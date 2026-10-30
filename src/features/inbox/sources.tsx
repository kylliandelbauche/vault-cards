import type { ReactNode } from 'react'

export type SourceKind = 'manual' | 'file' | 'photo' | 'text' | 'voice'

const PATHS: Record<SourceKind, ReactNode> = {
  manual: <path d="M12 5v14M5 12h14" />,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  photo: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  text: <><path d="M4 6h16M4 11h16M4 16h10" /><path d="M17.5 14.5l2.5 2.5-4 4h-2.5V18.5z" /></>,
  voice: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>,
}

/** Icône d'une source, partagée par la rangée de l'accueil (#81) et le hub (#86) ; `className` fixe la taille. */
export function SourceIcon({ kind, className }: { kind: SourceKind; className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={kind === 'manual' ? 2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[kind]}
    </svg>
  )
}

/** Message de la dernière action (envoi refusé en alerte). */
export function SourceMessage({ message, className }: { message: { text: string; alert: boolean } | null; className: string }) {
  if (!message) return null
  return (
    <p role={message.alert ? 'alert' : 'status'} className={`${className} text-[15px] leading-5 ${message.alert ? 'text-again' : 'text-label-2'}`}>
      {message.text}
    </p>
  )
}
