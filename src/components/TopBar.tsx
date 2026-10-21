import { createContext, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GlassButton } from './GlassButton'

/** État de la synchro affiché dans la barre du haut. */
export type SyncIndicator = 'syncing' | 'synced' | 'unsynced'

/** Marges latérales : 12 px, ou la zone sûre en paysage (encoche, Dynamic Island). */
export const EDGES = 'ps-[max(12px,var(--k-safe-area-left))] pe-[max(12px,var(--k-safe-area-right))]'

const SYNC_BADGE: Record<SyncIndicator, { label: string; dot: string }> = {
  synced: { label: 'Synchronisé', dot: 'bg-good' },
  unsynced: { label: 'Non synchronisé', dot: 'bg-muted' },
  syncing: { label: 'Synchronisation…', dot: 'bg-muted motion-safe:animate-pulse' },
}

/**
 * Point de couleur + libellé (jamais la couleur seule). Texte neutre et opaque (pas de couleur sémantique ni
 * d'opacité) : ≥ 4,5:1 en clair comme en sombre.
 */
export function SyncBadge({ sync }: { sync: SyncIndicator }) {
  const { label, dot } = SYNC_BADGE[sync]
  return (
    <span role="status" className="flex items-center gap-1.5 text-[13px] leading-4 text-label-2">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

/** Bouton icône rond, cible 44 px ; marges négatives verticales pour ne pas agrandir la barre (la page doit tenir sans scroll). */
export function IconButton({ label, onClick, className, children }: { label: string; onClick(): void; className: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`-my-2 flex size-11 shrink-0 items-center justify-center rounded-full text-label-2 hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/10 dark:active:bg-white/15 ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

/**
 * Bouton rond en verre de la barre (Paper « Accueil · v4 », « Révision », « Mes tags · v3 ») : 48 px, icône 22 px
 * noire / blanche. Verre imité (`on-glass`, sans backdrop-filter) : la barre est posée sur un fondu opaque de la
 * couleur du fond (`.bar-fade`), un flou n'y verrait rien et coûterait une surface de plus.
 */
function RoundButton({ label, children, ...rest }: { label: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'>) {
  return (
    <GlassButton
      tone="neutral"
      aria-label={label}
      className="on-glass bar-btn flex size-12 shrink-0 items-center justify-center rounded-full text-black dark:text-white"
      {...rest}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </GlassButton>
  )
}

/**
 * Actions de compte de la barre (Recherche, Profil), fournies par l'app connectée. Sans fournisseur (écran
 * testé seul, écran de connexion), la barre n'affiche pas ces boutons.
 */
export interface BarActionsValue {
  /** Déconnexion sûre (#40) : synchro d'abord, confirmation si elle échoue. */
  onSignOut(): void
}
const BarActionsContext = createContext<BarActionsValue | null>(null)
export const BarActionsProvider = BarActionsContext.Provider

type Panel = 'search' | 'profile'

/**
 * Recherche et Profil, à droite de la barre. Tant que « Mes cartes » (#80) et le Profil (#83) n'existent pas :
 * Recherche ouvre une petite fenêtre « bientôt » ; Profil ouvre une petite fenêtre avec « Se déconnecter »
 * (la déconnexion n'est plus dans la barre).
 */
function BarActions({ onSignOut }: BarActionsValue) {
  const [open, setOpen] = useState<Panel | null>(null)
  const toggle = (p: Panel) => setOpen(o => (o === p ? null : p))
  const close = () => setOpen(null)
  return (
    <>
      <RoundButton label="Rechercher" aria-haspopup="dialog" aria-expanded={open === 'search'} onClick={() => toggle('search')}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </RoundButton>
      <RoundButton label="Profil" aria-haspopup="dialog" aria-expanded={open === 'profile'} onClick={() => toggle('profile')}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
      </RoundButton>
      {open === 'search' && (
        <BarPopover label="Rechercher" onClose={close}>
          <p className="px-[18px] py-3.5 text-[15px] leading-5 text-label-2">La recherche dans tes cartes arrive bientôt.</p>
        </BarPopover>
      )}
      {open === 'profile' && (
        <BarPopover label="Profil" onClose={close}>
          <p className="px-[18px] pt-3.5 pb-3 text-[13px] leading-[18px] text-label-2">Le profil arrive bientôt.</p>
          <button
            type="button"
            onClick={() => { close(); onSignOut() }}
            className="flex h-[50px] w-full items-center border-t border-black/10 px-[18px] text-start text-[17px] leading-[22px] font-medium text-again hover:bg-black/5 active:bg-black/10 dark:border-white/12 dark:hover:bg-white/8 dark:active:bg-white/12"
          >
            Se déconnecter
          </button>
        </BarPopover>
      )}
    </>
  )
}

/**
 * Petite fenêtre sous les boutons de droite (style menu iOS 26) : fond presque opaque (`--glass-solid`, texte et
 * rouge ≥ 4,5:1), aucun voile. Échap ou tap à côté = fermer ; focus posé dans la fenêtre, gardé dedans (Tab),
 * puis rendu au bouton d'origine.
 */
function BarPopover({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(onClose)
  useEffect(() => { latest.current = onClose })
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = box.current?.querySelector<HTMLElement>('button')
    ;(first ?? box.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { latest.current(); return }
      if (e.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll<HTMLElement>('button')]
      e.preventDefault()
      if (items.length === 0) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus() }
  }, [])
  // Rendue dans <body> : au-dessus des barres `sticky` (la zone d'action du bas comprise), un tap à côté ne
  // déclenche jamais un bouton dessous. Hors de `.safe-areas` : zones sûres lues directement (env()).
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        style={{ backgroundColor: 'var(--glass-solid)' }}
        className="glass absolute end-[max(12px,env(safe-area-inset-right))] top-[calc(max(12px,env(safe-area-inset-top))+60px)] w-[260px] overflow-hidden rounded-[22px] text-black outline-none dark:text-white"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Flèche « retour » ronde, en tête de la barre. `label` : l'écran de destination (« Accueil », « Mes tags »). */
function BackButton({ onClick, label }: { onClick(): void; label: string }) {
  return (
    <RoundButton label={label} onClick={onClick}>
      <path d="M15 5l-7 7 7 7" strokeWidth="2.4" />
    </RoundButton>
  )
}

interface TopBarProps {
  /** Retour : flèche ronde en tête (écrans secondaires) ; l'accueil n'en a pas. */
  onBack?(): void
  /** Nom accessible de la flèche (l'écran de destination). */
  backLabel?: string
  /** Titre (voir BarTitle). */
  children: ReactNode
  /** Sous la ligne : barre de progression de la révision. */
  extra?: ReactNode
}

/**
 * Barre du haut commune (Paper, ligne Officiel) : flèche retour ronde (écrans secondaires), titre + petit
 * sous-titre sur une ligne, puis Recherche et Profil à droite. Pas de bandeau en verre autour : chaque bouton est
 * son propre verre. `sticky` sur un fondu de la couleur du fond (`.bar-fade`, effet de bord iOS 26) : le contenu
 * qui défile s'efface dessous au lieu de passer sous le titre.
 */
export function TopBar({ onBack, backLabel = 'Accueil', children, extra }: TopBarProps) {
  const actions = useContext(BarActionsContext)
  return (
    <header className={`bar-fade sticky top-0 z-20 shrink-0 pt-[max(12px,var(--k-safe-area-top))] pb-3 ${EDGES}`}>
      <div className="mx-auto max-w-xl">
        <div className="flex min-h-14 items-center gap-2.5">
          {onBack && <BackButton onClick={onBack} label={backLabel} />}
          {children}
          {actions && <BarActions onSignOut={actions.onSignOut} />}
        </div>
        {extra}
      </div>
    </header>
  )
}

interface BarTitleProps {
  title: string
  /** Petit sous-titre sous le titre (« Carte 3 sur 10 », « 10 cartes à revoir »). */
  subtitle?: string
  sync?: SyncIndicator
  /** Accueil : titre de l'app plus grand (22 px gras). */
  large?: boolean
  /** Le titre de la barre est le titre de la page (<h1>). */
  heading?: boolean
}

/** Titre + sous-titre (ou état de synchro), à gauche de la barre ; jamais de gros titre en dessous. */
export function BarTitle({ title, subtitle, sync, large, heading }: BarTitleProps) {
  const Title = heading ? 'h1' : 'p'
  const size = large ? 'text-[22px] leading-7 font-bold tracking-[-0.01em]' : 'text-[17px] leading-[22px] font-semibold'
  return (
    <div className={`min-w-0 flex-1 ${large ? '' : 'ps-1'}`}>
      <Title className={`truncate text-black dark:text-white ${size}`}>{title}</Title>
      {subtitle && <p className="truncate text-[13px] leading-4 text-label-2">{subtitle}</p>}
      {sync && <SyncBadge sync={sync} />}
    </div>
  )
}
