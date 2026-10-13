# Restaurer une sauvegarde

Le workflow `backup.yml` produit chaque dimanche (03:23 UTC) un artefact `backup-<run_id>` contenant
uniquement `backup.tgz.gpg` : une archive `schema.sql` + `data.sql` chiffrée en AES256. Conservation : 90 jours.

> **La phrase de passe (`BACKUP_PASSPHRASE`) vit dans le gestionnaire de mots de passe de Kyllian.
> Sans elle, la sauvegarde est définitivement inutilisable.** Elle n'est ni dans le dépôt ni dans les logs.

## 1. Récupérer l'artefact

```bash
gh run list --workflow backup.yml --limit 5          # repérer le run voulu (statut success)
mkdir -p ~/restore-vault-cards && cd ~/restore-vault-cards
gh run download <run_id> --repo yukydesu/vault-cards # crée backup-<run_id>/backup.tgz.gpg
```

## 2. Déchiffrer

```bash
gpg -d backup-<run_id>/backup.tgz.gpg | tar xz   # gpg demande la phrase de passe
ls                                               # schema.sql  data.sql
```

Les fichiers obtenus sont en clair : à supprimer une fois la restauration terminée.

## 3. Restaurer

Toujours sur une base **vide** (nouveau projet Supabase ou Postgres local), jamais par-dessus la prod sans l'avoir décidé.
Ordre : schéma, puis données.

```bash
export TARGET_DB_URL='postgresql://...'   # URI de la base cible (Session pooler pour un projet Supabase)
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f data.sql
```

Notes :

- Les rôles ne sont pas sauvegardés : sur Supabase ils sont gérés par la plateforme, et les droits (`grant`/`revoke`, RLS)
  sont portés par `supabase/migrations/`. Sur un nouveau projet Supabase, les rôles standard existent déjà.
- Sur Postgres local (hors Supabase), créer d'abord les rôles attendus : `create role anon nologin; create role authenticated nologin; create role service_role nologin;`
  (et le schéma `auth` si `data.sql` référence des utilisateurs).
- Après restauration sur un nouveau projet : mettre à jour `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  les secrets GitHub (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`) et `.env.local`.
- Vérifier ensuite que la RLS est active et qu'`anon` n'a aucun accès (voir les migrations).

## 4. Tester la restauration (à faire une fois, puis de temps en temps)

Une sauvegarde jamais restaurée n'est pas une sauvegarde. Deux options, sans toucher à la prod :

**Postgres local (Docker)**

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:17
export TARGET_DB_URL='postgresql://postgres:test@localhost:54329/postgres'
psql "$TARGET_DB_URL" -c "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f data.sql
psql "$TARGET_DB_URL" -c "select count(*) from public.cards;"   # comparer avec la prod
docker rm -f restore-test
```

**Projet Supabase de test** : créer un projet jetable, puis lancer les deux `psql` avec son URI de connexion, et le supprimer ensuite.

Si une erreur liée à une extension ou au schéma `auth` apparaît en local, c'est attendu hors Supabase : l'important est que
`public.cards`, `public.notes` et `public.reviews` aient le bon nombre de lignes.
