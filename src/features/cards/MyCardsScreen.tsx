import { Page, Preloader } from 'konsta/react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { ConfirmDialog } from '../../components/SheetBar'
import { BarTitle, EDGES, TopBar } from '../../components/TopBar'
import { deleteCard, updateCard } from '../../lib/cards'
import type { VaultDB } from '../../lib/db'
import { cards as cardCount } from '../../lib/home'
import { documentKind, filterCards, foldText, type ImportedDocument } from '../../lib/myCards'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import type { Card } from '../../lib/types'
import { EditForm } from '../inbox/EditCardScreen'
import { CardRow } from './CardRow'
import { useMyCards } from './useMyCards'

interface Props {
  db: VaultDB
  onBack(): void
  /** Document (`inbox_id`) filtré à l'ouverture, depuis « Tes créations » (#86) ; absent : « Tous ». Retiré s'il n'existe plus. */
  initialDocumentId?: string
  /** Nom accessible de la flèche : l'écran de destination. */
  backLabel?: string
  /** Après une modification ou une suppression locale : synchro immédiate. */
  onWrite?(): void
  /**
   * « Étudier ces N cartes » (#105) : lance une révision libre des cartes de la liste filtrée (ids des résultats, pas de la
   * tranche affichée). Absent : pas de bouton.
   */
  onStudy?(cardIds: string[]): void
}

/** Cartes rendues d'un coup, puis par tranches à l'approche du bas : l'ouverture reste instantanée avec 2000 cartes. */
const SLICE = 80

/** Fenêtre de confirmation sous la carte (au-dessus si elle déborderait de l'écran), bord droit aligné sur elle. */
function nearCard(anchor: DOMRect): CSSProperties {
  const right = Math.max(16, window.innerWidth - anchor.right)
  return anchor.bottom + 200 > window.innerHeight
    ? { bottom: window.innerHeight - anchor.top + 6, right }
    : { top: anchor.bottom + 6, right }
}

/**
 * « Mes cartes » (#80, Paper « Mes cartes · 1 à 5 », ligne Officiel) : barre commune (titre + nombre de cartes, sans
 * loupe : on y est déjà), champ de recherche, rangée « Tous » + documents importés, puis les cartes actives avec leurs
 * tags (ni brouillons, ni supprimées). Recherche locale (cache Dexie), sans accents ni casse, sur question, réponse,
 * tags et nom du document, combinée au document choisi. Tap sur une carte → « Modifier la carte » (formulaire de #73,
 * posé sur la liste : le retour iOS le ferme, garde #88 compris) ; glisser à gauche → « Supprimer » → confirmation →
 * suppression douce (deleteCard, comme le menu ⋯). Un filtre actif (document ou recherche) fait apparaître en bas
 * « Étudier ces N cartes » (#105) : révision libre des cartes de la liste. Sans filtre, aucun bouton bleu : seul
 * l'anneau de focus du champ l'est.
 */
export function MyCardsScreen({ db, onBack, initialDocumentId, backLabel = 'Accueil', onWrite, onStudy }: Props) {
  const data = useMyCards(db)
  const [query, setQuery] = useState('')
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId ?? null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Card | null>(null)
  const [deleting, setDeleting] = useState<{ card: Card; anchor: DOMRect } | null>(null)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [limit, setLimit] = useState(SLICE)
  const deferredQuery = useDeferredValue(query)

  const ready = data.status === 'ready' ? data : null
  // Document choisi disparu (dernière carte supprimée) : retour à « Tous ».
  const doc = ready && documentId !== null ? ready.documents.find(d => d.id === documentId) ?? null : null
  // Document disparu (dernière carte supprimée, ou filtre initial inconnu) : l'état revient à « Tous », pour qu'il ne
  // se réapplique pas en silence si le document revient.
  if (ready && documentId !== null && doc === null) setDocumentId(null)
  const results = useMemo(() => (ready ? filterCards(ready.cards, deferredQuery, doc?.id ?? null) : []), [ready, deferredQuery, doc])

  // Nouvelle recherche ou autre document : on repart de la première tranche, aucune carte ouverte.
  const [shownFor, setShownFor] = useState({ q: deferredQuery, d: doc?.id ?? null })
  if (shownFor.q !== deferredQuery || shownFor.d !== (doc?.id ?? null)) {
    setShownFor({ q: deferredQuery, d: doc?.id ?? null })
    setLimit(SLICE)
    setOpenId(null)
  }
  // Conteneur qui défile (la Page Konsta) : racine du préchargement, et position gardée pendant la modification.
  const page = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  // Sans IntersectionObserver (vieux navigateur, tests) : tout d'un coup.
  const shown = typeof IntersectionObserver === 'undefined' ? Infinity : limit
  const more = results.length > shown
  useEffect(() => {
    const el = sentinel.current
    if (!more || !el) return
    // `root` : la marge de 800 px ne s'applique qu'au conteneur qui défile (pas à la fenêtre, qui ne défile pas) ;
    // la tranche suivante arrive bien avant le bas, pas de blanc en défilement rapide.
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) setLimit(l => l + SLICE * 2) }, { root: page.current, rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, shown])

  // Position de la liste gardée pendant la modification (la page est masquée, pas démontée).
  const scrollTop = useRef(0)
  useLayoutEffect(() => { if (!editing && page.current) page.current.scrollTop = scrollTop.current }, [editing])

  const onOpenChange = useCallback((id: string, open: boolean) => setOpenId(cur => (open ? id : cur === id ? null : cur)), [])
  const onEdit = useCallback((card: Card) => {
    scrollTop.current = page.current?.scrollTop ?? 0
    setDeleteFailed(false)
    setEditing(card)
  }, [])
  const onDelete = useCallback((card: Card, anchor: DOMRect) => setDeleting({ card, anchor }), [])

  const confirmDelete = async () => {
    if (!deleting) return
    const { card } = deleting
    setDeleting(null)
    setOpenId(null)
    try {
      await deleteCard(db, card.id)
      setDeleteFailed(false)
      onWrite?.()
    } catch {
      setDeleteFailed(true)
    }
  }

  const subtitle = ready ? cardCount(results.length) : undefined
  // Bouton d'étude (#105) : seulement quand un filtre est actif (document ou recherche), sur ce que la liste affiche
  // (valeur différée comprise) ; les résultats sont déjà sans brouillons ni cartes supprimées.
  const filtered = doc !== null || foldText(deferredQuery).trim() !== ''
  const canStudy = onStudy !== undefined && filtered && results.length > 0
  return (
    <>
      {editing && (
        <EditForm
          key={editing.id}
          db={db}
          title="Modifier la carte"
          initial={editing}
          source={editing.source_title?.trim() || undefined}
          minTags={editing.source === 'vault' ? 0 : 1}
          overlay
          onClose={() => setEditing(null)}
          save={async patch => { await updateCard(db, editing.id, patch); onWrite?.() }}
        />
      )}
      <Page ref={page} colors={TRANSPARENT_PAGE} className={editing ? 'hidden' : 'flex flex-col overscroll-none'}>
        <TopBar onBack={onBack} backLabel={backLabel} search={false}>
          <BarTitle title="Mes cartes" subtitle={subtitle} heading />
        </TopBar>
        <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3.5 pt-1 pb-6 ${EDGES}`}>
          {/* Formulaire : la touche « Rechercher » du clavier iOS le ferme (rien à envoyer, la liste suit la frappe). */}
          <form role="search" className="shrink-0" onSubmit={e => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur() }}>
            <label className="glass-card flex h-11 shrink-0 items-center gap-2.5 rounded-full px-3.5 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-new">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0 text-label-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
              </svg>
              <span className="sr-only">Rechercher dans mes cartes</span>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Question, réponse, tag ou document"
                enterKeyHint="search"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[17px] leading-[22px] text-black outline-none placeholder:text-label-2 dark:text-white"
              />
            </label>
          </form>

          {ready && ready.documents.length > 0 && (
            <ul role="list" aria-label="Filtrer par document" className="chip-row -mx-1 flex shrink-0 gap-2 scroll-px-1 px-1 py-1">
              <li className="shrink-0"><DocumentChip label="Tous" selected={doc === null} onClick={() => setDocumentId(null)} /></li>
              {ready.documents.map(d => (
                <li key={d.id} className="shrink-0">
                  <DocumentChip document={d} label={d.label} selected={doc?.id === d.id} onClick={() => setDocumentId(d.id)} />
                </li>
              ))}
            </ul>
          )}

          {deleteFailed && (
            <p role="alert" className="mx-auto w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">Carte non supprimée. Réessaie.</p>
          )}
          {data.status === 'loading' && <div className="my-auto flex justify-center"><Preloader /></div>}
          {data.status === 'error' && (
            <p role="alert" className="glass-card my-auto rounded-[28px] p-6 text-center text-[17px] text-label-2">
              Impossible de lire les cartes enregistrées sur cet appareil.
            </p>
          )}
          {ready && results.length === 0 && (
            <p className="px-1 pt-4 text-center text-[15px] leading-5 text-label-2">
              {ready.cards.length === 0 ? 'Aucune carte pour l’instant.' : 'Aucune carte ne correspond à ta recherche.'}
            </p>
          )}
          {ready && results.length > 0 && (
            <ul role="list" aria-label="Cartes" className="flex flex-col gap-2.5">
              {results.slice(0, shown).map(({ card }) => (
                <CardRow key={card.id} card={card} open={openId === card.id} onOpenChange={onOpenChange} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </ul>
          )}
          {more && <div ref={sentinel} aria-hidden="true" className="h-px" />}
        </main>
        {canStudy && (
          <footer className={`action-dock sticky bottom-0 z-20 shrink-0 pt-3.5 pb-[max(12px,var(--k-safe-area-bottom))] ${EDGES}`}>
            <div className="mx-auto max-w-xl">
              <GlassButton tone="new" className={`${GLASS_PRIMARY} on-glass btn-filled gap-3`} onClick={() => onStudy(results.map(r => r.card.id))}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="currentColor">
                  <path d="M7 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 7 4.5z" />
                </svg>
                {results.length === 1 ? 'Étudier cette carte' : `Étudier ces ${results.length} cartes`}
              </GlassButton>
            </div>
          </footer>
        )}
      </Page>
      {deleting && (
        <ConfirmDialog
          message="Cette carte disparaîtra de tes révisions."
          confirmLabel="Supprimer la carte"
          cancelLabel="Annuler"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
          className="w-[270px]"
          style={nearCard(deleting.anchor)}
        />
      )}
    </>
  )
}

const ICONS = {
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>,
  photo: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  audio: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
}

/**
 * Pastille de la rangée (Paper « 1 liste », « 3 filtré par document ») : choisie = pleine, contrastée (blanc en
 * sombre, noir en clair) ; sinon verre neutre sans flou propre (posé sur le fond, comme les tags). 44 px de haut.
 */
function DocumentChip({ document, label, selected, onClick }: { document?: ImportedDocument; label: string; selected: boolean; onClick(): void }) {
  return (
    <GlassButton
      tone="neutral"
      aria-pressed={selected}
      aria-label={document ? `${label}, ${cardCount(document.count)}` : label}
      onClick={onClick}
      className={`tag-chip on-glass flex h-11 items-center gap-2 rounded-full ${document ? 'px-4' : 'px-[18px]'} text-[15px] leading-[18px] whitespace-nowrap ${selected ? 'doc-chip-on font-semibold' : 'font-medium'}`}
    >
      {document && (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-4 shrink-0 ${selected ? '' : 'text-label-2'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[documentKind(label)]}
        </svg>
      )}
      <span className="max-w-[220px] truncate">{label}</span>
    </GlassButton>
  )
}
