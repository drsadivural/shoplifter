import SwiftUI
import RetailGuardCore

/// Localized text + icon + tone for contract enums. Status is always shown as
/// text with an icon, never by color alone.
struct StatusPresentation {
    let text: String
    let systemImage: String
    let tone: Tone

    var badge: StatusBadge { StatusBadge(text: text, systemImage: systemImage, tone: tone) }
}

extension IncidentChannel {
    var title: String {
        switch self {
        case .behaviorCandidate: return L("Behavior signal")
        case .watchlistCandidate: return L("Watchlist candidate")
        case .checkoutException: return L("Checkout exception")
        case .rfidException: return L("RFID exception")
        case .manualObservation: return L("Manual observation")
        case .unrecognized: return L("Other event")
        }
    }

    var systemImage: String {
        switch self {
        case .behaviorCandidate: return "figure.walk.motion"
        case .watchlistCandidate: return "person.crop.rectangle.stack"
        case .checkoutException: return "cart.badge.questionmark"
        case .rfidException: return "dot.radiowaves.left.and.right"
        case .manualObservation: return "square.and.pencil"
        case .unrecognized: return "questionmark.circle"
        }
    }
}

extension IncidentStatus {
    var presentation: StatusPresentation {
        switch self {
        case .new: return StatusPresentation(text: L("Review required"), systemImage: "exclamationmark.circle", tone: .warning)
        case .acknowledged: return StatusPresentation(text: L("Acknowledged"), systemImage: "person.badge.clock", tone: .info)
        case .reviewing: return StatusPresentation(text: L("Awaiting review"), systemImage: "eye", tone: .info)
        case .resolved: return StatusPresentation(text: L("Resolved"), systemImage: "checkmark.seal", tone: .success)
        case .unrecognized: return StatusPresentation(text: L("Unknown status"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension Outcome {
    var title: String {
        switch self {
        case .confirmed: return L("Confirmed incident")
        case .falseAlert: return L("False alert")
        case .inconclusive: return L("Inconclusive")
        case .unrecognized: return L("Unknown outcome")
        }
    }

    var explanation: String {
        switch self {
        case .confirmed: return L("Footage and observed facts support the incident.")
        case .falseAlert: return L("The alert was not supported by footage or facts.")
        case .inconclusive: return L("Evidence is insufficient to decide either way.")
        case .unrecognized: return ""
        }
    }

    var presentation: StatusPresentation {
        switch self {
        case .confirmed: return StatusPresentation(text: title, systemImage: "checkmark.shield", tone: .critical)
        case .falseAlert: return StatusPresentation(text: title, systemImage: "xmark.circle", tone: .success)
        case .inconclusive: return StatusPresentation(text: title, systemImage: "questionmark.diamond", tone: .neutral)
        case .unrecognized: return StatusPresentation(text: title, systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension Priority {
    var title: String {
        switch self {
        case .normal: return L("Normal")
        case .high: return L("High")
        case .urgent: return L("Urgent")
        case .unrecognized: return L("Unknown priority")
        }
    }

    var presentation: StatusPresentation {
        switch self {
        case .urgent: return StatusPresentation(text: title, systemImage: "exclamationmark.3", tone: .critical)
        case .high: return StatusPresentation(text: title, systemImage: "exclamationmark.2", tone: .warning)
        default: return StatusPresentation(text: title, systemImage: "minus", tone: .neutral)
        }
    }
}

extension EvidenceState {
    var presentation: StatusPresentation {
        switch self {
        case .pending: return StatusPresentation(text: L("Evidence pending"), systemImage: "hourglass", tone: .warning)
        case .available: return StatusPresentation(text: L("Evidence available"), systemImage: "film", tone: .info)
        case .unavailable: return StatusPresentation(text: L("Evidence unavailable"), systemImage: "film.stack", tone: .neutral)
        case .expired: return StatusPresentation(text: L("Evidence expired"), systemImage: "clock.badge.xmark", tone: .neutral)
        case .unrecognized: return StatusPresentation(text: L("Evidence state unknown"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension CameraReadiness {
    var presentation: StatusPresentation {
        switch self {
        case .ready: return StatusPresentation(text: L("Online"), systemImage: "checkmark.circle", tone: .success)
        case .pending: return StatusPresentation(text: L("Pending setup"), systemImage: "hourglass", tone: .neutral)
        case .degraded: return StatusPresentation(text: L("Degraded"), systemImage: "exclamationmark.triangle", tone: .warning)
        case .offline: return StatusPresentation(text: L("Offline"), systemImage: "wifi.slash", tone: .critical)
        case .disabled: return StatusPresentation(text: L("Disabled"), systemImage: "pause.circle", tone: .neutral)
        case .unrecognized: return StatusPresentation(text: L("Unknown status"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension AnalysisState {
    var presentation: StatusPresentation {
        switch self {
        case .analyzing: return StatusPresentation(text: L("Analyzing"), systemImage: "waveform.path.ecg", tone: .success)
        case .activationRequested: return StatusPresentation(text: L("Activation requested"), systemImage: "hourglass", tone: .info)
        case .paused: return StatusPresentation(text: L("Paused"), systemImage: "pause.circle", tone: .neutral)
        case .degraded: return StatusPresentation(text: L("Analysis degraded"), systemImage: "exclamationmark.triangle", tone: .warning)
        case .unavailable: return StatusPresentation(text: L("Analysis unavailable"), systemImage: "slash.circle", tone: .neutral)
        case .unrecognized: return StatusPresentation(text: L("Unknown status"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension ChannelRunState {
    var presentation: StatusPresentation {
        switch self {
        case .running: return StatusPresentation(text: L("Running"), systemImage: "checkmark.circle", tone: .success)
        case .starting: return StatusPresentation(text: L("Starting"), systemImage: "hourglass", tone: .info)
        case .degraded: return StatusPresentation(text: L("Degraded"), systemImage: "exclamationmark.triangle", tone: .warning)
        case .unavailable: return StatusPresentation(text: L("Unavailable"), systemImage: "slash.circle", tone: .neutral)
        case .notRequested: return StatusPresentation(text: L("Not requested"), systemImage: "minus.circle", tone: .neutral)
        case .unrecognized: return StatusPresentation(text: L("Unknown status"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

enum ChannelName {
    static func title(_ key: String) -> String {
        switch key {
        case "behavior": return L("Behavior")
        case "watchlist": return L("Watchlist")
        case "checkout": return L("Checkout")
        case "rfid": return L("RFID")
        default: return key
        }
    }

    static func reason(_ code: String) -> String {
        switch code {
        case "model_not_installed": return L("Model not installed")
        case "face_sdk_unavailable": return L("Face SDK not installed")
        case "pos_unconfigured": return L("POS not connected")
        default: return code.replacingOccurrences(of: "_", with: " ")
        }
    }
}

extension ProfileStatus {
    var presentation: StatusPresentation {
        switch self {
        case .draft: return StatusPresentation(text: L("Draft"), systemImage: "pencil", tone: .neutral)
        case .pendingReview: return StatusPresentation(text: L("Awaiting review"), systemImage: "eye", tone: .warning)
        case .approved: return StatusPresentation(text: L("Approved"), systemImage: "checkmark.seal", tone: .success)
        case .suspended: return StatusPresentation(text: L("Suspended"), systemImage: "pause.circle", tone: .warning)
        case .expired: return StatusPresentation(text: L("Expired"), systemImage: "clock.badge.xmark", tone: .neutral)
        case .deleted: return StatusPresentation(text: L("Deleted"), systemImage: "trash", tone: .neutral)
        case .unrecognized: return StatusPresentation(text: L("Unknown status"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension GalleryState {
    var presentation: StatusPresentation {
        switch self {
        case .inGallery: return StatusPresentation(text: L("In matching gallery"), systemImage: "checkmark.circle", tone: .success)
        case .notInGallery: return StatusPresentation(text: L("Not in matching gallery"), systemImage: "minus.circle", tone: .neutral)
        case .faceSDKUnavailable: return StatusPresentation(text: L("Face SDK unavailable"), systemImage: "slash.circle", tone: .warning)
        case .unrecognized: return StatusPresentation(text: L("Unknown status"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension PhotoStatus {
    var presentation: StatusPresentation {
        switch self {
        case .pending: return StatusPresentation(text: L("Awaiting review"), systemImage: "eye", tone: .warning)
        case .approved: return StatusPresentation(text: L("Approved"), systemImage: "checkmark.seal", tone: .success)
        case .rejected: return StatusPresentation(text: L("Rejected"), systemImage: "xmark.circle", tone: .critical)
        case .deleted: return StatusPresentation(text: L("Deleted"), systemImage: "trash", tone: .neutral)
        case .unrecognized: return StatusPresentation(text: L("Unknown status"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

extension ProfileAction {
    var title: String {
        switch self {
        case .submit: return L("Submit for review")
        case .approve: return L("Approve enrollment")
        case .reject: return L("Reject")
        case .suspend: return L("Suspend profile")
        case .reinstate: return L("Reinstate")
        case .delete: return L("Delete profile")
        }
    }

    var message: String {
        switch self {
        case .submit: return L("A different authorized reviewer must approve the profile before it can be used.")
        case .approve: return L("Approve only if the evidence basis, scope, expiry and photos meet your policy.")
        case .reject: return L("The profile returns to its creator with your reason.")
        case .suspend: return L("Suspended profiles are removed from matching until reinstated.")
        case .reinstate: return L("The profile becomes active again within its scope and expiry.")
        case .delete: return L("Deletes the profile, its photos and any templates. This cannot be undone.")
        }
    }

    var isDestructive: Bool { self == .delete || self == .reject || self == .suspend }
}

extension Role {
    var title: String {
        switch self {
        case .viewer: return L("Viewer")
        case .responder: return L("Responder")
        case .investigator: return L("Investigator")
        case .storeAdmin: return L("Store admin")
        case .orgAdmin: return L("Organization admin")
        case .unrecognized: return L("Other role")
        }
    }
}

extension CoverageGapReason {
    var title: String {
        switch self {
        case .beforeActivation: return L("Before camera activation")
        case .outage: return L("Camera outage")
        case .beyondRetention: return L("Beyond retention period")
        case .noCameras: return L("No cameras in scope")
        case .unrecognized: return L("Unavailable")
        }
    }
}

enum SignalName {
    static func title(_ key: String) -> String {
        switch key {
        case "anomaly": return L("Pose anomaly score")
        case "item_interaction": return L("Item interaction")
        case "concealment_motion": return L("Concealment motion")
        case "visibility": return L("Body visibility")
        default: return key.replacingOccurrences(of: "_", with: " ")
        }
    }
}

enum TimelineActionName {
    static func title(_ action: String) -> String {
        switch action {
        case "entry": return L("Entry")
        case "trigger", "detected", "ingested": return L("Trigger signals")
        case "claim", "acknowledged": return L("Acknowledged")
        case "request_review", "request-review": return L("Request review")
        case "outcome", "resolved": return L("Outcome recorded")
        case "escalate", "escalated": return L("Assistance requested")
        case "reopen", "reopened": return L("Reopened")
        case "note": return L("Note added")
        case "exit": return L("Exit")
        default: return action.replacingOccurrences(of: "_", with: " ")
        }
    }
}
