import type { ReactNode } from 'react'

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
 * Point de couleur + libellé (jamais la couleur seule). Sur le verre, le texte reste neutre et opaque
 * (pas de couleur sémantique ni d'opacité) : ≥ 4,5:1 en clair comme en sombre, quel que soit le contenu dessous.
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
function IconButton({ label, onClick, className, children }: { label: string; onClick(): void; className: string; children: ReactNode }) {
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

export function SignOutButton({ onClick }: { onClick(): void }) {
  return (
    <IconButton label="Déconnexion" onClick={onClick} className="-me-2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </IconButton>
  )
}

/** Chevron « retour à l'accueil », en tête de la barre de révision. */
export function BackButton({ onClick }: { onClick(): void }) {
  return (
    <IconButton label="Accueil" onClick={onClick} className="-ms-2.5">
      <path d="M15 18l-6-6 6-6" strokeWidth="2.5" />
    </IconButton>
  )
}

/**
 * Barre du haut en verre (seule surface floutée de la barre), `sticky` : le contenu défile dessous.
 * `children` : la ligne principale (titre, synchro, actions) ; `extra` : ce qui va dessous (progression).
 */
export function TopBar({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <header className={`sticky top-0 z-20 shrink-0 pt-[max(12px,var(--k-safe-area-top))] pb-2 ${EDGES}`}>
      <div className="glass mx-auto max-w-xl rounded-[26px] px-4 py-2.5">
        <div className="flex items-center gap-3">{children}</div>
        {extra}
      </div>
    </header>
  )
}

/** Titre + indicateur de synchro, à gauche de la barre. */
export function BarTitle({ title, sync }: { title: string; sync?: SyncIndicator }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[17px] leading-tight font-semibold text-black dark:text-white">{title}</p>
      {sync && <SyncBadge sync={sync} />}
    </div>
  )
}
