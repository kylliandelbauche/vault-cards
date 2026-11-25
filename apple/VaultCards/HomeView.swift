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
        let day = dayCounts(cards, reviews, now: now)
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
                if day.total > 0 {
                    // Bloc du jour (HomeScreen de la PWA) : file du jour, 3 compteurs, puis l'action.
                    VStack(alignment: .leading, spacing: 16) {
                        if day.today > 0 {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(day.today)").font(.system(size: 52, weight: .bold)).monospacedDigit()
                                Text("\(day.today > 1 ? "cartes" : "carte") à revoir aujourd'hui").font(.title3.weight(.semibold))
                            }
                            .accessibilityElement(children: .combine)
                        } else {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Aucune carte à revoir aujourd'hui").font(.title2.weight(.semibold))
                                Text(day.nextDueAt.map { "Prochaine révision dans \(delayLabel(from: now, to: $0))." }
                                     ?? "Tout est à jour.")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        HStack(spacing: 8) {
                            Counter(value: day.due, label: "À revoir", color: .orange)
                            Counter(value: day.fresh, label: "Nouvelles", color: .blue)
                            Counter(value: day.mastered, label: "Maîtrisées", color: .green)
                        }
                        if day.today > 0 {
                            Button {
                                session = Session(items: queue, reviews: reviews, free: false)
                            } label: {
                                Label("Commencer à étudier", systemImage: "play.fill").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                        } else {
                            Button {
                                session = Session(items: freeQueue(cards, reviews, now: now), reviews: reviews, free: true)
                            } label: {
                                Text("Réviser à nouveau").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.large)
                        }
                    }
                    .padding()
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 24))
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

/// Compteur du bloc du jour : chiffre neutre, pastille de couleur décorative devant le libellé.
private struct Counter: View {
    let value: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title.bold()).monospacedDigit()
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 8, height: 8).accessibilityHidden(true)
                Text(label).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}
