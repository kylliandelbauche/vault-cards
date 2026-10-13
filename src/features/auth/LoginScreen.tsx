import { useState, type FormEvent } from 'react'
import { Button, List, ListInput, Page, Preloader } from 'konsta/react'
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
        {/* Même langage que la révision : fond décoratif + surface givrée dense (pas de verre sur un formulaire). */}
        <form onSubmit={submit} noValidate className="card-surface overflow-hidden rounded-[28px] pt-2">
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
          <div className="flex flex-col gap-3 px-4 pt-2 pb-3">
            <Button large rounded type="submit" disabled={sending}>
              {sending ? <Preloader aria-label="Connexion en cours" /> : 'Se connecter'}
            </Button>
            <p role="alert" aria-live="polite" className="min-h-6 text-center text-[15px] text-again">
              {error}
            </p>
          </div>
        </form>
      </main>
    </Page>
  )
}
