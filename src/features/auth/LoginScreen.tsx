import { useState, type FormEvent } from 'react'
import { List, ListInput, Page, Preloader } from 'konsta/react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { TRANSPARENT_PAGE } from '../../lib/theme'

interface Props {
  signIn(email: string, password: string): Promise<{ error: string | null }>
}

export function LoginScreen({ signIn }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
                inputClassName="h-11!"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </List>
          </div>
          <GlassButton tone="new" type="submit" disabled={sending} className={GLASS_PRIMARY}>
            {sending ? <Preloader aria-label="Connexion en cours" colors={{ iconIos: 'text-white' }} /> : 'Se connecter'}
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
