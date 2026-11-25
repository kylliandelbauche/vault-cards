import Foundation

/// Libellé d'une carte sans note source (carte manuelle), comme `MANUAL_CARD_LABEL` de la PWA.
public let manualCardLabel = "Carte perso"

public extension Card {
    /// Ligne de titre en révision (CardView.tsx) : titre de la source, sinon nom de fichier humanisé, sinon
    /// « Carte perso ». Jamais le chemin local.
    var displayTitle: String {
        let title = SourceTitle.trim(sourceTitle ?? "")
        if !title.isEmpty { return title }
        if let path = sourcePath, !path.isEmpty { return SourceTitle.fromFileName(path) }
        return manualCardLabel
    }

    /// Tags affichés : noms tels quels, sans vide ni doublon (casse ignorée), dans l'ordre de la carte.
    var displayTags: [String] {
        var seen = Set<String>()
        return tags.filter { !SourceTitle.trim($0).isEmpty && seen.insert(Tags.key($0)).inserted }
    }
}

/// Bilan d'une session : nombre de chaque note donnée (DoneScreen.tsx).
public struct SessionTally: Equatable, Sendable {
    public var again = 0, hard = 0, good = 0

    public init() {}

    public var total: Int { again + hard + good }

    public mutating func add(_ rating: Rating) {
        switch rating {
        case .again: again += 1
        case .hard: hard += 1
        case .good: good += 1
        }
    }
}
