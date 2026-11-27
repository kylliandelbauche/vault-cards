import Foundation

/// Surveille le dossier `VaultCards/` avec `NSFilePresenter` (Apple, « File Coordination ») : le fournisseur de fichiers
/// (iCloud Drive…) coordonne ses écritures, donc un journal d'un autre appareil qui change, ou un fichier qui finit de se
/// télécharger, appelle `onChange`. Les écritures de cet appareil (`devices/<id>/`) sont ignorées : pas de boucle.
/// La synchro par minute reste en secours pour les fournisseurs qui ne préviennent pas.
final class SyncFolderWatcher: NSObject, NSFilePresenter, @unchecked Sendable {
    let presentedItemURL: URL?
    let presentedItemOperationQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .utility
        return queue
    }()

    private let scope: URL
    private let scoped: Bool
    private let device: String
    private let onChange: @Sendable () -> Void

    /// `scope` : dossier choisi (portée de sécurité gardée tant que la surveillance dure) ; `root` : son `VaultCards/`.
    init(scope: URL, root: URL, device: String, onChange: @escaping @Sendable () -> Void) {
        self.scope = scope
        scoped = scope.startAccessingSecurityScopedResource()
        presentedItemURL = root
        self.device = device
        self.onChange = onChange
        super.init()
        NSFileCoordinator.addFilePresenter(self)
    }

    /// À appeler avant de lâcher l'objet (Apple : retirer le présentateur quand l'app passe en arrière-plan sur iOS).
    func stop() {
        NSFileCoordinator.removeFilePresenter(self)
        if scoped { scope.stopAccessingSecurityScopedResource() }
    }

    func presentedSubitemDidChange(at url: URL) { changed(url) }
    func presentedSubitemDidAppear(at url: URL) { changed(url) }
    func presentedItemDidChange() { onChange() }

    private func changed(_ url: URL) {
        if Self.isOwn(url, device: device) { return }
        onChange()
    }

    /// Fichier du dossier de cet appareil (`…/devices/<id>/…`).
    static func isOwn(_ url: URL, device: String) -> Bool {
        let parts = url.standardizedFileURL.pathComponents
        guard let i = parts.lastIndex(of: "devices"), i + 1 < parts.count else { return false }
        return parts[i + 1] == device
    }
}
