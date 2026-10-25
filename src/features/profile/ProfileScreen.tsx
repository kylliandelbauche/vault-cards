import { Page, Preloader } from 'konsta/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { DiscardDialog } from '../../components/SheetBar'
import { BarTitle, EDGES, TopBar, type SyncIndicator } from '../../components/TopBar'
import { AccountError, changePseudo, OFFLINE_MESSAGE, type ProfileDeps } from '../../lib/account'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { useOnline } from '../../lib/useOnline'
import type { HomeData } from '../home/useHomeData'
import { useLeaveGuard } from '../home/useLeaveGuard'
import { EmailForm, PasswordForm } from './ProfileForms'
import { useProfileUser } from './useProfileUser'

interface Props {
  deps: ProfileDeps
  /** Compteurs locaux (cache Dexie), les mêmes que l'accueil et « Mes tags ». */
  data: HomeData
  sync?: SyncIndicator
  /** Écran affiché : le Profil, ou l'un de ses deux formulaires (chacun est un niveau de navigation). */
  view?: 'email' | 'password'
  /** Nom accessible de la flèche : l'écran de destination. */
  backLabel?: string
  onBack(): void
  onOpenCards(): void
  onOpenTags(): void
  onOpenEmail(): void
  onOpenPassword(): void
  /** Déconnexion sûre (#40) : synchro d'abord, confirmation si elle échoue. */
  onSignOut(): void
}

const initialOf = (text: string) => [...text.trim()][0]?.toUpperCase() ?? '?'

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-label-2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

const TILE = 'flex min-h-[76px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] bg-black/5 px-1 py-3 dark:bg-white/8'
const TILE_LINK = `${TILE} hover:bg-black/10 active:bg-black/15 dark:hover:bg-white/12 dark:active:bg-white/16`

function Tile({ value, label, onOpen }: { value: string; label: string; onOpen?(): void }) {
  const inside: ReactNode = (
    <>
      <span className="text-[28px] leading-[34px] font-bold text-black dark:text-white">{value}</span>
      <span className="text-[13px] leading-4 font-medium text-label-2">{label}{onOpen ? ' ›' : ''}</span>
    </>
  )
  return onOpen
    ? <button type="button" aria-label={`${value} ${label}`} onClick={onOpen} className={TILE_LINK}>{inside}</button>
    : <div className={TILE}>{inside}</div>
}

/**
 * « Profil » v2 (#83, Paper « Profil · v2 », « Profil · Mot de passe », « Profil · Adresse e-mail », ligne Officiel).
 * Carte d'identité sans photo : avatar = initiale du pseudo (ou de l'e-mail), pseudo modifiable (métadonnées de
 * l'utilisateur Supabase, aucune table), e-mail, et 3 compteurs locaux : « Cartes › » (→ Mes cartes), « Maîtrisées »
 * (simple compteur), « Tags › » (→ Mes tags). Puis « Changer l'e-mail » et « Changer le mot de passe », et en bas
 * « Se déconnecter » (déconnexion sûre #40). Aucun bouton bleu ici ; les formulaires ont leur ✓ bleu.
 */
export function ProfileScreen({ deps, data, sync, view, backLabel = 'Accueil', onBack, onOpenCards, onOpenTags, onOpenEmail, onOpenPassword, onSignOut }: Props) {
  const { user, setPseudo } = useProfileUser(deps.client)
  const online = useOnline(deps.online)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Pseudo en cours de modification (#88) : retour du navigateur / geste iOS = même confirmation que la flèche.
  // Inactif sous un formulaire (celui-ci a son propre garde).
  const dirty = editing && !view && draft.trim() !== (user?.pseudo ?? '')
  useLeaveGuard(dirty, () => setConfirming(true))

  // Formulaires : état (message de succès) gardé ici, le formulaire se ferme par un retour de navigation.
  const done = (message: string) => { setNotice(message); onBack() }
  if (user && view === 'email') return <EmailForm deps={deps} user={user} onClose={onBack} onDone={done} />
  if (user && view === 'password') return <PasswordForm deps={deps} user={user} onClose={onBack} onDone={done} />

  const stats = data.status === 'ready' ? data.stats : null
  const count = (n: number | undefined) => (n === undefined ? '–' : String(n))
  // Tags portés par au moins une carte active (ni brouillon ni supprimée), comme « Mes tags ».
  const tagCount = stats?.tags.filter(t => t.total > 0).length

  const startEdit = () => { setDraft(user?.pseudo ?? ''); setError(null); setNotice(null); setEditing(true) }
  const stopEdit = () => { setEditing(false); setError(null); setConfirming(false) }
  const leave = () => (dirty ? setConfirming(true) : onBack())
  const savePseudo = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      setPseudo(await changePseudo(deps, draft))
      setEditing(false)
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Le pseudo n'a pas pu être enregistré. Réessaie.")
    } finally {
      setSaving(false)
    }
  }

  const name = user?.pseudo ?? ''
  const row = 'flex h-14 w-full items-center gap-2.5 px-[18px] text-start text-[17px] leading-[22px] font-medium text-black hover:bg-black/5 active:bg-black/10 dark:text-white dark:hover:bg-white/8 dark:active:bg-white/12'
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar onBack={leave} backLabel={backLabel} search={false} profile={false}>
        <BarTitle title="Profil" sync={sync} heading />
      </TopBar>
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 pt-1 pb-4 ${EDGES}`}>
        {user === undefined && <div className="my-auto flex justify-center"><Preloader aria-label="Chargement du profil" /></div>}
        {user !== undefined && (
          <>
            {notice && <p role="status" className="mx-auto w-fit max-w-full rounded-2xl bg-good-tint px-3 py-1.5 text-center text-[15px] leading-5 text-good">{notice}</p>}
            <section aria-label="Identité" className="glass-card flex flex-col items-center gap-4 rounded-[28px] px-[18px] pt-6 pb-[18px]">
              <div aria-hidden="true" className="flex size-20 shrink-0 items-center justify-center rounded-full bg-black/5 text-[32px] leading-[38px] font-bold text-black ring-1 ring-black/10 dark:bg-white/10 dark:text-white dark:ring-white/15">
                {initialOf(name || user?.email || '')}
              </div>
              <div className="flex w-full flex-col items-center gap-0.5">
                {editing ? (
                  <form onSubmit={e => void savePseudo(e)} onKeyDown={e => { if (e.key === 'Escape') stopEdit() }} noValidate className="flex w-full items-center gap-1">
                    <input
                      aria-label="Pseudo"
                      name="pseudo"
                      autoComplete="nickname"
                      autoCapitalize="words"
                      spellCheck={false}
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      className="h-11 min-w-0 flex-1 rounded-full bg-black/5 px-4 text-center text-[22px] leading-7 font-bold text-black outline-none focus:outline-2 focus:-outline-offset-2 focus:outline-new dark:bg-white/10 dark:text-white"
                    />
                    <button type="submit" aria-label="Enregistrer le pseudo" disabled={saving || !online} className="flex size-11 shrink-0 items-center justify-center rounded-full text-new hover:bg-black/5 disabled:text-label-2 disabled:opacity-70 dark:hover:bg-white/10">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    </button>
                    <button type="button" aria-label="Annuler" onClick={stopEdit} className="flex size-11 shrink-0 items-center justify-center rounded-full text-label-2 hover:bg-black/5 dark:hover:bg-white/10">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1 ps-11">
                    <p className={`min-w-0 truncate text-[22px] leading-7 font-bold ${name ? 'text-black dark:text-white' : 'text-label-2'}`}>{name || 'Ajoute un pseudo'}</p>
                    <button type="button" aria-label="Modifier le pseudo" onClick={startEdit} className="flex size-11 shrink-0 items-center justify-center rounded-full">
                      <span className="flex size-7 items-center justify-center rounded-full bg-black/5 text-label-2 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />
                        </svg>
                      </span>
                    </button>
                  </div>
                )}
                {editing && !online && <p role="status" className="text-center text-[13px] leading-4 text-label-2">{OFFLINE_MESSAGE}</p>}
                {error && <p role="alert" className="mt-1 w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">{error}</p>}
                <p className="max-w-full text-[15px] leading-5 break-all text-label-2">{user?.email}</p>
              </div>
              <div className="flex w-full gap-2">
                <Tile value={count(stats?.total)} label="Cartes" onOpen={onOpenCards} />
                <Tile value={count(stats?.mastered)} label="Maîtrisées" />
                <Tile value={count(tagCount)} label="Tags" onOpen={onOpenTags} />
              </div>
            </section>
            <div className="glass-card flex flex-col overflow-hidden rounded-[22px]">
              <button type="button" onClick={onOpenEmail} className={`${row} border-b border-black/10 dark:border-white/10`}>
                <span className="flex-1">Changer l'e-mail</span><Chevron />
              </button>
              <button type="button" onClick={onOpenPassword} className={row}>
                <span className="flex-1">Changer le mot de passe</span><Chevron />
              </button>
            </div>
          </>
        )}
      </main>
      {/* Verre à contour rouge (Paper) : libellé en rouge accessible (--again, ≥ 4,5:1 en clair comme en sombre). */}
      <div className={`mx-auto w-full max-w-xl pt-3 pb-[max(16px,var(--k-safe-area-bottom))] ${EDGES}`}>
        <GlassButton tone="again" onClick={onSignOut} className={`${GLASS_PRIMARY} gap-2.5 [--glass-btn-label:var(--again)]`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
          </svg>
          Se déconnecter
        </GlassButton>
      </div>
      {confirming && <DiscardDialog onDiscard={() => { stopEdit(); onBack() }} onContinue={() => setConfirming(false)} />}
    </Page>
  )
}
