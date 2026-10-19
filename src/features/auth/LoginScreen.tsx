import { useState, type FormEvent } from 'react'
import { List, ListInput, Page, Preloader } from 'konsta/react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { TRANSPARENT_PAGE } from '../../lib/theme'

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  )
}

interface Props {
  signIn(email: string, password: string): Promise<{ error: string | null }>
}

export function LoginScreen({ signIn }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    const res = await signIn(email.trim(), password)
    // En cas de succès, l'écran est démonté par App : on ne touche plus à l'état.
    if (res.error) {
      setError(res.error)
      setSending(false)
    }
  }

  return (
    <Page
      colors={TRANSPARENT_PAGE}
      className="flex flex-col pt-[max(12px,var(--k-safe-area-top))] pb-[max(12px,var(--k-safe-area-bottom))] ps-[max(16px,var(--k-safe-area-left))] pe-[max(16px,var(--k-safe-area-right))]"
    >
      <main className="mx-auto my-auto w-full max-w-md">
        <h1 className="mb-6 text-center text-[34px] font-bold text-black dark:text-white">Vault Cards</h1>
        {/*
          Liquid Glass (#39) : les champs dans un bloc en verre, « Se connecter » en dehors, bouton en verre bleu
          indépendant (toujours dans le <form> : Entrée et le remplissage automatique iOS soumettent toujours).
        */}
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div data-testid="login-fields" className="glass-card overflow-hidden rounded-[28px] py-1">
            <List className="my-0!" colors={{ strongBgIos: 'bg-transparent' }} strongIos>
              <ListInput
                label={<label htmlFor="login-email">E-mail</label>}
                inputId="login-email"
                inputClassName="h-11!"
                type="email"
                name="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                inputMode="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <ListInput
                label={<label htmlFor="login-password">Mot de passe</label>}
                inputId="login-password"
                className="relative"
                inputClassName="h-11! pe-11!"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
              >
                {/* Œil (#84) : type="button" (ne soumet pas), cible 44 px, le mot de passe reste dans le champ. */}
                <button
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  onClick={() => setShowPassword(v => !v)}
                  className="password-toggle absolute right-1 bottom-0 flex h-11 w-11 items-center justify-center rounded-full text-label-2"
                >
                  <EyeIcon crossed={showPassword} />
                </button>
              </ListInput>
            </List>
          </div>
          <GlassButton tone="new" type="submit" disabled={sending} className={GLASS_PRIMARY}>
            {sending ? <Preloader aria-label="Connexion en cours" /> : 'Se connecter'}
          </GlassButton>
          {/* Sur le fond décoratif, le message a sa propre pastille opaque (≥ 5:1 en clair comme en sombre). */}
          <p role="alert" aria-live="polite" className="flex min-h-8 justify-center text-center text-[15px]">
            {error && <span className="rounded-full bg-again-tint px-3 py-1 text-again">{error}</span>}
          </p>
        </form>
      </main>
    </Page>
  )
}
