import type { Card } from './types'

/**
 * Page « Mes cartes » (#80) : liste, documents importés et recherche, sans interface. Tout est local (cache Dexie) :
 * hors ligne, instantané, aucune requête réseau. L'index (texte replié) est calculé une fois par lecture du cache ;
 * chaque frappe ne fait qu'un `includes` par carte (≈ 2000 cartes : bien moins d'une milliseconde).
 */

/** Libellé d'un document dont la carte n'a pas de titre (ne devrait pas arriver : /flashcards le remplit). */
export const UNTITLED_DOCUMENT = 'Document importé'

/** Texte replié pour la recherche : sans accents ni casse (« Éte » ≈ « ete »), ligatures œ / æ développées. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
}

/** Carte affichée : vivante et active (ni brouillon, ni supprimée). */
export const isListed = (c: Card) => c.deleted_at === null && c.status !== 'draft'

/** Nom du document d'une carte importée depuis la boîte de réception ; null pour une carte du vault ou manuelle. */
export function documentLabel(c: Card): string | null {
  if (c.source !== 'inbox' || !c.inbox_id) return null
  return c.source_title?.trim() || UNTITLED_DOCUMENT
}

export interface ImportedDocument {
  /** `inbox_id` des cartes. */
  id: string
  label: string
  count: number
}

export interface IndexedCard {
  card: Card
  /** Question, réponse, tags et nom du document, repliés. */
  text: string
}

export interface MyCardsIndex {
  /** Cartes affichées, les plus récentes d'abord. */
  cards: IndexedCard[]
  /** Documents importés (cartes `inbox` regroupées par `inbox_id`), le plus récent d'abord. */
  documents: ImportedDocument[]
}

const stamp = (c: Card) => c.created_at ?? c.updated_at

/** Prépare la liste à partir du cache : exclut brouillons et cartes supprimées, regroupe les documents, replie le texte. */
export function indexCards(all: readonly Card[]): MyCardsIndex {
  const listed = all.filter(isListed).sort((a, b) => stamp(b).localeCompare(stamp(a)) || a.id.localeCompare(b.id))
  const docs = new Map<string, ImportedDocument & { latest: string }>()
  const cards = listed.map(card => {
    const label = documentLabel(card)
    if (label !== null) {
      const id = card.inbox_id as string
      const doc = docs.get(id)
      if (doc) doc.count++
      // Liste triée du plus récent au plus ancien : la 1re carte vue donne la date et le libellé du document.
      else docs.set(id, { id, label, count: 1, latest: stamp(card) })
    }
    return { card, text: foldText([card.front, card.back, ...card.tags, label ?? ''].join('\n')) }
  })
  const documents = [...docs.values()]
    .sort((a, b) => b.latest.localeCompare(a.latest) || a.label.localeCompare(b.label, 'fr'))
    .map(({ id, label, count }) => ({ id, label, count }))
  return { cards, documents }
}

/**
 * Cartes qui correspondent à la recherche (tous les mots, dans n'importe quel ordre, sans accents ni casse) et au
 * document choisi (`documentId` null : « Tous »).
 */
export function filterCards(index: readonly IndexedCard[], query: string, documentId: string | null): IndexedCard[] {
  const words = foldText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0 && documentId === null) return index as IndexedCard[]
  return index.filter(({ card, text }) =>
    (documentId === null || (card.source === 'inbox' && card.inbox_id === documentId)) && words.every(w => text.includes(w)))
}

/** Icône d'un document selon son nom : photo, vocal, ou fichier (PDF, texte collé…). */
export function documentKind(label: string): 'photo' | 'audio' | 'file' {
  if (/^photo\b/i.test(label) || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(label)) return 'photo'
  if (/^(vocal|audio|enregistrement)\b/i.test(label) || /\.(m4a|mp3|wav|aac|ogg|webm)$/i.test(label)) return 'audio'
  return 'file'
}
