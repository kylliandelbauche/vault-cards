import XCTest
@testable import VaultCardsCore

/// Mêmes cas que « homeStats : tags » de src/lib/home.test.ts (sans registre : l'app native n'en a pas).
final class HomeTests: XCTestCase {
    var calendar = Calendar(identifier: .gregorian)
    lazy var now: Millis = calendar.date(from: DateComponents(year: 2026, month: 10, day: 12, hour: 12))!.millis

    override func setUp() {
        calendar.timeZone = TimeZone(identifier: "Europe/Brussels")!
    }

    func ago(_ minutes: Int64) -> Millis { now - minutes * minuteMillis }
    func iso(_ s: String) -> Millis { ISOTimestamp.parse(s)! }
    func card(_ id: String, source: CardSource = .vault, status: CardStatus = .active, tags: [String],
              deletedAt: Millis? = nil) -> Card {
        Card(id: id, source: source, status: status, front: id, back: id, tags: tags, deletedAt: deletedAt,
             deck: source == .vault ? "ia" : nil, sourcePath: source == .vault ? "x/\(id).md" : nil)
    }
    func rv(_ cardId: String, _ at: Millis) -> Review {
        Review(id: "\(cardId)-\(at)", cardId: cardId, rating: .good, reviewedAt: at, free: false)
    }
    func queue(_ cards: [Card], _ reviews: [Review], tag: String) -> [SessionItem] {
        buildQueue(cards, reviews, now: now, tag: tag, calendar: calendar)
    }

    func counts(_ cards: [Card], _ reviews: [Review]) -> [String: TagCount] {
        Dictionary(uniqueKeysWithValues: tagCounts(cards, reviews, now: now, calendar: calendar).map { ($0.name, $0) })
    }
    func tag(_ name: String, _ total: Int) -> TagCount { TagCount(name: name, total: total, today: 0) }

    func testTagsOfLiveCardsAZAndCardWithTwoTagsCountsInBoth() {
        let cs = [card("a", tags: ["ia", "dev"]), card("b", tags: ["IA"]), card("c", tags: ["ia", "ia"]),
                  card("d", tags: ["zz"], deletedAt: iso("2026-10-02T00:00:00Z"))]
        XCTAssertEqual(tagCounts(cs, [], now: now, calendar: calendar).map(\.name), ["dev", "ia"])
        XCTAssertEqual(counts(cs, []).mapValues(\.total), ["ia": 3, "dev": 1])
    }

    func testTodayIsTheTagQueue() {
        let cs = [card("a", tags: ["ia"]), card("b", tags: ["ia", "dev"]), card("c", tags: ["dev"])]
        XCTAssertEqual(counts(cs, [rv("c", ago(1))]).mapValues(\.today), ["ia": 2, "dev": 1])
    }

    func testTodayMatchesTheTagSession() {
        let cs = [card("d", tags: ["dev", "ia"]), card("n1", tags: ["ia"]), card("later", tags: ["culture"])]
        let rs = [rv("d", iso("2026-09-01T10:00:00Z")), rv("later", ago(1))]
        for t in tagCounts(cs, rs, now: now, calendar: calendar) {
            XCTAssertEqual(t.today, queue(cs, rs, tag: t.name).count, t.name)
        }
    }

    func testNewQuotaStaysGlobal() {
        let cs = (0..<25).map { card("n\($0)", tags: ["ia"]) } + [card("x", tags: ["dev"])]
        XCTAssertEqual(counts(cs, [rv("x", ago(30))])["ia"]?.today, 19)
    }

    func testSortByCountThenAZ() {
        let sorted = Tags.sorted([tag("ia", 2), tag("dev", 5), tag("securite", 0), tag("marketing", 2), tag("argent", 0)])
        XCTAssertEqual(sorted.map(\.name), ["dev", "ia", "marketing", "argent", "securite"])
    }

    func testShortcutsKeepOnlyNonEmptyTags() {
        XCTAssertEqual(Tags.shortcuts([tag("ia", 2), tag("dev", 5), tag("securite", 0)]).map(\.name), ["dev", "ia"])
    }

    func testFrenchOrderIgnoresCaseAndAccents() {
        XCTAssertEqual(["Culture", "cerveau", "Argent", "écologie"].sorted(by: Tags.byName),
                       ["Argent", "cerveau", "Culture", "écologie"])
    }

    func testDraftCountsNowhere() {
        let cs = [card("a", tags: ["ia"]), card("d", source: .inbox, status: .draft, tags: ["dev"])]
        XCTAssertEqual(counts(cs, []).keys.sorted(), ["ia"])
    }

    func rv(_ cardId: String, _ at: Millis, _ rating: Rating, free: Bool = false) -> Review {
        Review(id: "\(cardId)-\(at)", cardId: cardId, rating: rating, reviewedAt: at, free: free)
    }
    func day(_ cards: [Card], _ reviews: [Review]) -> DayCounts { dayCounts(cards, reviews, now: now, calendar: calendar) }
    /// « Très bien » espacés : chaque note tombe à l'échéance de la précédente.
    func goodStreak(_ id: String, _ start: Millis, _ n: Int) -> [Review] {
        var out: [Review] = []
        var at = start
        for _ in 0..<n {
            out.append(rv(id, at))
            at = stateFromReviews(out).due
        }
        return out
    }

    func testDueIsSeenAndOverdueNeverDeleted() {
        let s = day([card("due", tags: ["ia"]), card("later", tags: ["ia"]),
                     card("gone", tags: ["ia"], deletedAt: iso("2026-10-02T00:00:00Z"))],
                    [rv("due", iso("2026-09-01T10:00:00Z")), rv("later", ago(1)), rv("gone", iso("2026-09-01T10:00:00Z"))])
        XCTAssertEqual(s.due, 1)
        XCTAssertEqual(s.total, 2)
    }

    func testFreshIsCappedAtTwentyMinusSeenToday() {
        let cs = (0..<30).map { card("n\($0)", tags: ["ia"]) }
        XCTAssertEqual(day(cs, []).fresh, 20)
        XCTAssertEqual(day(cs, [rv("n0", ago(120)), rv("n1", ago(119))]).fresh, 18)
        XCTAssertEqual(day(Array(cs.prefix(5)), []).fresh, 5)
    }

    func testFreeReviewsKeepTheQuota() {
        let cs = (0..<30).map { card("n\($0)", tags: ["ia"]) }
        let free = [rv("n0", ago(120), .good, free: true), rv("n1", ago(119), .good, free: true)]
        let s = day(cs, free)
        XCTAssertEqual(s.fresh, 20)
        XCTAssertEqual(s.today, buildQueue(cs, free, now: now, calendar: calendar).count)
    }

    func testTodayIsTheSessionQueue() {
        let cs = (0..<25).map { card("n\($0)", tags: ["ia"]) } + [card("d1", tags: ["ia"]), card("d2", tags: ["ia"])]
        let rs = [rv("d1", iso("2026-09-01T10:00:00Z")), rv("d2", iso("2026-09-02T10:00:00Z")), rv("n0", ago(120))]
        let s = day(cs, rs)
        XCTAssertEqual(s.today, buildQueue(cs, rs, now: now, calendar: calendar).count)
        XCTAssertEqual(s.today, s.due + s.fresh)
    }

    func testMasteredIsReviewStateWithStabilityOf21Days() {
        let long = goodStreak("m", iso("2026-01-01T10:00:00Z"), 6)
        let short = goodStreak("s", iso("2026-10-01T10:00:00Z"), 2)
        XCTAssertGreaterThanOrEqual(stateFromReviews(long).stability, masteredStabilityDays)
        XCTAssertLessThan(stateFromReviews(short).stability, masteredStabilityDays)
        XCTAssertEqual(day([card("m", tags: ["ia"]), card("s", tags: ["ia"]), card("n", tags: ["ia"])], long + short).mastered, 1)
    }

    func testRelearningIsNotMastered() {
        let long = goodStreak("m", iso("2026-01-01T10:00:00Z"), 6)
        let lapse = long + [rv("m", stateFromReviews(long).due + 1000, .again)]
        XCTAssertFalse(isMastered(stateFromReviews(lapse)))
    }

    func testNextDueIsTheNearestUpcomingOrNil() {
        XCTAssertNil(day([card("a", tags: ["ia"])], []).nextDueAt)
        XCTAssertGreaterThan(day([card("a", tags: ["ia"])], [rv("a", ago(1))]).nextDueAt ?? 0, now)
    }
}
