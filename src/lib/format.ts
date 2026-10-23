const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

export function formatInterval(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime()
  if (ms < MIN) return '< 1 min'
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`
  const days = Math.round(ms / DAY)
  if (days < 30) return `${days} j`
  if (days < 365) return `${Math.round(days / 30)} mois`
  return `${(days / 365).toFixed(1).replace('.', ',')} an`
}

/**
 * « il y a 5 min », « il y a 2 h », « il y a 3 j », « il y a 2 mois », « il y a 1 an » (arrondis vers le bas) ;
 * « à l'instant » sous la minute ou si l'horloge de l'appareil est en retard sur la date. Date invalide : chaîne
 * vide (rien à afficher plutôt qu'un faux « à l'instant »).
 */
export function formatAgo(at: Date, now: Date): string {
  const ms = now.getTime() - at.getTime()
  if (Number.isNaN(ms)) return ''
  if (ms < MIN) return "à l'instant"
  if (ms < HOUR) return `il y a ${Math.floor(ms / MIN)} min`
  if (ms < DAY) return `il y a ${Math.floor(ms / HOUR)} h`
  const days = Math.floor(ms / DAY)
  if (days < 30) return `il y a ${days} j`
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`
  const years = Math.floor(days / 365)
  return `il y a ${years} ${years > 1 ? 'ans' : 'an'}`
}
