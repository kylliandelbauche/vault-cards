export interface SafeSignOutDeps {
  /** Nombre de reviews locales pas encore poussées (`synced: 0`). */
  pending(): Promise<number>
  /** Synchro complète ; rejette hors ligne. */
  sync(): Promise<unknown>
  confirm(message: string): boolean
  signOut(): void | Promise<void>
}

export const unsyncedWarning = (n: number) =>
  `${n} ${n > 1 ? 'révisions pas encore synchronisées seront perdues' : 'révision pas encore synchronisée sera perdue'} si tu te déconnectes. Te déconnecter quand même ?`

/**
 * Déconnexion sans perdre de révisions : s'il en reste à pousser, on tente d'abord une synchro ;
 * si elle échoue (hors ligne) et qu'il en reste, on demande confirmation. Retourne `true` si déconnecté.
 */
export async function safeSignOut({ pending, sync, confirm, signOut }: SafeSignOutDeps): Promise<boolean> {
  let left = await pending()
  if (left > 0) {
    try {
      await sync()
    } catch {
      // Hors ligne ou jeton expiré : on recompte ci-dessous.
    }
    left = await pending()
  }
  if (left > 0 && !confirm(unsyncedWarning(left))) return false
  await signOut()
  return true
}
