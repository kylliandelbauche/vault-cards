import { audioExtension, INBOX_LIMITS, normalizeAudioType } from './inbox'

/**
 * Enregistrement du micro (#48), sans React : MediaRecorder + getUserMedia, testable avec des faux. Pas d'AudioContext :
 * sur iOS il modifie la session audio pendant la capture, et les barres de l'écran sont décoratives. Le micro est libéré
 * après le dernier morceau (arrêt) ou tout de suite (annulation, erreur, démontage). Un appel ou un verrouillage arrête
 * l'enregistrement proprement : ce qui a été capté reste envoyable. Deux garde-fous évitent de dépasser les 30 Mo du
 * bucket : la taille réelle reçue, et une durée maximale qui couvre un navigateur qui ne livrerait les données qu'à
 * l'arrêt ou ignorerait le débit demandé.
 */

/** `audio/mp4` d'abord : c'est le format natif de l'iPhone. Ailleurs : `audio/webm`, ou `audio/mp4` si le navigateur le propose. */
export const RECORD_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] as const
export const RECORD_BITRATE = 64_000
/** Arrêt avant la limite : il reste de la marge pour le dernier morceau, livré après l'arrêt. */
export const RECORD_STOP_BYTES = INBOX_LIMITS.FILE_MAX - 1024 * 1024
/** 20 min à 192 kbit/s (trois fois le débit demandé) = 29 Mo environ. */
export const RECORD_MAX_SECONDS = 20 * 60
/** Si le navigateur ne confirme jamais la fin, on termine quand même avec ce qui a été reçu, micro libéré. */
export const STOP_GUARD_MS = 2000

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'done'
/** Arrêt que l'utilisateur n'a pas demandé : limite de taille ou de durée, ou micro coupé par le système. */
export type StopReason = 'limit' | 'interrupted'

export interface RecorderSnapshot {
  phase: RecorderPhase
  seconds: number
  stopReason: StopReason | null
  error: string | null
  /** Enregistrement terminé, prêt à envoyer. */
  file: File | null
}

export const IDLE_RECORDER: RecorderSnapshot = { phase: 'idle', seconds: 0, stopReason: null, error: null, file: null }

export const NOT_SUPPORTED = 'Ton navigateur ne permet pas d’enregistrer. Tu peux importer un fichier audio.'

export function pickRecordType(isSupported: (type: string) => boolean): string | null {
  return RECORD_TYPES.find(isSupported) ?? null
}

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
    && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && pickRecordType(t => MediaRecorder.isTypeSupported(t)) !== null
}

/** Message d'un micro inaccessible : l'import de fichier reste toujours possible. */
export function micErrorMessage(e: unknown): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Micro refusé. Autorise-le dans les réglages du navigateur, ou importe un fichier audio.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Aucun micro détecté. Tu peux importer un fichier audio.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Micro indisponible, peut-être utilisé par une autre app. Réessaie, ou importe un fichier audio.'
  return 'Enregistrement impossible. Réessaie, ou importe un fichier audio.'
}

const pad = (n: number) => String(n).padStart(2, '0')

/** « Vocal du 30-10.m4a » : `/` est interdit dans un nom de fichier. Le nom n'est qu'affiché. */
export function recordingName(date: Date, ext: string): string {
  return `Vocal du ${pad(date.getDate())}-${pad(date.getMonth() + 1)}.${ext}`
}

export interface Recorder {
  start(): Promise<void>
  stop(): void
  /** Abandonne tout (enregistrement en cours ou terminé) et revient à l'état initial. */
  cancel(): void
}

/** `now` : horloge de la date du nom de fichier et du chrono (injectée en test). */
export function createRecorder(onChange: (snapshot: RecorderSnapshot) => void, now: () => Date = () => new Date()): Recorder {
  let snapshot = IDLE_RECORDER
  /** Change à chaque démarrage ou annulation : un rappel d'une session abandonnée n'a plus d'effet. */
  let session = 0
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let guard: ReturnType<typeof setTimeout> | undefined
  let unlisten = () => {}
  let finishNow = () => {}

  const update = (patch: Partial<RecorderSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    onChange(snapshot)
  }

  /** Plus de chrono ni d'écoute des interruptions : l'arrêt est lancé. */
  const settle = () => {
    clearInterval(timer)
    unlisten()
    unlisten = () => {}
  }

  /** Libère le micro : idempotent, appelé par tous les chemins de sortie. */
  const release = () => {
    settle()
    clearTimeout(guard)
    guard = undefined
    stream?.getTracks().forEach(t => t.stop())
    stream = null
  }

  /** Le micro reste ouvert jusqu'au dernier morceau (`onstop`), sous la protection du délai de garde. */
  const stop = () => {
    if (!recorder) return
    settle()
    if (recorder.state !== 'inactive') recorder.stop()
    guard ??= setTimeout(() => finishNow(), STOP_GUARD_MS)
  }

  const stopFor = (stopReason: StopReason) => {
    update({ stopReason })
    stop()
  }

  const finish = (chunks: Blob[], type: string) => {
    release()
    recorder = null
    const mime = normalizeAudioType(type)
    const total = chunks.reduce((sum, c) => sum + c.size, 0)
    if (!mime || total === 0) {
      update({ ...IDLE_RECORDER, error: 'Aucun son enregistré. Réessaie, ou importe un fichier audio.' })
      return
    }
    update({ phase: 'done', file: new File(chunks, recordingName(now(), audioExtension(mime)), { type: mime }) })
  }

  /** Appel, verrouillage, micro débranché : piste muette ou terminée, ou page cachée. */
  const watchInterruptions = (tracks: MediaStreamTrack[]) => {
    const interrupted = () => stopFor('interrupted')
    const onVisibility = () => { if (document.visibilityState === 'hidden') interrupted() }
    tracks.forEach(t => {
      t.addEventListener('mute', interrupted)
      t.addEventListener('ended', interrupted)
    })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      tracks.forEach(t => {
        t.removeEventListener('mute', interrupted)
        t.removeEventListener('ended', interrupted)
      })
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  const start = async () => {
    if (snapshot.phase === 'starting' || snapshot.phase === 'recording') return
    if (!isRecordingSupported()) {
      update({ ...IDLE_RECORDER, error: NOT_SUPPORTED })
      return
    }
    const mine = ++session
    update({ ...IDLE_RECORDER, phase: 'starting' })
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      if (mine === session) update({ ...IDLE_RECORDER, error: micErrorMessage(e) })
      return
    }
    if (mine !== session) { // annulé ou démonté pendant la demande d'autorisation
      media.getTracks().forEach(t => t.stop())
      return
    }
    stream = media
    const type = pickRecordType(t => MediaRecorder.isTypeSupported(t))!
    const chunks: Blob[] = []
    let bytes = 0
    let finished = false
    try {
      const rec = new MediaRecorder(media, { mimeType: type, audioBitsPerSecond: RECORD_BITRATE })
      recorder = rec
      const done = () => {
        if (mine !== session || finished) return
        finished = true
        finish(chunks, rec.mimeType || type)
      }
      finishNow = done
      rec.ondataavailable = e => {
        if (mine !== session || finished || e.data.size === 0) return
        chunks.push(e.data)
        bytes += e.data.size
        if (bytes >= RECORD_STOP_BYTES && rec.state !== 'inactive') stopFor('limit')
      }
      rec.onstop = done // fin réelle, quelle qu'en soit la cause
      rec.onerror = () => {
        if (mine !== session || finished) return
        update({ error: 'Enregistrement interrompu par une erreur du navigateur.' })
        stop()
      }
      rec.start(1000) // un morceau par seconde : la taille reste connue pendant l'enregistrement
    } catch (e) {
      release()
      recorder = null
      update({ ...IDLE_RECORDER, error: micErrorMessage(e) })
      return
    }
    const startedAt = now().getTime()
    unlisten = watchInterruptions(media.getTracks())
    timer = setInterval(() => {
      const seconds = Math.floor((now().getTime() - startedAt) / 1000)
      if (seconds !== snapshot.seconds) update({ seconds })
      if (seconds >= RECORD_MAX_SECONDS) stopFor('limit')
    }, 250)
    update({ phase: 'recording' })
  }

  const cancel = () => {
    session++
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    recorder = null
    release()
    if (snapshot !== IDLE_RECORDER) {
      snapshot = IDLE_RECORDER
      onChange(snapshot)
    }
  }

  return { start, stop, cancel }
}
