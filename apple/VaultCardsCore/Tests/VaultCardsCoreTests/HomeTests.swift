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
}
