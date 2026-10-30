import { describe, it, expect, vi } from 'vitest'
import { uploadErrorMessage, addAudio, addFile, addText, canvasCompressor, checkAudio, checkFile, checkText, cleanFilename, fitWithin, InboxError, INBOX_LIMITS, listInbox, normalizeAudioType, prepareFile, type InboxClient } from './inbox'

const MB = 1024 * 1024
const ID = '11111111-1111-4111-8111-111111111111'
const UID = '22222222-2222-4222-8222-222222222222'

/** Fichier de `size` octets sans allouer la mémoire (seuls name/size/type comptent pour les contrôles). */
const fakeFile = (name: string, size: number, type = '') => {
  if (size <= MB) return new File([new Uint8Array(size)], name, { type }) // vrai contenu : survit à new Blob([file])
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const row = (extra: object = {}) => ({
  id: ID, kind: 'text', text: 'T', storage_path: null, filename: null, mime: null, size: null, status: 'pending', error: null,
  created_at: '2026-10-15T10:00:00Z', processed_at: null, ...extra,
})

function fakeClient({ session = true, uploadError = null as null | { message: string }, rpcError = null as null | { message: string; code?: string }, listed = [row()], listError = null as null | { message: string } } = {}) {
  const calls: unknown[][] = []
  const types: string[] = []
  const client = {
    auth: { getSession: vi.fn(async () => ({ data: { session: session ? { user: { id: UID } } : null }, error: null })) },
    storage: {
      from: (bucket: string) => ({
        upload: vi.fn(async (path: string, body: Blob, opts: object) => {
          calls.push(['upload', bucket, path, body.size, opts])
          types.push(body.type)
          return uploadError ? { data: null, error: uploadError } : { data: { path }, error: null }
        }),
      }),
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push(['rpc', fn, args])
      return rpcError ? { data: null, error: rpcError } : { data: row({ id: args.p_id, kind: args.p_kind }), error: null }
    }),
    from: (table: string) => {
      const q = {
        select: (cols: string) => { calls.push(['select', table, cols]); return q },
        order: (col: string, o: object) => { calls.push(['order', col, o]); return q },
        limit: (n: number) => { calls.push(['limit', n]); return Promise.resolve({ data: listError ? null : listed, error: listError }) },
      }
      return q
    },
  }
  return { client: client as unknown as InboxClient, calls, types }
}

const deps = (client: InboxClient, extra = {}) => ({ client, online: () => true, uuid: () => ID, ...extra })

describe('contrôles côté client', () => {
  it('checkText : trim, refuse vide et > 100 000 caractères (points de code)', () => {
    expect(checkText('  Bonjour  ')).toBe('Bonjour')
    expect(() => checkText('   ')).toThrow(InboxError)
    expect(checkText('😀'.repeat(INBOX_LIMITS.TEXT_MAX))).toHaveLength(INBOX_LIMITS.TEXT_MAX * 2)
    expect(() => checkText('x'.repeat(INBOX_LIMITS.TEXT_MAX + 1))).toThrow('trop long')
  })

  it.each([
    ['cours.pdf', 'application/pdf'], ['notes.TXT', 'text/plain'], ['fiche.md', 'text/markdown'],
    ['photo.jpeg', 'image/jpeg'], ['photo.JPG', 'image/jpeg'], ['capture.png', 'image/png'], ['image.webp', 'image/webp'],
  ])('checkFile : %s → %s (type déduit de l’extension)', (name, mime) => {
    expect(checkFile(fakeFile(name, 1000)).mime).toBe(mime)
  })

  it('checkFile : extension hors liste, fichier vide, > 30 Mo refusés', () => {
    expect(() => checkFile(fakeFile('doc.docx', 1000))).toThrow('Format non pris en charge')
    expect(() => checkFile(fakeFile('sans-extension', 1000))).toThrow('Format non pris en charge')
    expect(() => checkFile(fakeFile('photo.heic', 1000, 'image/heic'))).toThrow('Format non pris en charge')
    expect(() => checkFile(fakeFile('vide.pdf', 0))).toThrow('vide')
    expect(() => checkFile(fakeFile('gros.pdf', 30 * MB + 1))).toThrow('30 Mo')
    expect(checkFile(fakeFile('pile.pdf', 30 * MB)).mime).toBe('application/pdf')
  })

  it('fitWithin : réduit le plus grand côté à 2048 px en gardant les proportions, jamais d’agrandissement', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3000, 6000, 2048)).toEqual({ width: 1024, height: 2048 })
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 })
  })
})

describe('cleanFilename', () => {
  it('retire caractères de contrôle et séparateurs, garde l’extension, tronque à 255 caractères', () => {
    expect(cleanFilename('  mon\u0000 cours\n/de\\chimie.pdf ')).toBe('mon cours de chimie.pdf')
    const long = cleanFilename('😀'.repeat(300) + '.pdf')
    expect(Array.from(long)).toHaveLength(255)
    expect(long.endsWith('.pdf')).toBe(true)
    expect(cleanFilename('\u0001\u0002.md')).toBe('fichier.md')
  })

  it('prepareFile renvoie le nom nettoyé', async () => {
    expect((await prepareFile(fakeFile('a\tb.pdf', 10))).filename).toBe('a b.pdf')
  })
})

describe('canvasCompressor', () => {
  it('fond blanc peint avant l’image (PNG transparent → JPEG), dimensions réduites, JPEG qualité demandée', async () => {
    const ops: unknown[][] = []
    const ctx = {
      set fillStyle(v: string) { ops.push(['fillStyle', v]) },
      fillRect: (...a: number[]) => ops.push(['fillRect', ...a]),
      drawImage: (_b: unknown, ...a: number[]) => ops.push(['drawImage', ...a]),
    }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob) => void, type: string, q: number) => { ops.push(['toBlob', type, q]); cb(new Blob(['j'], { type })) } }
    const create = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : create(tag))) as typeof document.createElement)
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4096, height: 2048, close })))
    try {
      const out = await canvasCompressor(new Blob(['png']), 2048, 0.8)
      expect(out.type).toBe('image/jpeg')
      expect([canvas.width, canvas.height]).toEqual([2048, 1024])
      expect(ops).toEqual([['fillStyle', '#ffffff'], ['fillRect', 0, 0, 2048, 1024], ['drawImage', 0, 0, 2048, 1024], ['toBlob', 'image/jpeg', 0.8]])
      expect(close).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})

describe('prepareFile : compression des images', () => {
  it('image > 2 Mo : recompressée en JPEG 2048 px qualité 0,8, renommée .jpg', async () => {
    const compress = vi.fn(async () => new Blob(['petit'], { type: 'image/jpeg' }))
    const p = await prepareFile(fakeFile('IMG_1.PNG', 5 * MB), compress)
    expect(compress).toHaveBeenCalledWith(expect.any(File), 2048, 0.8)
    expect(p).toMatchObject({ filename: 'IMG_1.jpg', mime: 'image/jpeg' })
    expect(p.blob.size).toBe(5)
  })

  it('image ≤ 2 Mo, PDF ou texte : envoyés tels quels', async () => {
    const compress = vi.fn()
    expect((await prepareFile(fakeFile('a.png', 2 * MB), compress)).mime).toBe('image/png')
    expect((await prepareFile(fakeFile('a.pdf', 20 * MB), compress)).mime).toBe('application/pdf')
    expect(compress).not.toHaveBeenCalled()
  })

  it('image illisible ou encore > 10 Mo après compression : refusée', async () => {
    await expect(prepareFile(fakeFile('a.jpg', 5 * MB), async () => { throw new Error('decode') })).rejects.toThrow('illisible')
    const huge = new Blob(['x'])
    Object.defineProperty(huge, 'size', { value: 10 * MB + 1 })
    await expect(prepareFile(fakeFile('a.jpg', 25 * MB), async () => huge)).rejects.toThrow('10 Mo')
  })
})

describe('dépôt dans la boîte de réception', () => {
  it('addText : RPC create_inbox_item (kind text, id client) ; renvoie l’élément pending', async () => {
    const { client, calls } = fakeClient()
    const item = await addText(deps(client), '  Mon texte  ')
    expect(calls).toEqual([['rpc', 'create_inbox_item', { p_id: ID, p_kind: 'text', p_text: 'Mon texte' }]])
    expect(item).toMatchObject({ id: ID, status: 'pending' })
  })

  it('hors ligne : erreur claire, aucun appel', async () => {
    const { client, calls } = fakeClient()
    await expect(addText(deps(client, { online: () => false }), 'x')).rejects.toMatchObject({ code: 'offline' })
    await expect(addFile(deps(client, { online: () => false }), fakeFile('a.pdf', 10))).rejects.toMatchObject({ code: 'offline' })
    expect(calls).toEqual([])
  })

  it('addFile : envoi vers inbox/<uid>/<id> (sans écrasement) PUIS création de l’élément', async () => {
    const { client, calls } = fakeClient()
    await addFile(deps(client), fakeFile('cours.pdf', 1234))
    expect(calls).toEqual([
      ['upload', 'inbox', `${UID}/${ID}`, 1234, { contentType: 'application/pdf', upsert: false }],
      ['rpc', 'create_inbox_item', { p_id: ID, p_kind: 'file', p_filename: 'cours.pdf' }],
    ])
  })

  it('addFile : le corps envoyé porte le type déduit de l’extension (Storage ignore contentType pour un Blob/File)', async () => {
    const { client, calls, types } = fakeClient()
    await addFile(deps(client), fakeFile('fiche.md', 12)) // type vide, comme souvent sur Safari/iOS
    await addFile(deps(client), fakeFile('notes.markdown', 12, 'text/x-markdown'))
    await addFile(deps(client), fakeFile('photo.JPG', 12, 'application/octet-stream'))
    expect(types).toEqual(['text/markdown', 'text/markdown', 'image/jpeg'])
    expect(calls.filter(c => c[0] === 'upload').map(c => c[3])).toEqual([12, 12, 12])
  })

  it('addFile : fichier refusé avant tout appel ; sans session, envoi en échec ou quota plein → erreur, pas d’élément', async () => {
    const bad = fakeClient()
    await expect(addFile(deps(bad.client), fakeFile('a.docx', 10))).rejects.toMatchObject({ code: 'format' })
    expect(bad.calls).toEqual([])

    const noSession = fakeClient({ session: false })
    await expect(addFile(deps(noSession.client), fakeFile('a.pdf', 10))).rejects.toMatchObject({ code: 'session' })
    expect(noSession.calls).toEqual([])

    const failed = fakeClient({ uploadError: { message: 'mime type not supported' } })
    await expect(addFile(deps(failed.client), fakeFile('a.pdf', 10))).rejects.toMatchObject({ code: 'server' })
    expect(failed.calls.map(c => c[0])).toEqual(['upload'])

    const full = fakeClient({ rpcError: { message: 'boîte de réception pleine', code: '54000' } })
    await expect(addText(deps(full.client), 'x')).rejects.toMatchObject({ code: 'full' })
  })

  it('listInbox : statuts sans le contenu, du plus récent au plus ancien', async () => {
    const { client, calls } = fakeClient()
    const items = await listInbox(client)
    expect(calls).toEqual([
      ['select', 'inbox', 'id, kind, filename, mime, size, status, error, created_at, processed_at'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 50],
    ])
    expect(items[0].status).toBe('pending')
  })
})

describe('audio (#48)', () => {
  it.each([
    ['audio/mp4', 'audio/mp4'],
    ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
    ['audio/x-m4a', 'audio/x-m4a'],
    ['audio/m4a', 'audio/m4a'],
    ['audio/webm;codecs=opus', 'audio/webm'],
    ['AUDIO/WEBM ; codecs=opus', 'audio/webm'],
    ['audio/wav', 'audio/wav'],
    ['audio/x-wav', 'audio/x-wav'],
    ['audio/wave', 'audio/wav'],
    ['audio/mpeg', 'audio/mpeg'],
    ['audio/mp3', 'audio/mpeg'],
  ])('%s → %s', (type, expected) => {
    expect(normalizeAudioType(type)).toBe(expected)
  })

  it.each(['', 'audio/ogg', 'video/mp4', 'application/pdf'])('« %s » : hors liste', type => {
    expect(normalizeAudioType(type)).toBeNull()
  })

  it('checkAudio : l’extension fait foi, sinon le type annoncé ; format, vide et taille refusés', () => {
    expect(checkAudio(fakeFile('note.m4a', 10, 'audio/x-m4a'))).toBe('audio/mp4')
    expect(checkAudio(fakeFile('video.MP4', 10, 'video/mp4'))).toBe('audio/mp4')
    expect(checkAudio(fakeFile('note.webm', 10))).toBe('audio/webm')
    expect(checkAudio(fakeFile('note.wav', 10))).toBe('audio/wav')
    expect(checkAudio(fakeFile('note.mp3', 10))).toBe('audio/mpeg')
    expect(checkAudio(fakeFile('sans-extension', 10, 'audio/webm;codecs=opus'))).toBe('audio/webm')
    expect(() => checkAudio(fakeFile('photo.png', 10, 'image/png'))).toThrow(/Format non pris en charge/)
    expect(() => checkAudio(fakeFile('note.ogg', 10, 'audio/ogg'))).toThrow(/Format non pris en charge/)
    expect(() => checkAudio(fakeFile('note.m4a', 0))).toThrow(/vide/)
    expect(checkAudio(fakeFile('note.m4a', INBOX_LIMITS.FILE_MAX))).toBe('audio/mp4') // 30 Mo pile : la limite de 10 Mo est réservée aux images
    expect(() => checkAudio(fakeFile('note.m4a', INBOX_LIMITS.FILE_MAX + 1))).toThrow(/30 Mo/)
  })

  it('addAudio : envoi sans compression, type sans paramètre, puis création de l’élément', async () => {
    const { client, calls, types } = fakeClient()
    const compress = vi.fn()
    const file = fakeFile('Vocal du 30-10.webm', 100, 'audio/webm;codecs=opus')
    await addAudio({ client, online: () => true, uuid: () => ID, compress }, file)
    expect(compress).not.toHaveBeenCalled()
    expect(types).toEqual(['audio/webm'])
    const writes = calls.filter(c => c[0] === 'upload' || c[0] === 'rpc')
    expect(writes[0]).toEqual(['upload', 'inbox', `${UID}/${ID}`, 100, { contentType: 'audio/webm', upsert: false }])
    expect(writes[1]).toEqual(['rpc', 'create_inbox_item', { p_id: ID, p_kind: 'file', p_filename: 'Vocal du 30-10.webm' }])
  })

  it('addAudio : file pleine, refus avant l’envoi ; 9 en attente ou éléments terminés, envoi', async () => {
    const pending = (n: number, status = 'pending') => Array.from({ length: n }, () => row({ status }))
    const full = fakeClient({ listed: [...pending(6), ...pending(4, 'processing')] })
    await expect(addAudio({ client: full.client, online: () => true, uuid: () => ID }, fakeFile('a.m4a', 5))).rejects.toMatchObject({ code: 'full' })
    expect(full.calls.filter(c => c[0] === 'upload' || c[0] === 'rpc')).toEqual([])
    const room = fakeClient({ listed: [...pending(9), ...pending(5, 'done')] })
    await addAudio({ client: room.client, online: () => true, uuid: () => ID }, fakeFile('a.m4a', 5))
    expect(room.calls.filter(c => c[0] === 'upload')).toHaveLength(1)
  })

  it('addAudio : lecture de la file impossible, l’envoi continue (la RPC reste juge)', async () => {
    const { client, calls } = fakeClient({ listError: { message: 'réseau' } })
    await addAudio({ client, online: () => true, uuid: () => ID }, fakeFile('a.m4a', 5))
    expect(calls.filter(c => c[0] === 'upload')).toHaveLength(1)
  })

  it('addAudio : hors ligne, session expirée et format refusé ne déposent rien', async () => {
    const off = fakeClient()
    await expect(addAudio({ client: off.client, online: () => false }, fakeFile('a.m4a', 5))).rejects.toMatchObject({ code: 'offline' })
    expect(off.calls).toEqual([])
    const noSession = fakeClient({ session: false })
    await expect(addAudio({ client: noSession.client, online: () => true }, fakeFile('a.m4a', 5))).rejects.toMatchObject({ code: 'session' })
    expect(noSession.calls).toEqual([])
    const bad = fakeClient()
    await expect(addAudio({ client: bad.client, online: () => true }, fakeFile('a.ogg', 5))).rejects.toBeInstanceOf(InboxError)
    expect(bad.calls).toEqual([])
  })
})

describe('uploadErrorMessage', () => {
  it('traduit les refus de Storage sans recopier le texte anglais', () => {
    expect(uploadErrorMessage('mime type audio/webm is not supported')).toBe('Envoi du fichier refusé : format non accepté par le serveur')
    expect(uploadErrorMessage('The object exceeded the maximum allowed size')).toBe('Envoi du fichier refusé : fichier trop gros (30 Mo au maximum)')
    expect(uploadErrorMessage('Internal Server Error')).toBe('Envoi du fichier refusé : réessaie plus tard')
  })
})
