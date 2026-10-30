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

  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
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
    queueMicrotask(() => {
      this.emit(new Blob(['dernier morceau']))
      this.onstop?.()
    })
  }

  emit(data: Blob) {
    this.ondataavailable?.({ data })
  }
}

export interface FakeTrack { stop(): void; stopped: boolean }

export function fakeStream() {
  const track: FakeTrack = { stopped: false, stop() { this.stopped = true } }
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream }
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
