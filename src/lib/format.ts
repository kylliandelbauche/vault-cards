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
 * « il y a 5 min », « il y a 2 h », « il y a 3 j » (minutes, heures, jours, arrondis vers le bas) ; « à l'instant »
 * sous la minute ou si l'horloge de l'appareil est en retard sur la date.
 */
export function formatAgo(at: Date, now: Date): string {
  const ms = now.getTime() - at.getTime()
  if (!(ms >= MIN)) return "à l'instant"
  if (ms < HOUR) return `il y a ${Math.floor(ms / MIN)} min`
  if (ms < DAY) return `il y a ${Math.floor(ms / HOUR)} h`
  return `il y a ${Math.floor(ms / DAY)} j`
}
