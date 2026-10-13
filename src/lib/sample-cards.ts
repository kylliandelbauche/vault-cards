import type { Card } from './types'

const RAW: [path: string, front: string, back: string][] = [
  ['Réseaux/HTTP.md', 'Que signifie le code HTTP 404 ?', "La ressource demandée n'existe pas sur le serveur (Not Found)."],
  ['Réseaux/HTTP.md', 'Différence entre 401 et 403 ?', '401 : non authentifié. 403 : authentifié mais pas autorisé.'],
  ['Réseaux/Modèle OSI.md', 'Combien de couches compte le modèle OSI ?', '7 : physique, liaison, réseau, transport, session, présentation, application.'],
  ['Réseaux/TCP-UDP.md', 'TCP ou UDP pour du streaming vidéo en direct ?', "UDP : pas de retransmission, latence faible ; une image perdue vaut mieux qu'un retard."],
  ['BDD/SQL.md', 'Que fait un LEFT JOIN ?', 'Garde toutes les lignes de la table de gauche, avec les correspondances de droite ou NULL.'],
  ['BDD/SQL.md', 'À quoi sert GROUP BY ?', 'Regrouper les lignes par valeur pour appliquer des agrégats (COUNT, SUM, AVG…).'],
  ['BDD/Normalisation.md', 'Condition de la 1re forme normale (1FN) ?', 'Chaque attribut contient une valeur atomique, sans groupe répétitif.'],
  ['Dev/Git.md', 'Différence entre git merge et git rebase ?', "merge crée un commit de fusion ; rebase réécrit l'historique en rejouant les commits au-dessus de la cible."],
  ['Dev/Big O.md', "Complexité d'une recherche dichotomique ?", "O(log n) : l'espace de recherche est divisé par deux à chaque étape."],
  ['Mendix/Microflows.md', "Microflow ou nanoflow : lequel s'exécute côté client ?", "Le nanoflow s'exécute dans le client ; le microflow sur le serveur."],
  ['Sécurité/OWASP.md', "Qu'est-ce qu'une injection SQL ?", 'Insertion de code SQL via une entrée utilisateur non filtrée. Parade : requêtes paramétrées.'],
  ['Méthodo/Scrum.md', "Durée habituelle d'un sprint Scrum ?", 'Fixe, 1 mois maximum ; souvent 2 semaines.'],
]

export const SAMPLE_CARDS: Card[] = RAW.map(([source_path, front, back], i) => ({
  id: `sample-${i}`,
  deck: source_path.split('/')[0],
  source_path,
  tags: [],
  front,
  back,
  updated_at: '2026-10-12T00:00:00Z',
  deleted_at: null,
}))
