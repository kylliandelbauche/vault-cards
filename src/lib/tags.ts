import { byTagName, normalizeTagName, tagKey } from '../../shared/tags'
import { isLive } from './session'
import type { Card, Tag } from './types'

/**
 * Tags connus de l'appareil (#79) : le registre tiré du serveur (table `tags`), plus les noms portés par les cartes
 * vivantes locales (un tag créé hors ligne existe dès que sa carte est écrite, avant la synchro ; le trigger serveur
 * le créera à l'envoi). Dédoublonnés par clé (casse ignorée : l'orthographe du registre l'emporte), triés A–Z.
 * Les brouillons ne comptent pas : leurs nouveaux noms ne deviennent des tags qu'à la validation.
 */
export function knownTagNames(cards: readonly Card[], registry: readonly Pick<Tag, 'name'>[]): string[] {
  const byKey = new Map<string, string>()
  for (const t of registry) if (!byKey.has(tagKey(t.name))) byKey.set(tagKey(t.name), t.name)
  for (const c of cards) {
    if (!isLive(c)) continue
    for (const name of c.tags ?? []) if (!byKey.has(tagKey(name))) byKey.set(tagKey(name), normalizeTagName(name))
  }
  return [...byKey.values()].sort(byTagName)
}

export interface TagChoice { name: string; cards: number }

/** Liste de l'écran « Ajouter des tags » : chaque tag connu (vides compris) et son nombre de cartes vivantes, A–Z. */
export function tagChoices(cards: readonly Card[], registry: readonly Pick<Tag, 'name'>[]): TagChoice[] {
  const counts = new Map<string, number>()
  for (const c of cards) {
    if (!isLive(c)) continue
    for (const key of new Set((c.tags ?? []).map(tagKey))) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return knownTagNames(cards, registry).map(name => ({ name, cards: counts.get(tagKey(name)) ?? 0 }))
}
