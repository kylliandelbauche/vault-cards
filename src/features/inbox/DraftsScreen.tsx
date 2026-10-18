import { Page, Preloader } from 'konsta/react'
import { useEffect, useState } from 'react'
import { getTag } from '../../../shared/tags'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { EDGES, TopBar, type SyncIndicator } from '../../components/TopBar'
import type { VaultDB } from '../../lib/db'
import { cards } from '../../lib/home'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import type { DraftsTarget } from '../home/useNavigation'
import { drafts as draftsLabel, sourceName } from './sourceName'
import { useDrafts } from './useDrafts'
import { useInbox } from './useInbox'

interface Props {
  db: VaultDB
  deps: InboxDeps
  target: DraftsTarget
  sync?: SyncIndicator
  onBack(): void
  onEdit(cardId: string): void
  /** Synchro immédiate : après chaque écriture locale, et quand la source vient d'être traitée (tirer ses brouillons). */
  onSync(): void
  /** Après « Tout valider ». */
  onDone(): void
}

/** Relecture des statuts tant que la source attend le Mac. */
const POLL_MS = 15_000

function statusLine(item: InboxItem | undefined, readError: boolean, sync?: SyncIndicator): string {
  if (!item) return readError ? 'Statut indisponible : pas de connexion ?' : 'Lecture du statut…'
  switch (item.status) {
    case 'pending': return 'En file d’attente.'
    case 'processing': return 'Traitement en cours…'
    case 'error': return `Échec du traitement : ${item.error ?? 'erreur inconnue'}.`
    case 'done': return sync === 'syncing' ? 'Traitée, récupération des brouillons…' : 'Traitée : aucun brouillon à valider.'
  }
}

/**
 * Brouillons d'une source (#81, Paper « Brouillons · A »), ou de toutes. Tant que /flashcards n'a pas tourné : état
 * d'attente + statut de la source (useInbox, relu toutes les 15 s et au retour au premier plan). Puis la liste
 * (useDrafts, cache local) dans une seule carte en verre : toucher une carte → Modifier ; × → retirer (suppression
 * douce) ; « Tout valider (n cartes) » dans l'emplacement d'action du bas.
 */
export function DraftsScreen({ db, deps, target, sync, onBack, onEdit, onSync, onDone }: Props) {
  const { drafts, error, reject, acceptAll } = useDrafts(db, target.inboxId, { onWrite: onSync })
  const inbox = useInbox(deps)
  const [failed, setFailed] = useState(false)
  const item = target.inboxId ? inbox.items?.find(i => i.id === target.inboxId) : undefined
  const source = target.source ?? (item ? sourceName(item) : undefined)
  const empty = drafts !== null && drafts.length === 0
  const waiting = empty && target.inboxId !== undefined && (item === undefined
    ? inbox.items === null
    : item.status === 'pending' || item.status === 'processing')

  const { refresh } = inbox
  useEffect(() => {
    if (!waiting) return
    const id = window.setInterval(() => void refresh(), POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [waiting, refresh])

  // Source traitée sur le Mac : ses brouillons arrivent par la synchro des cartes.
  const status = item?.status
  useEffect(() => { if (status === 'done') onSync() }, [status, onSync])

  const act = async (run: () => Promise<unknown>) => {
    try { setFailed(false); await run() } catch { setFailed(true) }
  }

  const n = drafts?.length ?? 0
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar onBack={onBack} backLabel="Accueil">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] leading-tight font-semibold text-black dark:text-white">{n > 0 ? draftsLabel(n) : 'Brouillons'}</h1>
          {source && <p className="truncate text-[13px] leading-4 text-label-2">Depuis « {source} »</p>}
        </div>
      </TopBar>

      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 py-2 ${EDGES}`}>
        {drafts === null && !error && <div className="my-auto flex justify-center"><Preloader /></div>}
        {error && (
          <p role="alert" className="glass-card my-auto rounded-[28px] p-6 text-center text-[17px] text-label-2">
            Impossible de lire les brouillons enregistrés sur cet appareil.
          </p>
        )}
        {empty && (
          <section className="glass-card my-auto rounded-[28px] p-6 text-center text-black dark:text-white">
            {waiting || item ? (
              <>
                <h2 className="text-[17px] leading-tight font-semibold">
                  {waiting ? 'En attente de traitement sur ton Mac' : 'Aucun brouillon à valider'}
                </h2>
                <p role="status" className="mt-1.5 text-[15px] leading-5 text-label-2">{statusLine(item, inbox.error !== null, sync)}</p>
                {waiting && <p className="mt-3 text-[13px] leading-[18px] text-label-2">Lance /flashcards sur le Mac : les brouillons apparaîtront ici.</p>}
              </>
            ) : <h2 className="text-[17px] leading-tight font-semibold">Aucun brouillon à valider</h2>}
          </section>
        )}
        {n > 0 && (
          <ul role="list" aria-label="Brouillons" className="glass-card rounded-[24px] text-black dark:text-white">
            {drafts?.map(c => (
              <li key={c.id} className="flex items-start gap-1 border-t border-black/8 py-1 ps-1 pe-0.5 first:border-t-0 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => onEdit(c.id)}
                  className="min-w-0 flex-1 rounded-[18px] px-3 py-2.5 text-start hover:bg-black/4 active:bg-black/8 dark:hover:bg-white/6 dark:active:bg-white/10"
                >
                  <span className="block text-[16px] leading-[21px] font-semibold">{c.front}</span>
                  <span className="mt-1 line-clamp-2 block text-[14px] leading-[19px] text-label-2">{c.back}</span>
                  {c.tags.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {c.tags.map(slug => getTag(slug)).filter(t => t !== undefined).map(t => (
                        <span key={t.slug} className="tag-pill rounded-full px-2.5 py-1 text-[12px] leading-4 font-medium">{t.label}</span>
                      ))}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Retirer « ${c.front} »`}
                  onClick={() => void act(() => reject(c.id))}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-label-2"
                >
                  <span aria-hidden="true" className="flex size-[30px] items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                    <svg viewBox="0 0 24 24" className="size-[13px]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M7 7l10 10M17 7L7 17" />
                    </svg>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {n > 0 && (
        <footer className={`action-dock sticky bottom-0 z-20 shrink-0 pt-3.5 pb-[max(12px,var(--k-safe-area-bottom))] ${EDGES}`}>
          <div className="mx-auto max-w-xl">
            {failed && (
              <p role="alert" className="mx-auto mb-1.5 w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">
                Action non enregistrée. Réessaie.
              </p>
            )}
            <GlassButton tone="new" className={GLASS_PRIMARY} onClick={() => void act(async () => { await acceptAll(); onDone() })}>
              Tout valider ({cards(n)})
            </GlassButton>
          </div>
        </footer>
      )}
    </Page>
  )
}
