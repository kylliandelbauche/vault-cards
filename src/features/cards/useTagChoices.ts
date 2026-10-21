import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import type { VaultDB } from '../../lib/db'
import { tagChoices, type TagChoice } from '../../lib/tags'

/** Tags connus de l'appareil avec leur nombre de cartes, en direct (registre tiré du serveur + cartes locales). */
export function useTagChoices(db: VaultDB): TagChoice[] | null {
  const [choices, setChoices] = useState<TagChoice[] | null>(null)
  useEffect(() => {
    const sub = liveQuery(() => Promise.all([db.cards.toArray(), db.tags.toArray()])).subscribe({
      next: ([all, registry]) => setChoices(tagChoices(all, registry)),
      error: () => setChoices([]),
    })
    return () => sub.unsubscribe()
  }, [db])
  return choices
}

/** Lettre d'index d'un nom : première lettre sans accent, « # » si ce n'est pas une lettre. */
export function indexLetter(name: string): string {
  const c = name.normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : '#'
}
