import { useRef, useState, type ReactNode } from 'react'
import { GlassButton } from '../../components/GlassButton'
import type { VaultDB } from '../../lib/db'
import { ACCEPT_ATTR, addFile, type InboxDeps, type InboxItem } from '../../lib/inbox'
import { drafts as draftsLabel, inboxErrorMessage } from './sourceName'
import { useDrafts } from './useDrafts'

interface Props {
  db: VaultDB
  deps: InboxDeps
  /** Tuile « À la main » : fenêtre Nouvelle carte. */
  onManual(): void
  /** Tuile « Texte » : écran Source · Texte. */
  onText(): void
  /** Fichier ou photo envoyé : écran Brouillons de la source. */
  onSent(item: InboxItem): void
  /** Ligne « n brouillons à valider » : tous les brouillons en attente. */
  onOpenDrafts(): void
}

const icon = (paths: ReactNode) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[26px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
)

const MANUAL = (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[26px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
)
const FILE = icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>)
const PHOTO = icon(<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>)
const TEXT = icon(<><path d="M4 6h16M4 11h16M4 16h10" /><path d="M17.5 14.5l2.5 2.5-4 4h-2.5V18.5z" /></>)
const VOICE = icon(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>)

const TILE = 'on-glass tag-chip flex h-[84px] w-[87px] flex-col items-center justify-center gap-2 rounded-[20px] text-[13px] leading-4 font-medium'

/**
 * Bloc « Nouvelles cartes » de l'accueil (#81, Paper « Accueil · v4 ») : rangée défilante de 5 tuiles (À la main → Nouvelle carte) en verre neutre posées sur la carte
 * (`on-glass`, pas de flou imbriqué). Fichier et Photo : sélecteur natif puis envoi direct (inbox.ts), puis écran
 * Brouillons ; Texte : écran Source · Texte ; Vocal : pas encore (#48), un message le dit. Sous les tuiles, quand des
 * brouillons attendent : une ligne discrète qui y mène.
 */
export function NewCardsBlock({ db, deps, onManual, onText, onSent, onOpenDrafts }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'file' | 'photo' | null>(null)
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null)
  const { drafts } = useDrafts(db)
  const waiting = drafts?.length ?? 0

  const send = async (input: HTMLInputElement, which: 'file' | 'photo') => {
    const file = input.files?.[0]
    input.value = '' // le même fichier peut être choisi de nouveau
    if (!file || busy) return
    setBusy(which)
    setMessage(null)
    try {
      onSent(await addFile(deps, file))
    } catch (e) {
      setMessage({ text: inboxErrorMessage(e), alert: true })
    } finally {
      setBusy(null)
    }
  }

  const label = (which: 'file' | 'photo', text: string) => (busy === which ? 'Envoi…' : text)

  return (
    <section aria-labelledby="new-cards" className="glass-card rounded-[28px] pt-3.5 pb-3 text-black dark:text-white">
      <h2 id="new-cards" className="mx-[18px] flex min-h-11 items-center text-[20px] leading-6 font-semibold">Nouvelles cartes</h2>
      {/* Rangée défilante (Accueil · v4), comme les tags : les tuiles glissent jusqu'au bord de la carte. */}
      <ul role="list" aria-label="Ajouter des cartes" className="chip-row mt-1.5 flex gap-2.5 scroll-px-[18px] px-[18px] py-1">
        <li className="shrink-0">
          <GlassButton tone="neutral" className={TILE} disabled={busy !== null} onClick={onManual}>
            {MANUAL}<span>À la main</span>
          </GlassButton>
        </li>
        <li className="shrink-0">
          <GlassButton tone="neutral" className={TILE} aria-busy={busy === 'file' || undefined} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            {FILE}<span>{label('file', 'Fichier')}</span>
          </GlassButton>
        </li>
        <li className="shrink-0">
          <GlassButton tone="neutral" className={TILE} aria-busy={busy === 'photo' || undefined} disabled={busy !== null} onClick={() => photoInput.current?.click()}>
            {PHOTO}<span>{label('photo', 'Photo')}</span>
          </GlassButton>
        </li>
        <li className="shrink-0">
          <GlassButton tone="neutral" className={TILE} disabled={busy !== null} onClick={onText}>
            {TEXT}<span>Texte</span>
          </GlassButton>
        </li>
        <li className="shrink-0">
          <GlassButton
            tone="neutral"
            className={`${TILE} tag-chip-empty`}
            aria-disabled="true"
            aria-label="Vocal, bientôt disponible"
            onClick={() => setMessage({ text: 'Le vocal arrive bientôt.', alert: false })}
          >
            {VOICE}<span>Vocal</span>
          </GlassButton>
        </li>
      </ul>
      <input ref={fileInput} type="file" accept={ACCEPT_ATTR} hidden aria-label="Choisir un fichier" onChange={e => void send(e.currentTarget, 'file')} />
      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden aria-label="Prendre une photo" onChange={e => void send(e.currentTarget, 'photo')} />
      {message && (
        <p role={message.alert ? 'alert' : 'status'} className={`mx-[18px] mt-2 text-[15px] leading-5 ${message.alert ? 'text-again' : 'text-label-2'}`}>
          {message.text}
        </p>
      )}
      {waiting > 0 && (
        <button
          type="button"
          onClick={onOpenDrafts}
          className="tag-head mx-[14px] mt-1 flex min-h-11 w-[calc(100%-28px)] items-center justify-between rounded-2xl px-1 text-start text-[15px] leading-5 font-medium"
        >
          <span>{draftsLabel(waiting)} à valider</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-label-2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </section>
  )
}
