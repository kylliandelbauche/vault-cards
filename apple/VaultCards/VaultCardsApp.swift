import SwiftData
import SwiftUI

@main
struct VaultCardsApp: App {
    /// Base locale de l'appareil (SwiftData, stockée en SQLite), jamais synchronisée par iCloud : la synchro passera par
    /// le dossier choisi par l'utilisateur (spec docs/specs/2026-11-25-app-apple-native.md).
    let container: ModelContainer = {
        let schema = Schema([StoredCard.self, StoredReview.self])
        let config = ModelConfiguration(schema: schema, cloudKitDatabase: .none)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Base locale illisible : \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(container)
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Accueil", systemImage: "rectangle.stack") }
            CardsView()
                .tabItem { Label("Mes cartes", systemImage: "list.bullet") }
        }
    }
}
