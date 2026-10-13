# Audit sécurité MVP (issue #7)

- **Date** : 2026-10-13
- **Version auditée** : `main` @ `83286c67c491a02811f8cd0467d002453e9fefc6`
- **Périmètre** : PWA React (Vercel, `https://vault-cards-three.vercel.app`), projet Supabase `kowhaowawiqqnunxecyt` (Free, un seul compte), GitHub Actions (CI, keepalive, backup chiffré).
- **Méthode** : lecture du code et des migrations, requêtes REST rejouées avec la clé publishable (publique, lue dans le bundle de prod), lecture seule de la configuration du projet via l'API Management Supabase (jeton de la CLI, jamais affiché) et de la base (requêtes `SELECT` en `read_only`). Aucun réglage Supabase, Vercel ou GitHub n'a été modifié, aucun compte créé. Aucune valeur secrète n'apparaît dans ce document.

## Résultat

| # | Point | Statut |
|---|---|---|
| 1 | `.env*` ignorés | OK |
| 2 | Aucune clé secrète dans l'historique | OK |
| 3 | Aucune clé secrète dans le build | OK |
| 4 | Clé publique seulement côté client | OK |
| 5 | RLS sur les 3 tables + Advisors | OK |
| 6 | `anon` sans accès | OK |
| 7 | Inscriptions désactivées, erreur de connexion unique | OK |
| 8 | Sessions et expiration du jeton | OK |
| 9 | Rate limiting de connexion | OK |
| 10 | Entrées validées | OK (durcissement mineur possible) |
| 11 | HTTPS | OK |
| 12 | Pas de `console.log` | OK |
| 13 | Dépendances, Dependabot | OK pour `npm audit` ; **à vérifier par Kyllian** pour les alertes Dependabot |
| 14 | Sauvegarde | OK |
| 15 (ajouté) | Inscriptions fermées, vérifié à distance | OK |
| 16 (ajouté) | Protection « leaked password » | N/A en plan Free, risque accepté |
| — | Uploads, webhooks, CORS | N/A |
| + | En-têtes de sécurité HTTP (hors checklist) | **OK** (corrigé par #51 via `vercel.json`, 2026-10-13 ; à revérifier sur la production après le merge) |
| + | Site URL Supabase, longueur mini du mot de passe (hors checklist) | **À vérifier par Kyllian** |

## Preuves

### 1. `.env*` ignorés : OK

```
$ git ls-files | grep -E '^\.env'
.env.example
$ git check-ignore -v .env.local
.gitignore:28:.env.*    .env.local
```

`.env.example` ne contient que des noms de variables, sans valeur. Le fichier `.env.local` n'a pas été ouvert pendant l'audit.

### 2. Aucune clé secrète dans l'historique : OK

121 commits (toutes branches) analysés avec des motifs en forme de clé, pour éviter les faux positifs du mot `service_role`, qui apparaît légitimement dans les migrations et les docs.

```
$ git log --all -p | grep -cE 'sb_secret_[A-Za-z0-9_-]{16,}'     -> 0
$ git log --all -p | grep -cE 'eyJhbGciOi[A-Za-z0-9_-]{20,}'     -> 0   (aucun JWT)
$ git log --all -p | grep -ciE '(password|passphrase)\s*[:=]\s*["'\''][^"'\'']{6,}'  -> 0
$ git log --all --name-only --format= | grep -iE '\.env|\.pem|\.key$|\.gpg$|backup' | sort -u
.env.example
.github/workflows/backup.yml
```

Le `grep 'sb_secret_|service_role'` littéral de l'issue ne peut pas donner « rien » : le mot `service_role` est présent dans les migrations (`GRANT`/`REVOKE`) et dans la doc. Il faut chercher des chaînes en forme de clé. `.mcp.json` est versionné et ne contient que l'URL `https://mcp.supabase.com/mcp` avec `project_ref` et `features` (aucun jeton).

### 3. Aucune clé secrète dans le build : OK

`npm run build` puis recherche dans `dist/` et dans le bundle servi en production (`/assets/index-DSWm_7qW.js`, identique au build local).

```
$ grep -rlE 'sb_secret_|service_role' dist/
dist/assets/index-DSWm_7qW.js        <- faux positif, voir ci-dessous
$ grep -oE '.{60}(sb_secret_|service_role).{60}' dist/assets/index-*.js
...e.startsWith(`sb_publishable_`)||e.startsWith(`sb_secret_`),oc=`sb_temp_`...   (code de supabase-js, test de préfixe)
$ grep -oE 'sb_secret_[A-Za-z0-9_-]{10,}|eyJhbGciOi[A-Za-z0-9_-]{20,}' dist/assets/*.js | wc -l   -> 0
```

Le seul motif trouvé est le test de préfixe de clé dans `supabase-js`, pas une clé. Le bundle contient une clé `sb_publishable_…` et l'URL du projet, ce qui est attendu.

### 4. Clé publique seulement côté client : OK

`src/lib/supabase.ts` lit uniquement `import.meta.env.VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. La clé secrète n'est lue que dans `tools/cards/cli.ts` (outil local Mac, hors bundle) : `grep -rlE "SUPABASE_SECRET|service_role|SECRET_KEY" src shared tools` ne renvoie que `tools/cards/cli.ts`.

### 5. RLS et Advisors : OK

Requêtes `SELECT` en lecture seule sur la base de prod :

```
pg_class (schéma public)      : cards rls=true, notes rls=true, reviews rls=true
pg_policies                   : cards   SELECT authenticated
                                reviews SELECT authenticated
                                reviews INSERT authenticated (with check true)
                                notes   aucune policy (voulu : seule la clé secrète y accède)
pg_class.relacl               : cards   authenticated=r, service_role=arwd
                                notes   service_role=arwd uniquement
                                reviews authenticated=ar (insert, select), service_role=ar
fonctions du schéma public    : rls_auto_enable, set_updated_at -> EXECUTE refusé à anon et authenticated
```

Advisors sécurité (`GET /v1/projects/{ref}/advisors/security`) : 1 alerte de niveau **INFO** (`rls_enabled_no_policy` sur `public.notes`). C'est le comportement voulu : `notes` n'est lue que par l'outil local via la clé secrète, `authenticated` n'a aucun grant dessus. Aucune alerte WARN ni ERROR.

### 6. `anon` sans accès : OK

Requêtes rejouées en production avec la clé publishable (rôle `anon`) :

```
GET  /rest/v1/cards?select=*&limit=1    -> HTTP 401  {"code":"42501","message":"permission denied for table cards"}
GET  /rest/v1/reviews?select=*&limit=1  -> HTTP 401  {"code":"42501","message":"permission denied for table reviews"}
GET  /rest/v1/notes?select=*&limit=1    -> HTTP 401  {"code":"42501","message":"permission denied for table notes"}
POST /rest/v1/reviews (insertion)       -> HTTP 401  {"code":"42501","message":"permission denied for table reviews"}
POST /rest/v1/rpc/rls_auto_enable       -> HTTP 401  {"code":"42501","message":"permission denied for function rls_auto_enable"}
GET  /rest/v1/ (schéma OpenAPI)         -> HTTP 401  "Secret API key required"
POST /graphql/v1 (introspection)        -> "pg_graphql extension is not enabled."
GET  /storage/v1/bucket                 -> HTTP 200, liste vide (0 bucket, 0 objet)
```

Aucune ligne renvoyée, aucune écriture possible. Le job `keepalive.yml` s'appuie sur ce 401/42501 et ne rouvre donc aucun accès.

### 7. Inscriptions désactivées, message d'erreur unique : OK

- Inscriptions : voir le point 15.
- Message d'erreur : `src/features/auth/useAuth.ts` renvoie `BAD_CREDENTIALS` (« E-mail ou mot de passe incorrect. ») pour toute erreur sauf une erreur réseau (`OFFLINE`). Côté API, un compte inexistant donne la même réponse qu'un mauvais mot de passe : `HTTP 400 {"error_code":"invalid_credentials","msg":"Invalid login credentials"}` (test avec une adresse `@example.invalid` inexistante, une seule requête). Pas d'énumération de comptes.

### 8. Sessions : OK

Configuration lue via l'API Management : `jwt_exp = 3600` (1 h), `refresh_token_rotation_enabled = true`, `security_refresh_token_reuse_interval = 10`. Le client active `autoRefreshToken` et `persistSession`. `sessions_timebox` et `sessions_inactivity_timeout` valent 0 (réglages réservés aux plans payants) : la session reste ouverte tant que le jeton de rafraîchissement est valide, ce qui est voulu pour une PWA hors ligne. La session est stockée dans `localStorage` (clé `vault-cards-auth`), valeur par défaut de `supabase-js` ; voir « En-têtes de sécurité » pour la mitigation.

### 9. Rate limiting de connexion : OK

Valeurs effectives du projet (API Management) : `rate_limit_otp = 30`, `rate_limit_verify = 30`, `rate_limit_token_refresh = 150`, `rate_limit_email_sent = 2` (par heure, fournisseur d'e-mail intégré), `rate_limit_anonymous_users = 30`. Selon la doc Supabase (`/auth/rate-limits`), la connexion par mot de passe passe par `/auth/v1/token` : 150 requêtes par 5 minutes par adresse IP par défaut (rafraîchissements inclus). Les endpoints d'inscription, de récupération et d'OTP sont limités à 30 requêtes par 5 minutes par IP. Pour un seul utilisateur et un mot de passe long, c'est suffisant. `security_captcha_enabled = false` : pas de CAPTCHA, acceptable ici.

### 10. Entrées validées : OK

- Outil local : `validatePayload` (`tools/cards/lib.ts`) refuse les clés inconnues, impose texte non vide, `front` ≤ 500, `back` ≤ 1500, 1 à 2 tags de la liste fixe sans doublon, `source_title` ≤ 200, et `cards` vide pour une note `removed`. `assertDeleteConfirmed` bloque toute suppression sans `--confirm-delete=<n>` exact. 248 tests verts.
- Base : contraintes `check` sur `cards.front` (1 à 500), `cards.back` (1 à 1500), `reviews.rating` (1 à 3), `cards.tags` (cardinalité 0 à 2, valeurs de la liste), `cards.source_title` (1 à 200).
- Client : aucune sortie HTML brute (`grep -E "dangerouslySetInnerHTML|innerHTML|eval\(|document.write" src` ne renvoie rien) ; React échappe le texte des cartes.
- Durcissement mineur possible (non bloquant) : `cards.deck`, `cards.source_path`, `notes.content_hash` n'ont pas de contrainte de longueur en base. Écriture réservée à la clé secrète (outil local) : risque très faible.

### 11. HTTPS : OK

```
$ curl -sI https://vault-cards-three.vercel.app/   -> HTTP/2 200
strict-transport-security: max-age=63072000; includeSubDomains; preload
$ curl -sI http://vault-cards-three.vercel.app/    -> 308 vers https://
```

L'API Supabase n'est servie qu'en HTTPS. Pas de source map exposée (`/assets/index-*.js.map` -> 404) ni de `.env.local` servi (404). Le service worker ne met en cache que la coquille de l'app (aucun `runtimeCaching`, donc pas de réponse d'API en cache).

### 12. Pas de `console.log` : OK

`eslint.config.js` active `'no-console': 'error'` ; `npm run lint` est vert et `grep -rn "console\." src` ne renvoie rien.

### 13. Dépendances : OK (npm), à vérifier (alertes GitHub)

```
$ npm audit --omit=dev
found 0 vulnerabilities
```

Dependabot **mises à jour de versions** actif (`.github/dependabot.yml` : npm hebdomadaire, GitHub Actions mensuel ; PR #12, #13, #14 ouvertes par le bot). En revanche, `GET /repos/yukydesu/vault-cards/vulnerability-alerts` renvoie 404 et `automated-security-fixes` renvoie `enabled: false` : les **alertes** et **mises à jour de sécurité** Dependabot semblent désactivées. À activer par Kyllian (voir plus bas).

### 14. Sauvegarde : OK

Dernier run de `backup.yml` : `38454323376`, `workflow_dispatch`, **success** le 2026-10-13 à 19:22 UTC (toutes les étapes vertes : dump, garde-fous tables `cards` et `reviews`, chiffrement GPG AES256, upload de l'artefact, rétention 90 jours). Deux runs précédents en échec le même jour (probablement le secret `SUPABASE_DB_URL`, redéfini à 19:22 juste avant le run réussi) ; aucun run planifié n'a encore eu lieu (le premier est dimanche 2026-10-18 à 03:23 UTC). Les données sauvegardées sont limitées au schéma `public` (pas de hash de mot de passe). `permissions: {}` sur le workflow, actions épinglées par SHA. Le test de restauration décrit dans `docs/restore.md` (étape 5) reste à faire une fois.

### 15. Inscriptions fermées, vérifié à distance : OK

Trois sources concordantes :

```
GET /auth/v1/settings (public)            -> disable_signup: true, external.anonymous_users: false, mailer_autoconfirm: false
API Management /config/auth               -> disable_signup = true, external_anonymous_users_enabled = false
SELECT count(*) FROM auth.users           -> 1 utilisateur (e-mail confirmé), 1 identité de type email
```

Aucun fournisseur OAuth activé (seul `email`). Aucune requête d'inscription n'a été envoyée.

### 16. Protection « leaked password » (HaveIBeenPwned) : N/A en Free, risque accepté

`password_hibp_enabled = false`. La doc officielle (`https://supabase.com/docs/guides/auth/password-security`) indique que la protection contre les mots de passe fuités est réservée au plan **Pro et au-dessus**. Elle n'est donc pas activable en Free. Mesure compensatoire : mot de passe long et unique, généré par le gestionnaire de mots de passe de Kyllian (au moins 16 caractères). La doc recommande 8 caractères au minimum ; le projet est réglé à 6 (voir « Actions pour Kyllian »).

### Uploads, webhooks, CORS : N/A

Aucun bucket Storage (0 bucket, 0 objet), aucune Edge Function (`GET /functions` renvoie `[]`), aucun webhook, `pg_graphql` désactivé. CORS : réglage par défaut de l'API Supabase, protégé par la clé et la RLS ; pas d'API maison.

## En-têtes de sécurité HTTP : OK (#51)

Constat de l'audit : en production, seul `strict-transport-security` était présent, sans `vercel.json`.

Correctif (issue #51, 2026-10-13) : `vercel.json` ajoute à toutes les routes une `Content-Security-Policy` stricte, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` et une `Permissions-Policy` minimale (caméra, micro, géolocalisation, paiement et autres capteurs désactivés ; à rouvrir `camera` pour `self` quand l'étape photo #55 arrivera). La CSP : `default-src 'self'`, `script-src 'self'` (aucun script inline), `style-src 'self'` + `style-src-attr 'unsafe-inline'` (attributs `style` uniquement), `img-src 'self' data:`, `connect-src 'self' https://kowhaowawiqqnunxecyt.supabase.co` (pas de `wss://` : Realtime n'est pas utilisé), `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, `upgrade-insecure-requests`.

Vérification : `dist/` servi en local avec ces en-têtes, ouvert dans Chrome headless : page de connexion rendue, aucune violation CSP en console, service worker activé et précache de 12 entrées, page contrôlée au second chargement ; un `fetch` vers un domaine tiers est bloqué, un `fetch` vers Supabase passe. Les écrans connectés (étiquettes colorées, etc.) n'ont pas pu être exercés sans identifiants : à regarder sur la preview.

Pourquoi c'est utile ici : la session Supabase est dans `localStorage`, donc une faille XSS permettrait de la lire. La CSP réduit ce risque (le code n'a aucun sink XSS aujourd'hui, c'est une défense en profondeur).

## Actions pour Kyllian

Rien de ce qui suit n'a été modifié pendant l'audit. Les chemins du Dashboard peuvent varier un peu selon la version de l'interface.

1. **Site URL Supabase** (priorité basse) : la valeur actuelle est `http://localhost:3000`. Dashboard, Authentication, URL Configuration, champ « Site URL » : mettre `https://vault-cards-three.vercel.app`. Laisser « Redirect URLs » vide. Cela évite qu'un futur e-mail de récupération de mot de passe pointe vers `localhost`.
2. **Longueur minimale du mot de passe** (recommandé) : actuellement 6. Dashboard, Authentication, Sign In / Providers (ou Policies), section Email, « Minimum password length » : passer à 12 ou plus. Sans effet sur ton mot de passe actuel, mais bloque un mot de passe faible lors d'un futur changement ou d'une recréation de compte. Vérifier au passage que le mot de passe actuel est long et unique (point 16).
3. **Alertes Dependabot** : GitHub, dépôt `yukydesu/vault-cards`, Settings, Advanced Security (Code security), activer « Dependabot alerts » et « Dependabot security updates ». Gratuit pour un dépôt privé.
4. **Test de restauration** : faire une fois l'étape 5 de `docs/restore.md` avec la sauvegarde du 2026-10-13, puis relire le premier run planifié du dimanche 2026-10-18.
5. Ne pas activer l'inscription TOTP (MFA) : `mfa_totp_enroll_enabled` est à `true` côté projet, mais l'app ne gère pas le niveau AAL2. Un facteur enrôlé aujourd'hui ne serait pas exigé ni géré par l'app. Pas d'action requise, rien à enrôler.

## Risques acceptés

- **Isolation par la seule fermeture des inscriptions.** Les policies RLS sont `using (true)` pour `authenticated` : le modèle est un seul utilisateur, sans `user_id` sur les lignes. Si les inscriptions étaient rouvertes, tout compte créé lirait toutes les cartes et pourrait ajouter des reviews. `disable_signup = true` est donc critique. Attention à la procédure de restauration (`docs/restore.md`, étape 4), qui demande de rouvrir temporairement les inscriptions : les refermer immédiatement et revérifier avec `GET /auth/v1/settings`.
- **Leaked password protection indisponible en Free** : compensée par un mot de passe long, unique et géré par le gestionnaire de mots de passe.
- **Jeton de session dans `localStorage`** (comportement par défaut de `supabase-js`) : exposé en cas de XSS ; réduit par l'absence de sink XSS et par la CSP (voir « En-têtes de sécurité HTTP »).
- **Pas de CAPTCHA ni de MFA** : un seul compte, rate limiting Supabase par IP, mot de passe long.
- **Pas de protection de la branche `main`** : fonction payante pour un dépôt privé en Free. La règle « jamais de commit direct sur `main` » repose sur la discipline et sur la CI.
- **Accès réseau à la base ouvert** (`0.0.0.0/0`, restrictions réseau non utilisées) : accès protégé par mot de passe et TLS (`ssl = on`). Les restrictions d'IP ne conviennent pas à GitHub Actions (IP variables).
- **Sauvegarde téléchargeable par quiconque a accès au dépôt** : chiffrée en AES256 ; la robustesse dépend de la longueur de la phrase de passe (voir `docs/restore.md`). Dépôt privé.
- **Pas de contrainte de longueur SQL sur `deck`, `source_path`, `content_hash`** : écrits uniquement par l'outil local avec la clé secrète, après `validatePayload`.
