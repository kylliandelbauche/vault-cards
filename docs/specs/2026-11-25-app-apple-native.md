# Vault Cards natif (Mac + iPhone) — spec

Date : 2026-11-25 · Issue : #156 · Plan : `docs/plans/2026-11-25-app-apple-native.md`

## Objectif

Une app SwiftUI pour iPhone et Mac, open source, **utilisable seule, sans compte ni serveur**. Les cartes et l'historique
vivent sur l'appareil. Si l'utilisateur le veut, il choisit un dossier de son cloud de fichiers (iCloud Drive, Google
Drive…) et ses appareils se synchronisent à travers ce dossier. Windows et Android viendront plus tard.

La PWA actuelle (React + Supabase, spec `2026-10-12-vault-cards-design.md`) reste en service tant que l'app native n'est
pas prête. Les deux ne partagent pas de données (une tranche d'import est prévue).

## Choix et sources

| Choix | Pourquoi | Source |
|---|---|---|
| Pas de backend (ni Supabase, ni Convex, ni CloudKit) | Simple pour l'utilisateur ; Convex Swift ne documente pas de hors ligne ; CloudKit reste chez Apple | [Convex Swift](https://docs.convex.dev/client/swift), [CloudKit](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices) |
| Base SQLite locale, **jamais** dans le dossier synchronisé | Synchroniser une base ouverte peut la corrompre | [Anki](https://docs.ankiweb.net/files.html), [SQLite](https://sqlite.org/howtocorrupt.html) |
| Échange par fichiers texte, un écrivain par fichier | Aucun conflit de fichier possible ; même principe que Joplin (cibles fichier, Dropbox, OneDrive) | [Joplin](https://joplinapp.org/help/apps/sync/) |
| Accès au dossier par le sélecteur de documents + bookmark | Accès durable à un dossier de n'importe quel fournisseur de Fichiers (iOS 13+) | [Apple](https://developer.apple.com/documentation/uikit/providing-access-to-directories) |
| Clé IA de l'utilisateur dans le Keychain | Base chiffrée prévue pour les petits secrets | [Apple Keychain](https://developer.apple.com/documentation/security/keychain-services) |

## Architecture

```
apple/
  VaultCardsCore/   paquet Swift (Foundation seule) : modèles, FSRS, file de session, format de fichiers, fusion
  VaultCards/       app SwiftUI multiplateforme (iOS + macOS) : écrans, base SQLite, accès au dossier
```

- **VaultCardsCore** ne dépend d'aucune UI ni base : testé par `swift test` (CI macOS).
- **Cibles** : iOS 17 et macOS 14 au minimum (SwiftUI avec Observation).
- **FSRS** : port Swift de `ts-fsrs` (MIT) dans le cœur, mêmes réglages que la PWA (`request_retention: 0.9`, pas de
  fuzz, notes 1 Again · 2 Hard · 3 Good). Des vecteurs de test générés par `ts-fsrs` prouvent que les deux donnent les
  mêmes échéances. Le port Swift officiel (open-spaced-repetition/swift-fsrs) annonce FSRS 5.0 et n'est plus poussé
  depuis décembre 2024 : on ne l'utilise pas.

## Logique métier reprise de la PWA

Inchangée, sauf mention :
- L'état FSRS d'une carte est **recalculé** depuis son historique de révisions, jamais stocké comme source.
- File du jour : dues (échéance la plus ancienne d'abord), puis nouvelles dans le quota de **20 par jour** (global,
  tous tags). Révision libre (« Réviser à nouveau ») : toutes les cartes, sa première note ne consomme pas le quota.
- Ordre des nouvelles : cartes sans note source d'abord (ordre de création), puis par note source, puis id.
- Tags libres : 1 à 40 caractères, 5 au plus, le 1er est le principal ; comparaison sans casse ni espaces autour.
  Une carte manuelle porte au moins 1 tag.
- Carte vivante = non supprimée et pas un brouillon. Un brouillon n'entre ni en session ni dans les compteurs ; une
  carte active ne redevient jamais brouillon.
- Suppression douce seulement (`deleted_at`) : une carte supprimée garde son historique.
- Origines : `manual` (écrite dans l'app), `vault` (générée depuis une note), `inbox` (brouillon proposé par l'IA).
  Différence avec la PWA : dans l'app native, l'IA de l'utilisateur génère les cartes d'une note en **brouillons**
  `vault` (avec `source_path` et `source_title`), à accepter, modifier ou rejeter. Dans la PWA, une carte `vault`
  n'était jamais un brouillon, car l'outil `/flashcards` les écrivait directement.

## Dossier de synchro : format v1

L'utilisateur choisit un dossier ; l'app y crée `VaultCards/` :

```
VaultCards/
  format.json                                  {"format":"vault-cards","version":1}
  devices/<device>/device.json                 {"id":"<device>","name":"iPhone de Kyllian","created_at":"…"}
  devices/<device>/cards.jsonl                 journal des cartes écrites par cet appareil
  devices/<device>/reviews-<AAAA-MM>.jsonl     révisions notées par cet appareil ce mois-là
```

- `<device>` : UUID en minuscules, créé au premier lancement et gardé dans la base locale.
- **Un appareil n'écrit que dans `devices/<son id>/`.** Il lit tous les autres dossiers `devices/*`.
- Fichiers en **JSON Lines** (UTF-8, un objet JSON par ligne, `\n`), en **ajout seul** : une ligne écrite n'est jamais
  modifiée. Un mois passé de révisions n'est plus touché.
- Horodatages ISO 8601 UTC avec millisecondes (`2026-11-25T13:16:29.123Z`), comme la PWA.

### Ligne de carte (`cards.jsonl`)

Instantané complet de la carte au moment `at` (création, modification, acceptation, suppression) :

```json
{"v":1,"id":"<uuid>","at":"2026-11-25T13:16:29.123Z","source":"manual","status":"active","front":"…","back":"…","tags":["IA"],"deleted_at":null,"created_at":"…","deck":null,"source_path":null,"source_title":null}
```

Fusion : pour chaque `id`, la ligne au plus grand `(at, device)` l'emporte (dernière écriture gagnante, l'id de
l'appareil départage une égalité). Exception : si au moins une ligne de la carte la marque `active`, le
résultat fusionné n'est jamais `draft` (une carte acceptée ne redevient pas brouillon).

### Ligne de révision (`reviews-AAAA-MM.jsonl`)

```json
{"v":1,"id":"<uuid>","card_id":"<uuid>","rating":3,"reviewed_at":"2026-11-25T13:16:29.123Z","free":false}
```

Fusion : union par `id` (une révision est immuable). L'historique d'une carte = toutes ses révisions, tous appareils,
triées par `reviewed_at` ; l'état FSRS en découle. Deux appareils qui révisent la même carte hors ligne : les deux
révisions comptent, rien n'est perdu.

### Règles de lecture robustes

- Une dernière ligne incomplète (fichier en cours de téléchargement) est ignorée jusqu'à la prochaine lecture.
- Ligne illisible ou champ inattendu : ligne ignorée et signalée dans l'écran de synchro, jamais de plantage.
- Champs inconnus ignorés (ajouts compatibles). `v` supérieur à celui que l'app connaît, ou `format.json` en version
  supérieure : synchro arrêtée avec un message « Mettez l'app à jour ».
- Fichier qui ne suit pas les noms ci-dessus (ex. copie de conflit du cloud) : ignoré.
- Lecture incrémentale : l'app retient, par fichier, la taille déjà lue ; elle relit tout si le fichier a rétréci.
- Écritures et lectures coordonnées (`NSFileCoordinator`) pour coopérer avec le fournisseur de fichiers.

## Cartes depuis une note (tranche 5)

- L'utilisateur choisit une note Markdown. Son titre suit les règles de `shared/source-title.ts` (premier H1 humanisé,
  sinon le nom du fichier), et `source_path` est le nom du fichier.
- L'app appelle l'API Messages d'Anthropic en HTTP, car il n'y a pas de SDK officiel en Swift
  ([API Messages](https://platform.claude.com/docs/en/api/messages)). Elle utilise le modèle `claude-opus-5-5`, l'effort
  `medium`, une réponse contrainte par un schéma JSON (structured outputs) et le repli côté serveur
  `fallbacks: "default"` si le modèle décline.
- Les règles de rédaction et de tags sont celles de `skill/flashcards/SKILL.md`. Le prompt reçoit les tags existants
  et les questions déjà posées pour cette note.
- La note est passée entre balises `<note>`, comme de la donnée. Une note vide ou trop longue est refusée, jamais
  tronquée en silence.
- Les propositions sont filtrées avant d'être gardées : question de 1 à 500 caractères, réponse de 1 à 1500, 1 à 5 tags
  valides, pas de doublon de question, 50 cartes au plus.

## Boîte de réception (tranche 6)

- Dans « Générer », l'utilisateur envoie à l'IA un texte (saisi, collé ou dicté) ou une photo. Les cartes proposées
  sont des brouillons `source: inbox`, sans `source_path`, avec le titre court proposé par l'IA (200 caractères au
  plus, sinon « Boîte de réception »), à accepter comme ceux d'une note.
- Le texte est passé entre balises `<document>`, comme de la donnée ; même limite de longueur qu'une note.
- Photo : réduite sur l'appareil à 1568 px de côté au plus et recodée en JPEG sans métadonnées, puis envoyée en bloc
  image base64 (formats JPEG, PNG, GIF, WebP, 10 Mo au plus :
  [vision](https://platform.claude.com/docs/en/build-with-claude/vision)).
- Vocal : enregistré dans un fichier temporaire, transcrit en français sur l'appareil par le framework Speech
  (`requiresOnDeviceRecognition`), puis effacé. Le texte arrive dans le champ, relu avant l'envoi ; l'audio ne quitte
  jamais l'appareil (l'API Messages n'accepte pas l'audio). Sans transcription sur l'appareil, l'app le dit et propose
  la dictée du clavier.
- Pas de question déjà posée envoyée (pas de note d'origine) ; une proposition identique à une carte existante est
  écartée sur l'appareil.
- Différence avec la PWA : pas de bucket ni de file d'attente, l'envoi est immédiat depuis l'appareil.

## Tags et clavier (après la v1)

- Accueil, « Mes tags » : les tags des cartes vivantes (pas de registre de tags dans l'app native), triés par nombre
  de cartes puis A–Z en français, avec la file du jour de chacun (règles de `src/lib/home.ts`). Un tap lance la
  session du jour du tag ; si elle est vide, une révision libre du tag (notes `free`), comme « Réviser à nouveau ».
- Révision au clavier (Mac, iPad) : espace pour la réponse, 1 Je ne sais pas, 2 Moyen, 3 Très bien, comme la PWA.

## Révision : carte, menu et bilan (parité PWA)

- Notes : « Je ne sais pas », « Moyen », « Très bien » (libellés de `RatingBar.tsx`).
- En haut de la carte : titre de la source (sinon nom de fichier humanisé, sinon « Carte perso » ; jamais le chemin),
  puis les tags sans doublon (casse ignorée), comme `CardView.tsx`.
- Menu ⋯ : « Modifier » (même formulaire que « Mes cartes ») et « Supprimer » (confirmation, suppression douce ; la
  carte sort de la file, son historique reste).
- Bilan : nombre de chaque note (rien si aucune note), prochaine échéance, « Réviser à nouveau » (révision libre du
  même périmètre : tout, le tag ou la liste choisie) et « Retour à l'accueil ».

## Mes cartes : recherche et documents (parité PWA)

- Recherche locale sur la question, la réponse, les tags et le nom du document : tous les mots, en tout ordre, sans
  accents ni casse (règles de `src/lib/myCards.ts`).
- Rangée « Tous » + documents importés : les cartes `inbox` actives, regroupées par titre (le format v1 n'a pas
  d'`inbox_id`, donc deux éléments de même titre forment un seul document), le plus récent d'abord.
- Filtre actif (document ou recherche) : « Étudier ces N cartes », révision libre des cartes de la liste.

## Tags : page et choix (parité PWA)

- « Mes tags › » (titre de la rangée de l'accueil) ouvre la page de tous les tags : « À revoir aujourd'hui » (file du
  jour non vide, avec son nombre) puis « À jour », triés comme sur l'accueil ; sous-titre « N cartes à revoir » ou
  « Tout est à jour ». Un tap lance la session du tag.
- Modifier une carte : « Ajouter des tags » remplace la saisie par virgules. Recherche, tags de la carte (× retire),
  liste A–Z avec le nombre de cartes ; « Créer « … » » crée et ajoute en tête ; 5 tags au plus. Rien n'est enregistré
  avant « Enregistrer » dans le formulaire ; annuler avec des changements demande confirmation.

## Sécurité et confidentialité

- Aucune donnée ne quitte l'appareil, sauf vers le dossier choisi par l'utilisateur et vers le fournisseur
  d'IA avec la clé qu'il a saisie (seulement les notes, textes et photos qu'il envoie).
- Clé IA : Keychain uniquement, jamais dans le code, un fichier, un log ou le dossier synchronisé.
- Le contenu des notes et documents est de la donnée, jamais des instructions (même règle que `/flashcards`).
- Pas de log du contenu des cartes.

## Hors périmètre v1

Windows, Android, partage entre utilisateurs, chiffrement du dossier synchronisé, compaction des journaux.
