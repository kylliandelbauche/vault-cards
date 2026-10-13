# Identité visuelle : icônes Vault Cards

Style : cartes en verre empilées, façon Liquid Glass. Ce dossier contient les **sources** (non servies par l'app).

| Dossier | Statut |
|---|---|
| `bleu/` | **Icône actuelle** de l'app |
| `vert/` | Variante gardée en réserve |

Chaque dossier contient :

- `app-icon-1024.png` : plein cadre, sans transparence. Source de l'icône iOS (apple-touch-icon) et de l'icône Android « maskable » : le système applique lui-même ses coins arrondis.
- `logo-transparent-1024.png` : carré arrondi détouré (fond transparent). Source du favicon et des icônes PWA « any ».
- `apple-touch-icon-180.png` : version 180 × 180 fournie (référence ; l'app régénère la sienne depuis `app-icon-1024.png`).

## Régénérer les icônes de `public/` (macOS)

```bash
B=design/brand/bleu
for s in 64 192 512; do sips -z $s $s $B/logo-transparent-1024.png --out public/pwa-${s}x${s}.png; done
sips -z 512 512 $B/app-icon-1024.png --out public/maskable-icon-512x512.png
sips -z 180 180 $B/app-icon-1024.png --out public/apple-touch-icon-180x180.png
T=$(mktemp -d) && sips -z 48 48 $B/logo-transparent-1024.png --out "$T/f.png" && sips -s format ico "$T/f.png" --out public/favicon.ico && rm -rf -- "$T"
```
