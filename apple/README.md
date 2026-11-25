# Vault Cards natif (Mac + iPhone)

Spec : `docs/specs/2026-11-25-app-apple-native.md` · Plan : `docs/plans/2026-11-25-app-apple-native.md`

- `VaultCardsCore/` : paquet Swift (Foundation seule) — FSRS (port de ts-fsrs, MIT), file de session, format du dossier
  de synchro et fusion. Tests : `cd apple/VaultCardsCore && swift test` (Xcode 16 ou Swift 5.10+).
- Vecteurs FSRS : `node tools/dev/fsrs-vectors.ts` régénère `Tests/VaultCardsCoreTests/Fixtures/fsrs-vectors.json`.
