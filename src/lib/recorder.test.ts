import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bigBlob, FakeMediaRecorder, fakeStream, setMediaDevices, setPageVisibility } from './recorder.fixture'
import { createRecorder, isRecordingSupported, micErrorMessage, pickRecordType, RECORD_MAX_SECONDS, RECORD_STOP_BYTES, recordingName, STOP_GUARD_MS, type RecorderSnapshot } from './recorder'
import { INBOX_LIMITS } from './inbox'

const flush = async () => {
  await new Promise<void>(resolve => { queueMicrotask(resolve) })
  await new Promise<void>(resolve => { queueMicrotask(resolve) })
}

function setup(now?: () => Date) {
  const { track, stream } = fakeStream()
  setMediaDevices(() => Promise.resolve(stream))
  let last: RecorderSnapshot | null = null
  const recorder = createRecorder(s => { last = s }, now)
  return { track, recorder, state: () => last as RecorderSnapshot | null, rec: () => FakeMediaRecorder.instances[0] }
}

beforeEach(() => {
  FakeMediaRecorder.reset()
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setMediaDevices(undefined)
  delete (document as unknown as Record<string, unknown>).visibilityState
})

describe('choix du format', () => {
  it('audio/mp4 si proposé (iPhone), sinon audio/webm ; rien si aucun', () => {
    expect(pickRecordType(t => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickRecordType(t => t === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus')
    expect(pickRecordType(t => t === 'audio/webm')).toBe('audio/webm')
    expect(pickRecordType(() => false)).toBeNull()
  })

  it('navigateur compatible seulement avec MediaRecorder, le micro et un format connu', () => {
    setMediaDevices(() => Promise.resolve(fakeStream().stream))
    expect(isRecordingSupported()).toBe(true)
    FakeMediaRecorder.supported = ['audio/ogg']
    expect(isRecordingSupported()).toBe(false)
    FakeMediaRecorder.supported = ['audio/mp4']
    setMediaDevices(undefined)
    expect(isRecordingSupported()).toBe(false)
    setMediaDevices(() => Promise.resolve(fakeStream().stream))
    vi.stubGlobal('MediaRecorder', undefined)
    expect(isRecordingSupported()).toBe(false)
  })
})

describe('messages et nom', () => {
  it('refus, absence de micro, micro occupé, autre : en français, avec l’import comme issue', () => {
    expect(micErrorMessage(new DOMException('x', 'NotAllowedError'))).toMatch(/^Micro refusé.*importe un fichier/)
    expect(micErrorMessage(new DOMException('x', 'NotFoundError'))).toMatch(/^Aucun micro détecté.*importer un fichier/)
    expect(micErrorMessage(new DOMException('x', 'NotReadableError'))).toMatch(/^Micro indisponible/)
    expect(micErrorMessage(new Error('x'))).toMatch(/^Enregistrement impossible/)
  })

  it('nom d’un enregistrement : jour et mois, sans barre oblique', () => {
    expect(recordingName(new Date(2026, 9, 3), 'm4a')).toBe('Vocal du 03-10.m4a')
  })
})

describe('enregistrement', () => {
  it('démarre avec le format choisi, un débit modéré et des morceaux réguliers, sans AudioContext', async () => {
    const context = vi.fn()
    vi.stubGlobal('AudioContext', context)
    const { recorder, state, rec } = setup()
    await recorder.start()
    expect(state()?.phase).toBe('recording')
    expect(rec().options.mimeType).toBe('audio/mp4')
    expect(rec().options.audioBitsPerSecond).toBe(64_000)
    expect(rec().timeslice).toBe(1000)
    expect(context).not.toHaveBeenCalled()
    recorder.cancel()
  })

  it('arrêt : micro libéré après le dernier morceau, fichier prêt, type sans paramètre', async () => {
    const { recorder, state, rec, track } = setup(() => new Date(2026, 9, 30))
    await recorder.start()
    rec().mimeType = 'audio/mp4;codecs=mp4a.40.2'
    rec().emit(new Blob(['son']))
    recorder.stop()
    expect(track.stopped).toBe(false)
    await flush()
    expect(track.stopped).toBe(true)
    expect(rec().deliveredWhileOpen).toEqual([true, true])
    const s = state()!
    expect(s.phase).toBe('done')
    expect(s.stopReason).toBeNull()
    expect(s.file?.type).toBe('audio/mp4')
    expect(s.file?.name).toBe('Vocal du 30-10.m4a')
    expect(s.file?.size).toBe(3 + 'dernier morceau'.length)
  })

  it('le navigateur ne confirme jamais la fin : après le délai de garde, micro libéré et données gardées', async () => {
    vi.useFakeTimers()
    const { recorder, state, rec, track } = setup()
    await recorder.start()
    rec().silentStop = true
    rec().emit(new Blob(['son']))
    recorder.stop()
    vi.advanceTimersByTime(STOP_GUARD_MS - 1)
    expect(track.stopped).toBe(false)
    vi.advanceTimersByTime(1)
    expect(track.stopped).toBe(true)
    expect(state()).toMatchObject({ phase: 'done' })
    expect(state()?.file?.size).toBe(3)
    rec().onstop?.() // confirmation tardive : sans effet
    expect(state()?.file?.size).toBe(3)
  })

  it('annulation : pistes libérées tout de suite, retour à l’état initial, données jetées', async () => {
    const { recorder, state, rec, track } = setup()
    await recorder.start()
    rec().emit(new Blob(['son']))
    recorder.cancel()
    expect(track.stopped).toBe(true)
    await flush()
    expect(state()).toMatchObject({ phase: 'idle', file: null, seconds: 0 })
  })

  it('annulé pendant la demande d’accès au micro : le micro accordé ensuite est aussitôt libéré', async () => {
    const { track, stream } = fakeStream()
    let grant: (s: MediaStream) => void = () => {}
    setMediaDevices(() => new Promise(resolve => { grant = resolve }))
    const recorder = createRecorder(() => {})
    const started = recorder.start()
    recorder.cancel()
    grant(stream)
    await started
    expect(track.stopped).toBe(true)
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('rien de capté : message clair, pas de fichier vide', async () => {
    const { recorder, state, rec, track } = setup()
    await recorder.start()
    rec().silentStop = true
    recorder.stop()
    rec().onstop?.()
    expect(track.stopped).toBe(true)
    expect(state()).toMatchObject({ phase: 'idle', file: null })
    expect(state()?.error).toMatch(/^Aucun son enregistré/)
  })

  it('arrêt automatique avant 30 Mo d’après la taille reçue', async () => {
    expect(RECORD_STOP_BYTES).toBeLessThan(INBOX_LIMITS.FILE_MAX)
    const { recorder, state, rec, track } = setup()
    await recorder.start()
    rec().emit(bigBlob(RECORD_STOP_BYTES - 10))
    expect(rec().state).toBe('recording')
    rec().emit(bigBlob(10))
    expect(rec().state).toBe('inactive')
    await flush()
    expect(track.stopped).toBe(true)
    expect(state()).toMatchObject({ phase: 'done', stopReason: 'limit' })
  })

  it('arrêt automatique à la durée maximale ; le chrono suit l’horloge', async () => {
    expect(RECORD_MAX_SECONDS * (192_000 / 8)).toBeLessThan(RECORD_STOP_BYTES)
    vi.useFakeTimers()
    let t = 0
    const { recorder, state, rec, track } = setup(() => new Date(t))
    await recorder.start()
    t = 84_000
    vi.advanceTimersByTime(250)
    expect(state()?.seconds).toBe(84)
    expect(rec().state).toBe('recording')
    t = RECORD_MAX_SECONDS * 1000
    vi.advanceTimersByTime(250)
    expect(rec().state).toBe('inactive')
    await flush()
    expect(track.stopped).toBe(true)
    expect(state()).toMatchObject({ phase: 'done', stopReason: 'limit' })
  })

  it('refus du micro : message, retour à l’état initial, aucun recorder', async () => {
    setMediaDevices(() => Promise.reject(new DOMException('x', 'NotAllowedError')))
    let last: RecorderSnapshot | null = null
    const recorder = createRecorder(s => { last = s })
    await recorder.start()
    expect(last).toMatchObject({ phase: 'idle' })
    expect((last as RecorderSnapshot | null)?.error).toMatch(/^Micro refusé/)
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('MediaRecorder refuse de démarrer : pistes libérées', async () => {
    const { recorder, state, track } = setup()
    vi.stubGlobal('MediaRecorder', class extends FakeMediaRecorder {
      start() { throw new DOMException('x', 'NotSupportedError') }
    })
    await recorder.start()
    expect(track.stopped).toBe(true)
    expect(state()?.phase).toBe('idle')
    expect(state()?.error).toMatch(/^Enregistrement impossible/)
  })

  it('erreur du navigateur pendant l’enregistrement : message, arrêt, données gardées', async () => {
    const { recorder, state, rec, track } = setup()
    await recorder.start()
    rec().emit(new Blob(['son']))
    rec().onerror?.()
    expect(rec().state).toBe('inactive')
    await flush()
    expect(track.stopped).toBe(true)
    expect(state()?.phase).toBe('done')
    expect(state()?.error).toMatch(/^Enregistrement interrompu/)
  })
})

describe('interruption par le système (appel, verrouillage)', () => {
  it.each(['mute', 'ended'])('piste « %s » : arrêt, ce qui a été capté reste prêt à envoyer', async event => {
    const { recorder, state, rec, track } = setup()
    await recorder.start()
    rec().emit(new Blob(['son']))
    track.dispatchEvent(new Event(event))
    expect(rec().state).toBe('inactive')
    await flush()
    expect(track.stopped).toBe(true)
    expect(state()).toMatchObject({ phase: 'done', stopReason: 'interrupted' })
    expect(state()?.file?.size).toBe(3 + 'dernier morceau'.length)
  })

  it('page cachée : arrêt ; page de nouveau visible : aucun effet', async () => {
    const { recorder, state, rec } = setup()
    await recorder.start()
    rec().emit(new Blob(['son']))
    setPageVisibility('visible')
    expect(rec().state).toBe('recording')
    setPageVisibility('hidden')
    expect(rec().state).toBe('inactive')
    await flush()
    expect(state()).toMatchObject({ phase: 'done', stopReason: 'interrupted' })
  })

  it('arrêt demandé : une piste qui passe ensuite en « ended » ne change pas le motif', async () => {
    const { recorder, state, rec, track } = setup()
    await recorder.start()
    rec().emit(new Blob(['son']))
    recorder.stop()
    track.dispatchEvent(new Event('ended'))
    await flush()
    expect(state()).toMatchObject({ phase: 'done', stopReason: null })
  })

  it('annulé : plus aucune écoute, un événement tardif n’a aucun effet', async () => {
    const { recorder, state, track } = setup()
    await recorder.start()
    recorder.cancel()
    track.dispatchEvent(new Event('mute'))
    setPageVisibility('hidden')
    await flush()
    expect(state()).toMatchObject({ phase: 'idle', stopReason: null })
  })
})
