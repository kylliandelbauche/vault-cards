import { InboxError, type InboxItem } from '../../lib/inbox'

/** Nom affiché d'une source (« Depuis « … » ») : le nom du fichier, ou « Texte collé ». */
export const sourceName = (item: Pick<InboxItem, 'kind' | 'filename'>): string =>
  item.kind === 'text' ? 'Texte collé' : item.filename ?? 'Fichier'

/** Message d'un dépôt refusé (InboxError : déjà en français, hors ligne compris). */
export const inboxErrorMessage = (e: unknown): string =>
  e instanceof InboxError ? e.message : 'Envoi impossible. Réessaie.'

/** « 3 brouillons », « 1 brouillon ». */
export const drafts = (n: number) => `${n} ${n > 1 ? 'brouillons' : 'brouillon'}`
