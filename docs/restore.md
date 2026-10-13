# Restaurer une sauvegarde

Le workflow `backup.yml` produit chaque dimanche (03:23 UTC) un artefact `backup-<run_id>` contenant
uniquement `backup.tgz.gpg` : une archive `schema.sql` + `data.sql` chiffrée en AES256. Conservation : 90 jours.

> **La phrase de passe (`BACKUP_PASSPHRASE`) vit dans le gestionnaire de mots de passe de Kyllian.
> Sans elle, la sauvegarde est définitivement inutilisable.** Elle n'est ni dans le dépôt ni dans les logs.
> Elle doit être longue (6 mots ou plus) : l'artefact est téléchargeable par quiconque a accès au dépôt,
> donc une attaque hors ligne sur la phrase de passe est possible.

## Ce que contient la sauvegarde

- `schema.sql` : le schéma applicatif (`public`), y compris les `GRANT`/`REVOKE` et la RLS de ces tables. Les schémas internes de Supabase (`auth`, `storage`...) sont exclus.
- `data.sql` : les **données du schéma `public` uniquement** (`cards`, `notes`, `reviews`). Aucune donnée `auth` ni `storage` : pas de hash de mot de passe ni de jeton de session dans l'archive.
- Pas de rôles : ils sont gérés par la plateforme Supabase.

Conséquence : `cards`, `notes` et `reviews` n'ont pas de lien avec `auth.users`, mais le **compte utilisateur n'est pas sauvegardé**.
Après restauration sur un projet neuf, Kyllian recrée son compte (voir l'étape 4).

## Prérequis

- `gh` (connecté au dépôt), `gpg` et le client `psql` (absent par défaut sur le Mac : `brew install libpq`, puis ajouter `$(brew --prefix libpq)/bin` au `PATH`).
- Une URL de connexion Postgres : le **mot de passe doit être percent-encodé** dans l'URL (`@` devient `%40`, `#` devient `%23`, `/` devient `%2F`, `%` devient `%25`). Cela vaut aussi pour le secret `SUPABASE_DB_URL` du dépôt.

## 1. Récupérer l'artefact

```bash
umask 077                                            # les fichiers en clair ne seront lisibles que par toi
mkdir -p ~/restore-vault-cards && cd ~/restore-vault-cards
gh run list --workflow backup.yml --repo yukydesu/vault-cards --limit 5   # repérer un run en succès
gh run download <run_id> --repo yukydesu/vault-cards                      # crée backup-<run_id>/backup.tgz.gpg
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
export TARGET_DB_URL='postgresql://postgres.<ref>:<mot_de_passe_percent_encodé>@<hôte>:5432/postgres'
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f data.sql
```

Sur un projet Supabase neuf, les rôles standard (`anon`, `authenticated`, `service_role`) existent déjà.

## 4. Après restauration sur un projet neuf

1. Recréer le compte de Kyllian : rouvrir temporairement les inscriptions (Dashboard, Authentication), s'inscrire dans l'app, puis **refermer les inscriptions**.
2. Mettre à jour `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, les secrets GitHub (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`) et `.env.local`.
3. Vérifier la base restaurée :

```sql
-- RLS activée sur les trois tables (attendu : relrowsecurity = t pour cards, notes, reviews)
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relname in ('cards', 'notes', 'reviews');

-- Aucun grant pour anon (attendu : 0 ligne)
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';

-- Volumes (à comparer avec la base d'origine)
select (select count(*) from public.cards) as cards,
       (select count(*) from public.reviews) as reviews,
       (select count(*) from public.notes) as notes;
```

## 5. Tester la restauration (à faire une fois, puis de temps en temps)

Une sauvegarde jamais restaurée n'est pas une sauvegarde. Deux options, sans toucher à la prod.

**Postgres local (Docker)** : utiliser la **même version majeure** de Postgres que le projet Supabase
(Dashboard, Settings, Infrastructure) ; `17` ci-dessous est un exemple à adapter.

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:17
export TARGET_DB_URL='postgresql://postgres:test@localhost:54329/postgres'
psql "$TARGET_DB_URL" -c "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f data.sql
# puis les requêtes de vérification de l'étape 4
docker rm -f restore-test
```

Les données ne touchent que `public`, donc aucune erreur liée à `auth` n'est attendue. Si `schema.sql` échoue hors Supabase sur une
extension ou un schéma propre à la plateforme, c'est le seul écart toléré : noter lequel, et préférer alors le projet Supabase de test.

**Projet Supabase de test** : créer un projet jetable, lancer les deux `psql` avec son URI de connexion (Session pooler),
exécuter les requêtes de vérification, puis supprimer le projet.
