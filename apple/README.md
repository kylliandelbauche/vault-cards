# Vault Cards natif (Mac + iPhone)

Spec : `docs/specs/2026-11-25-app-apple-native.md` · Plan : `docs/plans/2026-11-25-app-apple-native.md`

- `VaultCardsCore/` : paquet Swift (Foundation seule) — FSRS (port de ts-fsrs, MIT), file de session, format du dossier
  de synchro et fusion. Tests : `cd apple/VaultCardsCore && swift test` (Xcode 16 ou Swift 5.10+).
- Vecteurs FSRS : `node tools/dev/fsrs-vectors.ts` régénère `Tests/VaultCardsCoreTests/Fixtures/fsrs-vectors.json`.
- `VaultCards/` + `project.yml` : app SwiftUI Mac + iPhone. Ouvrir dans Xcode :
  `brew install xcodegen && cd apple && xcodegen && open VaultCards.xcodeproj`, choisir son équipe dans
  « Signing & Capabilities », puis lancer sur l'iPhone ou le Mac.
- Synchro : onglet « Synchro », choisir le même dossier (iCloud Drive, Google Drive…) sur chaque appareil. L'app y
  écrit `VaultCards/` (format v1 de la spec) ; la base locale reste hors de ce dossier. Au premier plan, l'app
  surveille le dossier (`NSFilePresenter`) : un changement d'un autre appareil est lu en quelques secondes, sinon à la
  synchro de secours, une par minute.
- Import depuis la PWA : sur le Mac, `node tools/export/cli.ts <dossier choisi dans l'app>` (lit Supabase avec la clé
  secrète de `.env.local`, sans rien y modifier) ; l'app reçoit cartes et historique à sa synchro suivante.
- Cartes depuis une note : onglet « Générer », saisir sa clé API Anthropic (gardée dans le trousseau), choisir une
  note Markdown ; les cartes proposées arrivent en brouillons à accepter, modifier ou rejeter.
- Boîte de réception : même onglet, écrire, dicter (transcrit sur l'appareil) ou joindre une photo, puis « Envoyer à
  l'IA » ; les cartes arrivent en brouillons.
- Icône : sources dans `apple/design/` (`icon-ios.svg` plein cadre, `icon-macos.svg` avec la forme et la marge du Mac),
  exportées en PNG dans `VaultCards/Assets.xcassets/AppIcon.appiconset` (iOS 1024 sans transparence, Mac 16 à 1024).
