# Création de cartes : manuel, texte, fichiers (décisions du 2026-10-14)

Audit réalisé avec Kyllian. Ce document garde la trace des choix, des coûts et des précautions pour la suite.

## Vision produit
- **Aujourd'hui** : usage personnel.
- **Ensuite** : test par des proches et des amis pour voir s'il y a un marché.
- **Peut-être** : app native Apple (SwiftUI, Liquid Glass) et revenus. On prévoit sans sur-construire.

## Décisions
1. **Saisie manuelle (#54)** : question + réponse + tags (1–2), **sans IA**. L'interface est dessinée par Kyllian (Paper) ; l'app enregistre la carte localement (hors ligne, UUID client) puis la synchronise vers Supabase (client supabase-js, donc l'API REST), comme les révisions. Côté base : type de source (`vault` / `manual`…), droits d'insertion pour `authenticated` protégés par RLS, et `/flashcards` ne touche jamais aux cartes manuelles. Prérequis : #22.
2. **Texte et fichiers par IA, phase gratuite (#55)** : boîte de réception. L'app dépose un texte collé, puis un PDF ou une photo (OCR) dans une file Supabase (table + bucket privé) ; `/flashcards` sur le Mac (Claude Code, abonnement Pro) traite la file, génère les cartes et vide la file. **Limite** : l'abonnement Claude est personnel, cette phase ne sert qu'à Kyllian et à ses tests.
3. **Écran de relecture des cartes générées** (à dessiner par Kyllian) : liste des cartes proposées par l'IA, chacune cliquable et éditable (question, réponse, tags) ; raccourci **« Tout accepter »** pour faire confiance à l'IA ; forme à choisir plus tard (glisser façon Tinder, ou liste / tableau).
4. **L'IA ne touche jamais la base directement** : elle produit un JSON au format imposé, validé par le code (tags de la liste, longueurs, doublons, clés inconnues refusées), puis accepté par l'utilisateur.

## Pipeline recommandé (IA là où elle apporte de la valeur)
| Étape | Qui | Pourquoi |
|---|---|---|
| Récupérer le texte | Code, gratuit : texte collé, couche texte d'un PDF (pdf.js dans le navigateur) | Fiable, aucune invention |
| Lire un scan ou une photo | IA vision | Moins cher qu'un OCR classique et un seul appel |
| Comprendre, créer les cartes, choisir les tags | IA | Le cœur de la valeur |
| Valider et enregistrer | Code + relecture utilisateur | Qualité, protection contre un document piégé |

## Coûts estimés (Claude API, tarifs octobre 2026, à re-mesurer avant de fixer un prix)
Prix par million de tokens : Haiku 5.5 = 0,10 $ entrée / 0,50 $ sortie ; Sonnet 5.5 = 2 $ / 10 $ ; Opus 5.5 = 4 $ / 20 $. API batch : −50 %.

| Génération | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Texte ~3 000 mots, ~20 cartes | ≈ 0,002 $ | ≈ 0,05 $ |
| PDF 20 pages | ≈ 0,005 $ | ≈ 0,10 $ |
| Photo d'une page | < 0,001 $ | ≈ 0,01 $ |

Repères : un OCR classique coûte ≈ 1,50 $ / 1 000 pages (Google Document AI, AWS Textract), Mistral OCR ≈ 1–2 $ / 1 000 pages. Concurrents (RemNote, Knowt, Quizlet, YouLearn) : palier gratuit limité puis ≈ 8–25 $/mois ou packs de crédits (≈ 10 $). Point faible commun : qualité en matières techniques → relecture indispensable.
Recommandation : Haiku 5.5 par défaut ; comparer avec Sonnet 5.5 sur ~20 vraies notes avant de décider.

## Plus tard (produit pour d'autres)
1. **Multi-comptes** (prérequis à toute facturation) : propriétaire (`user_id`) sur cartes, révisions, notes ; RLS par utilisateur ; inscriptions ouvertes. Aujourd'hui la sécurité repose sur « inscriptions fermées ».
2. **Génération par API** : fonction serveur Supabase (Edge Function) qui garde la clé IA (jamais dans l'app), reçoit le document, appelle le modèle et renvoie un brouillon à relire.
3. **Crédits ou abonnement** : registre de crédits en base, débit par génération (pages / tokens), limite quotidienne anti-abus ; Stripe pour la PWA (≈ 3 % + 0,30 $) ; In-App Purchase Apple (15–30 %) si app native sur l'App Store.
4. **Conformité** : informer que les documents partent vers un service d'IA, supprimer les fichiers après traitement, RGPD (export / suppression des données).

## Sécurité à prévoir dès #55
- Bucket privé, formats et taille limités (ex. 10 Mo), fichiers supprimés après traitement.
- Contenu des documents traité comme de la donnée (injection d'instructions possible dans un PDF) ; sortie validée par le code et relue avant enregistrement.
- Caméra : rouvrir `camera=(self)` dans la Permissions-Policy (`vercel.json`, #51) pour la prise de photo ; le choix d'un fichier depuis la galerie n'en a pas besoin.

## Questions encore ouvertes
- Langue des cartes : celle du document, ou toujours le français ?
- Forme de l'écran de relecture (glisser ou liste).
