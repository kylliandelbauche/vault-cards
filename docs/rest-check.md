# Cartes manuelles : preuves que la base et l'API REST fonctionnent (#54)

Deux vérifications complémentaires. Aucune n'affiche ni ne demande la clé secrète.

## 1. Preuve SQL (droits et RLS), sans trace

```sh
supabase db query --linked -f supabase/tests/manual_cards.sql
```

Tout le fichier tourne dans **une transaction annulée** (`rollback` final) : aucune ligne ne reste en base, même en cas d'échec.
Il simule les rôles `authenticated` (avec `request.jwt.claims`) et `anon`, et vérifie chaque attente avec son code SQLSTATE.
Résultat binaire : la liste des `OK: …`, ou une erreur `ÉCHEC: …` qui nomme l'écart.

Ce qui est vérifié : insertion `manual` acceptée ; insertion `vault` (explicite ou par défaut) refusée ; colonnes réservées à
l'outil (`deck`, `updated_at`…) refusées ; 1 à 2 tags de la liste et longueurs ; envoi rejoué sans doublon (`ON CONFLICT DO
NOTHING`) ; édition et suppression douce d'une carte `manual` (trigger `updated_at` compris) ; update d'une carte `vault` sans
effet (0 ligne) ; colonnes `source`, `id`, `deck`, `source_path`, `updated_at` non modifiables ; `delete` refusé ; review
acceptée sur une carte `manual` ; `anon` : lecture, insertion, modification, suppression refusées.

## 2. Script REST avec ton compte (à lancer par toi)

```sh
node tools/dev/rest-check.ts
```

- Le script demande ton **e-mail**, puis ton **mot de passe** (saisie masquée : rien ne s'affiche). Il ne les stocke ni ne les affiche.
- Il n'utilise que `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` (variables d'environnement, sinon `.env.local`).
  Le fichier est lu en texte brut, mais seules ces deux lignes sont gardées puis analysées : la clé secrète n'est jamais
  analysée, copiée ni affichée. Une clé secrète mise par erreur à la place de la clé publishable est refusée.
- Il ne modifie jamais une vraie carte : la tentative sur une carte vault réécrit sa propre question (0 ligne attendue ;
  même si la RLS cédait, le contenu resterait identique).
- Il passe par l'API REST exactement comme l'app (supabase-js → PostgREST), puis affiche un tableau :

| # | Étape | Attendu |
|---|---|---|
| 1 | anon : lire cards | refusé (42501, HTTP 401) |
| 2 | connexion (auth) | session ouverte |
| 3 | créer une carte manual | HTTP 201, 1 ligne |
| 4 | relire la carte | HTTP 200, `source = manual`, `deck`/`source_path` nuls |
| 5 | renvoyer la même carte | 0 ligne, pas de doublon |
| 6 | modifier front/back/tags | HTTP 200, 1 ligne |
| 7 | modifier la colonne source | refusé (42501, HTTP 403) |
| 8 | supprimer (DELETE) | refusé (42501, HTTP 403) |
| 9 | créer une carte vault | refusé (42501, HTTP 403) |
| 10 | modifier une carte vault | 0 ligne (RLS), carte intacte |
| 11 | suppression douce (deleted_at) | HTTP 200, 1 ligne |

Code de sortie 0 si tout est ✓, 1 sinon. Colle le tableau dans la PR ou l'issue.

Trace laissée : une carte `[rest-check] <date>` **supprimée en douce** (l'app n'a pas le droit de supprimer physiquement),
y compris si le script s'arrête sur une erreur après l'avoir créée (nettoyage en `finally`).
Elle est invisible dans l'app. Pour la purger : `delete from public.cards where front like '[rest-check]%' and source = 'manual';`
dans l'éditeur SQL de Supabase (ses éventuelles reviews d'abord ; le script n'en crée pas).

# Boîte de réception et brouillons : preuves (#55)

## 1. Preuve SQL, sans trace

```sh
supabase db query --linked -f supabase/tests/inbox.sql
```

Transaction annulée (`rollback` final), rôles `authenticated` et `anon` simulés. Vérifie : dépôt d'un texte par la RPC
`create_inbox_item` (statut `pending`, rappel idempotent) ; insertion directe dans `inbox` (même `pending`), update et
delete refusés ; lecture des statuts ; bucket `inbox` : aucun objet visible ni modifiable, dépôt seulement dans
`<uid>/<uuid>` ; RPC fichier : objet absent refusé, image > 10 Mo refusée, taille et type pris sur l'objet stocké ;
quota de 10 éléments en attente ; carte `inbox` ou colonne `status` refusées à l'insertion ; brouillon accepté
(`draft → active`) ; `active → draft` refusé (trigger) ; carte `manual` en brouillon refusée ; rejet (suppression douce) ;
colonnes `inbox_id`, `source`, `source_title` non modifiables ; carte `vault` intouchable ; `anon` : tout refusé ;
bucket privé, 30 Mo, 6 types.

## 2. Script REST + Storage avec ton compte (à lancer par toi)

```sh
node tools/dev/rest-check-inbox.ts
```

Mêmes garanties que `rest-check.ts` : e-mail puis mot de passe masqué (ni stockés ni affichés), clé publishable seule.

| # | Étape | Attendu |
|---|---|---|
| 1 | anon : lire inbox | refusé (42501, HTTP 401) |
| 2 | anon : create_inbox_item | refusé (42501, HTTP 401) |
| 3 | anon : déposer un fichier | refusé |
| 4 | connexion (auth) | session ouverte |
| 5 | déposer un texte (RPC) | élément `pending` |
| 6 | envoyer un fichier dans `inbox/<uid>/<id>` | accepté |
| 7 | créer l'élément fichier (RPC) | `pending`, `text/plain`, taille exacte |
| 8 | relire le fichier | refusé |
| 9 | lister le dossier | 0 objet visible |
| 10 | remplacer le fichier (upsert) | refusé |
| 11 | supprimer le fichier | 0 objet supprimé |
| 12 | déposer dans le dossier d'un autre uid | refusé |
| 13 | insérer dans inbox (status done) | refusé (42501, HTTP 403) |
| 14 | lister mes éléments | HTTP 200, 2 lignes |
| 15–17 | *(si un brouillon de test existe)* accepter · repasser en brouillon · suppression douce | 1 ligne · refusé (23514) · 1 ligne |

Les étapes 15–17 ne s'affichent qu'après un passage de `/flashcards` sur un texte `[rest-check]` (il en fait un
brouillon) : lancer le script, puis `/flashcards`, puis relancer le script. Le brouillon de test accepté est aussitôt
supprimé en douce : il n'entre jamais dans tes sessions.

**Trace laissée** : à chaque passage, deux éléments `[rest-check]` en attente (l'app n'a pas le droit de supprimer un
élément) ; ils comptent dans le quota de 10. Les purger :
- soit `/flashcards` les traite (texte → brouillon de test, fichier → brouillon ou `inbox fail`) : fichiers supprimés du stockage ;
- soit, sans les traiter : `node tools/cards/cli.ts inbox fail <id> "test rest-check"` pour chaque id affiché en fin de
  script (passe en erreur et supprime le fichier).

Puis, pour effacer les lignes (éditeur SQL de Supabase) :

```sql
update public.cards set deleted_at = now()
where source = 'inbox' and deleted_at is null
  and inbox_id in (select id from public.inbox where text like '[rest-check]%' or filename like 'rest-check-%');
delete from public.inbox where status in ('done', 'error') and (text like '[rest-check]%' or filename like 'rest-check-%');
```
