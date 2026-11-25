import Foundation

/// Réglages FSRS de l'app, identiques à la PWA (src/lib/scheduler.ts).
public let scheduler = FSRS(requestRetention: 0.9)

/// État FSRS recalculé depuis l'historique d'une carte (révisions de tous les appareils). Ordre : instant, puis id
/// (deux révisions au même instant restent dans le même ordre sur tous les appareils).
public func stateFromReviews(_ reviews: [Review]) -> FSRSCard {
    reviews.sorted { ($0.reviewedAt, $0.id) < ($1.reviewedAt, $1.id) }
        .reduce(FSRSCard.empty()) { scheduler.next($0, now: $1.reviewedAt, grade: $1.rating.grade) }
}

/// Échéance de chaque note possible depuis cet état.
public func previewDue(_ state: FSRSCard, now: Millis) -> [Rating: Millis] {
    let p = scheduler.preview(state, now: now)
    return Dictionary(uniqueKeysWithValues: Rating.allCases.map { ($0, p[$0.grade]!.due) })
}

public struct SessionItem: Equatable, Sendable {
    public var card: Card
    public var state: FSRSCard
}

/// Nombre maximal de nouvelles cartes introduites par jour (quota global, tous tags confondus).
public let newPerDay = 20

public func byCard(_ reviews: [Review]) -> [String: [Review]] {
    Dictionary(grouping: reviews, by: \.cardId)
}

/// Cartes vivantes avec leur état FSRS.
public func scheduleItems(_ cards: [Card], _ grouped: [String: [Review]]) -> [SessionItem] {
    cards.filter(\.isLive).map { SessionItem(card: $0, state: stateFromReviews(grouped[$0.id] ?? [])) }
}

/// Cartes introduites aujourd'hui (jour local) : première note aujourd'hui, hors révision libre.
func introducedToday(_ grouped: [String: [Review]], now: Millis, calendar: Calendar) -> Int {
    grouped.values.filter { rs in
        guard let first = rs.min(by: { $0.reviewedAt < $1.reviewedAt }) else { return false }
        return !first.free && calendar.isDate(Date(millis: first.reviewedAt), inSameDayAs: Date(millis: now))
    }.count
}

/// Ordre des nouvelles : cartes sans note source d'abord (ordre de création), puis par note source, puis id.
func freshOrder(_ a: SessionItem, _ b: SessionItem) -> Bool {
    let pa = a.card.sourcePath ?? "", pb = b.card.sourcePath ?? ""
    if pa != pb { return pa < pb }
    if a.card.source != .vault && b.card.source != .vault {
        let ca = a.card.createdAt ?? Millis.min, cb = b.card.createdAt ?? Millis.min
        if ca != cb { return ca < cb }
    }
    return a.card.id < b.card.id
}

/// File du jour : dues (échéance la plus ancienne d'abord), puis nouvelles dans le quota restant. Avec `tag`, seules
/// les cartes du tag ; le quota reste global.
public func queueOf(_ items: [SessionItem], _ grouped: [String: [Review]], now: Millis, newLimit: Int = newPerDay,
                    tag: String? = nil, calendar: Calendar = .current) -> [SessionItem] {
    let scoped = tag.map { t in items.filter { $0.card.hasTag(t) } } ?? items
    let due = scoped.filter { $0.state.state != .new && $0.state.due <= now }.sorted { $0.state.due < $1.state.due }
    let remaining = max(0, newLimit - introducedToday(grouped, now: now, calendar: calendar))
    let fresh = scoped.filter { $0.state.state == .new }.sorted(by: freshOrder).prefix(remaining)
    return due + fresh
}

/// Session normale : cartes dues + nouvelles du jour.
public func buildQueue(_ cards: [Card], _ reviews: [Review], now: Millis, newLimit: Int = newPerDay, tag: String? = nil,
                       calendar: Calendar = .current) -> [SessionItem] {
    let grouped = byCard(reviews)
    return queueOf(scheduleItems(cards, grouped), grouped, now: now, newLimit: newLimit, tag: tag, calendar: calendar)
}

/// Révision libre : toutes les cartes vivantes (du tag), dues ou non, sans limite de nouvelles. Déjà vues d'abord
/// (échéance la plus proche), puis nouvelles dans l'ordre habituel.
public func freeQueue(_ cards: [Card], _ reviews: [Review], now: Millis, tag: String? = nil) -> [SessionItem] {
    let grouped = byCard(reviews)
    let items = scheduleItems(cards, grouped).filter { tag == nil || $0.card.hasTag(tag!) }
    let seen = items.filter { $0.state.state != .new }.sorted { $0.state.due < $1.state.due }
    let fresh = items.filter { $0.state.state == .new }.sorted(by: freshOrder)
    return seen + fresh
}

public struct Kinds: Equatable, Sendable {
    public var new = 0, learn = 0, due = 0
}

public func countKinds(_ items: [SessionItem]) -> Kinds {
    var k = Kinds()
    for item in items {
        switch item.state.state {
        case .new: k.new += 1
        case .learning, .relearning: k.learn += 1
        case .review: k.due += 1
        }
    }
    return k
}

/// Prochaine échéance future parmi les cartes déjà vues (du tag), nil s'il n'y en a pas.
public func nextDue(_ cards: [Card], _ reviews: [Review], now: Millis, tag: String? = nil) -> Millis? {
    let grouped = byCard(reviews)
    return cards.filter { $0.isLive && grouped[$0.id] != nil && (tag == nil || $0.hasTag(tag!)) }
        .map { stateFromReviews(grouped[$0.id]!).due }
        .filter { $0 > now }
        .min()
}
