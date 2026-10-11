import Foundation

/// Client-side pre-check of reference/query photos against the upload contract
/// (JPEG/PNG, ≤ 8 MB, ≥ 200×200 px, ≤ 40 MP). Reads the container headers only;
/// the server re-validates and re-encodes. Face quality is *not* assessed here
/// (that requires the licensed face SDK, which reports `unavailable`).
public enum ImageInspector {
    public enum Format: String, Sendable, Equatable {
        case jpeg, png

        public var mimeType: String { self == .jpeg ? "image/jpeg" : "image/png" }
    }

    public struct Info: Sendable, Equatable {
        public let format: Format
        public let width: Int
        public let height: Int
        public let byteCount: Int
        public var megapixels: Double { Double(width) * Double(height) / 1_000_000 }
    }

    public enum Failure: Error, Equatable, Sendable {
        case unsupportedFormat
        case unreadableDimensions
        case tooLarge(bytes: Int)
        case tooSmall(width: Int, height: Int)
        case tooManyPixels(width: Int, height: Int)
    }

    public static let maxBytes = 8 * 1024 * 1024
    public static let minDimension = 200
    public static let maxPixels = 40_000_000

    public static func inspect(_ data: Data) throws -> Info {
        let bytes = [UInt8](data)
        let format: Format
        let size: (Int, Int)?
        if bytes.count >= 8, bytes[0..<8].elementsEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
            format = .png
            size = pngSize(bytes)
        } else if bytes.count >= 3, bytes[0] == 0xFF, bytes[1] == 0xD8, bytes[2] == 0xFF {
            format = .jpeg
            size = jpegSize(bytes)
        } else {
            throw Failure.unsupportedFormat
        }
        guard let (width, height) = size, width > 0, height > 0 else { throw Failure.unreadableDimensions }
        return Info(format: format, width: width, height: height, byteCount: bytes.count)
    }

    /// Inspects and enforces the upload limits.
    public static func validateForUpload(_ data: Data) throws -> Info {
        if data.count > maxBytes { throw Failure.tooLarge(bytes: data.count) }
        let info = try inspect(data)
        if info.width < minDimension || info.height < minDimension {
            throw Failure.tooSmall(width: info.width, height: info.height)
        }
        if info.width * info.height > maxPixels {
            throw Failure.tooManyPixels(width: info.width, height: info.height)
        }
        return info
    }

    static func pngSize(_ b: [UInt8]) -> (Int, Int)? {
        // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
        guard b.count >= 24, b[12] == 0x49, b[13] == 0x48, b[14] == 0x44, b[15] == 0x52 else { return nil }
        let width = Int(b[16]) << 24 | Int(b[17]) << 16 | Int(b[18]) << 8 | Int(b[19])
        let height = Int(b[20]) << 24 | Int(b[21]) << 16 | Int(b[22]) << 8 | Int(b[23])
        return (width, height)
    }

    static func jpegSize(_ b: [UInt8]) -> (Int, Int)? {
        var i = 2
        while i + 3 < b.count {
            guard b[i] == 0xFF else { return nil }
            var marker = b[i + 1]
            // Skip fill bytes.
            while marker == 0xFF, i + 2 < b.count {
                i += 1
                marker = b[i + 1]
            }
            // Standalone markers without a length.
            if marker == 0x01 || (0xD0...0xD7).contains(marker) {
                i += 2
                continue
            }
            if marker == 0xD9 || marker == 0xDA { return nil } // EOI / SOS before SOF
            guard i + 3 < b.count else { return nil }
            let length = Int(b[i + 2]) << 8 | Int(b[i + 3])
            guard length >= 2 else { return nil }
            let isSOF = (0xC0...0xCF).contains(marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC
            if isSOF {
                guard i + 8 < b.count else { return nil }
                let height = Int(b[i + 5]) << 8 | Int(b[i + 6])
                let width = Int(b[i + 7]) << 8 | Int(b[i + 8])
                return (width, height)
            }
            i += 2 + length
        }
        return nil
    }
}
