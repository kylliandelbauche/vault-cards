export type Rating = 1 | 2 | 3 // 1 Again · 2 Hard · 3 Good

export interface Card {
  id: string
  deck: string
  source_path: string
  source_title?: string | null // titre (H1) de la note source ; absent/null = repli sur le nom de fichier
  tags: string[] // slugs de shared/tags.ts (0 à 2) ; inconnu = ignoré à l'affichage
  front: string
  back: string
  updated_at: string
  deleted_at: string | null
}

export interface Review {
  id: string
  card_id: string
  rating: Rating
  reviewed_at: string // ISO
  synced: 0 | 1 // 0 = à pousser
}
