import SwiftData
import SwiftUI
import VaultCardsCore

/// Accueil : bloc du jour (file, 3 compteurs, action), brouillons à valider, « Mes tags » en grille. iPhone : l'action
/// principale est fixée en bas, au-dessus de la barre d'onglets, au même endroit que « Voir la réponse » en révision.
/// Mac : elle reste dans le bloc du jour, déclenchée aussi par Entrée.
struct HomeView: View {
    /// Ouvre l'onglet « Générer » (brouillons à valider).
    var showDrafts: () -> Void = {}

    @Query private var storedCards: [StoredCard]
    @Query private var storedReviews: [StoredReview]
    @State private var session: Session?
    @State private var creating = false
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
        let day = dayCounts(cards, reviews, now: now)
        let allTags = tagCounts(cards, reviews, now: now)
        let drafts = storedCards.filter { $0.deletedAt == nil && $0.status == CardStatus.draft.rawValue }.count
        let start = {
            let queue = buildQueue(cards, reviews, now: now)
            session = queue.isEmpty
                ? Session(items: freeQueue(cards, reviews, now: now), reviews: reviews, free: true)
                : Session(items: queue, reviews: reviews, free: false)
        }
        let study: (String) -> Void = { tag in
            let due = buildQueue(cards, reviews, now: now, tag: tag)
            // Rien à revoir dans ce tag aujourd'hui : révision libre du tag, comme « Réviser à nouveau ».
            session = due.isEmpty
                ? Session(items: freeQueue(cards, reviews, now: now, tag: tag), reviews: reviews, free: true, tag: tag)
                : Session(items: due, reviews: reviews, free: false, tag: tag)
        }
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    if day.total > 0 {
                        TodayCard(day: day, now: now) {
                            #if os(macOS)
                            HStack {
                                Spacer()
                                StartButton(today: day.today, action: start)
                            }
                            #endif
                        }
                    }
                    if drafts > 0 {
                        DraftsRow(count: drafts, action: showDrafts)
                    }
                    let shortcuts = Tags.shortcuts(allTags)
                    if !shortcuts.isEmpty {
                        TagGrid(tags: shortcuts, study: study) {
                            TagsView(tags: allTags, today: day.today, study: study)
                        }
                    }
                }
                .padding()
                // Lisible sur une grande fenêtre Mac : colonne centrée, comme Réglages ou Santé.
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.page)
            .overlay {
                if day.total == 0 && drafts == 0 {
                    ContentUnavailableView {
                        Label("Aucune carte", systemImage: "rectangle.stack.badge.plus")
                    } description: {
                        Text("Crée ta première carte, ou fais-en proposer par l'IA dans « Générer ».")
                    } actions: {
                        Button("Nouvelle carte") { creating = true }.buttonStyle(.borderedProminent)
                    }
                }
            }
            #if os(iOS)
            .safeAreaInset(edge: .bottom) {
                if day.total > 0 {
                    StartButton(today: day.today, action: start)
                        .padding(.horizontal)
                        .padding(.bottom, 8)
                }
            }
            #endif
            .refreshable { await sync.sync(context) }
            .navigationTitle("Vault Cards")
            .toolbar {
                #if os(macOS)
                ToolbarItem {
                    Button {
                        sync.soon(context)
                    } label: {
                        Label("Synchroniser", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .keyboardShortcut("r")
                    .disabled(sync.isSyncing || sync.folderName == nil)
                    .help(sync.folderName == nil ? "Choisis un dossier dans « Synchro »." : "Synchroniser maintenant")
                }
                #endif
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        creating = true
                    } label: {
                        Label("Nouvelle carte", systemImage: "plus")
                    }
                    .keyboardShortcut("n")
                    .help("Nouvelle carte")
                }
            }
            .sheet(item: $session, onDismiss: { sync.soon(context) }) { s in
                ReviewSessionView(items: s.items, reviews: s.reviews, free: s.free, tag: s.tag)
            }
            .sheet(isPresented: $creating) { CardEditor(card: nil) }
        }
    }
}

/// Couleurs de fond : contenu sur fond groupé (cartes claires sur gris en iOS), fenêtre standard sur Mac. Le verre
/// Liquid Glass reste réservé aux commandes (barres, bouton principal), comme le demandent les HIG.
enum Palette {
    #if os(iOS)
    static let page = Color(uiColor: .systemGroupedBackground)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    #else
    static let page = Color(nsColor: .windowBackgroundColor)
    static let card = Color(nsColor: .controlBackgroundColor)
    #endif
}

/// Bloc du jour (HomeScreen de la PWA) : file du jour ou prochaine échéance, puis 3 compteurs.
private struct TodayCard<Footer: View>: View {
    let day: DayCounts
    let now: Millis
    @ViewBuilder let footer: () -> Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if day.today > 0 {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(day.today)").font(.system(size: 52, weight: .bold, design: .rounded)).monospacedDigit()
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
            HStack(spacing: 0) {
                Counter(value: day.due, label: "À revoir", color: .orange)
                Divider().frame(height: 36)
                Counter(value: day.fresh, label: "Nouvelles", color: .blue)
                Divider().frame(height: 36)
                Counter(value: day.mastered, label: "Maîtrisées", color: .green)
            }
            footer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// Compteur du bloc du jour : chiffre neutre, pastille de couleur décorative devant le libellé.
private struct Counter: View {
    let value: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title2.bold()).monospacedDigit()
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 7, height: 7).accessibilityHidden(true)
                Text(label).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// « Commencer à étudier » (file du jour), sinon « Réviser à nouveau » (révision libre). Seule couleur forte de l'écran.
private struct StartButton: View {
    let today: Int
    let action: () -> Void

    var body: some View {
        let label = Label(today > 0 ? "Commencer à étudier" : "Réviser à nouveau",
                          systemImage: today > 0 ? "play.fill" : "arrow.counterclockwise")
        Button(action: action) {
            #if os(iOS)
            label.frame(maxWidth: .infinity, minHeight: 34)
            #else
            label.padding(.horizontal, 6)
            #endif
        }
        .controlSize(.large)
        .keyboardShortcut(.defaultAction)
        .modifier(StartStyle(prominent: today > 0))
    }
}

private struct StartStyle: ViewModifier {
    let prominent: Bool

    func body(content: Content) -> some View {
        // Le verre n'existe qu'avec le SDK 26 (Swift 6.2) ; la CI compile encore avec Xcode 16.
        #if compiler(>=6.2)
        if #available(iOS 26, macOS 26, *) {
            if prominent { content.buttonStyle(.glassProminent) } else { content.buttonStyle(.glass) }
        } else {
            fallback(content)
        }
        #else
        fallback(content)
        #endif
    }

    @ViewBuilder private func fallback(_ content: Content) -> some View {
        if prominent { content.buttonStyle(.borderedProminent) } else { content.buttonStyle(.bordered) }
    }
}

/// Brouillons proposés par l'IA en attente : un lien vers « Générer », où ils s'acceptent.
private struct DraftsRow: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles").font(.title3).foregroundStyle(.secondary).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(count > 1 ? "\(count) brouillons à valider" : "1 brouillon à valider").font(.headline)
                    Text("Propositions de l'IA, pas encore en révision").font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// « Mes tags » : les tags les plus fournis en grille (6 au plus, taille fixe : rien ne bouge en dessous). Un tap
/// lance la session du tag ; « Tout voir » ouvre la page de tous les tags.
private struct TagGrid<Destination: View>: View {
    let tags: [TagCount]
    let study: (String) -> Void
    @ViewBuilder let destination: () -> Destination

    private static var limit: Int { 6 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink {
                destination()
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    Text("Mes tags").font(.title3.bold()).foregroundStyle(.primary)
                    Spacer()
                    Text(tags.count > Self.limit ? "Tout voir (\(tags.count))" : "Tout voir")
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                }
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                ForEach(tags.prefix(Self.limit), id: \.name) { tag in
                    Button { study(tag.name) } label: { TagTile(tag: tag) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(tag.today > 0
                            ? "\(tag.name), \(tag.today) à revoir"
                            : "\(tag.name), à jour")
                }
            }
        }
    }
}

private struct TagTile: View {
    let tag: TagCount

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(tag.name).font(.headline).lineLimit(1)
                Spacer(minLength: 4)
                Text("\(tag.total)").font(.subheadline).monospacedDigit().foregroundStyle(.tertiary)
                    .accessibilityLabel("\(tag.total) carte\(tag.total > 1 ? "s" : "")")
            }
            Group {
                if tag.today > 0 {
                    Text("\(tag.today) à revoir").monospacedDigit()
                } else {
                    Label("À jour", systemImage: "checkmark")
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .contentShape(Rectangle())
    }
}
