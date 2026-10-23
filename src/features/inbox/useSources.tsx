import { useRef, useState } from 'react'
import { ACCEPT_ATTR, addFile, type InboxDeps, type InboxItem } from '../../lib/inbox'
import { inboxErrorMessage } from './sourceName'
import type { SourceKind } from './sources'

/** Nom accessible de la source Vocal tant qu'elle n'existe pas (#48). */
export const VOICE_LABEL = 'Vocal, bientôt disponible'

interface SourcesOptions {
  deps: InboxDeps
  /** « À la main » : fenêtre Nouvelle carte. */
  onManual(): void
  /** « Texte » : écran Source · Texte. */
  onText(): void
  /** Fichier ou photo envoyé : écran Brouillons de la source. */
  onSent(item: InboxItem): void
}

interface Message { text: string; alert: boolean }

/**
 * Actions des sources de nouvelles cartes, une seule fois pour l'accueil et le hub : Fichier et Photo ouvrent le
 * sélecteur natif puis envoient tout de suite (inbox.ts) ; Vocal n'existe pas encore (#48) et le dit. `inputs`
 * (les deux champs fichier cachés) est à rendre une fois par écran.
 */
export function useSources({ deps, onManual, onText, onSent }: SourcesOptions) {
  const fileInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'file' | 'photo' | null>(null)
  const [message, setMessage] = useState<Message | null>(null)

  const send = async (input: HTMLInputElement, which: 'file' | 'photo') => {
    const file = input.files?.[0]
    input.value = '' // le même fichier peut être choisi de nouveau
    if (!file || busy) return
    setBusy(which)
    setMessage(null)
    try {
      onSent(await addFile(deps, file))
    } catch (e) {
      setMessage({ text: inboxErrorMessage(e), alert: true })
    } finally {
      setBusy(null)
    }
  }

  const actions: Record<SourceKind, () => void> = {
    manual: onManual,
    text: onText,
    file: () => fileInput.current?.click(),
    photo: () => photoInput.current?.click(),
    voice: () => setMessage({ text: 'Le vocal arrive bientôt.', alert: false }),
  }
  /** Libellé d'une source qui envoie : « Envoi… » pendant le dépôt. */
  const label = (which: SourceKind, text: string) => (busy !== null && busy === which ? 'Envoi…' : text)

  const inputs = (
    <>
      <input ref={fileInput} type="file" accept={ACCEPT_ATTR} hidden aria-label="Choisir un fichier" onChange={e => void send(e.currentTarget, 'file')} />
      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden aria-label="Prendre une photo" onChange={e => void send(e.currentTarget, 'photo')} />
    </>
  )
  return { busy, message, actions, label, inputs }
}
