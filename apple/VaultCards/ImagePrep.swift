import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Photo de la boîte de réception, préparée sur l'appareil avant l'envoi à l'IA : réduite à 1568 px de côté au plus
/// (taille conseillée par https://platform.claude.com/docs/en/build-with-claude/vision), orientée, recodée en JPEG.
/// Le recodage ne garde aucune métadonnée (lieu, appareil).
enum ImagePrep {
    static let maxPixelSize = 1568

    static func jpeg(from data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
