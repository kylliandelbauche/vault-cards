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
- `authenticated` n'écrit dans `cards` que des cartes `source = 'manual'` (colonnes `front, back, tags, deleted_at` ; pas de delete). L'outil `/flashcards` ne touche qu'aux cartes `vault`.
- Pas de `console.log` dans `src/`.

## Commandes
- `npm run dev` · `npm test` · `npm run build`
- `node tools/cards/cli.ts scan | all | existing <path> | apply <file.json> [--confirm-delete=<n>] | retag <file.json> | titles`
  - Toute suppression de cartes exige `--confirm-delete=<n>` (n exact), seulement après confirmation explicite de Kyllian.
- `supabase db push` (migrations dans `supabase/migrations/`)
- `supabase db query --linked -f supabase/tests/manual_cards.sql` : preuve des droits sur `cards` (transaction annulée, aucune trace)
- `node tools/dev/rest-check.ts` : vérification de l'API REST avec un vrai compte (e-mail + mot de passe masqué demandés, clé publishable seulement) — voir docs/rest-check.md
