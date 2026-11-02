# Vault Cards

> 🚧 **Projet en construction.** Vault Cards sert d'abord à un usage personnel. Il n'y a pas encore de guide d'installation.

Application de flashcards à répétition espacée (FSRS), pensée pour l'iPhone. Elle fonctionne hors ligne et se synchronise avec Supabase. Les cartes viennent de notes Obsidian, de documents, de textes, de photos ou de vocaux, et peuvent aussi s'écrire à la main.

<p align="center">
  <img src="docs/screenshots/accueil.png" width="200" alt="Accueil : cartes du jour, sources et tags">
  <img src="docs/screenshots/revision.png" width="200" alt="Révision d'une carte et notation">
  <img src="docs/screenshots/nouvelles-cartes.png" width="200" alt="Création de cartes depuis plusieurs sources">
  <img src="docs/screenshots/mes-cartes.png" width="200" alt="Mes cartes, filtrées par document">
</p>

<p align="center"><sub>Maquettes de l'application, avec des données fictives.</sub></p>

## Fonctionnalités

- **Révision FSRS** : file du jour, révision libre, étude par tag ou par liste filtrée.
- **Hors ligne** : PWA installable, cache local, synchronisation au retour du réseau.
- **Création de cartes** : à la main, ou depuis un fichier, une photo, un texte ou un vocal.
- **Relecture avant ajout** : les cartes générées depuis la boîte de réception arrivent en brouillon, à valider dans l'app.
- **Gestion** : recherche, tags libres, modification et suppression.
- **Notes Obsidian** : l'outil `tools/cards` et le skill Claude Code `/flashcards` transforment des synthèses en cartes.

L'interface est en français.

## Stack

React 19, TypeScript, Vite, Konsta UI, Tailwind CSS 4, Dexie (IndexedDB), ts-fsrs, Supabase (Postgres, Auth, Storage).

## Vérifications

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Documentation

- [Spécification](docs/specs/2026-10-12-vault-cards-design.md)
- [Audit de sécurité](docs/security-checklist.md)
- [Restauration d'une sauvegarde](docs/restore.md)
- [Skill `/flashcards`](skill/flashcards/SKILL.md)

## Licence

[MIT](LICENSE)
