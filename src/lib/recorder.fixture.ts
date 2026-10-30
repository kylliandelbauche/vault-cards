/** Faux MediaRecorder et faux micro pour les tests (#48) : l'arrêt est asynchrone, comme dans un vrai navigateur. */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static supported: string[] = ['audio/mp4']
  static isTypeSupported = (type: string) => FakeMediaRecorder.supported.includes(type)
  static reset(supported: string[] = ['audio/mp4']) {
    FakeMediaRecorder.instances = []
    FakeMediaRecorder.supported = supported
  }

  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  options: MediaRecorderOptions
  timeslice: number | undefined
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  /** Faux : le navigateur ne confirme jamais la fin. */
  silentStop = false
  /** Morceaux pour lesquels le micro était encore ouvert à la livraison. */
  deliveredWhileOpen: boolean[] = []
  private stream: MediaStream

  constructor(stream: MediaStream, options: MediaRecorderOptions) {
    this.stream = stream
    this.options = options
    this.mimeType = options.mimeType ?? ''
    FakeMediaRecorder.instances.push(this)
  }

  start(timeslice?: number) {
    this.timeslice = timeslice
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    if (this.silentStop) return
    queueMicrotask(() => {
      this.emit(new Blob(['dernier morceau']))
      this.onstop?.()
    })
  }

  emit(data: Blob) {
    this.deliveredWhileOpen.push(this.stream.getTracks().every(t => !(t as unknown as FakeTrack).stopped))
    this.ondataavailable?.({ data })
  }
}

/** Fausse piste : de vrais événements (`mute`, `ended`), et seulement si quelqu'un les écoute. */
export class FakeTrack extends EventTarget {
  stopped = false
  stop() { this.stopped = true }
}

export function fakeStream() {
  const track = new FakeTrack()
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream }
}

/** Page cachée (verrouillage, appel) ou de nouveau visible : déclenche le vrai événement. */
export function setPageVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Blob de `size` octets annoncés, sans allouer la mémoire. */
export function bigBlob(size: number): Blob {
  const blob = new Blob(['x'])
  Object.defineProperty(blob, 'size', { value: size })
  return blob
}

/** Pose `navigator.mediaDevices` ; `undefined` : navigateur sans accès au micro. */
export function setMediaDevices(getUserMedia: (() => Promise<MediaStream>) | undefined) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: getUserMedia ? { getUserMedia } : undefined })
}
