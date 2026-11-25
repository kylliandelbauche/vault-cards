/**
 * Vecteurs de test FSRS pour l'app native (#156) : des historiques de révisions déterministes passés dans `ts-fsrs` avec
 * les réglages de l'app (src/lib/scheduler.ts). Le port Swift (apple/VaultCardsCore) doit retrouver exactement les
 * mêmes états. Usage : `node tools/dev/fsrs-vectors.ts` (réécrit le fichier) ; la CI vérifie qu'il est à jour.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fsrs, createEmptyCard, Rating, type Card, type Grade } from 'ts-fsrs'

const OUT = fileURLToPath(new URL('../../apple/VaultCardsCore/Tests/VaultCardsCoreTests/Fixtures/fsrs-vectors.json', import.meta.url))
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false })
const grades: Grade[] = [Rating.Again, Rating.Hard, Rating.Good]

/** Générateur pseudo-aléatoire déterministe (LCG 32 bits) : mêmes vecteurs à chaque exécution. */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const MIN = 60_000
const DAY = 86_400_000
/** Écarts entre deux révisions : même minute, quelques minutes, heures, jours, mois. */
const GAPS = [0, MIN, 10 * MIN, 3 * 3_600_000, DAY, 2 * DAY, 5 * DAY, 13 * DAY, 40 * DAY, 200 * DAY]

const snapshot = (c: Card) => ({
  due: c.due.getTime(),
  stability: c.stability,
  difficulty: c.difficulty,
  state: c.state,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
})

const sequences = []
for (let n = 0; n < 60; n++) {
  const rand = lcg(1000 + n)
  let at = Date.UTC(2026, 0, 1, 7, 30) + Math.floor(rand() * 30) * DAY + Math.floor(rand() * 1440) * MIN
  let card = createEmptyCard(new Date(0))
  const steps = []
  const length = 1 + Math.floor(rand() * 14)
  for (let i = 0; i < length; i++) {
    // Une note sur trois au moins « Good », pour que des cartes atteignent de longs intervalles.
    const rating = rand() < 0.5 ? 3 : grades[Math.floor(rand() * 3)]
    card = scheduler.next(card, new Date(at), rating).card
    steps.push({ at, rating, card: snapshot(card) })
    at += GAPS[Math.floor(rand() * GAPS.length)] + Math.floor(rand() * 600) * 1000
  }
  const preview = scheduler.repeat(card, new Date(at))
  sequences.push({ steps, preview_at: at, preview: grades.map(g => preview[g].card.due.getTime()) })
}

writeFileSync(OUT, `${JSON.stringify({ generator: 'ts-fsrs', settings: { request_retention: 0.9, enable_fuzz: false }, sequences }, null, 1)}\n`)
