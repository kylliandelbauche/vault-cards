import Foundation

// Port Swift de ts-fsrs 5.4.2 (MIT, https://github.com/open-spaced-repetition/ts-fsrs), limité à ce qu'utilise l'app :
// FSRS-6, paramètres par défaut, `request_retention` 0.9, sans fuzz, apprentissage court terme activé (BasicScheduler),
// pas d'apprentissage 1m/10m et de réapprentissage 10m. Les calculs suivent l'ordre exact des opérations de ts-fsrs ;
// les vecteurs de Tests/…/Fixtures/fsrs-vectors.json (générés par tools/dev/fsrs-vectors.ts) le vérifient.

public enum FSRSState: Int, Codable, Sendable {
    case new = 0, learning = 1, review = 2, relearning = 3
}

/// Note FSRS. L'app n'utilise que Again, Hard et Good ; Easy sert au calcul des intervalles comme dans ts-fsrs.
public enum Grade: Int, Sendable, CaseIterable {
    case again = 1, hard = 2, good = 3, easy = 4
}

/// État FSRS d'une carte (équivalent du `Card` de ts-fsrs). Instants en millisecondes.
public struct FSRSCard: Equatable, Sendable {
    public var due: Millis
    public var stability: Double
    public var difficulty: Double
    public var elapsedDays: Int64
    public var scheduledDays: Int64
    public var learningSteps: Int
    public var reps: Int
    public var lapses: Int
    public var state: FSRSState
    public var lastReview: Millis?

    /// Carte jamais révisée (`createEmptyCard(new Date(0))` dans la PWA).
    public static func empty(due: Millis = 0) -> FSRSCard {
        FSRSCard(due: due, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 0,
                 lapses: 0, state: .new, lastReview: nil)
    }

    public var dueDate: Date { Date(millis: due) }
}

/// `Math.round` de JavaScript : arrondi à l'entier le plus proche, les demis vers +∞ (-2.5 → -2).
func jsRound(_ x: Double) -> Double {
    let f = x.rounded(.down)
    return x - f >= 0.5 ? f + 1 : f
}

func roundTo(_ x: Double, _ decimals: Int) -> Double {
    let factor = pow(10.0, Double(decimals))
    return jsRound(x * factor) / factor
}

func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(max(v, lo), hi) }

public struct FSRS: Sendable {
    public static let defaultWeights: [Double] = [
        0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
        1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ]
    static let sMin = 0.001
    static let sMax = 36500.0
    /// Bornes des paramètres (CLAMP_PARAMETERS de ts-fsrs, apprentissage court terme activé, 1 pas de réapprentissage).
    static let bounds: [(Double, Double)] = [
        (0.001, 100), (0.001, 100), (0.001, 100), (0.001, 100), (1, 10), (0.001, 4), (0.001, 4), (0.001, 0.75),
        (0, 4.5), (0, 0.8), (0.001, 3.5), (0.001, 5), (0.001, 0.25), (0.001, 0.9), (0, 4), (0, 1), (1, 6), (0, 2),
        (0, 2), (0.01, 0.8), (0.1, 0.8),
    ]

    public let w: [Double]
    public let requestRetention: Double
    public let maximumInterval: Int64 = 36500
    /// Pas d'apprentissage et de réapprentissage, en minutes.
    let learningSteps: [Int64] = [1, 10]
    let relearningSteps: [Int64] = [10]
    let decay: Double
    let factor: Double
    let intervalModifier: Double

    public init(requestRetention: Double = 0.9, weights: [Double] = FSRS.defaultWeights) {
        precondition(weights.count == 21, "FSRS-6 attend 21 paramètres")
        precondition(requestRetention > 0 && requestRetention <= 1, "rétention demandée hors de (0, 1]")
        w = weights.enumerated().map { clamp($0.element, FSRS.bounds[$0.offset].0, FSRS.bounds[$0.offset].1) }
        self.requestRetention = requestRetention
        decay = -w[20]
        factor = roundTo(exp(pow(decay, -1) * log(0.9)) - 1.0, 8)
        intervalModifier = roundTo((pow(requestRetention, 1 / decay) - 1) / factor, 8)
    }

    // MARK: Algorithme (algorithm.ts)

    func forgettingCurve(_ elapsedDays: Double, _ stability: Double) -> Double {
        roundTo(pow(1 + (factor * elapsedDays) / stability, decay), 8)
    }

    func initStability(_ g: Grade) -> Double { max(w[g.rawValue - 1], 0.1) }

    func initDifficulty(_ g: Grade) -> Double {
        roundTo(w[4] - exp(Double(g.rawValue - 1) * w[5]) + 1, 8)
    }

    func nextInterval(_ s: Double) -> Int64 {
        // Sans fuzz : Math.round de l'intervalle déjà entier, donc inchangé.
        min(max(1, Int64(jsRound(s * intervalModifier))), maximumInterval)
    }

    func linearDamping(_ deltaD: Double, _ oldD: Double) -> Double { roundTo((deltaD * (10 - oldD)) / 9, 8) }

    func meanReversion(_ initial: Double, _ current: Double) -> Double {
        roundTo(w[7] * initial + (1 - w[7]) * current, 8)
    }

    func nextDifficulty(_ d: Double, _ g: Grade) -> Double {
        let deltaD = -w[6] * Double(g.rawValue - 3)
        let nextD = d + linearDamping(deltaD, d)
        return clamp(meanReversion(initDifficulty(.easy), nextD), 1, 10)
    }

    func nextRecallStability(_ d: Double, _ s: Double, _ r: Double, _ g: Grade) -> Double {
        let hardPenalty = g == .hard ? w[15] : 1
        let easyBound = g == .easy ? w[16] : 1
        let grown = s * (1 + exp(w[8]) * (11 - d) * pow(s, -w[9]) * (exp((1 - r) * w[10]) - 1) * hardPenalty * easyBound)
        return roundTo(clamp(grown, FSRS.sMin, FSRS.sMax), 8)
    }

    func nextForgetStability(_ d: Double, _ s: Double, _ r: Double) -> Double {
        let value = w[11] * pow(d, -w[12]) * (pow(s + 1, w[13]) - 1) * exp((1 - r) * w[14])
        return roundTo(clamp(value, FSRS.sMin, FSRS.sMax), 8)
    }

    func nextShortTermStability(_ s: Double, _ g: Grade) -> Double {
        let sinc = pow(s, -w[19]) * exp(w[17] * (Double(g.rawValue - 3) + w[18]))
        let masked = g.rawValue >= Grade.hard.rawValue ? max(sinc, 1.0) : sinc
        return roundTo(clamp(s * masked, FSRS.sMin, FSRS.sMax), 8)
    }

    /// Nouvel état mémoire (difficulté, stabilité) après la note `g`, `t` jours après la révision précédente.
    func nextMemory(d: Double, s: Double, t: Int64, g: Grade, r: Double? = nil) -> (difficulty: Double, stability: Double) {
        if d == 0 && s == 0 {
            return (clamp(initDifficulty(g), 1, 10), initStability(g))
        }
        let r = r ?? forgettingCurve(Double(t), s)
        let newS: Double
        if t == 0 {
            newS = nextShortTermStability(s, g)
        } else if g == .again {
            let afterFail = nextForgetStability(d, s, r)
            let nextSMin = s / exp(w[17] * w[18])
            newS = clamp(roundTo(nextSMin, 8), FSRS.sMin, afterFail)
        } else {
            newS = nextRecallStability(d, s, r, g)
        }
        return (nextDifficulty(d, g), newS)
    }

    // MARK: Ordonnanceur (abstract_scheduler.ts, impl/basic_scheduler.ts, strategies/learning_steps.ts)

    /// Jours civils UTC entre deux instants (dateDiffInDays de ts-fsrs).
    static func daysBetween(_ last: Millis, _ current: Millis) -> Int64 {
        floorDiv(current, dayMillis) - floorDiv(last, dayMillis)
    }

    /// Pas d'apprentissage pour chaque note : minutes avant l'échéance et pas suivant.
    func stepsStrategy(state: FSRSState, currentStep: Int) -> [Grade: (minutes: Int64, next: Int)] {
        let steps = state == .relearning || state == .review ? relearningSteps : learningSteps
        guard !steps.isEmpty, currentStep < steps.count else { return [:] }
        if state == .review {
            return [.again: (steps[max(0, currentStep)], 0)]
        }
        var result: [Grade: (minutes: Int64, next: Int)] = [.again: (steps[0], 0)]
        let hard = steps.count == 1
            ? Int64(jsRound(Double(steps[0]) * 1.5))
            : Int64(jsRound(Double(steps[0] + steps[1]) / 2))
        result[.hard] = (hard, currentStep)
        if currentStep + 1 >= 0, currentStep + 1 < steps.count, steps[currentStep + 1] != 0 {
            result[.good] = (steps[currentStep + 1], currentStep + 1)
        }
        return result
    }

    /// Carte après une révision notée `grade` à l'instant `now` (fsrs.next(card, now, grade).card).
    public func next(_ last: FSRSCard, now: Millis, grade: Grade) -> FSRSCard {
        var current = last
        var interval: Int64 = 0
        if last.state != .new, let lastReview = last.lastReview {
            interval = FSRS.daysBetween(lastReview, now)
        }
        current.lastReview = now
        current.elapsedDays = interval
        current.reps += 1

        func nextDS(_ g: Grade, _ r: Double? = nil) -> FSRSCard {
            let m = nextMemory(d: current.difficulty, s: current.stability, t: interval, g: g, r: r)
            var card = current
            card.difficulty = m.difficulty
            card.stability = m.stability
            return card
        }

        func applyLearningSteps(_ card: inout FSRSCard, _ g: Grade, to state: FSRSState) {
            let info = stepsStrategy(state: current.state, currentStep: current.learningSteps)[g]
            let minutes = max(0, info?.minutes ?? 0)
            let nextStep = max(0, info?.next ?? 0)
            if minutes > 0 && minutes < 1440 {
                card.learningSteps = nextStep
                card.scheduledDays = 0
                card.state = state
                card.due = now + minutes * minuteMillis
            } else {
                card.state = .review
                if minutes >= 1440 {
                    card.learningSteps = nextStep
                    card.due = now + minutes * minuteMillis
                    card.scheduledDays = minutes / 1440
                } else {
                    card.learningSteps = 0
                    let days = nextInterval(card.stability)
                    card.scheduledDays = days
                    card.due = now + days * dayMillis
                }
            }
        }

        switch last.state {
        case .new, .learning, .relearning:
            var card = nextDS(grade)
            applyLearningSteps(&card, grade, to: last.state == .new ? .learning : last.state)
            return card
        case .review:
            let r = forgettingCurve(Double(interval), current.stability)
            var again = nextDS(.again, r)
            var hard = nextDS(.hard, r)
            var good = nextDS(.good, r)
            var easy = nextDS(.easy, r)
            var hardDays = nextInterval(hard.stability)
            var goodDays = nextInterval(good.stability)
            hardDays = min(hardDays, goodDays)
            goodDays = max(goodDays, hardDays + 1)
            let easyDays = max(nextInterval(easy.stability), goodDays + 1)
            hard.scheduledDays = hardDays
            hard.due = now + hardDays * dayMillis
            good.scheduledDays = goodDays
            good.due = now + goodDays * dayMillis
            easy.scheduledDays = easyDays
            easy.due = now + easyDays * dayMillis
            hard.state = .review
            hard.learningSteps = 0
            good.state = .review
            good.learningSteps = 0
            easy.state = .review
            easy.learningSteps = 0
            applyLearningSteps(&again, .again, to: .relearning)
            again.lapses += 1
            switch grade {
            case .again: return again
            case .hard: return hard
            case .good: return good
            case .easy: return easy
            }
        }
    }

    /// Échéance de chaque note possible (fsrs.repeat), pour afficher « dans 10 min », « dans 3 j »…
    public func preview(_ card: FSRSCard, now: Millis) -> [Grade: FSRSCard] {
        Dictionary(uniqueKeysWithValues: Grade.allCases.map { ($0, next(card, now: now, grade: $0)) })
    }
}
