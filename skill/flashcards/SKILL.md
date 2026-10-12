---
name: flashcards
description: Génère ou met à jour les flashcards Vault Cards à partir des notes de veille du vault Obsidian (~/Workspace/3-Resources/veille). À lancer quand Kyllian dit « /flashcards », « mets à jour mes cartes », « génère les flashcards ».
---

# /flashcards

Outil : `node tools/cards/cli.ts` depuis `~/Workspace/1-Projects/vault-cards` (lit `.env.local`).

- Ne jamais afficher, lire ni copier `.env.local` ou la clé secrète : seul l'outil la charge.
- Fichiers JSON temporaires : toujours dans un dossier de travail hors du dépôt, `$TMPDIR/vault-cards/` (le créer avec `mkdir -p`), jamais dans le dépôt ni dans le vault.
- L'outil ne touche jamais aux reviews : la progression d'une carte est liée à son `id`.

1. `scan` → liste `changed` et `removed`. Si les deux sont vides : répondre « Rien de nouveau » et s'arrêter.
2. Pour chaque note `removed` : écrire `{source_path, deck, content_hash: "removed", cards: []}` (deck = dossier qui suit `veille/` dans `source_path`) et `apply` (supprime ses cartes).
3. Pour chaque note `changed` :
   a. Lire le fichier (`abs_path`).
   b. `existing <source_path>` → cartes actuelles.
   c. Écrire les cartes (règles ci-dessous) dans un fichier JSON temporaire de `$TMPDIR/vault-cards/` au format `{source_path, deck, content_hash, cards: [{id?, front, back, tags}]}`, avec `source_path`, `deck` et `content_hash` recopiés tels quels depuis `scan`. Garder l'`id` d'une carte existante encore pertinente (même si reformulée) ; ne jamais inventer d'id. Une carte existante absente de la liste est supprimée. Chaque carte porte 1 ou 2 tags (section « Tags ») ; reprendre les tags renvoyés par `existing` sauf s'ils ne conviennent plus.
   d. `apply <fichier>` → `{added, updated, deleted}`. En cas d'erreur, corriger le JSON et relancer : le hash n'est enregistré que si tout a réussi.
4. Résumé final : « N notes · +X cartes · Y modifiées · Z supprimées », puis la liste des notes traitées.

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
3. `retag <fichier>` → `{updated, unchanged}`. Seule la colonne `tags` est modifiée ; un id inconnu ou un tag invalide fait tout refuser avant écriture.
