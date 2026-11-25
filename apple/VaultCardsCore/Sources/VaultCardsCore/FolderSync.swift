import Foundation

/// Accès au dossier `VaultCards/` choisi par l'utilisateur. Chemins relatifs à ce dossier (`devices/<id>/cards.jsonl`).
/// L'app l'implémente avec `NSFileCoordinator` ; les tests avec un dossier en mémoire.
public protocol SyncFolder {
    /// Contenu du fichier, nil s'il n'existe pas (ou pas encore téléchargé : il sera lu à la synchro suivante).
    func read(_ path: String) throws -> Data?
    /// Noms des entrées d'un dossier, [] s'il n'existe pas.
    func list(_ directory: String) throws -> [String]
    /// Ajoute à la fin du fichier (créé s'il n'existe pas), en une écriture.
    func append(_ data: Data, to path: String) throws
    /// Remplace le fichier entier.
    func write(_ data: Data, to path: String) throws
    func makeDirectory(_ path: String) throws
}

public enum SyncError: LocalizedError, Equatable, Sendable {
    /// `format.json` illisible (peut-être en cours de téléchargement).
    case unreadableFormat
    /// `format.json` d'une autre app : le dossier n'est pas un dossier Vault Cards.
    case foreignFolder

    public var errorDescription: String? {
        switch self {
        case .unreadableFormat: return "Le fichier format.json du dossier est illisible. Réessaie dans un instant."
        case .foreignFolder: return "Ce dossier VaultCards appartient à une autre app."
        }
    }
}

public struct SyncInput: Sendable {
    public var device: String
    public var deviceName: String
    public var now: Millis
    /// Changements de cartes de cet appareil pas encore écrits dans son journal.
    public var pendingCards: [CardEvent]
    public var pendingReviews: [Review]
    /// Octets déjà lus par fichier des autres appareils (chemin relatif → taille).
    public var offsets: [String: Int]

    public init(device: String, deviceName: String, now: Millis, pendingCards: [CardEvent], pendingReviews: [Review],
                offsets: [String: Int]) {
        self.device = device
        self.deviceName = deviceName
        self.now = now
        self.pendingCards = pendingCards
        self.pendingReviews = pendingReviews
        self.offsets = offsets
    }
}

public struct SyncOutput: Equatable, Sendable {
    /// Changements lus chez les autres appareils, à fusionner avec `Merge.apply`.
    public var incomingCards: [CardEvent] = []
    public var incomingReviews: [Review] = []
    /// Nouvelles tailles lues, à garder pour la synchro suivante.
    public var offsets: [String: Int] = [:]
    /// Lignes ou fichiers ignorés, à montrer dans l'écran de synchro.
    public var problems: [String] = []
    /// Dossier ou ligne écrits par une version plus récente de l'app : « Mettez l'app à jour ».
    public var needsUpdate = false
    /// Les changements en attente ont été écrits dans le journal de l'appareil.
    public var wrotePending = false
}

/// Une synchro : écrire les changements de l'appareil dans son journal, puis lire ce qui est nouveau chez les autres
/// (spec docs/specs/2026-11-25-app-apple-native.md, « Dossier de synchro : format v1 »).
public enum FolderSync {
    public static func run(_ folder: SyncFolder, _ input: SyncInput) throws -> SyncOutput {
        var out = SyncOutput(offsets: input.offsets)

        if let data = try folder.read(SyncFormat.formatFile) {
            guard let info = try? JSONDecoder().decode(FormatInfo.self, from: data) else { throw SyncError.unreadableFormat }
            guard info.format == FormatInfo.current.format else { throw SyncError.foreignFolder }
            if info.version > SyncFormat.version {
                out.needsUpdate = true
                return out
            }
        } else {
            try folder.write(Journal.encode(FormatInfo.current), to: SyncFormat.formatFile)
        }

        try writeOwn(folder, input)
        out.wrotePending = true

        let devices = try folder.list(SyncFormat.devicesFolder).filter { SyncFormat.isDeviceID($0) && $0 != input.device }
        for device in devices.sorted() {
            readDevice(folder, device, into: &out)
        }
        return out
    }

    /// Écrit dans `devices/<appareil>/` uniquement : fiche de l'appareil, puis les lignes en attente (ajout seul).
    static func writeOwn(_ folder: SyncFolder, _ input: SyncInput) throws {
        try folder.makeDirectory("\(SyncFormat.devicesFolder)/\(input.device)")
        let infoPath = SyncFormat.path(device: input.device, file: SyncFormat.deviceFile)
        if try folder.read(infoPath) == nil {
            let info = DeviceInfo(id: input.device, name: input.deviceName, created_at: ISOTimestamp.format(input.now))
            try folder.write(Journal.encode(info), to: infoPath)
        }
        if !input.pendingCards.isEmpty {
            var data = Data()
            for e in input.pendingCards { data.append(try Journal.encode(CardLine(card: e.card, at: e.at))) }
            try folder.append(data, to: SyncFormat.path(device: input.device, file: SyncFormat.cardsFile))
        }
        let byMonth = Dictionary(grouping: input.pendingReviews) { SyncFormat.reviewsFile(for: $0.reviewedAt) }
        for (file, reviews) in byMonth.sorted(by: { $0.key < $1.key }) {
            var data = Data()
            for r in reviews.sorted(by: { ($0.reviewedAt, $0.id) < ($1.reviewedAt, $1.id) }) {
                data.append(try Journal.encode(ReviewLine(review: r)))
            }
            try folder.append(data, to: SyncFormat.path(device: input.device, file: file))
        }
    }

    /// Lit la suite des journaux d'un autre appareil. Un fichier en erreur est signalé et relu à la synchro suivante.
    static func readDevice(_ folder: SyncFolder, _ device: String, into out: inout SyncOutput) {
        let dir = "\(SyncFormat.devicesFolder)/\(device)"
        let label = deviceLabel(folder, device)
        let names: [String]
        do {
            names = try folder.list(dir)
        } catch {
            out.problems.append("\(label) : dossier illisible.")
            return
        }
        for name in names.sorted() {
            guard let kind = SyncFormat.kind(ofFile: name), kind != .device else { continue }
            let path = "\(dir)/\(name)"
            do {
                guard let data = try folder.read(path) else { continue }
                var offset = out.offsets[path] ?? 0
                if offset > data.count { offset = 0 }  // Fichier rétréci : tout relire (la fusion est idempotente).
                let start = data.startIndex + offset
                let firstLine = data[data.startIndex..<start].filter { $0 == Journal.newline }.count + 1
                let rest = data.subdata(in: start..<data.endIndex)
                var errors: [LineError] = []
                var consumed = 0
                if kind == .cards {
                    let read = Journal.readCards(rest, device: device, firstLine: firstLine)
                    errors = read.errors
                    consumed = read.consumed
                    if !read.needsUpdate { out.incomingCards += read.items }
                } else {
                    let read = Journal.readReviews(rest, firstLine: firstLine)
                    errors = read.errors
                    consumed = read.consumed
                    if !read.needsUpdate { out.incomingReviews += read.items }
                }
                if errors.contains(where: { if case .newerVersion = $0 { return true } else { return false } }) {
                    // Fichier écrit par une version plus récente : ni lu ni avancé tant que l'app n'est pas à jour.
                    out.needsUpdate = true
                    continue
                }
                for case .unreadable(let line, let reason) in errors {
                    out.problems.append("\(label), \(name), ligne \(line) : \(reason).")
                }
                out.offsets[path] = offset + consumed
            } catch {
                out.problems.append("\(label), \(name) : fichier illisible pour l'instant.")
            }
        }
    }

    /// Nom de l'appareil tiré de sa fiche, sinon le début de son id.
    static func deviceLabel(_ folder: SyncFolder, _ device: String) -> String {
        if let data = try? folder.read(SyncFormat.path(device: device, file: SyncFormat.deviceFile)),
           let info = try? JSONDecoder().decode(DeviceInfo.self, from: data), !info.name.isEmpty {
            return info.name
        }
        return "Appareil \(device.prefix(8))"
    }
}
