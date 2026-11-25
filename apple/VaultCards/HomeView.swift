import SwiftData
import SwiftUI
import VaultCardsCore

struct HomeView: View {
    @Query private var storedCards: [StoredCard]
    @Query private var storedReviews: [StoredReview]
    @State private var session: Session?
    @Environment(\.modelContext) private var context
    @Environment(SyncService.self) private var sync

    struct Session: Identifiable {
        let id = UUID()
        let items: [SessionItem]
        let reviews: [Review]
        let free: Bool
        var tag: String?
    }

    var body: some View {
        // Recalculé à chaque affichage : une révision ou une carte ajoutée met l'accueil à jour.
        let cards = storedCards.map(\.card)
        let reviews = storedReviews.compactMap(\.review)
        let now = Date.now.millis
        let queue = buildQueue(cards, reviews, now: now)
        let kinds = countKinds(queue)
        let allTags = tagCounts(cards, reviews, now: now)
        let tags = Tags.shortcuts(allTags)
        let study: (String) -> Void = { tag in
            let due = buildQueue(cards, reviews, now: now, tag: tag)
            // Rien à revoir dans ce tag aujourd'hui : révision libre du tag, comme « Réviser à nouveau ».
            session = due.isEmpty
                ? Session(items: freeQueue(cards, reviews, now: now, tag: tag), reviews: reviews, free: true, tag: tag)
                : Session(items: due, reviews: reviews, free: false, tag: tag)
        }
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
                }
                if !tags.isEmpty {
                    TagShortcuts(tags: tags, study: study) {
                        TagsView(tags: allTags, today: queue.count, study: study)
                    }
                }
                if !cards.contains(where: \.isLive) {
                    ContentUnavailableView("Aucune carte", systemImage: "rectangle.stack.badge.plus",
                                           description: Text("Crée ta première carte dans « Mes cartes »."))
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Vault Cards")
            .sheet(item: $session, onDismiss: { sync.soon(context) }) { s in
                ReviewSessionView(items: s.items, reviews: s.reviews, free: s.free, tag: s.tag)
            }
        }
    }
}

/// « Mes tags » : tags non vides, triés par nombre de cartes ; un tap lance la session du tag. Le titre ouvre la page
/// de tous les tags.
private struct TagShortcuts<Destination: View>: View {
    let tags: [TagCount]
    let study: (String) -> Void
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink {
                destination()
            } label: {
                HStack {
                    Text("Mes tags").font(.headline)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tags, id: \.name) { tag in
                        Button { study(tag.name) } label: {
                            HStack(spacing: 6) {
                                Text(tag.name)
                                Text(tag.today > 0 ? "\(tag.today)" : "✓").foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel(tag.today > 0
                            ? "\(tag.name), \(tag.today) à revoir"
                            : "\(tag.name), à jour")
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
