import Foundation
import Observation
import SwiftData
import VaultCardsCore
#if os(iOS)
import UIKit
#endif

/// Synchro avec le dossier choisi par l'utilisateur : accès durable par bookmark (Apple, « Providing access to
/// directories »), fichiers lus et écrits hors du fil principal, résultat appliqué à la base locale.
@MainActor
@Observable
final class SyncService {
    private(set) var folderName: String?
    private(set) var lastSync: Date?
    private(set) var problems: [String] = []
    private(set) var needsUpdate = false
    private(set) var error: String?
    private(set) var isSyncing = false
    /// Une synchro demandée pendant une autre : relancée juste après.
    private var again = false
    /// Surveillance du dossier (changements des autres appareils), active tant que l'app est au premier plan.
    private var watcher: SyncFolderWatcher?
    private var watching = false
    /// Synchro prévue après un changement signalé : plusieurs fichiers changés d'un coup en donnent une seule.
    private var scheduled: Task<Void, Never>?

    private let defaults = UserDefaults.standard
    private enum Key {
        static let bookmark = "syncBookmark", offsets = "syncOffsets", lastSync = "syncLastDate"
    }

    #if os(macOS)
    private let createOptions: URL.BookmarkCreationOptions = .withSecurityScope
    private let resolveOptions: URL.BookmarkResolutionOptions = .withSecurityScope
    #else
    private let createOptions: URL.BookmarkCreationOptions = .minimalBookmark
    private let resolveOptions: URL.BookmarkResolutionOptions = []
    #endif

    init() {
        folderName = folderURL()?.lastPathComponent
        let last = defaults.double(forKey: Key.lastSync)
        lastSync = last > 0 ? Date(timeIntervalSince1970: last) : nil
    }

    /// Dossier choisi dans le sélecteur : gardé, puis tout ce que l'appareil connaît y est écrit.
    func choose(_ url: URL, context: ModelContext) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            defaults.set(try url.bookmarkData(options: createOptions, includingResourceValuesForKeys: nil, relativeTo: nil),
                         forKey: Key.bookmark)
        } catch {
            self.error = "Impossible de garder l'accès à ce dossier."
            return
        }
        defaults.removeObject(forKey: Key.offsets)
        defaults.removeObject(forKey: Key.lastSync)
        for card in (try? context.fetch(FetchDescriptor<StoredCard>())) ?? [] { card.journaled = false }
        for review in (try? context.fetch(FetchDescriptor<StoredReview>())) ?? [] { review.journaled = false }
        try? context.save()
        folderName = url.lastPathComponent
        lastSync = nil
        problems = []
        needsUpdate = false
        error = nil
        if watching { watch(context) }
        soon(context)
    }

    /// Surveille le dossier choisi : une synchro part dès qu'un autre appareil y écrit. Sur iOS, `unwatch` quand l'app
    /// passe en arrière-plan (un présentateur d'app suspendue peut bloquer le fournisseur de fichiers).
    func watch(_ context: ModelContext) {
        watching = true
        watcher?.stop()
        watcher = nil
        guard let url = folderURL() else { return }
        watcher = SyncFolderWatcher(scope: url, root: url.appending(path: SyncFormat.rootFolder), device: Device.id) {
            [weak self] in
            Task { @MainActor in self?.changed(context) }
        }
    }

    func unwatch() {
        watching = false
        watcher?.stop()
        watcher = nil
        scheduled?.cancel()
        scheduled = nil
    }

    private func changed(_ context: ModelContext) {
        guard watching, scheduled == nil else { return }
        scheduled = Task {
            try? await Task.sleep(for: .seconds(2))
            scheduled = nil
            if Task.isCancelled { return }
            await sync(context)
        }
    }

    /// Synchro en arrière-plan, sans attendre le résultat (après un changement local ou au retour dans l'app).
    func soon(_ context: ModelContext) {
        Task { await sync(context) }
    }

    func sync(_ context: ModelContext) async {
        if isSyncing {
            again = true
            return
        }
        guard let url = folderURL() else { return }
        isSyncing = true
        repeat {
            again = false
            await run(url, context)
        } while again
        isSyncing = false
    }

    private func run(_ url: URL, _ context: ModelContext) async {
        let me = Device.id
        let pendingCards = (try? context.fetch(FetchDescriptor<StoredCard>(predicate: #Predicate { $0.journaled == false }))) ?? []
        let pendingReviews = (try? context.fetch(FetchDescriptor<StoredReview>(predicate: #Predicate { $0.journaled == false }))) ?? []
        let snapshot = Dictionary(pendingCards.map { ($0.id, $0.updatedAt) }, uniquingKeysWith: { a, _ in a })
        let input = SyncInput(device: me, deviceName: Self.deviceName, now: Date.now.millis,
                              pendingCards: pendingCards.map { CardEvent(device: me, at: $0.updatedAt.millis, card: $0.card) },
                              pendingReviews: pendingReviews.compactMap(\.review),
                              offsets: defaults.dictionary(forKey: Key.offsets) as? [String: Int] ?? [:])

        let result = await Task.detached(priority: .utility) { () -> Result<SyncOutput, Error> in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return Result {
                let folder = FileSyncFolder(root: url.appending(path: SyncFormat.rootFolder))
                try folder.makeDirectory("")
                return try FolderSync.run(folder, input)
            }
        }.value

        switch result {
        case .failure(let e):
            error = (e as? LocalizedError)?.errorDescription ?? "Dossier inaccessible pour l'instant. Réessaie plus tard."
        case .success(let out):
            if out.wrotePending {
                // Une carte modifiée pendant la synchro garde son changement en attente.
                for card in pendingCards where snapshot[card.id] == card.updatedAt { card.journaled = true }
                for review in pendingReviews { review.journaled = true }
            }
            apply(out, me: me, context)
            try? context.save()
            defaults.set(out.offsets, forKey: Key.offsets)
            needsUpdate = out.needsUpdate
            problems = out.problems
            error = nil
            lastSync = .now
            defaults.set(Date.now.timeIntervalSince1970, forKey: Key.lastSync)
        }
    }

    /// Fusion des changements reçus avec la base locale (même règle que la fusion des journaux : tous convergent).
    private func apply(_ out: SyncOutput, me: String, _ context: ModelContext) {
        if !out.incomingCards.isEmpty {
            let all = (try? context.fetch(FetchDescriptor<StoredCard>())) ?? []
            var stored = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            for e in out.incomingCards {
                let local = stored[e.card.id]
                let version = local.map { Merge.Versioned(card: $0.card, at: $0.updatedAt.millis, device: $0.updatedBy.isEmpty ? me : $0.updatedBy) }
                guard let v = Merge.apply(e, to: version) else { continue }
                if let local, let version {
                    local.set(v.card)
                    if (v.at, v.device) != (version.at, version.device) {
                        // Le changement reçu remplace celui de l'appareil : plus rien à écrire pour cette carte.
                        local.updatedAt = Date(millis: v.at)
                        local.updatedBy = v.device == me ? "" : v.device
                        local.journaled = true
                    }
                } else {
                    let card = StoredCard(v.card, updatedAt: Date(millis: v.at))
                    card.updatedBy = v.device
                    card.journaled = true
                    context.insert(card)
                    stored[card.id] = card
                }
            }
        }
        if !out.incomingReviews.isEmpty {
            let known = Set(((try? context.fetch(FetchDescriptor<StoredReview>())) ?? []).map(\.id))
            for r in Merge.reviews(out.incomingReviews) where !known.contains(r.id) {
                let review = StoredReview(r)
                review.journaled = true
                context.insert(review)
            }
        }
    }

    /// Dossier gardé, ou nil. Un bookmark périmé est recréé.
    private func folderURL() -> URL? {
        guard let data = defaults.data(forKey: Key.bookmark) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: resolveOptions, relativeTo: nil,
                                 bookmarkDataIsStale: &stale) else {
            error = "Le dossier de synchro est introuvable. Choisis-le à nouveau."
            return nil
        }
        if stale {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let fresh = try? url.bookmarkData(options: createOptions, includingResourceValuesForKeys: nil, relativeTo: nil) {
                defaults.set(fresh, forKey: Key.bookmark)
            }
        }
        return url
    }

    private static var deviceName: String {
        #if os(iOS)
        return UIDevice.current.model
        #else
        return Host.current().localizedName ?? "Mac"
        #endif
    }
}
