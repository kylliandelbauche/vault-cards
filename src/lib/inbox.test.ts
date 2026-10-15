import { describe, it, expect, vi } from 'vitest'
import { addFile, addText, checkFile, checkText, fitWithin, InboxError, INBOX_LIMITS, listInbox, prepareFile, type InboxClient } from './inbox'

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

function fakeClient({ session = true, uploadError = null as null | { message: string }, rpcError = null as null | { message: string; code?: string } } = {}) {
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
        limit: (n: number) => { calls.push(['limit', n]); return Promise.resolve({ data: [row()], error: null }) },
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
