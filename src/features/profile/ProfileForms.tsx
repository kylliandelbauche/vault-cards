import { Page } from 'konsta/react'
import { useState, type FormEvent } from 'react'
import { EyeToggle } from '../../components/EyeToggle'
import { DiscardDialog, SheetBar } from '../../components/SheetBar'
import { EDGES } from '../../components/TopBar'
import { AccountError, changePassword, MIN_PASSWORD, OFFLINE_MESSAGE, requestEmailChange, type ProfileDeps } from '../../lib/account'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { useOnline } from '../../lib/useOnline'
import { useLeaveGuard } from '../home/useLeaveGuard'

const LABEL = 'px-1.5 text-[13px] leading-4 font-semibold tracking-[0.06em] text-label-2 uppercase'
const FIELD = 'glass-card block h-14 w-full rounded-[22px] px-[18px] text-[17px] leading-[22px] font-medium text-black outline-none focus:outline-2 focus:-outline-offset-2 focus:outline-new dark:text-white'
const HINT = 'px-1.5 text-[13px] leading-4 text-label-2'

interface FormProps {
  deps: ProfileDeps
  /** Compte courant (id pour la vérification de la reconnexion, adresse actuelle). */
  user: { id: string; email: string }
  /** Ferme le formulaire (retour au Profil). */
  onClose(): void
  /** Succès : le Profil affiche ce message, puis le formulaire se ferme. */
  onDone(message: string): void
}

/**
 * Mécanique commune des deux formulaires : ✓ (désactivé hors ligne, sans saisie ou pendant l'envoi), erreur en
 * français, et garde de retour (#88) tant qu'une saisie n'est pas envoyée : le geste iOS ouvre la même confirmation
 * que le ✕.
 */
function useAccountForm(dirty: boolean, deps: ProfileDeps, onClose: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const online = useOnline(deps.online)
  useLeaveGuard(dirty && !saving, () => setConfirming(true))
  const close = () => (dirty ? setConfirming(true) : onClose())
  const run = async (action: () => Promise<void>) => {
    if (saving || !online) return
    setSaving(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof AccountError ? e.message : 'Modification non enregistrée. Réessaie.')
      setSaving(false)
    }
  }
  return { error, saving, confirming, setConfirming, online, close, run }
}

function Feedback({ error, online }: { error: string | null; online: boolean }) {
  return (
    <>
      {!online && <p role="status" className="mx-auto w-fit rounded-full bg-hard-tint px-3 py-0.5 text-center text-[15px] text-hard">{OFFLINE_MESSAGE}</p>}
      {error && <p role="alert" className="mx-auto w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">{error}</p>}
    </>
  )
}

/** « Profil · Adresse e-mail » (Paper) : nouvelle adresse, rappel de l'actuelle, liens de confirmation Supabase (ancienne et nouvelle adresse). */
export function EmailForm({ deps, user, onClose, onDone }: FormProps) {
  const [value, setValue] = useState('')
  const f = useAccountForm(value !== '', deps, onClose)
  const submit = () => f.run(async () => {
    const asked = await requestEmailChange(deps, user.email, value)
    onDone(`Un lien a été envoyé à ton adresse actuelle et un autre à ${asked}. Valide les deux pour changer d'adresse. L'actuelle reste active jusque-là.`)
  })
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void submit() }
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <SheetBar title="Adresse e-mail" onClose={f.close} onConfirm={() => void submit()} confirmLabel="Envoyer le lien" confirmDisabled={f.saving || !f.online || value.trim() === ''} />
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3.5 py-2 ${EDGES}`}>
        <Feedback error={f.error} online={f.online} />
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
          <label htmlFor="profile-new-email" className={LABEL}>Nouvelle adresse e-mail</label>
          <input
            id="profile-new-email"
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            className={FIELD}
          />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
        <div className="flex flex-col gap-1 px-1.5 pt-3.5">
          <span className="text-[13px] leading-4 text-label-2">Adresse actuelle</span>
          <p className="text-[15px] leading-5 font-medium break-all text-label-2">{user.email}</p>
          <p className="pt-3 text-[15px] leading-5 font-medium text-label-2">Un lien sera envoyé à l'adresse actuelle et un autre à la nouvelle. Il faut valider les deux. L'adresse actuelle reste active jusque-là.</p>
        </div>
      </main>
      {f.confirming && <DiscardDialog onDiscard={onClose} onContinue={() => f.setConfirming(false)} />}
    </Page>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, autoFocus }: {
  id: string
  label: string
  value: string
  onChange(v: string): void
  autoComplete: 'current-password' | 'new-password'
  autoFocus?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          name={id}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`${FIELD} pe-14`}
        />
        <EyeToggle shown={shown} onToggle={() => setShown(v => !v)} subject={`le ${label.toLowerCase()}`} className="absolute end-1.5 top-1.5" />
      </div>
    </div>
  )
}

/**
 * « Profil · Mot de passe » (Paper) : actuel, nouveau, confirmer, un œil par champ. L'actuel est vérifié par une
 * reconnexion avec l'e-mail du compte (`changePassword`), puis le nouveau est enregistré.
 */
export function PasswordForm({ deps, user, onClose, onDone }: FormProps) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const f = useAccountForm(current !== '' || next !== '' || confirm !== '', deps, onClose)
  const submit = () => f.run(async () => {
    await changePassword(deps, user, current, next, confirm)
    onDone('Mot de passe modifié.')
  })
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void submit() }
  const incomplete = current === '' || next === '' || confirm === ''
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <SheetBar title="Mot de passe" onClose={f.close} onConfirm={() => void submit()} confirmLabel="Enregistrer" confirmDisabled={f.saving || !f.online || incomplete} />
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3.5 py-2 ${EDGES}`}>
        <Feedback error={f.error} online={f.online} />
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
          {/* Identifiant du compte pour le gestionnaire de mots de passe d'iOS (invisible, hors tabulation). */}
          <input type="text" name="username" autoComplete="username" value={user.email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
          <PasswordField id="profile-current-password" label="Mot de passe actuel" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
          <PasswordField id="profile-new-password" label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" />
          <PasswordField id="profile-confirm-password" label="Confirmer le nouveau mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
        <p className={`${HINT} pt-3.5`}>{MIN_PASSWORD} caractères minimum.</p>
      </main>
      {f.confirming && <DiscardDialog onDiscard={onClose} onContinue={() => f.setConfirming(false)} />}
    </Page>
  )
}
