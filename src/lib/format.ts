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
