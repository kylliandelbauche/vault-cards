# Vault Cards MVP — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS : superpowers:subagent-driven-development. Chaque tâche = une issue GitHub, une branche, une PR. Étapes en cases à cocher (`- [ ]`).

**Objectif :** PWA de flashcards (FSRS) installable sur iPhone, hors ligne, synchronisée avec Supabase, alimentée par un skill Claude Code qui transforme les notes `3-Resources/veille` en cartes.

**Architecture :** React + Vite + TS côté client, Konsta UI (thème iOS) sur Tailwind 4. Stockage local Dexie (IndexedDB) ; Supabase = source de vérité des cartes et journal des réponses (`reviews`, ajout seul). L'état FSRS d'une carte est recalculé en rejouant ses reviews. Un outil Node local (`tools/cards`) écrit les cartes avec la clé secrète.

**Stack :** Vite 8, React 19, TypeScript, Tailwind 4 + `konsta` 5, `ts-fsrs` 5, `dexie` 4, `@supabase/supabase-js` 2, `vite-plugin-pwa` 2, Vitest + `fake-indexeddb` + Testing Library, Supabase CLI, GitHub Actions, Vercel.

**Spec :** `docs/specs/2026-10-12-vault-cards-design.md`

## Contraintes globales

- Langue de l'interface : français. Libellés exacts des boutons : `Je ne sais pas` / `Moyen` / `Très bien` ; `Afficher la réponse` ; `Session terminée`.
- Boutons → FSRS : `Je ne sais pas` = `Rating.Again` (1), `Moyen` = `Rating.Hard` (2), `Très bien` = `Rating.Good` (3). `Easy` n'est jamais utilisé.
- FSRS : `fsrs({ request_retention: 0.9, enable_fuzz: false })` — fuzz désactivé pour que le rejeu des reviews soit déterministe.
- Max **20 nouvelles cartes par jour** (jour local de l'appareil).
- Seules les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` vont dans le client. La clé secrète (`sb_secret_…` / `service_role`) n'existe que dans `.env.local` sur le Mac et dans les secrets GitHub ; jamais dans le code, jamais commitée, jamais affichée dans un log ou une PR.
- `.env*` ignoré par git sauf `.env.example`.
- Pas de `console.log` dans `src/` (règle ESLint `no-console: error`).
- Cibles tactiles ≥ 44 px, safe areas iOS respectées, mode sombre suivant le système.
- Vault : `~/Workspace`, nom de coffre Obsidian `Workspace`. Notes sources : `~/Workspace/3-Resources/veille/<deck>/**/*-synthese.md`.
- Node ≥ 22 (`process.loadEnvFile`, type stripping natif pour `tools/`).
- Jamais de commit direct sur `main` : branche `feat|fix|chore/<n°issue>-<slug>`, PR avec `Closes #<n>`, CI verte, relecture, puis squash merge.

## Points de vigilance (Review Focus)

1. **Lancement hors ligne avec jeton expiré** → l'app affiche quand même l'écran de révision avec les cartes en cache ; seule la synchro échoue, silencieusement. (Test : Tâche 5, `useAuth`.)
2. **Double tap sur un bouton de notation** (très probable au pouce) → une seule review enregistrée. (Test : Tâche 2, `useReviewSession`.)
3. **Push de reviews rejoué** (timeout réseau puis nouvel essai) → aucun doublon côté serveur. (Test : Tâche 5, `sync`.)
4. **Ligne serveur avec un horodatage égal au curseur** → jamais perdue au pull. (Test : Tâche 5, `sync`.)
5. **Note modifiée dont Claude garde certaines cartes** → les cartes gardées conservent leur `id`, donc leur progression. (Test : Tâche 7, `diffCards`.)

---

## Structure des fichiers

```
vault-cards/
  CLAUDE.md                       règles du projet pour les agents
  .env.example                    noms des variables, sans valeurs
  index.html, vite.config.ts, eslint.config.js, tsconfig*.json, package.json
  public/logo.svg                 source des icônes PWA
  src/
    main.tsx, App.tsx, index.css
    lib/
      types.ts                    Card, Review, Rating
      scheduler.ts                FSRS : rejeu des reviews, aperçu des échéances
      session.ts                  construction de la file + compteurs
      format.ts                   formatInterval
      obsidian.ts                 obsidianUrl
      sample-cards.ts             cartes d'exemple (Tâche 2 seulement)
      db.ts                       schéma Dexie
      supabase.ts                 client Supabase
      sync.ts                     push/pull
    features/
      auth/useAuth.ts, LoginScreen.tsx
      review/useReviewSession.ts, ReviewScreen.tsx, CardView.tsx, RatingBar.tsx, DoneScreen.tsx
  supabase/config.toml, supabase/migrations/20261012000000_init.sql
  tools/cards/lib.ts, cli.ts, lib.test.ts, fixtures/
  skill/flashcards/SKILL.md
  .github/workflows/ci.yml, keepalive.yml, backup.yml
  .github/dependabot.yml, .github/pull_request_template.md
  docs/security-checklist.md
```

## Ordre et parallélisme

```
T1 socle ─┬─ T2 révision locale ─┐
          └─ T3 schéma Supabase ─┼─ T4 connexion ── T5 stockage + synchro ── T6 PWA ── T9 audit
                                 ├─ T7 outil cards + skill
                                 └─ T8 ping + sauvegarde
```
T2 ∥ T3 après T1. T7 ∥ T8 ∥ T4 après T3.

---

### Tâche 1 : Socle du projet

**Fichiers :** créer tout le scaffold Vite, `CLAUDE.md`, `.env.example`, `.gitignore`, `eslint.config.js`, `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `.github/dependabot.yml`, `src/App.tsx` (écran vide Konsta), `src/lib/format.ts` + test.

**Interfaces :**
- Produit : `formatInterval(from: Date, to: Date): string` ; scripts npm `dev`, `build`, `lint`, `typecheck`, `test`.

- [ ] **Étape 1 : scaffold** — dans le repo (qui contient déjà `docs/`, `.mcp.json`, `.agents/`, `.claude/`), générer dans un dossier temporaire puis copier :

```bash
npm create vite@latest tmp-app -- --template react-ts
cp -R tmp-app/. . && rm -rf tmp-app
npm i
npm i konsta ts-fsrs dexie @supabase/supabase-js
npm i -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/user-event fake-indexeddb
```

- [ ] **Étape 2 : Tailwind + Konsta** — `vite.config.ts` :

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
})
```

`src/index.css` :

```css
@import "tailwindcss";
@import "konsta/react/theme.css";
```

`src/test-setup.ts` : `import 'fake-indexeddb/auto'`. Ajouter `/// <reference types="vitest/config" />` en tête de `vite.config.ts` si le typecheck le demande. Vérifier la doc d'installation Konsta 5 + Tailwind 4 sur konstaui.com si l'import CSS diffère.

`src/App.tsx` :

```tsx
import { App as KApp, Page, Navbar, Block } from 'konsta/react'

export default function App() {
  return (
    <KApp theme="ios" safeAreas>
      <Page>
        <Navbar title="Vault Cards" />
        <Block>Socle prêt.</Block>
      </Page>
    </KApp>
  )
}
```

`index.html` : `<html lang="fr">`, `<title>Vault Cards</title>`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

- [ ] **Étape 3 : test qui échoue** — `src/lib/format.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { formatInterval } from './format'

const t0 = new Date('2026-10-12T10:00:00Z')
const plus = (ms: number) => new Date(t0.getTime() + ms)
const MIN = 60_000, DAY = 86_400_000

describe('formatInterval', () => {
  it('moins d’une minute', () => expect(formatInterval(t0, plus(30_000))).toBe('< 1 min'))
  it('minutes', () => expect(formatInterval(t0, plus(10 * MIN))).toBe('10 min'))
  it('heures', () => expect(formatInterval(t0, plus(5 * 60 * MIN))).toBe('5 h'))
  it('jours', () => expect(formatInterval(t0, plus(3 * DAY))).toBe('3 j'))
  it('mois', () => expect(formatInterval(t0, plus(65 * DAY))).toBe('2 mois'))
  it('années', () => expect(formatInterval(t0, plus(440 * DAY))).toBe('1,2 an'))
  it('date passée', () => expect(formatInterval(t0, plus(-DAY))).toBe('< 1 min'))
})
```

Run : `npx vitest run src/lib/format.test.ts` → FAIL (module introuvable).

- [ ] **Étape 4 : implémentation** — `src/lib/format.ts` :

```ts
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

export function formatInterval(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime()
  if (ms < MIN) return '< 1 min'
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`
  const days = Math.round(ms / DAY)
  if (days < 30) return `${days} j`
  if (days < 365) return `${Math.round(days / 30)} mois`
  return `${(days / 365).toFixed(1).replace('.', ',')} an`
}
```

Run : `npx vitest run` → PASS.

- [ ] **Étape 5 : scripts et lint** — `package.json` scripts : `"typecheck": "tsc -b --noEmit"` (adapter si le template utilise `tsc -b`), `"test": "vitest run"`, `"lint": "eslint ."`. Dans `eslint.config.js`, ajouter la règle `'no-console': 'error'` pour `src/**`, et ignorer `dist`, `dev-dist`, `.agents`, `tools/cards/fixtures`.

- [ ] **Étape 6 : fichiers du repo**

`.gitignore` (en plus du template) :

```
.env
.env.*
!.env.example
dev-dist
```

`.env.example` :

```
# Client (exposé au navigateur — clé publique uniquement)
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
# Mac uniquement (tools/cards) — JAMAIS commité
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

`.github/workflows/ci.yml` :

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

`.github/dependabot.yml` : écosystème `npm`, intervalle `weekly`, groupe unique `all`. Écosystème `github-actions`, `monthly`.

`.github/pull_request_template.md` :

```markdown
Closes #

## Ce qui change

## Comment tester

## Checklist
- [ ] CI verte
- [ ] Aucune clé secrète ni donnée perso dans le diff
- [ ] Testé à la main (écran concerné) si UI
```

`CLAUDE.md` :

```markdown
# Vault Cards

PWA de flashcards FSRS, hors ligne, synchronisée avec Supabase. Spec : docs/specs/2026-10-12-vault-cards-design.md. Plan : docs/plans/2026-10-12-vault-cards-mvp.md.

## Règles de travail
- Une issue = une branche `feat|fix|chore/<n>-<slug>` = une PR avec `Closes #<n>`. Jamais de commit direct sur `main`.
- Avant de pousser : `npm run lint && npm run typecheck && npm test && npm run build`.
- Les échanges (avancement, questions, revues) se font en commentaires sur l'issue ou la PR via `gh`.
- Tout bug découvert hors périmètre = nouvelle issue `bug`, pas une correction en douce.

## Sécurité (non négociable)
- Client : uniquement `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Clé secrète Supabase : seulement dans `.env.local` (Mac) et les secrets GitHub. Jamais dans le code, un log, une issue, une PR.
- RLS activée sur toute table. Aucun accès `anon`.
- Pas de `console.log` dans `src/`.

## Commandes
- `npm run dev` · `npm test` · `npm run build`
- `node tools/cards/cli.ts scan|existing <path>|apply <file.json>`
- `supabase db push` (migrations dans `supabase/migrations/`)
```

- [ ] **Étape 7 : vérifier** — `npm run lint && npm run typecheck && npm test && npm run build` → tout passe. `npm run dev` → la page « Vault Cards / Socle prêt. » s'affiche avec la navbar iOS.

- [ ] **Étape 8 : commit + PR** — `git checkout -b chore/<n>-socle`, commit `chore: socle Vite React TS + Konsta + CI`, `gh pr create`.

- [ ] **Étape 9 (action de Kyllian, guidée par l'orchestrateur)** : sur vercel.com → Add New Project → importer `yukydesu/vault-cards` (framework Vite, réglages par défaut). Les variables `VITE_*` sont ajoutées en Tâche 4.

---

### Tâche 2 : Écran de révision + FSRS (local, cartes d'exemple)

**Fichiers :** créer `src/lib/types.ts`, `scheduler.ts`, `session.ts`, `obsidian.ts`, `sample-cards.ts` (+ tests), `src/features/review/*` ; modifier `src/App.tsx`.

**Interfaces :**
- Consomme : `formatInterval` (T1).
- Produit :

```ts
// types.ts
export type Rating = 1 | 2 | 3 // 1 Again · 2 Hard · 3 Good
export interface Card {
  id: string; deck: string; source_path: string
  front: string; back: string
  updated_at: string; deleted_at: string | null
}
export interface Review {
  id: string; card_id: string; rating: Rating
  reviewed_at: string // ISO
  synced: 0 | 1 // 0 = à pousser
}

// scheduler.ts
export function stateFromReviews(reviews: Review[]): FsrsCard
export function previewDue(state: FsrsCard, now: Date): Record<Rating, Date>
export function isNew(state: FsrsCard): boolean

// session.ts
export interface SessionItem { card: Card; state: FsrsCard }
export function buildQueue(cards: Card[], reviews: Review[], now: Date, newLimit?: number): SessionItem[]
export function countKinds(items: SessionItem[]): { new: number; learn: number; due: number }
export function nextDue(cards: Card[], reviews: Review[], now: Date): Date | null

// obsidian.ts
export function obsidianUrl(sourcePath: string): string

// features/review/useReviewSession.ts — dépend d'un "store" injecté
export interface ReviewStore {
  loadCards(): Promise<Card[]>
  loadReviews(): Promise<Review[]>
  addReview(r: Review): Promise<void>
}
export function useReviewSession(store: ReviewStore, now?: () => Date): {
  status: 'loading' | 'empty' | 'reviewing' | 'done'
  current: SessionItem | null
  revealed: boolean
  reveal(): void
  rate(r: Rating): void
  counts: { new: number; learn: number; due: number }
  progress: number // 0..1
  stats: { again: number; hard: number; good: number }
  nextDueAt: Date | null
  restart(): void
}
export const memoryStore: (cards: Card[]) => ReviewStore // pour T2 et les tests
```

- [ ] **Étape 1 : tests scheduler (échouent)** — `src/lib/scheduler.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { State } from 'ts-fsrs'
import { stateFromReviews, previewDue, isNew } from './scheduler'
import type { Review } from './types'

const r = (rating: 1 | 2 | 3, at: string, id = at): Review =>
  ({ id, card_id: 'c1', rating, reviewed_at: at, synced: 1 })

describe('scheduler', () => {
  it('sans review : carte nouvelle', () => {
    expect(isNew(stateFromReviews([]))).toBe(true)
  })
  it('rejoue dans l’ordre chronologique, quel que soit l’ordre reçu', () => {
    const a = [r(3, '2026-10-01T10:00:00Z'), r(3, '2026-10-02T10:00:00Z')]
    const b = [...a].reverse()
    expect(stateFromReviews(b).due.getTime()).toBe(stateFromReviews(a).due.getTime())
  })
  it('déterministe (pas de fuzz)', () => {
    const rs = [r(3, '2026-10-01T10:00:00Z'), r(3, '2026-10-03T10:00:00Z'), r(3, '2026-10-10T10:00:00Z')]
    expect(stateFromReviews(rs).due.getTime()).toBe(stateFromReviews(rs).due.getTime())
  })
  it('Again repasse la carte en (re)apprentissage', () => {
    const rs = [r(3, '2026-10-01T10:00:00Z'), r(3, '2026-10-03T10:00:00Z'), r(1, '2026-10-10T10:00:00Z')]
    expect(stateFromReviews(rs).state).toBe(State.Relearning)
  })
  it('aperçu : Again < Hard <= Good', () => {
    const now = new Date('2026-10-12T10:00:00Z')
    const p = previewDue(stateFromReviews([r(3, '2026-10-01T10:00:00Z')]), now)
    expect(p[1].getTime()).toBeLessThan(p[2].getTime())
    expect(p[2].getTime()).toBeLessThanOrEqual(p[3].getTime())
  })
})
```

Run : `npx vitest run src/lib/scheduler.test.ts` → FAIL.

- [ ] **Étape 2 : implémentation** — `src/lib/scheduler.ts` :

```ts
import { fsrs, createEmptyCard, Rating as F, State, type Card as FsrsCard, type Grade } from 'ts-fsrs'
import type { Rating, Review } from './types'

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false })
const toGrade = (r: Rating): Grade => (r === 1 ? F.Again : r === 2 ? F.Hard : F.Good)

export type { FsrsCard }

export function stateFromReviews(reviews: Review[]): FsrsCard {
  const sorted = [...reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at))
  let card = createEmptyCard(new Date(0))
  for (const rv of sorted) card = scheduler.next(card, new Date(rv.reviewed_at), toGrade(rv.rating)).card
  return card
}

export function previewDue(state: FsrsCard, now: Date): Record<Rating, Date> {
  const p = scheduler.repeat(state, now)
  return { 1: p[F.Again].card.due, 2: p[F.Hard].card.due, 3: p[F.Good].card.due }
}

export const isNew = (s: FsrsCard) => s.state === State.New
```

Run → PASS.

- [ ] **Étape 3 : tests session (échouent)** — `src/lib/session.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { buildQueue, countKinds, nextDue } from './session'
import type { Card, Review } from './types'

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id, deck: 'ia', source_path: `3-Resources/veille/ia/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null, ...extra,
})
const rv = (card_id: string, at: string, rating: 1 | 2 | 3 = 3): Review =>
  ({ id: `${card_id}-${at}`, card_id, rating, reviewed_at: at, synced: 1 })
const now = new Date('2026-10-12T10:00:00Z')

describe('buildQueue', () => {
  it('exclut les cartes supprimées', () => {
    expect(buildQueue([card('a', { deleted_at: '2026-10-02T00:00:00Z' })], [], now)).toHaveLength(0)
  })
  it('dues d’abord, puis nouvelles', () => {
    const q = buildQueue([card('new1'), card('old')], [rv('old', '2026-09-01T10:00:00Z')], now)
    expect(q.map(i => i.card.id)).toEqual(['old', 'new1'])
  })
  it('exclut les cartes pas encore dues', () => {
    expect(buildQueue([card('a')], [rv('a', '2026-10-12T09:59:00Z')], now)
      .filter(i => i.card.id === 'a' && i.state.due > now)).toHaveLength(0)
  })
  it('limite les nouvelles à 20 par jour, en comptant celles déjà vues aujourd’hui', () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(`n${i}`))
    const seenToday = [rv('n0', '2026-10-12T08:00:00Z'), rv('n1', '2026-10-12T08:01:00Z')]
    const q = buildQueue(cards, seenToday, now, 20)
    expect(q.filter(i => i.state.reps === 0)).toHaveLength(18)
  })
})

describe('countKinds / nextDue', () => {
  it('compte nouvelles / en apprentissage / dues', () => {
    const q = buildQueue([card('n'), card('l'), card('d')],
      // 'd' : deux « Good » pour sortir des étapes d'apprentissage (1m, 10m) et passer en Review
      [rv('l', '2026-10-12T09:00:00Z', 1), rv('d', '2026-09-01T10:00:00Z'), rv('d', '2026-09-01T10:20:00Z')], now)
    expect(countKinds(q)).toEqual({ new: 1, learn: 1, due: 1 })
  })
  it('nextDue : null si aucune carte révisée', () => {
    expect(nextDue([card('a')], [], now)).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Étape 4 : implémentation** — `src/lib/session.ts` :

```ts
import { State } from 'ts-fsrs'
import { stateFromReviews, isNew, type FsrsCard } from './scheduler'
import type { Card, Review } from './types'

export interface SessionItem { card: Card; state: FsrsCard }

const sameLocalDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

function byCard(reviews: Review[]) {
  const m = new Map<string, Review[]>()
  for (const r of reviews) m.set(r.card_id, [...(m.get(r.card_id) ?? []), r])
  return m
}

export function buildQueue(cards: Card[], reviews: Review[], now: Date, newLimit = 20): SessionItem[] {
  const grouped = byCard(reviews)
  const live = cards.filter(c => !c.deleted_at)
  const items = live.map(card => ({ card, state: stateFromReviews(grouped.get(card.id) ?? []) }))

  const introducedToday = [...grouped.values()].filter(rs => {
    const first = rs.reduce((a, b) => (a.reviewed_at < b.reviewed_at ? a : b))
    return sameLocalDay(new Date(first.reviewed_at), now)
  }).length

  const due = items.filter(i => !isNew(i.state) && i.state.due <= now)
    .sort((a, b) => a.state.due.getTime() - b.state.due.getTime())
  const fresh = items.filter(i => isNew(i.state))
    .sort((a, b) => a.card.source_path.localeCompare(b.card.source_path) || a.card.id.localeCompare(b.card.id))
    .slice(0, Math.max(0, newLimit - introducedToday))
  return [...due, ...fresh]
}

export function countKinds(items: SessionItem[]) {
  let n = 0, learn = 0, due = 0
  for (const { state } of items) {
    if (state.state === State.New) n++
    else if (state.state === State.Learning || state.state === State.Relearning) learn++
    else due++
  }
  return { new: n, learn, due }
}

export function nextDue(cards: Card[], reviews: Review[], now: Date): Date | null {
  const grouped = byCard(reviews)
  const dues = cards.filter(c => !c.deleted_at && grouped.has(c.id))
    .map(c => stateFromReviews(grouped.get(c.id)!).due)
    .filter(d => d > now)
  return dues.length ? new Date(Math.min(...dues.map(d => d.getTime()))) : null
}
```

Run → PASS.

- [ ] **Étape 5 : obsidian + cartes d'exemple** — `src/lib/obsidian.ts` :

```ts
export const obsidianUrl = (sourcePath: string) =>
  `obsidian://open?vault=Workspace&file=${encodeURIComponent(sourcePath.replace(/\.md$/, ''))}`
```

Test `src/lib/obsidian.test.ts` : `obsidianUrl('3-Resources/veille/ia/a b.md')` → `'obsidian://open?vault=Workspace&file=3-Resources%2Fveille%2Fia%2Fa%20b'`.

`src/lib/sample-cards.ts` : reprendre les 12 cartes de l'artefact d'origine (ci-dessous), converties en `Card` (`id` = `sample-<i>`, `deck` = premier segment du chemin, `source_path` = chemin, `front`/`back` en texte brut — **pas de HTML**, `<code>`/`<b>` retirés) :

```
Réseaux/HTTP.md | Que signifie le code HTTP 404 ? | La ressource demandée n'existe pas sur le serveur (Not Found).
Réseaux/HTTP.md | Différence entre 401 et 403 ? | 401 : non authentifié. 403 : authentifié mais pas autorisé.
Réseaux/Modèle OSI.md | Combien de couches compte le modèle OSI ? | 7 : physique, liaison, réseau, transport, session, présentation, application.
Réseaux/TCP-UDP.md | TCP ou UDP pour du streaming vidéo en direct ? | UDP : pas de retransmission, latence faible ; une image perdue vaut mieux qu'un retard.
BDD/SQL.md | Que fait un LEFT JOIN ? | Garde toutes les lignes de la table de gauche, avec les correspondances de droite ou NULL.
BDD/SQL.md | À quoi sert GROUP BY ? | Regrouper les lignes par valeur pour appliquer des agrégats (COUNT, SUM, AVG…).
BDD/Normalisation.md | Condition de la 1re forme normale (1FN) ? | Chaque attribut contient une valeur atomique, sans groupe répétitif.
Dev/Git.md | Différence entre git merge et git rebase ? | merge crée un commit de fusion ; rebase réécrit l'historique en rejouant les commits au-dessus de la cible.
Dev/Big O.md | Complexité d'une recherche dichotomique ? | O(log n) : l'espace de recherche est divisé par deux à chaque étape.
Mendix/Microflows.md | Microflow ou nanoflow : lequel s'exécute côté client ? | Le nanoflow s'exécute dans le client ; le microflow sur le serveur.
Sécurité/OWASP.md | Qu'est-ce qu'une injection SQL ? | Insertion de code SQL via une entrée utilisateur non filtrée. Parade : requêtes paramétrées.
Méthodo/Scrum.md | Durée habituelle d'un sprint Scrum ? | Fixe, 1 mois maximum ; souvent 2 semaines.
```

- [ ] **Étape 6 : tests du hook (échouent)** — `src/features/review/useReviewSession.test.tsx` avec `renderHook` + `act` :

```tsx
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useReviewSession, memoryStore } from './useReviewSession'
import type { Card } from '../../lib/types'

const cards: Card[] = ['a', 'b'].map(id => ({ id, deck: 'x', source_path: `x/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null }))
const fixedNow = () => new Date('2026-10-12T10:00:00Z')

describe('useReviewSession', () => {
  it('révéler puis noter passe à la carte suivante', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    const first = result.current.current!.card.id
    act(() => result.current.reveal())
    await act(async () => result.current.rate(3))
    expect(result.current.current!.card.id).not.toBe(first)
    expect(result.current.revealed).toBe(false)
  })
  it('noter sans avoir révélé ne fait rien', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    await act(async () => result.current.rate(3))
    expect((await store.loadReviews())).toHaveLength(0)
  })
  it('double tap : une seule review', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reveal())
    await act(async () => { result.current.rate(3); result.current.rate(3) })
    expect((await store.loadReviews())).toHaveLength(1)
  })
  it('« Je ne sais pas » remet la carte en fin de session', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    const first = result.current.current!.card.id
    act(() => result.current.reveal()); await act(async () => result.current.rate(1))
    act(() => result.current.reveal()); await act(async () => result.current.rate(3))
    expect(result.current.current!.card.id).toBe(first)
  })
  it('fin de session : status done + stats', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    for (const _ of cards) { act(() => result.current.reveal()); await act(async () => result.current.rate(3)) }
    expect(result.current.status).toBe('done')
    expect(result.current.stats).toEqual({ again: 0, hard: 0, good: 2 })
  })
  it('aucune carte : status empty', async () => {
    const { result } = renderHook(() => useReviewSession(memoryStore([]), fixedNow))
    await waitFor(() => expect(result.current.status).toBe('empty'))
  })
})
```

- [ ] **Étape 7 : implémenter le hook** — `useReviewSession.ts`. Règles :
  - au montage : `loadCards` + `loadReviews` → `buildQueue(cards, reviews, now())` ; file vide → `empty` si aucune carte vivante, sinon `done`.
  - `rate(r)` : ignoré si `!revealed` ou si une notation est en cours (verrou `useRef<boolean>` posé **avant** tout `await`, libéré à la fin) ; crée `Review { id: crypto.randomUUID(), card_id, rating: r, reviewed_at: now().toISOString(), synced: 0 }` ; `await store.addReview` ; recalcule l'état de la carte ; si `r === 1` remet l'item (avec nouvel état) en fin de file ; incrémente `stats` ; `revealed = false`.
  - `progress` = traités / (traités + restants).
  - `nextDueAt` = `nextDue(...)` recalculé à l'état `done`.
  - `restart()` relit le store et reconstruit la file.
  - `memoryStore(cards)` : tableaux en mémoire, `addReview` pousse dans le tableau.

Run → PASS.

- [ ] **Étape 8 : UI** — composants Konsta (`theme="ios"`), aucune logique dedans :
  - `ReviewScreen.tsx` : `Page` > `Navbar` titre « Vault Cards », à droite les compteurs (pastilles : nouvelles = bleu système, à revoir = rouge, dues = vert ; chiffres tabulaires) ; `Progressbar` sous la navbar ; `CardView` au centre ; `RatingBar` ou bouton plein largeur `Afficher la réponse` en bas, dans la zone du pouce, au-dessus de la safe area.
  - `CardView.tsx` : `Card` Konsta, `source_path` en petit (mono, gris) — lien `<a href={obsidianUrl(path)}>` ; question en 22 px semi-gras ; après révélation, séparateur puis réponse en 17 px. Tap sur la carte = `reveal()`. `white-space: pre-wrap` sur le texte.
  - `RatingBar.tsx` : 3 `Button` large (`Je ne sais pas` rouge, `Moyen` orange, `Très bien` vert, couleurs système iOS), chacun avec le délai `formatInterval(now, previewDue(state, now)[r])` dessous ; hauteur ≥ 56 px.
  - `DoneScreen.tsx` : `Session terminée`, stats (✕ / ~ / ✓), « Prochaine révision dans … » ou « Aucune carte en attente. », bouton `Réviser à nouveau` → `restart()`.
  - État `empty` : « Aucune carte pour l'instant. Lance /flashcards sur le Mac. »
  - Clavier (ordinateur) : Espace/Entrée = révéler ; 1/2/3 = noter.
  - `App.tsx` : `useReviewSession(memoryStore(SAMPLE_CARDS))`.

- [ ] **Étape 9 : vérifier** — tests + lint + typecheck + build verts. `npm run dev`, vérifier à la main en 390×844 (iPhone) et en desktop : révéler, noter, carte ratée qui revient, écran de fin, mode sombre. Joindre deux captures (mobile clair, mobile sombre) à la PR.

- [ ] **Étape 10 : commit + PR** `feat: écran de révision FSRS (local)`.

---

### Tâche 3 : Schéma Supabase + RLS

**Fichiers :** créer `supabase/config.toml` (via `supabase init`), `supabase/migrations/20261012000000_init.sql`, `src/lib/supabase-types.ts` (généré).

**Interfaces :**
- Produit : tables `cards`, `notes`, `reviews` (colonnes ci-dessous) ; types générés `Database`.

- [ ] **Étape 1 : lier le projet**

```bash
supabase init   # répondre non aux options IDE
supabase link --project-ref kowhaowawiqqnunxecyt
```

(`supabase link` demande le mot de passe de la base : **c'est Kyllian qui le tape** dans son terminal. L'orchestrateur lance la commande dans un onglet terminal visible.)

- [ ] **Étape 2 : migration** — `supabase/migrations/20261012000000_init.sql` :

```sql
-- Vault Cards : schéma initial. Un seul utilisateur, accès réservé au rôle authenticated.

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  deck text not null,
  source_path text not null,
  front text not null check (length(front) between 1 and 500),
  back text not null check (length(back) between 1 and 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index cards_updated_at_idx on public.cards (updated_at);
create index cards_source_path_idx on public.cards (source_path);

create table public.notes (
  source_path text primary key,
  content_hash text not null,
  processed_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key,
  card_id uuid not null references public.cards (id),
  rating smallint not null check (rating between 1 and 3),
  reviewed_at timestamptz not null,
  inserted_at timestamptz not null default now()
);
create index reviews_inserted_at_idx on public.reviews (inserted_at);
create index reviews_card_id_idx on public.reviews (card_id);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger cards_set_updated_at before update on public.cards
  for each row execute function public.set_updated_at();

alter table public.cards enable row level security;
alter table public.notes enable row level security;
alter table public.reviews enable row level security;

-- App (utilisateur connecté) : lit les cartes, lit et ajoute des reviews. Rien d'autre.
grant select on public.cards to authenticated;
grant select, insert on public.reviews to authenticated;
create policy "authenticated read cards" on public.cards for select to authenticated using (true);
create policy "authenticated read reviews" on public.reviews for select to authenticated using (true);
create policy "authenticated insert reviews" on public.reviews for insert to authenticated with check (true);

-- Outil local (clé secrète) : accès complet, RLS contournée par service_role.
grant all on public.cards, public.notes, public.reviews to service_role;

-- Aucun accès anonyme.
revoke all on public.cards, public.notes, public.reviews from anon;
```

- [ ] **Étape 3 : appliquer** — `supabase db push` → migration appliquée. Puis `supabase gen types typescript --linked > src/lib/supabase-types.ts`.

- [ ] **Étape 4 : vérifier les droits** (script jetable, non commité, avec la clé publique) :

```bash
curl -s "https://kowhaowawiqqnunxecyt.supabase.co/rest/v1/cards?select=id" \
  -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY"
```

Attendu : erreur de permission ou `[]` — **jamais** de données. Vérifier aussi dans le Dashboard → Advisors → Security : aucune alerte sur ces tables. Coller le résultat (sans clé) dans la PR.

- [ ] **Étape 5 : commit + PR** `feat: schéma Supabase (cards, notes, reviews) + RLS`.

---

### Tâche 4 : Connexion e-mail + mot de passe

**Fichiers :** créer `src/lib/supabase.ts`, `src/features/auth/useAuth.ts`, `LoginScreen.tsx`, test ; modifier `App.tsx`, `.env.local` (Mac, non commité).

**Interfaces :**
- Consomme : variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Produit :

```ts
// supabase.ts
export const supabase: SupabaseClient<Database>
// useAuth.ts
export function useAuth(): {
  status: 'loading' | 'signed-out' | 'signed-in'
  signIn(email: string, password: string): Promise<{ error: string | null }>
  signOut(): Promise<void>
}
```

- [ ] **Étape 1 : variables** — l'orchestrateur écrit `.env.local` avec `VITE_SUPABASE_URL=https://kowhaowawiqqnunxecyt.supabase.co` et `VITE_SUPABASE_PUBLISHABLE_KEY` (récupérée par `supabase projects api-keys --project-ref kowhaowawiqqnunxecyt`, clé `sb_publishable_…`). Les mêmes deux variables sont ajoutées dans Vercel (Production + Preview) : `npx vercel env add` si la CLI Vercel est connectée, sinon Kyllian les colle dans Vercel → Settings → Environment Variables.

- [ ] **Étape 2 : client** — `src/lib/supabase.ts` :

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './supabase-types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Configuration Supabase manquante')

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})
```

Déclarer les deux variables dans `src/vite-env.d.ts` (`interface ImportMetaEnv`).

- [ ] **Étape 3 : tests useAuth (échouent)** — `useAuth.test.tsx`, en mockant `../../lib/supabase` avec `vi.mock` :
  - session présente dans `getSession` → `signed-in`.
  - `getSession` sans session → `signed-out`.
  - **hors ligne avec jeton expiré** : `getSession` renvoie une session dont `expires_at` est passé → `signed-in` quand même (Review Focus n°1 : on ne déconnecte jamais sur une erreur réseau).
  - `signIn` avec erreur Supabase « Invalid login credentials » → retourne `{ error: 'E-mail ou mot de passe incorrect.' }` (message unique, checklist sécurité n°9).
  - événement `SIGNED_OUT` de `onAuthStateChange` → `signed-out`.

- [ ] **Étape 4 : implémentation** — `useAuth` : `getSession()` au montage (statut selon présence de session, **sans regarder l'expiration**), abonnement `onAuthStateChange` (`SIGNED_IN`/`TOKEN_REFRESHED` → signed-in, `SIGNED_OUT` → signed-out), désabonnement au démontage. Toute erreur d'auth → message unique `E-mail ou mot de passe incorrect.` ; erreur réseau → `Pas de connexion. Réessaie quand tu as du réseau.`

- [ ] **Étape 5 : écran** — `LoginScreen.tsx` : `Page`, titre « Vault Cards », `List` avec deux `ListInput` (`type="email"` `autoComplete="username"`, `type="password"` `autoComplete="current-password"`), bouton `Se connecter` (désactivé pendant l'envoi, `Preloader`), message d'erreur sous le formulaire. `App.tsx` : `loading` → écran vide ; `signed-out` → `LoginScreen` ; `signed-in` → `ReviewScreen`. Lien discret « Se déconnecter » en bas de l'écran de fin de session.

- [ ] **Étape 6 : vérifier** — tests verts ; `npm run dev`, connexion avec le compte de Kyllian (**c'est lui qui tape le mot de passe**, jamais l'agent) ; mauvais mot de passe → message unique ; rechargement → toujours connecté.

- [ ] **Étape 7 : commit + PR** `feat: connexion e-mail + mot de passe`.

---

### Tâche 5 : Stockage local + synchronisation

**Fichiers :** créer `src/lib/db.ts`, `src/lib/sync.ts`, `sync.test.ts`, `src/features/review/dexieStore.ts` ; modifier `App.tsx`, `ReviewScreen.tsx` (indicateur), retirer l'usage de `sample-cards.ts` dans `App.tsx` (garder le fichier pour les tests).

**Interfaces :**
- Consomme : `ReviewStore` (T2), `supabase` (T4), types `Card`/`Review`.
- Produit :

```ts
// db.ts
export class VaultDB extends Dexie {
  cards!: Table<Card, string>
  reviews!: Table<Review, string>
  meta!: Table<{ key: string; value: string }, string>
}
export const db: VaultDB
// dexieStore.ts
export const dexieStore: (db: VaultDB) => ReviewStore
// sync.ts
export interface Remote {
  pushReviews(rows: Omit<Review, 'synced'>[]): Promise<void>
  pullCards(since: string | null): Promise<(Card)[]>
  pullReviews(since: string | null): Promise<(Omit<Review, 'synced'> & { inserted_at: string })[]>
}
export const supabaseRemote: (client: typeof supabase) => Remote
export async function sync(db: VaultDB, remote: Remote): Promise<{ pushed: number; pulledCards: number; pulledReviews: number }>
export async function pendingCount(db: VaultDB): Promise<number>
```

- [ ] **Étape 1 : schéma Dexie** — `db.ts` :

```ts
import Dexie, { type Table } from 'dexie'
import type { Card, Review } from './types'

export class VaultDB extends Dexie {
  cards!: Table<Card, string>
  reviews!: Table<Review, string>
  meta!: Table<{ key: string; value: string }, string>
  constructor(name = 'vault-cards') {
    super(name)
    this.version(1).stores({
      cards: 'id, updated_at, source_path',
      reviews: 'id, card_id, synced, reviewed_at',
      meta: 'key',
    })
  }
}
export const db = new VaultDB()
```

- [ ] **Étape 2 : tests sync (échouent)** — `sync.test.ts` avec `new VaultDB('test-' + crypto.randomUUID())` et un `Remote` en mémoire (faux serveur qui stocke ses lignes et attribue `updated_at`/`inserted_at`) :
  - push : les reviews `synced: 0` sont envoyées puis marquées `synced: 1` ; celles déjà `1` ne sont pas renvoyées.
  - **push rejoué** : le faux serveur ignore un `id` déjà présent (comme `ON CONFLICT DO NOTHING`) ; faire échouer la première réponse après écriture serveur (lever une erreur), relancer `sync` → le serveur contient **une** ligne (Review Focus n°3).
  - pull cartes : nouvelles et modifiées arrivent ; une carte avec `deleted_at` est enregistrée avec `deleted_at` (et disparaît donc de `buildQueue`).
  - **curseur égal** : deux cartes serveur avec le même `updated_at` ; le premier pull n'en reçoit qu'une (simuler une page coupée), le second pull reçoit l'autre (Review Focus n°4). D'où : requête `>=` curseur + `put` idempotent.
  - le curseur est le **max des horodatages serveur reçus**, jamais l'horloge de l'appareil.
  - erreur réseau sur le push → `sync` rejette, rien n'est marqué `synced`, les données locales restent intactes.
  - pull reviews : les reviews d'un autre appareil arrivent avec `synced: 1`.

- [ ] **Étape 3 : implémentation** — `sync.ts` :

```ts
import type { VaultDB } from './db'

const CURSOR_CARDS = 'cursor:cards', CURSOR_REVIEWS = 'cursor:reviews'

async function getCursor(db: VaultDB, key: string) {
  return (await db.meta.get(key))?.value ?? null
}
const maxOf = (values: string[], current: string | null) =>
  values.reduce((m, v) => (m === null || v > m ? v : m), current)

export async function sync(db: VaultDB, remote: Remote) {
  const pending = await db.reviews.where('synced').equals(0).toArray()
  if (pending.length) {
    await remote.pushReviews(pending.map(({ synced: _s, ...r }) => r))
    await db.reviews.bulkUpdate(pending.map(r => ({ key: r.id, changes: { synced: 1 as const } })))
  }

  const cards = await remote.pullCards(await getCursor(db, CURSOR_CARDS))
  if (cards.length) {
    await db.transaction('rw', db.cards, db.meta, async () => {
      await db.cards.bulkPut(cards)
      await db.meta.put({ key: CURSOR_CARDS, value: maxOf(cards.map(c => c.updated_at), await getCursor(db, CURSOR_CARDS))! })
    })
  }

  const reviews = await remote.pullReviews(await getCursor(db, CURSOR_REVIEWS))
  if (reviews.length) {
    await db.transaction('rw', db.reviews, db.meta, async () => {
      await db.reviews.bulkPut(reviews.map(({ inserted_at: _i, ...r }) => ({ ...r, synced: 1 as const })))
      await db.meta.put({ key: CURSOR_REVIEWS, value: maxOf(reviews.map(r => r.inserted_at), await getCursor(db, CURSOR_REVIEWS))! })
    })
  }
  return { pushed: pending.length, pulledCards: cards.length, pulledReviews: reviews.length }
}

export const pendingCount = (db: VaultDB) => db.reviews.where('synced').equals(0).count()
```

`supabaseRemote` :
- `pushReviews` → `client.from('reviews').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })`, lever si `error`.
- `pullCards(since)` → `select('id, deck, source_path, front, back, updated_at, deleted_at')`, `.gte('updated_at', since)` si `since`, `.order('updated_at')`, pagination par 1000 avec `.range()` jusqu'à une page incomplète.
- `pullReviews(since)` → idem sur `reviews` avec `inserted_at`.

Run → PASS.

- [ ] **Étape 4 : branchement** — `dexieStore(db)` implémente `ReviewStore` (`loadCards` = `db.cards.toArray()`, `loadReviews` = `db.reviews.toArray()`, `addReview` = `db.reviews.add`). Dans `App.tsx` (signed-in) : `sync` au montage, sur l'événement `online`, et quand `status` passe à `done` ; erreurs avalées (aucun log en prod) ; après un sync qui a ramené des cartes alors que la session est `empty`, appeler `restart()`. `ReviewScreen` : petit indicateur (point gris + « non synchronisé ») si `pendingCount > 0`.
  - Premier lancement sans réseau et sans cache → état `empty` avec le texte « Connecte-toi à internet pour la première synchronisation. » si `navigator.onLine === false`.

- [ ] **Étape 5 : vérifier** — tests verts. À la main : insérer 3 cartes de test via le SQL editor de Supabase (`insert into cards (deck, source_path, front, back) values ...`), ouvrir l'app → elles arrivent ; noter une carte en coupant le réseau (DevTools offline) → indicateur « non synchronisé » ; remettre le réseau → la review est en base ; ouvrir dans un 2e navigateur → même progression. Supprimer les cartes de test ensuite (`update cards set deleted_at = now()`).

- [ ] **Étape 6 : commit + PR** `feat: stockage local Dexie + synchronisation Supabase`.

---

### Tâche 6 : PWA installable et hors ligne

**Fichiers :** modifier `vite.config.ts`, `index.html` ; créer `public/logo.svg`, icônes générées dans `public/`.

- [ ] **Étape 1 : dépendances** — `npm i -D vite-plugin-pwa @vite-pwa/assets-generator`.

- [ ] **Étape 2 : icône** — `public/logo.svg` : carré 512×512, fond `#0f6b63` (vert-bleu de l'artefact), deux cartes superposées blanches arrondies, légèrement décalées. Générer : `npx pwa-assets-generator --preset minimal-2023 public/logo.svg`.

- [ ] **Étape 3 : config** — dans `vite.config.ts` :

```ts
import { VitePWA } from 'vite-plugin-pwa'
// plugins: [..., VitePWA({...})]
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
  manifest: {
    name: 'Vault Cards',
    short_name: 'Cards',
    lang: 'fr',
    display: 'standalone',
    start_url: '/',
    background_color: '#f2f2f7',
    theme_color: '#0f6b63',
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'], navigateFallback: '/index.html' },
})
```

`index.html` : `<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="default">`, `<meta name="theme-color" content="#0f6b63">`.

- [ ] **Étape 4 : vérifier** — `npm run build && npx vite preview` ; DevTools → Application : manifest valide, service worker actif ; cocher Offline + recharger → l'app se charge et les cartes en cache s'affichent. Puis sur l'URL Vercel de la PR, sur iPhone : Safari → Partager → Sur l'écran d'accueil → ouverture plein écran, mode avion → révision possible (test fait par Kyllian, résultat noté dans la PR).

- [ ] **Étape 5 : commit + PR** `feat: PWA installable et hors ligne`.

---

### Tâche 7 : Outil `tools/cards` + skill `/flashcards`

**Fichiers :** créer `tools/cards/lib.ts`, `tools/cards/cli.ts`, `tools/cards/lib.test.ts`, `tools/cards/fixtures/veille/ia/a/a-synthese.md`, `.../a/a-transcription.md`, `.../software/b/b-synthese.md`, `skill/flashcards/SKILL.md`.

**Interfaces :**
- Consomme : tables `cards`, `notes` (T3), `SUPABASE_URL` + `SUPABASE_SECRET_KEY` dans `.env.local`.
- Produit :

```ts
// lib.ts
export interface NoteFile { source_path: string; deck: string; content_hash: string; abs_path: string }
export interface IncomingCard { id?: string; front: string; back: string }
export interface ApplyPayload { source_path: string; deck: string; content_hash: string; cards: IncomingCard[] }
export interface ExistingCard { id: string; front: string; back: string }
export function listSyntheses(vaultRoot: string, subdir?: string): Promise<NoteFile[]> // subdir défaut '3-Resources/veille'
export function hashContent(text: string): string // sha256 hex
export function diffCards(existing: ExistingCard[], incoming: IncomingCard[]): {
  toInsert: IncomingCard[]; toUpdate: ExistingCard[]; toDelete: string[]
}
export function validatePayload(p: unknown): ApplyPayload // lève une Error lisible
```

CLI : `node tools/cards/cli.ts scan` → JSON `{ changed: NoteFile[], removed: string[] }` ; `existing <source_path>` → JSON `ExistingCard[]` ; `apply <fichier.json>` → JSON `{ added, updated, deleted }`.

- [ ] **Étape 1 : fixtures** — trois petits fichiers Markdown (deux synthèses, une transcription) sous `tools/cards/fixtures/veille/`.

- [ ] **Étape 2 : tests (échouent)** — `tools/cards/lib.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { listSyntheses, hashContent, diffCards, validatePayload } from './lib'

const root = path.join(__dirname, 'fixtures')

describe('listSyntheses', () => {
  it('ne garde que les *-synthese.md, avec le deck = 1er sous-dossier', async () => {
    const notes = await listSyntheses(root, 'veille')
    expect(notes.map(n => [n.source_path, n.deck]).sort()).toEqual([
      ['veille/ia/a/a-synthese.md', 'ia'],
      ['veille/software/b/b-synthese.md', 'software'],
    ])
  })
})

describe('hashContent', () => {
  it('stable et sensible au contenu', () => {
    expect(hashContent('x')).toBe(hashContent('x'))
    expect(hashContent('x')).not.toBe(hashContent('y'))
  })
})

describe('diffCards', () => {
  const existing = [{ id: '1', front: 'Q1', back: 'R1' }, { id: '2', front: 'Q2', back: 'R2' }]
  it('carte gardée telle quelle : ni update ni delete (progression conservée)', () => {
    const d = diffCards(existing, [{ id: '1', front: 'Q1', back: 'R1' }])
    expect(d).toEqual({ toInsert: [], toUpdate: [], toDelete: ['2'] })
  })
  it('carte gardée mais reformulée : update avec le même id', () => {
    const d = diffCards(existing, [{ id: '1', front: 'Q1 bis', back: 'R1' }, { id: '2', front: 'Q2', back: 'R2' }])
    expect(d.toUpdate).toEqual([{ id: '1', front: 'Q1 bis', back: 'R1' }])
    expect(d.toDelete).toEqual([])
  })
  it('nouvelle carte sans id : insert', () => {
    expect(diffCards([], [{ front: 'Q', back: 'R' }]).toInsert).toHaveLength(1)
  })
  it('id inconnu : erreur (Claude ne doit pas inventer d’id)', () => {
    expect(() => diffCards(existing, [{ id: '999', front: 'Q', back: 'R' }])).toThrow(/id inconnu/)
  })
})

describe('validatePayload', () => {
  it('refuse une carte vide ou trop longue', () => {
    const base = { source_path: 'a.md', deck: 'ia', content_hash: 'h' }
    expect(() => validatePayload({ ...base, cards: [{ front: '', back: 'R' }] })).toThrow()
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'x'.repeat(1501) }] })).toThrow()
  })
  it('accepte une liste vide (note sans contenu à apprendre)', () => {
    expect(validatePayload({ source_path: 'a.md', deck: 'ia', content_hash: 'h', cards: [] }).cards).toEqual([])
  })
})
```

Ajouter `tools/**/*.test.ts` dans l'`include` de Vitest (environnement `node` pour ces fichiers : `// @vitest-environment node` en tête).

Run → FAIL.

- [ ] **Étape 3 : implémentation `lib.ts`** — `listSyntheses` : parcours récursif (`fs.promises.readdir` `recursive: true`), filtre `-synthese.md`, `source_path` relatif à `vaultRoot` en `/`, `deck` = segment qui suit `subdir`, `content_hash` = `hashContent(contenu)`. `diffCards` : map des existants par id ; incoming avec id inconnu → `throw new Error('id inconnu: ' + id)` ; avec id connu et texte différent → update ; identique → rien ; sans id → insert ; existants absents d'incoming → delete. `validatePayload` : types, `front` 1–500, `back` 1–1500 caractères, trim.

Run → PASS.

- [ ] **Étape 4 : `cli.ts`** — `process.loadEnvFile('.env.local')` ; client `createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })` ; erreur claire si une variable manque (sans afficher de valeur). Vault = `process.env.VAULT_ROOT ?? path.join(os.homedir(), 'Workspace')`.
  - `scan` : `listSyntheses` ; lire `notes` ; `changed` = notes absentes ou hash différent ; `removed` = `notes.source_path` absents du disque.
  - `existing <p>` : cartes `source_path = p` et `deleted_at is null`.
  - `apply <f>` : `validatePayload(JSON.parse(f))` ; `diffCards` ; `insert` (avec `deck`, `source_path`), `update` par id, `update deleted_at = now()` pour `toDelete` ; `upsert` dans `notes` (`source_path`, `content_hash`, `processed_at`). Si une étape échoue, ne pas écrire le hash (la note sera retraitée au prochain scan).
  - Sortie : JSON sur stdout uniquement.

- [ ] **Étape 5 : skill** — `skill/flashcards/SKILL.md` :

```markdown
---
name: flashcards
description: Génère ou met à jour les flashcards Vault Cards à partir des notes de veille du vault Obsidian (~/Workspace/3-Resources/veille). À lancer quand Kyllian dit « /flashcards », « mets à jour mes cartes », « génère les flashcards ».
---

# /flashcards

Outil : `node tools/cards/cli.ts` depuis `~/Workspace/1-Projects/vault-cards` (lit `.env.local`).

1. `scan` → liste `changed` et `removed`. Si les deux sont vides : répondre « Rien de nouveau » et s'arrêter.
2. Pour chaque note `removed` : écrire `{source_path, deck, content_hash: "removed", cards: []}` et `apply` (supprime ses cartes).
3. Pour chaque note `changed` :
   a. Lire le fichier (`abs_path`).
   b. `existing <source_path>` → cartes actuelles.
   c. Écrire les cartes (règles ci-dessous) dans un fichier JSON temporaire du scratchpad au format `{source_path, deck, content_hash, cards: [{id?, front, back}]}`. Garder l'`id` d'une carte existante encore pertinente (même si reformulée) ; ne jamais inventer d'id.
   d. `apply <fichier>`.
4. Résumé final : « N notes · +X cartes · Y modifiées · Z supprimées », puis la liste des notes traitées.

## Règles des cartes
- 3 à 8 cartes par note, selon la densité. Zéro carte si la note n'a rien à retenir (`cards: []`, le hash est quand même enregistré).
- Français. Question ≤ 150 caractères, une seule idée. Réponse ≤ 3 phrases, autonome.
- Viser les conclusions marquées ★, les chiffres, les définitions, les distinctions. Pas d'anecdote.
- Jamais « selon la vidéo », « dans cette note » : la carte doit se comprendre seule.
- Texte brut, pas de Markdown ni de HTML.
```

Installation (orchestrateur) : `ln -s ~/Workspace/1-Projects/vault-cards/skill/flashcards ~/.claude/skills/flashcards`.

- [ ] **Étape 6 : vérifier** — tests verts. Kyllian colle sa clé secrète dans `.env.local` (`SUPABASE_SECRET_KEY=`), l'agent ne la lit jamais. `node tools/cards/cli.ts scan` → liste les 8 synthèses de `veille`. Lancer `/flashcards` sur **une seule note** d'abord, vérifier les cartes dans l'app, puis sur toutes.

- [ ] **Étape 7 : commit + PR** `feat: outil cards + skill /flashcards`.

---

### Tâche 8 : Ping anti-pause + sauvegarde hebdomadaire

**Fichiers :** créer `.github/workflows/keepalive.yml`, `.github/workflows/backup.yml`, `docs/restore.md`.

- [ ] **Étape 1 : secrets GitHub** (Kyllian tape les valeurs secrètes lui-même) :

```bash
gh secret set SUPABASE_URL --body "https://kowhaowawiqqnunxecyt.supabase.co"
gh secret set SUPABASE_PUBLISHABLE_KEY      # collée par l'orchestrateur (clé publique)
gh secret set SUPABASE_DB_URL               # Kyllian : Dashboard → Connect → Session pooler URI, avec son mot de passe
gh secret set BACKUP_PASSPHRASE             # Kyllian : phrase de passe longue, gardée dans son gestionnaire
```

- [ ] **Étape 2 : keepalive** — `keepalive.yml` :

```yaml
name: Keepalive Supabase
on:
  schedule: [{ cron: '17 6 * * *' }]
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          code=$(curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/rest/v1/cards?select=id&limit=1" -H "apikey: $KEY")
          echo "HTTP $code"
          test "$code" -lt 500
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}
```

- [ ] **Étape 3 : sauvegarde** — `backup.yml` :

```yaml
name: Backup Supabase
on:
  schedule: [{ cron: '23 3 * * 0' }]
  workflow_dispatch:
jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: |
          supabase db dump --db-url "$DB_URL" -f schema.sql
          supabase db dump --db-url "$DB_URL" --data-only -f data.sql
          tar czf backup.tgz schema.sql data.sql
          gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" -c backup.tgz
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          PASS: ${{ secrets.BACKUP_PASSPHRASE }}
      - uses: actions/upload-artifact@v4
        with: { name: backup-${{ github.run_id }}, path: backup.tgz.gpg, retention-days: 90 }
```

`docs/restore.md` : télécharger l'artefact (`gh run download`), `gpg -d backup.tgz.gpg | tar xz`, puis `psql "$SUPABASE_DB_URL" -f data.sql`.

- [ ] **Étape 4 : vérifier** — après fusion sur `main` : `gh workflow run keepalive.yml` et `gh workflow run backup.yml` → les deux réussissent ; l'artefact est chiffré (pas lisible sans phrase de passe).

- [ ] **Étape 5 : commit + PR** `chore: ping anti-pause + sauvegarde chiffrée`.

---

### Tâche 9 : Audit sécurité avant usage réel

**Fichiers :** créer `docs/security-checklist.md`.

- [ ] **Étape 1 : passer la checklist** et noter pour chaque point OK / N/A / à corriger, avec la preuve :
  1. `.env*` ignorés : `git ls-files | grep -E '^\.env'` → seulement `.env.example`.
  2. Aucune clé secrète dans l'historique : `git log -p | grep -E 'sb_secret_|service_role|eyJhbGciOi'` → rien.
  3. Aucune clé secrète dans le build : `npm run build && grep -rE 'sb_secret_|service_role' dist/` → rien.
  4. Clé publique seulement côté client (relire `src/lib/supabase.ts`).
  5. RLS active sur les 3 tables + Advisors Supabase sans alerte de sécurité.
  6. `anon` sans accès : requête curl de la Tâche 3 rejouée.
  7. Inscriptions désactivées (Dashboard → Auth) ; message d'erreur de connexion unique.
  8. Sessions : expiration du jeton par défaut (1 h, rafraîchi) — OK.
  9. Rate limiting de connexion : limites par défaut de Supabase Auth — noter la valeur.
  10. Entrées validées : `validatePayload` + contraintes `check` SQL.
  11. HTTPS : URL Vercel.
  12. Pas de `console.log` : `npm run lint` vert.
  13. Dépendances : `npm audit --omit=dev` → 0 vulnérabilité haute ; Dependabot actif.
  14. Sauvegarde : dernier run `backup.yml` réussi.
  - Uploads, webhooks, CORS : N/A (aucun upload, aucun webhook, API Supabase uniquement).

- [ ] **Étape 2 : corriger** chaque point « à corriger » via une issue `security` séparée.

- [ ] **Étape 3 : commit + PR** `docs: audit sécurité MVP`.
