import SwiftData
import SwiftUI

@main
struct VaultCardsApp: App {
    /// Base locale de l'appareil (SwiftData, stockée en SQLite), jamais synchronisée par iCloud : la synchro passe par
    /// le dossier choisi par l'utilisateur (SyncService, spec docs/specs/2026-11-25-app-apple-native.md).
    let container: ModelContainer = {
        let schema = Schema([StoredCard.self, StoredReview.self])
        let config = ModelConfiguration(schema: schema, cloudKitDatabase: .none)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Base locale illisible : \(error)")
        }
    }()
    @State private var sync = SyncService()

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        #if os(macOS)
        .defaultSize(width: 980, height: 700)
        #endif
        .modelContainer(container)
        .environment(sync)
    }
}

struct RootView: View {
    @Environment(SyncService.self) private var sync
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var phase

    @State private var tab = AppTab.home

    enum AppTab: Hashable { case home, cards, generate, sync }

    var body: some View {
        // iPhone : barre d'onglets. Mac (et iPad en largeur) : barre latérale, la navigation attendue par les HIG.
        TabView(selection: $tab) {
            Tab("Accueil", systemImage: "rectangle.stack", value: .home) {
                HomeView { tab = .generate }
            }
            Tab("Mes cartes", systemImage: "list.bullet", value: .cards) {
                CardsView()
            }
            Tab("Générer", systemImage: "sparkles", value: .generate) {
                GenerateView()
            }
            Tab("Synchro", systemImage: "arrow.triangle.2.circlepath", value: .sync) {
                SyncView()
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        // Au retour dans l'app, les changements des autres appareils sont lus.
        // Au premier plan, le dossier est surveillé : les changements arrivent en quelques secondes.
        .onChange(of: phase, initial: true) { _, now in
            switch now {
            case .active:
                sync.watch(context)
                sync.soon(context)
            case .background: sync.unwatch()
            default: break
            }
        }
        // En secours (fournisseur qui ne prévient pas), tant que l'app est active : une synchro par minute.
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { break }
                await sync.sync(context)
            }
        }
    }
}
