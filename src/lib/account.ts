import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'

/** Le compte, vu du client : uniquement l'API d'authentification (clé publishable), aucune table. */
export interface ProfileClient {
  auth: Pick<SupabaseClient['auth'], 'getSession' | 'updateUser' | 'signInWithPassword' | 'signOut' | 'onAuthStateChange'>
}

export interface ProfileDeps {
  client: ProfileClient
  /** Réseau disponible ? (`navigator.onLine` par défaut ; injectable en test.) */
  online?: () => boolean
}

/** Erreur à afficher telle quelle (déjà en français) ; rien n'est parti si elle vient d'une validation locale. */
export class AccountError extends Error {}

export const OFFLINE_MESSAGE = 'Pas de connexion. Réessaie quand tu as du réseau.'
export const MIN_PASSWORD = 8
export const MAX_PSEUDO = 40

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine
const requireOnline = (online: () => boolean = isOnline) => { if (!online()) throw new AccountError(OFFLINE_MESSAGE) }

interface AuthFailure { code?: string; status?: number }
const failure = (e: unknown): AuthFailure => (typeof e === 'object' && e !== null ? e : {})
/** Erreur réseau : supabase-js la signale (fetch impossible) ou le `fetch` rejette lui-même. */
const isNetwork = (e: unknown) => e instanceof TypeError || isAuthRetryableFetchError(e)
const isRateLimited = (e: unknown) => failure(e).status === 429 || /rate_limit/.test(failure(e).code ?? '')

/** Pseudo valide : 1 à 40 caractères une fois les espaces de bord retirés. Renvoie le pseudo nettoyé. */
export function checkPseudo(raw: string): string {
  const pseudo = raw.trim()
  const length = [...pseudo].length
  if (length < 1 || length > MAX_PSEUDO) throw new AccountError(`Le pseudo doit faire de 1 à ${MAX_PSEUDO} caractères.`)
  return pseudo
}

/** Enregistre le pseudo dans les métadonnées de l'utilisateur (aucune table). Renvoie le pseudo enregistré. */
export async function changePseudo({ client, online }: ProfileDeps, raw: string): Promise<string> {
  const pseudo = checkPseudo(raw)
  requireOnline(online)
  try {
    const { error } = await client.auth.updateUser({ data: { pseudo } })
    if (error) throw error
    return pseudo
  } catch (e) {
    throw new AccountError(isNetwork(e) ? OFFLINE_MESSAGE : isRateLimited(e) ? 'Trop de demandes. Réessaie dans quelques minutes.' : "Le pseudo n'a pas pu être enregistré. Réessaie.")
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Demande le changement d'adresse : Supabase envoie un lien de confirmation (l'ancienne adresse reste active jusque-là).
 * `emailRedirectTo` : l'origine de l'app. Renvoie l'adresse demandée, nettoyée.
 */
export async function requestEmailChange({ client, online }: ProfileDeps, current: string, raw: string): Promise<string> {
  const email = raw.trim()
  if (!EMAIL_SHAPE.test(email)) throw new AccountError("Cette adresse e-mail n'est pas valide.")
  if (email.toLowerCase() === current.trim().toLowerCase()) throw new AccountError("C'est déjà ton adresse actuelle.")
  requireOnline(online)
  try {
    const { error } = await client.auth.updateUser({ email }, { emailRedirectTo: window.location.origin })
    if (error) throw error
    return email
  } catch (e) {
    const code = failure(e).code
    throw new AccountError(
      isNetwork(e) ? OFFLINE_MESSAGE
        : isRateLimited(e) ? "Trop d'e-mails envoyés pour l'instant. Réessaie dans quelques minutes."
          : code === 'email_address_invalid' || code === 'validation_failed' ? "Cette adresse e-mail n'est pas valide."
            : code === 'email_exists' || code === 'same_email' ? 'Cette adresse est déjà utilisée.'
              : code === 'email_address_not_authorized' ? "Cette adresse n'est pas autorisée."
                : "L'adresse n'a pas pu être modifiée. Réessaie.",
    )
  }
}

/** Compte courant : l'id sert à vérifier que la reconnexion ouvre bien ce compte. */
export interface AccountIdentity { id: string; email: string }

/**
 * Change le mot de passe : contrôle local (8 caractères, confirmation, différent de l'actuel), vérification de l'actuel
 * par une reconnexion avec l'e-mail du compte (qui doit ouvrir le même compte : sinon on se déconnecte de la session
 * étrangère et on s'arrête avant tout changement), puis `updateUser`, puis déconnexion des autres appareils.
 * Aucun mot de passe n'est journalisé ni gardé.
 */
export async function changePassword({ client, online }: ProfileDeps, who: AccountIdentity, current: string, next: string, confirm: string): Promise<void> {
  if (next.length < MIN_PASSWORD) throw new AccountError(`Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`)
  if (next !== confirm) throw new AccountError('Les deux mots de passe ne correspondent pas.')
  if (next === current) throw new AccountError("Le nouveau mot de passe doit être différent de l'actuel.")
  requireOnline(online)
  let reopened: string | undefined
  try {
    const { data, error } = await client.auth.signInWithPassword({ email: who.email, password: current })
    if (error) throw error
    reopened = data?.user?.id
  } catch (e) {
    throw new AccountError(
      isNetwork(e) ? OFFLINE_MESSAGE
        : isRateLimited(e) ? 'Trop de tentatives. Réessaie dans quelques minutes.'
          : failure(e).code === 'invalid_credentials' ? 'Mot de passe actuel incorrect.'
            : "Le mot de passe actuel n'a pas pu être vérifié. Réessaie.",
    )
  }
  if (reopened !== who.id) {
    // La reconnexion a ouvert un autre compte (e-mail changé ailleurs) : cette session étrangère ne reste pas ouverte.
    try { await client.auth.signOut({ scope: 'local' }) } catch { /* session locale effacée par l'écran de connexion */ }
    throw new AccountError('Ce mot de passe ouvre un autre compte que celui-ci. Par sécurité, tu es déconnecté : reconnecte-toi.')
  }
  try {
    const { error } = await client.auth.updateUser({ password: next })
    if (error) throw error
  } catch (e) {
    const code = failure(e).code
    throw new AccountError(
      isNetwork(e) ? OFFLINE_MESSAGE
        : isRateLimited(e) ? 'Trop de demandes. Réessaie dans quelques minutes.'
          : code === 'same_password' ? "Le nouveau mot de passe doit être différent de l'actuel."
            : code === 'weak_password' ? 'Mot de passe trop faible : choisis-en un plus long ou plus varié.'
              : "Le mot de passe n'a pas pu être modifié. Réessaie.",
    )
  }
  // Mot de passe changé : les autres appareils doivent se reconnecter. Un échec ici ne défait pas le changement.
  try { await client.auth.signOut({ scope: 'others' }) } catch { /* sans effet sur ce appareil */ }
}
