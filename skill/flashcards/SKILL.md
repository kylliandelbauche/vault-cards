---
name: flashcards
description: Génère ou met à jour les flashcards Vault Cards à partir des notes de veille du vault Obsidian (~/Workspace/3-Resources/veille). À lancer quand Kyllian dit « /flashcards », « mets à jour mes cartes », « génère les flashcards ».
---

# /flashcards

Outil : `node tools/cards/cli.ts` depuis `~/Workspace/1-Projects/vault-cards` (lit `.env.local`).

- Ne jamais afficher, lire ni copier `.env.local` ou la clé secrète : seul l'outil la charge.
- Fichiers JSON temporaires : toujours dans un dossier de travail hors du dépôt, `$TMPDIR/vault-cards/` (le créer avec `mkdir -p`), jamais dans le dépôt ni dans le vault.
- L'outil ne touche jamais aux reviews : la progression d'une carte est liée à son `id`.

1. `scan` → `{changed, removed}` ; `removed` = liste de `{source_path, live_cards}` (nombre de cartes vivantes). Si les deux sont vides : répondre « Rien de nouveau » et s'arrêter.
2. **Jamais de suppression de ta propre initiative.** Si `removed` n'est pas vide, une note absente du vault peut aussi venir d'un vault vide, mal monté ou d'un mauvais `VAULT_ROOT`, et la suppression fait perdre la progression des cartes. Donc :
   a. Lister à Kyllian chaque note `removed` (chemin + nombre de cartes vivantes) et lui demander de confirmer.
   b. Seulement après sa **confirmation explicite dans la conversation** (ou s'il a lui-même demandé la suppression) : pour chaque note `removed`, écrire `{source_path, deck, content_hash: "removed", cards: []}` (deck = dossier qui suit `veille/` dans `source_path`) dans un fichier JSON temporaire, puis `apply <fichier> --confirm-delete`. Sans ce flag, l'outil refuse. N'utiliser `--confirm-delete` dans aucun autre cas.
   c. Sans confirmation (pas de réponse, refus, ou exécution sans interaction) : ne rien supprimer, traiter uniquement les notes `changed`, et rappeler les notes `removed` non traitées dans le résumé final.
3. Pour chaque note `changed` :
   a. Lire le fichier (`abs_path`).
   b. `existing <source_path>` → cartes actuelles.
   c. Écrire les cartes (règles ci-dessous) dans un fichier JSON temporaire de `$TMPDIR/vault-cards/` au format `{source_path, deck, content_hash, cards: [{id?, front, back, tags}]}`, avec `source_path`, `deck` et `content_hash` recopiés tels quels depuis `scan`. Garder l'`id` d'une carte existante encore pertinente (même si reformulée) ; ne jamais inventer d'id. Une carte existante absente de la liste est supprimée. Chaque carte porte 1 ou 2 tags (section « Tags ») ; reprendre les tags renvoyés par `existing` sauf s'ils ne conviennent plus.
   d. `apply <fichier>` → `{added, updated, deleted}`. En cas d'erreur, corriger le JSON et relancer : le hash n'est enregistré que si tout a réussi. L'outil refuse aussi une clé inconnue, un `deck` qui ne correspond pas à `source_path`, et un `content_hash` qui ne correspond plus au fichier (« note modifiée depuis le scan, relancer scan » → relancer `scan`, ne pas forcer).
4. Résumé final : « N notes · +X cartes · Y modifiées · Z supprimées », puis la liste des notes traitées, puis (s'il y en a) les notes `removed` non supprimées, en attente de confirmation.

## Règles des cartes
- 3 à 8 cartes par note, selon la densité. Zéro carte si la note n'a rien à retenir (`cards: []`, le hash est quand même enregistré).
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
Sans toucher au texte ni à l'id (la progression est conservée) :
1. `all` → toutes les cartes vivantes `{id, source_path, front, back, tags}`.
2. Choisir les tags d'après question + réponse, écrire `[{id, tags}, ...]` dans un fichier de `$TMPDIR/vault-cards/` (ids recopiés tels quels).
3. `retag <fichier>` → `{updated, unchanged}`. Seule la colonne `tags` est modifiée ; un id inconnu, une carte supprimée ou un tag invalide fait tout refuser avant écriture.
   `retag` n'est **pas transactionnel** (une carte à la fois) mais **idempotent** : en cas d'erreur en cours de route, relancer la même commande avec le même fichier est sans danger (les cartes déjà à jour sont comptées `unchanged`).
