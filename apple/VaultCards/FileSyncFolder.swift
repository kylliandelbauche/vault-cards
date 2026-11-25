import Foundation
import VaultCardsCore

/// Dossier `VaultCards/` sur le disque (iCloud Drive, Google Drive…). Lectures et écritures coordonnées avec
/// `NSFileCoordinator`, pour coopérer avec le fournisseur de fichiers (téléchargement, envoi, versions).
/// À utiliser hors du fil principal.
struct FileSyncFolder: SyncFolder {
    let root: URL

    private func url(_ path: String) -> URL { path.isEmpty ? root : root.appending(path: path) }

    func read(_ path: String) throws -> Data? {
        var data: Data?
        try coordinate(reading: url(path)) { u in
            do {
                data = try Data(contentsOf: u)
            } catch let e as CocoaError where e.code == .fileReadNoSuchFile || e.code == .fileNoSuchFile {
                data = nil
            }
        }
        return data
    }

    func list(_ directory: String) throws -> [String] {
        let dir = url(directory)
        guard FileManager.default.fileExists(atPath: dir.path(percentEncoded: false)) else { return [] }
        return try FileManager.default.contentsOfDirectory(atPath: dir.path(percentEncoded: false)).compactMap { name in
            // Fichier iCloud pas encore téléchargé (`.nom.icloud`) : téléchargement demandé, lu à la synchro suivante.
            if name.hasPrefix("."), name.hasSuffix(".icloud") {
                let real = String(name.dropFirst().dropLast(".icloud".count))
                try? FileManager.default.startDownloadingUbiquitousItem(at: dir.appending(path: real))
                return real
            }
            return name.hasPrefix(".") ? nil : name
        }
    }

    /// Ajout en fin de fichier. Si une écriture précédente a été coupée (pas de `\n` final), un `\n` d'abord : la ligne
    /// coupée reste seule (signalée comme illisible) au lieu d'abîmer la suivante.
    func append(_ data: Data, to path: String) throws {
        try coordinate(writing: url(path), options: .forMerging) { u in
            guard FileManager.default.fileExists(atPath: u.path(percentEncoded: false)) else {
                try data.write(to: u)
                return
            }
            let handle = try FileHandle(forUpdating: u)
            defer { try? handle.close() }
            var chunk = data
            let end = try handle.seekToEnd()
            if end > 0 {
                try handle.seek(toOffset: end - 1)
                if try handle.read(upToCount: 1) != Data([UInt8(ascii: "\n")]) { chunk.insert(UInt8(ascii: "\n"), at: 0) }
                try handle.seekToEnd()
            }
            try handle.write(contentsOf: chunk)
        }
    }

    func write(_ data: Data, to path: String) throws {
        try coordinate(writing: url(path), options: .forReplacing) { u in try data.write(to: u, options: .atomic) }
    }

    func makeDirectory(_ path: String) throws {
        try FileManager.default.createDirectory(at: url(path), withIntermediateDirectories: true)
    }

    private func coordinate(reading u: URL, _ body: (URL) throws -> Void) throws {
        var failure: Error?
        var coordination: NSError?
        NSFileCoordinator().coordinate(readingItemAt: u, options: [], error: &coordination) { u in
            do { try body(u) } catch { failure = error }
        }
        if let error = coordination ?? failure { throw error }
    }

    private func coordinate(writing u: URL, options: NSFileCoordinator.WritingOptions, _ body: (URL) throws -> Void) throws {
        var failure: Error?
        var coordination: NSError?
        NSFileCoordinator().coordinate(writingItemAt: u, options: options, error: &coordination) { u in
            do { try body(u) } catch { failure = error }
        }
        if let error = coordination ?? failure { throw error }
    }
}
