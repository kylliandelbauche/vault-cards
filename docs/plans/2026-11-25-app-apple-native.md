# Vault Cards natif (Mac + iPhone) — plan

Spec : `docs/specs/2026-11-25-app-apple-native.md` · Issue : #156

Une tranche = une issue = une PR. Chaque tranche laisse l'app dans un état utilisable. La PWA n'est pas modifiée.

| # | Tranche | Fini quand | Test par Kyllian |
|---|---|---|---|
| 1 | **Cœur Swift** (`apple/VaultCardsCore`) : modèles, port FSRS + vecteurs `ts-fsrs`, file de session, format JSONL et fusion | `swift test` vert en CI macOS | aucun |
| 2 | **App SwiftUI** Mac + iPhone : base SQLite locale, créer / modifier / supprimer une carte manuelle, réviser, accueil avec compteurs | build vert en CI, app lancée sur iPhone et Mac | ouvrir le projet dans Xcode, lancer sur l'iPhone, réviser 3 cartes |
| 3 | **Synchro par dossier** : choix du dossier, écriture du journal de l'appareil, lecture et fusion des autres, écran d'état | deux appareils convergent dans les tests | choisir un dossier iCloud Drive sur Mac et iPhone, réviser sur l'un, voir sur l'autre |
| 4 | **Import depuis la PWA** : commande `tools/` qui exporte les cartes et révisions Supabase au format v1 | historique complet retrouvé dans l'app | lancer une commande, ouvrir l'app |
| 5 | **Cartes depuis les notes** : lecture des notes Markdown du dossier, génération par l'IA avec la clé de l'utilisateur (Keychain), en brouillons | brouillons acceptés / rejetés comme dans la PWA | saisir sa clé, générer depuis une note |
| 6 | **Boîte de réception** : texte, photo, vocal → brouillons | idem | déposer une photo et un vocal |
| 7 | **Distribution** : TestFlight (compte Apple Developer requis) | app installée sans Xcode | accepter l'invitation TestFlight |

## Règles

- Avant de pousser : `swift test` dans `apple/VaultCardsCore` (en CI macOS, le conteneur cloud n'a pas Swift) et, si la
  PWA change, les commandes de `CLAUDE.md`.
- Toute règle métier portée en Swift garde un test qui reprend le cas du test Vitest correspondant.
- Les vecteurs FSRS sont régénérés par un script Node depuis `ts-fsrs` ; un écart d'échéance fait échouer la CI.
