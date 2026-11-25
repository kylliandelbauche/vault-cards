import Foundation
import VaultCardsCore

/// Délai lisible jusqu'à une échéance : « 1 min », « 10 min », « 3 h », « 4 j », « 2 mois », « 1 an ».
func delayLabel(from now: Millis, to due: Millis) -> String {
    let minutes = max(1, Int((Double(due - now) / 60_000).rounded()))
    if minutes < 60 { return "\(minutes) min" }
    let hours = Int((Double(minutes) / 60).rounded())
    if hours < 24 { return "\(hours) h" }
    let days = Int((Double(hours) / 24).rounded())
    if days < 31 { return "\(days) j" }
    let months = Int((Double(days) / 30.4).rounded())
    if months < 12 { return "\(months) mois" }
    let years = Int((Double(days) / 365).rounded())
    return years == 1 ? "1 an" : "\(years) ans"
}

/// Libellés des notes, ceux de la PWA (RatingBar.tsx).
extension Rating {
    var label: String {
        switch self {
        case .again: return "Je ne sais pas"
        case .hard: return "Moyen"
        case .good: return "Très bien"
        }
    }
}
