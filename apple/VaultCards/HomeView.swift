import SwiftData
import SwiftUI
import VaultCardsCore

struct HomeView: View {
    @Query private var storedCards: [StoredCard]
    @Query private var storedReviews: [StoredReview]
    @State private var session: Session?

    struct Session: Identifiable {
        let id = UUID()
        let items: [SessionItem]
        let reviews: [Review]
        let free: Bool
    }

    var body: some View {
        // Recalculé à chaque affichage : une révision ou une carte ajoutée met l'accueil à jour.
        let cards = storedCards.map(\.card)
        let reviews = storedReviews.compactMap(\.review)
        let now = Date.now.millis
        let queue = buildQueue(cards, reviews, now: now)
        let kinds = countKinds(queue)
        return NavigationStack {
            VStack(spacing: 24) {
                HStack(spacing: 16) {
                    Counter(value: kinds.new, label: "Nouvelles", color: .blue)
                    Counter(value: kinds.learn, label: "En cours", color: .orange)
                    Counter(value: kinds.due, label: "À revoir", color: .green)
                }
                if !queue.isEmpty {
                    Button {
                        session = Session(items: queue, reviews: reviews, free: false)
                    } label: {
                        Text("Réviser (\(queue.count))").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                } else if cards.contains(where: \.isLive) {
                    VStack(spacing: 12) {
                        Text("Tout est révisé pour l'instant.").font(.headline)
                        if let due = nextDue(cards, reviews, now: now) {
                            Text("Prochaine carte dans \(delayLabel(from: now, to: due)).").foregroundStyle(.secondary)
                        }
                        Button("Réviser à nouveau") {
                            session = Session(items: freeQueue(cards, reviews, now: now), reviews: reviews, free: true)
                        }
                        .buttonStyle(.bordered)
                    }
                } else {
                    ContentUnavailableView("Aucune carte", systemImage: "rectangle.stack.badge.plus",
                                           description: Text("Crée ta première carte dans « Mes cartes »."))
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Vault Cards")
            .sheet(item: $session) { s in
                ReviewSessionView(items: s.items, reviews: s.reviews, free: s.free)
            }
        }
    }
}

private struct Counter: View {
    let value: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text("\(value)").font(.largeTitle.bold()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }
}
