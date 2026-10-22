import { Page, Preloader } from 'konsta/react'
import { useState } from 'react'
import { MAX_TAGS } from '../../../shared/tags'
import { DiscardDialog, SheetBar } from '../../components/SheetBar'
import { EDGES } from '../../components/TopBar'
import { CardValidationError, createManualCard, type ManualCardInput } from '../../lib/cards'
import type { VaultDB } from '../../lib/db'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { AddTagsScreen } from '../cards/AddTagsScreen'
import { useTagChoices } from '../cards/useTagChoices'
import type { DraftsTarget } from '../home/useNavigation'
import { useDrafts } from './useDrafts'

interface Props {
  db: VaultDB
  target: DraftsTarget & { cardId: string }
  onClose(): void
  /** Après l'écriture locale : synchro immédiate. */
  onWrite(): void
}

/**
 * « Modifier la carte » (#81, Paper « Carte · Modifier ») pour un brouillon : question, réponse, tags libres (#79 : 1 à 5,
 * écran « Ajouter des tags » ; un nom nouveau n'est créé qu'à la validation du brouillon). ✓ enregistre la retouche SANS valider (updateDraft) et revient à la liste : la validation reste
 * une décision de la liste (« Tout valider »), un seul geste pour accepter. ✕ sans modification ferme ; avec
 * modifications, fenêtre de confirmation.
 */
export function EditCardScreen({ db, target, onClose, onWrite }: Props) {
  const { drafts, error, update } = useDrafts(db, target.inboxId, { onWrite })
  const card = drafts?.find(c => c.id === target.cardId)
  if (card) {
    return <EditForm key={card.id} db={db} title="Modifier la carte" initial={card} source={target.source} onClose={onClose} save={patch => update(card.id, patch)} />
  }
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <SheetBar title="Modifier la carte" onClose={onClose} />
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col py-2 ${EDGES}`}>
        {drafts === null && !error
          ? <div className="my-auto flex justify-center"><Preloader /></div>
          : <p role="alert" className="glass-card my-auto rounded-[28px] p-6 text-center text-[17px] text-label-2">Ce brouillon n’existe plus.</p>}
      </main>
    </Page>
  )
}

/**
 * « Nouvelle carte » (#81, Paper « 1 vide » / « 2 remplie ») : même fenêtre, vide. ✓ gris tant que la question ou la
 * réponse est vide, bleu dès que les deux sont remplies ; ✓ → createManualCard (#54, cache local puis synchro) puis
 * retour à l'accueil.
 */
export function NewCardScreen({ db, onClose, onWrite }: { db: VaultDB; onClose(): void; onWrite(): void }) {
  return (
    <EditForm
      db={db}
      title="Nouvelle carte"
      initial={EMPTY}
      creating
      onClose={onClose}
      save={async input => { await createManualCard(db, input); onWrite() }}
    />
  )
}

const EMPTY: ManualCardInput = { front: '', back: '', tags: [] }

export interface EditFormProps {
  db: VaultDB
  title: string
  initial: ManualCardInput
  /** Création : ✓ actif seulement quand question et réponse sont remplies ; sinon ✓ sans modification = fermer. */
  creating?: boolean
  source?: string
  /** Nombre minimal de tags affiché (« 1 à 5 ») : 0 pour une carte du vault (« 5 au plus »). La règle vit dans cards.ts. */
  minTags?: 0 | 1
  onClose(): void
  save(patch: ManualCardInput): Promise<unknown>
}

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(t => b.includes(t))
const LABEL = 'px-1.5 text-[13px] leading-4 font-semibold tracking-[0.06em] text-label-2'
const FIELD = 'glass-card block w-full resize-none rounded-[22px] px-[18px] py-4 text-black outline-none focus:outline-2 focus:-outline-offset-2 focus:outline-new dark:text-white'
const FIELD_LABEL: Record<CardValidationError['field'], string> = { front: 'Question', back: 'Réponse', tags: 'Tags' }

/**
 * Formulaire « Modifier la carte » / « Nouvelle carte » : brouillons (#81), création (#54), et toute carte depuis le
 * menu ⋯ de la révision (#73).
 */
export function EditForm({ db, title, initial: card, creating = false, source, minTags = 1, onClose, save }: EditFormProps) {
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)
  const [tags, setTags] = useState<string[]>([...card.tags])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [picking, setPicking] = useState(false)
  const choices = useTagChoices(db)
  const dirty = front !== card.front || back !== card.back || !sameTags(tags, card.tags)
  const filled = front.trim() !== '' && back.trim() !== ''


  const submit = async () => {
    if (saving) return
    if (!creating && !dirty) { onClose(); return } // rien à écrire
    setSaving(true)
    setError(null)
    try {
      await save({ front, back, tags })
      onClose()
    } catch (e) {
      setError(e instanceof CardValidationError ? `${FIELD_LABEL[e.field]} : ${e.message}.` : 'Modification non enregistrée. Réessaie.')
      setSaving(false)
    }
  }

  if (picking) {
    return <AddTagsScreen initial={tags} choices={choices} onCancel={() => setPicking(false)} onDone={next => { setTags(next); setPicking(false) }} />
  }

  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <SheetBar
        title={title}
        onClose={() => (dirty ? setConfirming(true) : onClose())}
        onConfirm={() => void submit()}
        confirmLabel={creating ? 'Créer la carte' : 'Enregistrer'}
        confirmDisabled={saving || (creating && !filled)}
      />
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3.5 py-2 ${EDGES}`}>
        {error && <p role="alert" className="mx-auto w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">{error}</p>}
        <div className="flex flex-col gap-2">
          <label htmlFor="edit-front" className={LABEL}>QUESTION</label>
          <textarea id="edit-front" rows={3} value={front} onChange={e => setFront(e.target.value)} className={`${FIELD} min-h-[120px] text-[19px] leading-[26px] font-semibold`} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="edit-back" className={LABEL}>RÉPONSE</label>
          <textarea id="edit-back" rows={4} value={back} onChange={e => setBack(e.target.value)} className={`${FIELD} min-h-[150px] text-[17px] leading-6`} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className={`${LABEL} mb-2`}>TAGS <span className="font-normal tracking-normal">· {minTags === 0 ? `${MAX_TAGS} au plus` : `1 à ${MAX_TAGS}`}</span></legend>
          <ul role="list" className="flex flex-wrap gap-2.5">
            {tags.map(name => (
              <li key={name}>
                <span className="tag-pill flex h-10 items-center gap-2 rounded-full ps-4 pe-2.5 text-[15px] leading-[18px] font-medium">
                  {name}
                  <button
                    type="button"
                    aria-label={`Retirer ${name}`}
                    onClick={() => setTags(t => t.filter(x => x !== name))}
                    className="flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-black/10 dark:bg-white/15"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
                  </button>
                </span>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-black/25 px-4 text-[15px] leading-[18px] font-medium text-label-2 dark:border-white/30"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Ajouter un tag
              </button>
            </li>
          </ul>
        </fieldset>
        {source && (
          <div className="flex flex-col gap-1 px-1.5 pt-2">
            <span className="text-[13px] leading-4 text-label-2">Source</span>
            <span className="text-[15px] leading-5 font-medium text-label-2">{source}</span>
          </div>
        )}
      </main>
      {confirming && <DiscardDialog onDiscard={onClose} onContinue={() => setConfirming(false)} />}
    </Page>
  )
}
