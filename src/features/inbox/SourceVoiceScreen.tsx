import { Page } from 'konsta/react'
import { useEffect, useRef, useState } from 'react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { DiscardDialog, SheetBar } from '../../components/SheetBar'
import { EDGES } from '../../components/TopBar'
import { addAudio, AUDIO_ACCEPT_ATTR, checkAudio, type InboxDeps, type InboxItem } from '../../lib/inbox'
import { createRecorder, IDLE_RECORDER, isRecordingSupported, NOT_SUPPORTED } from '../../lib/recorder'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { useLeaveGuard } from '../home/useLeaveGuard'
import { inboxErrorMessage } from './sourceName'

interface Props {
  deps: InboxDeps
  onClose(): void
  /** Audio déposé : écran Brouillons de la source. */
  onSent(item: InboxItem): void
}

const BARS = 16
const RED = 'bg-[#FF453A]' // rouge de Paper : barres et bouton d'enregistrement, jamais derrière du texte
const SECONDARY = 'flex min-h-11 items-center rounded-full bg-black/4 px-4 text-[14px] font-medium text-label-2 hover:bg-black/8 dark:bg-white/7 dark:hover:bg-white/12'

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`

/** Barres du niveau du micro : décoratives. Grises tant qu'aucun niveau n'est arrivé. */
function Levels({ levels }: { levels: readonly number[] }) {
  return (
    <div aria-hidden="true" className="flex h-14 shrink-0 items-center gap-1">
      {Array.from({ length: BARS }, (_, i) => {
        const level = levels[i]
        if (level === undefined) return <span key={i} className="h-2.5 w-1 rounded-[2px] bg-black/15 dark:bg-white/20" />
        const opacity = level > 0.6 ? 'opacity-100' : level > 0.3 ? 'opacity-70' : 'opacity-55'
        return <span key={i} className={`w-1 rounded-[2px] ${RED} ${opacity}`} style={{ height: `${10 + Math.round(level * 42)}px` }} />
      })}
    </div>
  )
}

/**
 * « Source · Vocal » (#48, Paper « Source · Vocal ») : enregistrer (chrono, arrêt) ou importer un fichier audio, puis
 * « Créer les brouillons » dans l'emplacement d'action du bas, comme sur Source · Texte. Pas de réécoute avant l'envoi ;
 * la langue est détectée sur le Mac. ✕ ou retour avec un enregistrement ou un fichier en attente : confirmation (#88).
 * Le bouton rond est posé sur la carte en verre, sans flou. Le micro est libéré à chaque sortie (recorder.ts).
 */
export function SourceVoiceScreen({ deps, onClose, onSent }: Props) {
  const [recording, setRecording] = useState(IDLE_RECORDER)
  const [recorder] = useState(() => createRecorder(setRecording))
  const [imported, setImported] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState<'close' | 'remove' | null>(null)
  const [supported] = useState(isRecordingSupported)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => () => recorder.cancel(), [recorder]) // démontage : micro libéré, enregistrement abandonné

  const { phase, seconds, levels, limited, file: recorded } = recording
  const active = phase === 'starting' || phase === 'recording'
  const pending = imported ?? recorded
  const dirty = active || pending !== null
  useLeaveGuard(dirty, () => setConfirming('close'))
  const close = () => (dirty ? setConfirming('close') : onClose())

  const toggle = () => {
    setError(null)
    if (phase === 'recording') recorder.stop()
    else void recorder.start()
  }

  const importFile = (el: HTMLInputElement) => {
    const file = el.files?.[0]
    el.value = '' // le même fichier peut être choisi de nouveau
    if (!file) return
    setError(null)
    try {
      checkAudio(file)
      setImported(file)
    } catch (e) {
      setError(inboxErrorMessage(e))
    }
  }

  const remove = () => {
    setConfirming(null)
    setImported(null)
    setError(null)
    recorder.cancel()
  }

  const submit = async () => {
    if (sending || !pending) return
    setSending(true)
    setError(null)
    try {
      onSent(await addAudio(deps, pending))
    } catch (e) {
      setError(inboxErrorMessage(e))
      setSending(false)
    }
  }

  const shownError = error ?? recording.error ?? (supported ? null : NOT_SUPPORTED)
  const caption = phase === 'recording' ? 'Enregistrement… touche pour arrêter'
    : phase === 'starting' ? 'Accès au micro…'
      : phase === 'done' ? limited ? 'Limite atteinte : enregistrement arrêté, prêt à envoyer' : 'Enregistrement prêt à envoyer'
        : 'Touche pour enregistrer'

  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <SheetBar title="Vocal" onClose={close} />
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col py-2 ${EDGES}`}>
        <div className="glass-card flex min-h-80 flex-1 flex-col items-center justify-center gap-7 rounded-[28px] p-6 text-center text-black dark:text-white">
          {imported
            ? (
              <div className="flex max-w-full min-w-0 flex-col items-center gap-1">
                <p className="max-w-full truncate text-[17px] leading-[22px] font-semibold">{imported.name}</p>
                <p className="text-[15px] leading-5 text-label-2">{megabytes(imported.size)} · prêt à envoyer</p>
              </div>
            )
            : (
              <>
                <p role="timer" className="text-[56px] leading-[60px] font-light tracking-[-0.02em] tabular-nums">{clock(seconds)}</p>
                <Levels levels={levels} />
                {phase !== 'done' && supported && (
                  <button
                    type="button"
                    aria-label={phase === 'recording' ? 'Arrêter l’enregistrement' : 'Démarrer l’enregistrement'}
                    disabled={phase === 'starting'}
                    onClick={toggle}
                    className="flex size-[88px] shrink-0 items-center justify-center rounded-full shadow-[0_0_30px_#FF453A73] ring-4 ring-black/15 disabled:opacity-60 dark:ring-white/35"
                  >
                    <span className={phase === 'recording' ? `size-[34px] rounded-lg ${RED}` : `size-14 rounded-full ${RED}`} />
                  </button>
                )}
                {(supported || phase === 'done') && <p role="status" className="text-[15px] leading-5 text-label-2">{caption}</p>}
              </>
            )}
          {pending && (
            <button type="button" disabled={sending} onClick={() => setConfirming('remove')} className={SECONDARY}>
              {imported ? 'Retirer le fichier' : 'Recommencer'}
            </button>
          )}
        </div>
      </main>
      <footer className={`action-dock sticky bottom-0 z-20 shrink-0 pt-3.5 pb-[max(12px,var(--k-safe-area-bottom))] ${EDGES}`}>
        <div className="mx-auto flex max-w-xl flex-col gap-2.5">
          {shownError && (
            <p role="alert" className="mx-auto w-fit rounded-[14px] bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">{shownError}</p>
          )}
          <input ref={input} type="file" accept={AUDIO_ACCEPT_ATTR} hidden aria-label="Choisir un fichier audio" onChange={e => importFile(e.currentTarget)} />
          <GlassButton
            tone="neutral"
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full px-5 text-[16px] font-semibold"
            disabled={sending || active || recorded !== null}
            onClick={() => input.current?.click()}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
              <path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
            </svg>
            Importer un fichier audio
          </GlassButton>
          <GlassButton tone="new" className={GLASS_PRIMARY} disabled={sending || !pending} onClick={() => void submit()}>
            {sending ? 'Envoi…' : 'Créer les brouillons'}
          </GlassButton>
        </div>
      </footer>
      {confirming && <DiscardDialog onDiscard={confirming === 'close' ? onClose : remove} onContinue={() => setConfirming(null)} />}
    </Page>
  )
}
