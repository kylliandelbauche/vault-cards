import { Page } from 'konsta/react'
import { useMemo, useState } from 'react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { DiscardDialog, SheetBar } from '../../components/SheetBar'
import { EDGES } from '../../components/TopBar'
import { addText, INBOX_LIMITS, type InboxDeps, type InboxItem } from '../../lib/inbox'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { useLeaveGuard } from '../home/useLeaveGuard'
import { inboxErrorMessage } from './sourceName'

interface Props {
  deps: InboxDeps
  onClose(): void
  /** Texte déposé : écran Brouillons de la source. */
  onSent(item: InboxItem): void
}

const canPaste = () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'

/**
 * « Source · Texte » (#81) : une zone de saisie dans une carte en verre (liseré bleu au focus), « Coller » et le nombre
 * de caractères dessous ; « Créer les brouillons » dans l'emplacement d'action du bas (celui de « Tout valider »), rien
 * dessous. ✕ avec du texte saisi : confirmation. Hors ligne : le refus d'inbox.ts s'affiche au-dessus du bouton.
 */
export function SourceTextScreen({ deps, onClose, onSent }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const count = useMemo(() => Array.from(text.trim()).length, [text])
  const tooLong = count > INBOX_LIMITS.TEXT_MAX

  const dirty = text.trim() !== ''
  useLeaveGuard(dirty, () => setConfirming(true)) // #88 : retour du navigateur / geste iOS = même confirmation que le ✕
  const close = () => (dirty ? setConfirming(true) : onClose())

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip) setText(t => (t ? `${t}\n${clip}` : clip))
    } catch {
      setError('Collage refusé : colle le texte à la main.')
    }
  }

  const submit = async () => {
    if (sending) return
    setSending(true)
    setError(null)
    try {
      onSent(await addText(deps, text))
    } catch (e) {
      setError(inboxErrorMessage(e))
      setSending(false)
    }
  }

  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <SheetBar title="Texte" onClose={close} />
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col py-2 ${EDGES}`}>
        <div className="glass-card flex min-h-60 flex-1 flex-col gap-3 rounded-[24px] p-[18px] text-black focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-new dark:text-white">
          <label htmlFor="source-text" className="sr-only">Texte dont tirer des cartes</label>
          <textarea
            id="source-text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Colle ou écris le texte dont tirer des cartes."
            className="min-h-0 flex-1 resize-none bg-transparent text-[17px] leading-[25px] outline-none placeholder:text-label-2"
          />
          <div className="flex items-center justify-between gap-3">
            {canPaste() && (
              <button
                type="button"
                onClick={() => void paste()}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-black/4 px-3.5 text-[14px] font-medium text-label-2 hover:bg-black/8 dark:bg-white/7 dark:hover:bg-white/12"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="8" y="3" width="8" height="4" rx="1" />
                  <path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
                </svg>
                Coller
              </button>
            )}
            <span className={`ms-auto text-[13px] leading-4 tabular-nums ${tooLong ? 'font-semibold text-again' : 'text-label-2'}`}>
              {count} {count > 1 ? 'caractères' : 'caractère'}{tooLong && ` : ${INBOX_LIMITS.TEXT_MAX.toLocaleString('fr-FR')} au maximum`}
            </span>
          </div>
        </div>
      </main>
      <footer className={`action-dock sticky bottom-0 z-20 shrink-0 pt-3.5 pb-[max(12px,var(--k-safe-area-bottom))] ${EDGES}`}>
        <div className="mx-auto max-w-xl">
          {error && (
            <p role="alert" className="mx-auto mb-1.5 w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">{error}</p>
          )}
          <GlassButton tone="new" className={GLASS_PRIMARY} disabled={sending || count === 0 || tooLong} onClick={() => void submit()}>
            {sending ? 'Envoi…' : 'Créer les brouillons'}
          </GlassButton>
        </div>
      </footer>
      {confirming && <DiscardDialog onDiscard={onClose} onContinue={() => setConfirming(false)} />}
    </Page>
  )
}
