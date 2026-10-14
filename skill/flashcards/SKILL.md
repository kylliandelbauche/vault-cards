---
name: flashcards
description: Génère ou met à jour les flashcards Vault Cards à partir des notes de veille du vault Obsidian (~/Workspace/3-Resources/veille). À lancer quand Kyllian dit « /flashcards », « mets à jour mes cartes », « génère les flashcards ».
---

# /flashcards

Outil : `node tools/cards/cli.ts` depuis `~/Workspace/1-Projects/vault-cards` (lit `.env.local`).

## Garde-fous
- Ne jamais afficher, lire ni copier `.env.local` ou la clé secrète : seul l'outil la charge.
- L'outil ne touche jamais aux reviews : la progression d'une carte est liée à son `id`.
- L'outil ne voit que les cartes `source = 'vault'` : les cartes créées à la main dans l'app (`manual`, #54) n'apparaissent ni dans `scan`, `existing`, `all`, ni dans `apply`, `retag`, `titles`. Ne jamais tenter de les modifier.
- **Tu ne supprimes jamais de cartes de ta propre initiative**, quelle qu'en soit la cause : note `removed`, carte retirée d'une note `changed`, ou `cards: []` sur une note qui avait des cartes. L'outil refuse toute suppression sans `--confirm-delete=<n>` (n = nombre exact de cartes supprimées) et, dans ce refus, liste les cartes concernées (id + début de la question). Marche à suivre : montrer cette liste telle quelle à Kyllian, **attendre sa confirmation explicite dans la conversation**, puis seulement relancer la même commande avec `--confirm-delete=<n>` (le n du message de refus). Pas de confirmation (refus, silence, exécution sans interaction) : ne pas supprimer, ne pas passer le flag, et signaler la note dans le résumé. Limite assumée : le flag est passable par toi ; il protège de l'oubli et du rejeu, pas d'une décision de l'outrepasser. Ne jamais le passer sans confirmation.
- **Dossier temporaire unique par exécution** (incident du 2026-10-13 : un vieux payload rejoué a remplacé des cartes par une version antérieure). Une exécution = un `mktemp -d` ; tous les JSON y sont écrits ; seuls des fichiers créés pendant cette exécution sont appliqués (`apply`, `retag`) : ne jamais rejouer un JSON trouvé ailleurs ni lister un dossier de travail ancien. Les variables du shell ne persistent pas d'un appel Bash à l'autre : à chaque appel, réaffecter `RUN_DIR='<chemin exact renvoyé par mktemp>'` (recopié, jamais recomposé).
- **Nettoyage** en fin d'exécution, y compris en cas d'arrêt anticipé (« Rien de nouveau », erreur, abandon, refus de confirmation) : `RUN_DIR='<chemin exact renvoyé par mktemp>'; [ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ] && rm -rf -- "$RUN_DIR"`. Ne l'exécuter que si `RUN_DIR` est non vide, est un dossier créé par ton `mktemp -d` de cette exécution et se trouve dans le dossier temporaire du système (`$TMPDIR`, `/var/folders/…` ou `/tmp`) ; au moindre doute sur le chemin, ne rien supprimer et le signaler.

## Procédure
Une exécution complète : dossier temporaire → scan → notes `changed` → demandes de confirmation de suppression, dans la **même** exécution → nettoyage → résumé.

1. `RUN_DIR=$(mktemp -d); echo "$RUN_DIR"` (en un seul appel), puis noter le chemin affiché.
2. `scan` → `{changed, removed}`. `changed` : `{source_path, deck, content_hash, title, abs_path}` ; `removed` : `{source_path, live_cards}`. Si les deux sont vides : nettoyage puis « Rien de nouveau », fin.
3. Pour chaque note `changed` :
   a. Lire le fichier (`abs_path`).
   b. `existing <source_path>` → cartes actuelles.
   c. Écrire les cartes (règles ci-dessous) dans un fichier de `$RUN_DIR` au format `{source_path, deck, content_hash, source_title, cards: [{id?, front, back, tags}]}`. Recopier **uniquement** `source_path`, `deck` et `content_hash` depuis `scan`, tels quels, et `source_title` = le `title` de `scan` (H1 de la note, ou nom de fichier si elle n'en a pas ; ne pas le réécrire). Ni `abs_path`, ni `live_cards`, ni `title` sous ce nom. `source_title` est obligatoire pour une note modifiée et **interdit** dans le payload d'une note `removed`. Il s'écrit sur toutes les cartes de la note, y compris celles conservées. Garder l'`id` d'une carte existante encore pertinente (même si reformulée) ; ne jamais inventer d'id. Chaque carte porte 1 ou 2 tags (section « Tags ») ; reprendre les tags renvoyés par `existing` sauf s'ils ne conviennent plus. **Une carte existante absente de la liste serait supprimée** (donc soumise à confirmation, voir « Garde-fous »). Pour ne rien supprimer, la garder dans la liste.
   d. `apply <fichier>` → `{added, updated, deleted}`. En cas d'erreur, corriger le JSON et relancer : le hash n'est enregistré que si tout a réussi. L'outil refuse aussi une clé inconnue, un `source_path` ou un `deck` incohérent, et un `content_hash` périmé (« note modifiée depuis le scan, relancer scan » : relancer `scan`, ne pas forcer). S'il refuse pour cause de suppression : procédure des garde-fous. Si la suppression n'est pas confirmée, ne pas appliquer cette note (son hash n'est pas enregistré, elle sera retraitée au prochain `scan`).
4. Notes `removed` (une fois les `changed` traités, dans la même exécution). Une note absente du vault peut aussi venir d'un vault vide, mal monté ou d'un mauvais `VAULT_ROOT` : ne rien supposer.
   a. Lister à Kyllian chaque note `removed` (chemin + `live_cards`) et lui demander s'il veut supprimer leurs cartes.
   b. Pour chaque note dont il confirme la suppression : écrire dans `$RUN_DIR` `{source_path, deck, content_hash: "removed", cards: []}` (sans `source_title` ; `source_path` recopié depuis `scan`, `deck` = dossier qui suit `3-Resources/veille/` dans `source_path`), lancer `apply <fichier>` **sans** flag, montrer la liste du refus à Kyllian, et seulement après sa confirmation explicite relancer avec `--confirm-delete=<n>`.
   c. Notes non confirmées : rien à faire, les rappeler dans le résumé.
   d. Si Kyllian ne répond qu'après la fin de l'exécution : repartir à zéro (nouveau `mktemp -d`, nouveau `scan`, ne traiter que ce qui y figure encore comme `removed`, même procédure b), jamais avec un `scan` ou un JSON de l'exécution précédente.
5. Nettoyage de `$RUN_DIR` (voir « Garde-fous »).
6. Résumé final : « N notes · +X cartes · Y modifiées · Z supprimées », puis la liste des notes traitées, puis, s'il y en a, les suppressions non confirmées (notes `removed` et cartes retirées) en attente.

## Règles des cartes
- 3 à 8 cartes par note, selon la densité. Zéro carte si la note n'a rien à retenir (`cards: []`, le hash est quand même enregistré ; si la note avait déjà des cartes, c'est une suppression soumise à confirmation).
- Français. Question ≤ 150 caractères, une seule idée. Réponse ≤ 3 phrases, autonome.
- Viser les conclusions marquées ★, les chiffres, les définitions, les distinctions. Pas d'anecdote.
- Jamais « selon la vidéo », « dans cette note » : la carte doit se comprendre seule.
- Texte brut, pas de Markdown ni de HTML.

## Tags
Chaque carte a **1 tag principal**, et un **2e seulement s'il est vraiment pertinent** (la carte relève autant des deux thèmes). Maximum 2. Le 1er tag de la liste est le principal. Liste fixe (source : `shared/tags.ts`, tout autre slug est refusé) :

| slug | thème |
|---|---|
| `ia` | 🤖 IA & agents |
| `dev` | 🛠️ Dev & outils |
| `securite` | 🔐 Sécurité |
| `marketing` | 📈 Marketing & vente |
| `argent` | 💰 Argent & business |
| `mental` | 🧠 Mental & psycho |
| `productivite` | ⏱️ Productivité |
| `culture` | 📚 Culture |

Le tag dépend du contenu de la carte, pas du dossier de la note.

### Re-taguer des cartes existantes
Sans toucher au texte ni à l'id (la progression est conservée). Même règle de dossier que « Garde-fous » : `mktemp -d` au début, nettoyage protégé à la fin.
1. `all` → toutes les cartes vivantes `{id, source_path, front, back, tags}`.
2. Choisir les tags d'après question + réponse, écrire `[{id, tags}, ...]` dans un fichier du dossier de l'exécution (ids recopiés tels quels).
3. `retag <fichier>` → `{updated, unchanged}`. Seule la colonne `tags` est modifiée ; un id inconnu, une carte supprimée ou un tag invalide fait tout refuser avant écriture.
   `retag` n'est **pas transactionnel** (une carte à la fois) mais **idempotent** : en cas d'erreur en cours de route, relancer la même commande avec le même fichier est sans danger (les cartes déjà à jour sont comptées `unchanged`).

## Titre de la source
Chaque carte porte `source_title` : le titre de sa note (premier `# ` H1, frontmatter ignoré ; à défaut le nom de fichier sans `-synthese.md`, tirets en espaces). L'app l'affiche à la place du chemin local. `scan` le calcule (`title`), `apply` l'écrit.

### Remplir les cartes existantes
Commande sans fichier ni argument : `titles`. Elle relit chaque note source sur le disque et ne modifie **que** la colonne `source_title` des cartes vivantes (jamais id, texte ni tags : la progression est conservée).
1. `titles` → `{updated, unchanged}`.
2. Idempotent et rejouable : une carte déjà au bon titre est comptée `unchanged`, et un titre de note modifié depuis est mis à jour.
3. Si un fichier source est introuvable (note déplacée ou supprimée du vault, vault mal monté), l'outil refuse **avant toute écriture** et liste les notes concernées : les montrer à Kyllian, ne rien forcer.
4. Vérifier ensuite avec `all` (champ `source_title` de chaque carte).
