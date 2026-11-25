import SwiftData
import SwiftUI
import VaultCardsCore

/// Session de révision : question, puis réponse, puis une note parmi À revoir / Difficile / Correct.
struct ReviewSessionView: View {
    /// Révision libre (« Réviser à nouveau ») : les notes sont marquées `free`.
    let free: Bool
    /// Session limitée à un tag (titre seulement).
    let tag: String?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    /// File restante : la carte affichée est la première. Une carte notée « À revoir » revient en fin de file (PWA).
    @State private var queue: [SessionItem]
    /// Historique connu (toutes les révisions), complété à chaque note pour recalculer l'état d'une carte remise en file.
    @State private var history: [Review]
    @State private var done = 0
    @State private var showBack = false

    init(items: [SessionItem], reviews: [Review], free: Bool, tag: String? = nil) {
        self.free = free
        self.tag = tag
        _queue = State(initialValue: items)
        _history = State(initialValue: reviews)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let item = queue.first {
                    card(item)
                } else {
                    ContentUnavailableView("Session terminée", systemImage: "checkmark.circle",
                                           description: Text("\(done) révision\(done > 1 ? "s" : "")."))
                }
            }
            .padding()
            .navigationTitle(queue.isEmpty ? "Terminé" : "Reste \(queue.count)")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                if let tag {
                    ToolbarItem(placement: .principal) {
                        Text(queue.isEmpty ? tag : "\(tag) · reste \(queue.count)").font(.headline)
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 520)
        #endif
    }

    @ViewBuilder
    private func card(_ item: SessionItem) -> some View {
        VStack(spacing: 20) {
            if let tag = item.card.tags.first {
                Text(tag).font(.caption).padding(.horizontal, 10).padding(.vertical, 4)
                    .background(.quaternary, in: Capsule())
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(item.card.front).font(.title3.weight(.semibold))
                    if showBack {
                        Divider()
                        Text(item.card.back)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            }
            if showBack {
                let now = Date.now.millis
                let due = previewDue(item.state, now: now)
                HStack(spacing: 12) {
                    ForEach(Rating.allCases, id: \.self) { rating in
                        Button {
                            rate(item, rating)
                        } label: {
                            VStack(spacing: 2) {
                                Text(rating.label).font(.headline)
                                Text(delayLabel(from: now, to: due[rating] ?? now)).font(.caption)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                        // Clavier (Mac, iPad) : 1 À revoir, 2 Difficile, 3 Correct, comme la PWA.
                        .keyboardShortcut(KeyEquivalent(Character(String(rating.rawValue))), modifiers: [])
                        .tint(rating == .again ? .red : rating == .hard ? .orange : .green)
                    }
                }
            } else {
                Button {
                    showBack = true
                } label: {
                    Text("Voir la réponse").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.space, modifiers: [])
            }
        }
    }

    private func rate(_ item: SessionItem, _ rating: Rating) {
        let review = Review(id: UUID().uuidString.lowercased(), cardId: item.card.id, rating: rating,
                            reviewedAt: Date.now.millis, free: free)
        context.insert(StoredReview(review))
        try? context.save()
        history.append(review)
        queue = afterRating(queue, rating: rating, cardHistory: history.filter { $0.cardId == item.card.id })
        done += 1
        showBack = false
    }
}
