import { useState, type FormEvent } from 'react'
import { Block, Button, List, ListInput, Page, Preloader } from 'konsta/react'

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
    <Page className="flex flex-col justify-center pb-[var(--k-safe-area-bottom)] pt-[var(--k-safe-area-top)]">
      <main className="mx-auto w-full max-w-md">
        <h1 className="mb-6 text-center text-[34px] font-bold">Vault Cards</h1>
        <form onSubmit={submit} noValidate>
          <List strongIos insetIos>
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
          <Block className="flex flex-col gap-4">
            <Button large rounded type="submit" disabled={sending}>
              {sending ? <Preloader aria-label="Connexion en cours" /> : 'Se connecter'}
            </Button>
            <p role="alert" aria-live="polite" className="min-h-6 text-center text-[15px] text-again">
              {error}
            </p>
          </Block>
        </form>
      </main>
    </Page>
  )
}
