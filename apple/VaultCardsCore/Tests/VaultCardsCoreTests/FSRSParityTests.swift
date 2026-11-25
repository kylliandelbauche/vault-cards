import XCTest
@testable import VaultCardsCore

/// Le port Swift retrouve exactement les états de ts-fsrs (vecteurs générés par tools/dev/fsrs-vectors.ts).
final class FSRSParityTests: XCTestCase {
    struct Vectors: Decodable {
        struct Snapshot: Decodable {
            let due: Millis
            let stability: Double
            let difficulty: Double
            let state: Int
            let scheduled_days: Int64
            let learning_steps: Int
            let reps: Int
            let lapses: Int
        }
        struct Step: Decodable { let at: Millis; let rating: Int; let card: Snapshot }
        struct Sequence: Decodable { let steps: [Step]; let preview_at: Millis; let preview: [Millis] }
        let sequences: [Sequence]
    }

    func loadVectors() throws -> Vectors {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "fsrs-vectors", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    func testMatchesTsFsrsStepByStep() throws {
        let vectors = try loadVectors()
        XCTAssertGreaterThan(vectors.sequences.count, 0)
        for (n, seq) in vectors.sequences.enumerated() {
            var card = FSRSCard.empty()
            for (i, step) in seq.steps.enumerated() {
                card = scheduler.next(card, now: step.at, grade: try XCTUnwrap(Grade(rawValue: step.rating)))
                let where_ = "séquence \(n), pas \(i)"
                XCTAssertEqual(card.due, step.card.due, "échéance, \(where_)")
                XCTAssertEqual(card.stability, step.card.stability, accuracy: 1e-7, "stabilité, \(where_)")
                XCTAssertEqual(card.difficulty, step.card.difficulty, accuracy: 1e-7, "difficulté, \(where_)")
                XCTAssertEqual(card.state.rawValue, step.card.state, "état, \(where_)")
                XCTAssertEqual(card.scheduledDays, step.card.scheduled_days, "jours prévus, \(where_)")
                XCTAssertEqual(card.learningSteps, step.card.learning_steps, "pas, \(where_)")
                XCTAssertEqual(card.reps, step.card.reps, "répétitions, \(where_)")
                XCTAssertEqual(card.lapses, step.card.lapses, "oublis, \(where_)")
            }
            let preview = previewDue(card, now: seq.preview_at)
            XCTAssertEqual([preview[.again], preview[.hard], preview[.good]], seq.preview.map { Optional($0) }, "aperçu, séquence \(n)")
        }
    }

    func testStateFromReviewsReplaysHistoryInOrder() throws {
        let seq = try XCTUnwrap(try loadVectors().sequences.first { $0.steps.count > 3 })
        // Historique donné dans le désordre : l'état est recalculé dans l'ordre chronologique.
        let reviews = seq.steps.enumerated().reversed().map { i, s in
            Review(id: "r\(i)", cardId: "c", rating: Rating(rawValue: s.rating)!, reviewedAt: s.at)
        }
        XCTAssertEqual(stateFromReviews(reviews).due, seq.steps.last!.card.due)
    }

    func testJsRoundMatchesJavaScript() {
        XCTAssertEqual(jsRound(2.5), 3)
        XCTAssertEqual(jsRound(-2.5), -2)
        XCTAssertEqual(jsRound(-2.6), -3)
        XCTAssertEqual(jsRound(0.49999999999999994), 0)
    }
}
