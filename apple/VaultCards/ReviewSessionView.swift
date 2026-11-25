import SwiftData
import SwiftUI
import VaultCardsCore

/// Session de révision : question, puis réponse, puis une note parmi À revoir / Difficile / Correct.
struct ReviewSessionView: View {
    let items: [SessionItem]
    /// Révision libre (« Réviser à nouveau ») : les notes sont marquées `free`.
    let free: Bool

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0
    @State private var showBack = false

    var body: some View {
        NavigationStack {
            Group {
                if index < items.count {
                    card(items[index])
                } else {
                    ContentUnavailableView("Session terminée", systemImage: "checkmark.circle",
                                           description: Text("\(items.count) carte\(items.count > 1 ? "s" : "") révisée\(items.count > 1 ? "s" : "")."))
                }
            }
            .padding()
            .navigationTitle(index < items.count ? "\(index + 1) / \(items.count)" : "Terminé")
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
        showBack = false
        index += 1
    }
}
