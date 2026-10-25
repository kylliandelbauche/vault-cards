/** Œil des champs de mot de passe (#84) : ouvert = masqué, barré = affiché. */
export function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  )
}

/**
 * Bouton « afficher / masquer le mot de passe » : `type="button"` (ne soumet pas), cible 44 px, le mot de passe reste
 * dans le champ. `label` : « le mot de passe » par défaut, ou le nom du champ pour les formulaires à plusieurs champs.
 */
export function EyeToggle({ shown, onToggle, subject = 'le mot de passe', className = '' }: { shown: boolean; onToggle(): void; subject?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={shown}
      aria-label={`${shown ? 'Masquer' : 'Afficher'} ${subject}`}
      onClick={onToggle}
      className={`password-toggle flex h-11 w-11 items-center justify-center rounded-full text-label-2 ${className}`}
    >
      <EyeIcon crossed={shown} />
    </button>
  )
}
