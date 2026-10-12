# Vault Cards — spec (PRD + design)

Date : 2026-10-12 · Statut : à valider

## 1. Pourquoi

Réviser le contenu de mon second cerveau Obsidian (`~/Workspace`) dans les temps morts (transports), sur iPhone, hors ligne. Les cartes sont générées par Claude à partir des notes, mises à jour en un prompt quand le vault grossit.

## 2. Contraintes

- 0 € : GitHub (repo privé), Vercel Hobby, Supabase Free.
- Pas d'app native : PWA installée sur l'écran d'accueil iPhone, utilisable aussi sur ordinateur.
- Un seul utilisateur (moi). Accès protégé, mais aucune logique multi-utilisateur.
- MVP très sobre : réviser, rien d'autre.

## 3. User stories (MVP)

- **US-1** Je me connecte une fois par appareil avec e-mail + mot de passe ; personne d'autre ne peut lire ou modifier mes cartes.
- **US-2** J'ouvre l'app et je vois une carte : la question, puis « Afficher la réponse » (bouton ou tap sur la carte).
- **US-3** Je note ma réponse avec 3 boutons — *Je ne sais pas* / *Moyen* / *Très bien* — et chaque bouton affiche quand la carte reviendra.
- **US-4** Les cartes reviennent selon l'algorithme FSRS ; une carte ratée revient dans la même session.
- **US-5** Je vois les compteurs (nouvelles / à revoir / dues) et une barre de progression.
- **US-6** Je vois le chemin de la note source ; sur Mac, il ouvre la note dans Obsidian.
- **US-7** Fin de session : écran « Session terminée » avec le bilan et la prochaine échéance.
- **US-8** Sans réseau, je révise quand même ; mes réponses partent à la prochaine connexion.
- **US-9** Je révise sur iPhone puis sur Mac : la progression est la même partout.
- **US-10** Je lance `/flashcards` dans Claude Code : les notes nouvelles ou modifiées de `3-Resources/veille` deviennent des cartes dans Supabase, sans doublon, sans perdre ma progression sur les cartes inchangées.
- **US-11** J'installe l'app sur l'écran d'accueil iPhone (plein écran, icône).

## 4. Hors périmètre MVP

Choix de deck, statistiques, édition/suppression de carte dans l'app, notifications, réglages, multi-utilisateur, e-mail (codes, liens magiques), autres dossiers du vault, Trello.

## 5. Architecture

```
Mac : Claude Code /flashcards → tools/cards (Node, clé secrète locale) → Supabase
iPhone / navigateur : PWA (Vercel) ⇄ IndexedDB (Dexie) ⇄ Supabase (sync quand réseau)
```

**App** : React + Vite + TypeScript, Tailwind + Konsta UI (thème iOS), `ts-fsrs`, Dexie, `@supabase/supabase-js`, `vite-plugin-pwa`. Police système Apple (`-apple-system` / SF Pro), mode sombre automatique. Règles visuelles : Apple HIG (cibles tactiles ≥ 44 pt, couleurs système, safe areas).

**Hébergement** : repo privé `yukydesu/vault-cards` → Vercel (déploiement auto sur `main`, préview par PR). Variables Supabase injectées par l'intégration Vercel ↔ Supabase.

## 6. Données (Supabase / Postgres)

| Table | Colonnes | Rôle |
|---|---|---|
| `cards` | `id uuid pk`, `deck text`, `source_path text`, `front text`, `back text`, `created_at`, `updated_at` (trigger), `deleted_at null` | Les cartes. Suppression = `deleted_at` renseigné, pour que les appareils l'apprennent. |
| `notes` | `source_path text pk`, `content_hash text`, `processed_at` | Empreinte de chaque note déjà traitée par `/flashcards`. |
| `reviews` | `id uuid pk` (généré côté client), `card_id fk`, `rating smallint` (1 Again, 2 Hard, 3 Good), `reviewed_at`, `inserted_at default now()` | Journal des réponses, uniquement en ajout. |

- **Pas de table d'état FSRS** : l'état d'une carte est recalculé côté client en rejouant ses `reviews` dans l'ordre. Deux appareils hors ligne ne peuvent donc jamais entrer en conflit.
- **Sécurité** : RLS activée sur les 3 tables, politique unique `to authenticated using (true) with check (true)`. Aucun accès `anon`. Tables non exposées automatiquement : `grant` explicites au rôle `authenticated`.
- **Compte** : un seul utilisateur créé à la main (Dashboard → Authentication → Add user, auto-confirmé). Inscriptions publiques désactivées. Mot de passe connu de moi seul, jamais dans le repo.
- **Migrations** : fichiers SQL versionnés dans `supabase/migrations/`, appliqués avec la CLI Supabase.

## 7. App

**Écrans** : Connexion (e-mail + mot de passe) → Révision → Session terminée. Rien d'autre.

**Session** : cartes dues (`due <= maintenant`) + au plus 20 nouvelles par jour. Une carte notée *Je ne sais pas* est remise en fin de file de la session.

**FSRS** : `ts-fsrs`, paramètres par défaut, rétention visée 0,9. Boutons → `Rating.Again` / `Rating.Hard` / `Rating.Good`.

**Stockage local (Dexie)** : `cards`, `reviews` (+ drapeau `synced`), `meta` (`lastPull`).

**Synchro** (au lancement, au retour du réseau, en fin de session) :
1. Push : `upsert` des `reviews` non synchronisées (idempotent grâce à l'`id` client).
2. Pull : `cards` avec `updated_at > lastPull` (suppressions comprises) et `reviews` avec `inserted_at > lastPull`.
3. Échec réseau : silencieux, on réessaie plus tard. Un petit indicateur montre l'état « non synchronisé ».

**Lien source** : `obsidian://open?vault=Workspace&file=<source_path encodé>`.

**PWA** : manifest `display: standalone`, icônes, service worker `autoUpdate` qui met en cache l'app.

## 8. `/flashcards` (génération des cartes)

- **Skill** utilisateur : `~/.claude/skills/flashcards/SKILL.md` (source dans le repo, `skill/`), utilisable depuis n'importe quel dossier.
- **Outil** `tools/cards` (Node, lit `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local`, jamais commité) :
  - `scan` → liste JSON des `*-synthese.md` de `~/Workspace/3-Resources/veille` nouvelles ou modifiées (hash ≠ `notes.content_hash`) ;
  - `existing <path>` → cartes actuelles de cette note ;
  - `apply <fichier.json>` → crée / met à jour / supprime les cartes d'une note et enregistre son hash.
- **Déroulé** : `scan` → pour chaque note, Claude lit la synthèse (et les cartes existantes) et écrit 3 à 8 cartes (question courte, réponse ≤ 3 phrases, en français) → `apply` → résumé (« 4 notes, +23 cartes, 2 modifiées, 1 supprimée »).
- **Deck** = sous-dossier de `veille/` (`ia`, `software`, `web`, `concept`…). Les transcriptions sont ignorées.

## 9. Sécurité (checklist du vault)

`.env*` dans `.gitignore` ; seule la clé publique dans l'app ; clé `service_role` uniquement dans `.env.local` sur le Mac ; RLS sur toutes les tables ; HTTPS (Vercel) ; pas de `console.log` ni d'erreurs détaillées en production ; dépendances à jour (Dependabot) ; sauvegarde hebdomadaire de la base (GitHub Action, dump chiffré en artefact) ; ping quotidien (GitHub Action) pour éviter la mise en pause Supabase.

## 10. Méthode de travail

- 1 tranche verticale = 1 issue GitHub = 1 branche (`feat/<n>-slug`, `fix/…`, `chore/…`) = 1 PR (« Closes #n »).
- Jamais de push direct sur `main` (règle écrite dans `CLAUDE.md`, la protection de branche n'existant pas en repo privé gratuit).
- Chaque PR : CI verte (types, lint, tests, build) + relecture par un agent séparé, commentée dans la PR, avant fusion.
- Suivi dans un GitHub Project (Kanban) + jalon « MVP ». Les bugs trouvés deviennent des issues `bug`.
- Tests : Vitest sur la logique (file de session, FSRS, synchro, outil `cards`) ; test manuel sur iPhone à la fin de chaque tranche visible.

## 11. Tranches prévues

1. Socle : Vite + React + TS, Tailwind + Konsta, ESLint, Vitest, CI, `CLAUDE.md`, déploiement Vercel.
2. Écran de révision + FSRS avec cartes d'exemple, en local (US-2 à US-7).
3. Schéma Supabase + RLS + migrations.
4. Connexion e-mail + mot de passe (US-1).
5. Stockage local + synchro (US-8, US-9).
6. PWA installable et hors ligne (US-11).
7. Outil `tools/cards` + skill `/flashcards` (US-10).
8. Ping anti-pause + sauvegarde.
9. Audit sécurité avant usage réel.
