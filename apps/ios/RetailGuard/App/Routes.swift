import SwiftUI
import RetailGuardCore

/// Typed navigation destinations. Screen IDs refer to design/screens.json.
enum Route: Hashable {
    case alertDetail(String)                // ios-09
    case incident(String)                   // ios-14
    case visits(String)                     // ios-25
    case history                            // ios-15
    case searchResults(SearchRequest)       // ios-17
    case watchlist                          // ios-18
    case profile(String)                    // ios-19
    case subjectEnroll // ios-20
    case staff                              // ios-21
    case staffEnroll                        // ios-22
    case photoCapture(profileId: String)    // ios-23
    case photoQuality(profileId: String, photoId: String) // ios-24
    case cameras                            // ios-26
    case camera(String)                     // ios-27
    case notificationSettings               // ios-28
    case team                               // ios-30
    case offline                            // ios-31
    case help                               // ios-34
    case storeSelection                     // ios-06
}

/// Search submitted from ios-16.
struct SearchRequest: Hashable {
    var query: IncidentQuery
    /// Store-local day range for display.
    var firstDay: Date
    var lastDay: Date
    /// Results come from `POST /v1/search/photo` (held in AppState, not re-run).
    var isPhotoSearch = false
}

struct RouteDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .alertDetail(let id): AlertDetailView(incidentId: id)
        case .incident(let id): IncidentDetailView(incidentId: id)
        case .visits(let id): VisitTimelineView(incidentId: id)
        case .history: HistoryView()
        case .searchResults(let request): SearchResultsView(request: request)
        case .watchlist: ProfileListView(kind: .watchlist)
        case .profile(let id): ProfileDetailView(profileId: id)
        case .subjectEnroll: SubjectEnrollView()
        case .staff: ProfileListView(kind: .staff)
        case .staffEnroll: StaffEnrollView()
        case .photoCapture(let profileId): PhotoCaptureView(profileId: profileId)
        case .photoQuality(let profileId, let photoId): PhotoQualityView(profileId: profileId, photoId: photoId)
        case .cameras: CamerasView()
        case .camera(let id): CameraPreviewView(cameraId: id)
        case .notificationSettings: NotificationPreferencesView()
        case .team: TeamView()
        case .offline: OfflineView()
        case .help: HelpView()
        case .storeSelection: StoreSelectionView(isOnboarding: false)
        }
    }
}
