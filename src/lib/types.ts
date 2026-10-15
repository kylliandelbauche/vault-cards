export type Rating = 1 | 2 | 3 // 1 Again · 2 Hard · 3 Good

/**
 * Origine d'une carte : générée depuis le vault par /flashcards, créée à la main dans l'app (#54), ou proposée par
 * /flashcards depuis la boîte de réception (#55, d'abord en brouillon).
 */
export type CardSource = 'vault' | 'manual' | 'inbox'

/** `draft` : carte de la boîte de réception pas encore acceptée, exclue des sessions, compteurs et tags. */
export type CardStatus = 'active' | 'draft'

export interface Card {
  id: string
  source: CardSource
  deck: string | null // null pour une carte manuelle
  source_path: string | null // null pour une carte manuelle
  source_title?: string | null // titre (H1) de la note source ; absent/null = repli sur le nom de fichier
  tags: string[] // slugs de shared/tags.ts (0 à 2) ; inconnu = ignoré à l'affichage
  front: string
  back: string
  /** Création (horodatage serveur ; pour une carte manuelle pas encore envoyée, horloge de l'appareil). Absent d'un vieux cache. */
  created_at?: string
  updated_at: string
  deleted_at: string | null
  /** Absent (vieux cache, avant #55) = `active`. Une carte active ne repasse jamais en brouillon. */
  status?: CardStatus
  /** Élément de la boîte de réception d'origine (cartes `inbox`) ; null ou absent sinon. */
  inbox_id?: string | null
  /**
   * Local seulement, jamais envoyé : 0 = carte manuelle (ou de la boîte de réception) créée ou modifiée sur cet appareil, à envoyer.
   * Absent (cartes tirées du serveur) ou 1 = à jour.
   */
  synced?: 0 | 1
}

export interface Review {
  id: string
  card_id: string
  rating: Rating
  reviewed_at: string // ISO
  synced: 0 | 1 // 0 = à pousser
  /**
   * Local seulement, jamais envoyé : notée en révision libre (« Réviser à nouveau »). La première note d'une carte
   * en révision libre ne consomme pas le quota de nouvelles du jour. Absent sur les reviews tirées du serveur.
   */
  free?: boolean
}
