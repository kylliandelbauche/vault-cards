import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from 'react'
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
  /** Loupe : ouvre « Mes cartes » (#80), un niveau de navigation. */
  onSearch(): void
  /** Profil (#83) : ouvre l'écran Profil, un niveau de navigation. Absent : pas de bouton Profil. */
  onProfile?(): void
}
const BarActionsContext = createContext<BarActionsValue | null>(null)
export const BarActionsProvider = BarActionsContext.Provider

/**
 * Recherche et Profil, à droite de la barre. La loupe ouvre « Mes cartes » (#80) ; absente de « Mes cartes » même
 * (`search` faux). Le bouton Profil ouvre l'écran Profil (#83, déconnexion comprise) ; absent de cet écran même
 * (`profile` faux).
 */
function BarActions({ onSearch, onProfile, search, profile }: BarActionsValue & { search: boolean; profile: boolean }) {
  return (
    <>
      {search && (
        <RoundButton label="Rechercher" onClick={onSearch}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </RoundButton>
      )}
      {profile && onProfile && (
        <RoundButton label="Profil" onClick={onProfile}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
        </RoundButton>
      )}
    </>
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
  /** Loupe (« Mes cartes ») : masquée sur « Mes cartes » même. */
  search?: boolean
  /** Bouton Profil : masqué sur l'écran Profil même. */
  profile?: boolean
}

/**
 * Barre du haut commune (Paper, ligne Officiel) : flèche retour ronde (écrans secondaires), titre + petit
 * sous-titre sur une ligne, puis Recherche et Profil à droite. Pas de bandeau en verre autour : chaque bouton est
 * son propre verre. `sticky` sur un fondu de la couleur du fond (`.bar-fade`, effet de bord iOS 26) : le contenu
 * qui défile s'efface dessous au lieu de passer sous le titre.
 */
export function TopBar({ onBack, backLabel = 'Accueil', children, extra, search = true, profile = true }: TopBarProps) {
  const actions = useContext(BarActionsContext)
  return (
    <header className={`bar-fade sticky top-0 z-20 shrink-0 pt-[max(12px,var(--k-safe-area-top))] pb-3 ${EDGES}`}>
      <div className="mx-auto max-w-xl">
        <div className="flex min-h-14 items-center gap-2.5">
          {onBack && <BackButton onClick={onBack} label={backLabel} />}
          {children}
          {actions && <BarActions onSearch={actions.onSearch} onProfile={actions.onProfile} search={search} profile={profile} />}
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
