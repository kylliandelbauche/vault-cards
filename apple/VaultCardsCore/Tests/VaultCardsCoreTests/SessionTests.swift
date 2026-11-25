import XCTest
@testable import VaultCardsCore

/// Mêmes cas que src/lib/session.test.ts (PWA).
final class SessionTests: XCTestCase {
    var calendar = Calendar(identifier: .gregorian)
    // Midi, heure locale du calendrier de test.
    lazy var now: Millis = at(2026, 10, 12, 12, 0)

    override func setUp() {
        calendar.timeZone = TimeZone(identifier: "Europe/Brussels")!
    }

    func at(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int, _ s: Int = 0) -> Millis {
        calendar.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi, second: s))!.millis
    }
    func ago(_ minutes: Int64) -> Millis { now - minutes * minuteMillis }
    func iso(_ s: String) -> Millis { ISOTimestamp.parse(s)! }

    func card(_ id: String, source: CardSource = .vault, status: CardStatus = .active, tags: [String] = ["ia"],
              deletedAt: Millis? = nil, createdAt: Millis? = nil) -> Card {
        Card(id: id, source: source, status: status, front: id, back: id, tags: tags, deletedAt: deletedAt,
             createdAt: createdAt, deck: source == .vault ? "ia" : nil,
             sourcePath: source == .vault ? "3-Resources/veille/ia/\(id).md" : nil)
    }
    func rv(_ cardId: String, _ at: Millis, _ rating: Rating = .good, free: Bool = false) -> Review {
        Review(id: "\(cardId)-\(at)", cardId: cardId, rating: rating, reviewedAt: at, free: free)
    }
    func queue(_ cards: [Card], _ reviews: [Review], at: Millis? = nil, tag: String? = nil) -> [SessionItem] {
        buildQueue(cards, reviews, now: at ?? now, tag: tag, calendar: calendar)
    }
    func freshCount(_ q: [SessionItem]) -> Int { q.filter { $0.state.reps == 0 }.count }

    func testExcludesDeletedAndDrafts() {
        XCTAssertTrue(queue([card("a", deletedAt: iso("2026-10-02T00:00:00Z")), card("b", status: .draft)], []).isEmpty)
    }

    func testDueFirstThenNew() {
        let q = queue([card("new1"), card("old")], [rv("old", iso("2026-09-01T10:00:00Z"))])
        XCTAssertEqual(q.map(\.card.id), ["old", "new1"])
    }

    func testNotYetDueExcluded() {
        XCTAssertTrue(queue([card("a")], [rv("a", ago(1))]).filter { $0.state.due > now }.isEmpty)
    }

    func testNewQuotaCountsCardsSeenToday() {
        let cards = (0..<30).map { card("n\($0)") }
        XCTAssertEqual(freshCount(queue(cards, [rv("n0", ago(120)), rv("n1", ago(119))])), 18)
    }

    func testManualCardsFirstByCreation() {
        let n = iso("2026-10-14T10:00:00Z")
        func manual(_ id: String, _ c: String) -> Card { card(id, source: .manual, createdAt: iso(c)) }
        let q = queue([card("v2"), manual("m-a", "2026-10-14T09:00:00Z"), card("v1"), manual("m-z", "2026-10-14T08:00:00Z"),
                       manual("m-b", "2026-10-14T09:00:00Z")], [], at: n)
        XCTAssertEqual(q.map(\.card.id), ["m-z", "m-a", "m-b", "v1", "v2"])
    }

    func testQuotaUsesLocalDay() {
        let cards = (0..<30).map { card("n\($0)") }
        let late = [rv("n0", at(2026, 10, 12, 23, 59))]
        XCTAssertEqual(freshCount(queue(cards, late, at: at(2026, 10, 12, 23, 59, 30))), 19)
        XCTAssertEqual(freshCount(queue(cards, late, at: at(2026, 10, 13, 0, 1))), 20)
    }

    func testFreeReviewDoesNotUseQuota() {
        let cards = (0..<30).map { card("n\($0)") }
        XCTAssertEqual(freshCount(queue(cards, [rv("n0", ago(10), free: true), rv("n1", ago(9), free: true)])), 20)
        XCTAssertEqual(freshCount(queue(cards, [rv("n0", ago(10)), rv("n0", ago(5), free: true)])), 19)
        XCTAssertEqual(freshCount(queue(cards, [rv("n0", ago(10), free: true), rv("n0", ago(5))])), 20)
    }

    func testCountKinds() {
        let q = queue([card("n"), card("l"), card("d")],
                      [rv("l", ago(60), .again), rv("d", iso("2026-09-01T10:00:00Z")), rv("d", iso("2026-09-01T10:20:00Z"))])
        XCTAssertEqual(countKinds(q), Kinds(new: 1, learn: 1, due: 1))
    }

    func testNextDue() {
        XCTAssertNil(nextDue([card("a")], [], now: now))
        let due = nextDue([card("a")], [rv("a", ago(1))], now: now)
        XCTAssertNotNil(due)
        XCTAssertGreaterThan(due!, now)
    }

    func testFreeQueueAllLiveCardsNoLimit() {
        let cards = (0..<25).map { card("n\($0)") } + [card("gone", deletedAt: now)]
        let q = freeQueue(cards, [rv("n3", ago(1))], now: now)
        XCTAssertEqual(q.count, 25)
        XCTAssertEqual(q.first?.card.id, "n3")
    }

    func testTagScopeWithGlobalQuota() {
        let cards = [card("a", tags: ["IA"]), card("b", tags: ["IA", "Swift"]), card("c", tags: ["Swift"])]
        XCTAssertEqual(Set(queue(cards, [], tag: " ia ").map(\.card.id)), ["a", "b"])
        let many = (0..<25).map { card("s\($0)", tags: ["Swift"]) } + (0..<5).map { card("i\($0)", tags: ["IA"]) }
        let seen = (0..<5).map { rv("i\($0)", ago(Int64(30 - $0))) }
        XCTAssertEqual(freshCount(queue(many, seen, tag: "Swift")), 15)
    }
}
