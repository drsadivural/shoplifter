import SwiftUI

/// Async load state for a screen.
enum Loadable<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(UserFacingError)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

/// Renders loading / error / permission-denied / unavailable / offline states
/// around loaded content.
struct LoadableView<Value, Content: View>: View {
    let state: Loadable<Value>
    let retry: () async -> Void
    @ViewBuilder var content: (Value) -> Content

    var body: some View {
        switch state {
        case .idle, .loading:
            LoadingStateView()
        case .loaded(let value):
            content(value)
        case .failed(let error):
            FailureStateView(error: error, retry: retry)
        }
    }
}

struct LoadingStateView: View {
    var text: String = L("Loading…")

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Color.rgSecondaryText)
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .rgCard()
        .accessibilityElement(children: .combine)
    }
}

/// Chooses the right presentation for an error kind.
struct FailureStateView: View {
    let error: UserFacingError
    let retry: () async -> Void

    var body: some View {
        switch error.kind {
        case .forbidden:
            PermissionDeniedView(message: error.message)
        case .unavailable:
            UnavailableStateView(title: L("Service unavailable"), message: error.message, retry: retry)
        case .offline:
            StateMessageView(systemImage: "wifi.slash", title: L("Offline mode"), message: error.message,
                             tone: .warning, actionTitle: L("Retry"), action: retry, requestId: nil)
        case .notFound:
            StateMessageView(systemImage: "questionmark.folder", title: L("Not available"), message: error.message,
                             tone: .neutral, actionTitle: L("Retry"), action: retry, requestId: error.requestId)
        default:
            StateMessageView(systemImage: "exclamationmark.triangle", title: L("Something went wrong"),
                             message: error.message, tone: .critical, actionTitle: L("Retry"), action: retry,
                             requestId: error.requestId)
        }
    }
}

struct StateMessageView: View {
    let systemImage: String
    let title: String
    let message: String
    var tone: Tone = .neutral
    var actionTitle: String?
    var action: (() async -> Void)?
    var requestId: String?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.largeTitle)
                .foregroundStyle(tone == .neutral ? Color.rgPrimary : tone.foreground)
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.bold())
                .foregroundStyle(Color.rgInk)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.rgSecondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let requestId {
                Text(LF("Request ID: %@", requestId))
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.rgSecondaryText)
                    .textSelection(.enabled)
            }
            if let actionTitle, let action {
                Button(actionTitle) { Task { await action() } }
                    .buttonStyle(.rgPrimary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .rgCard()
        .accessibilityElement(children: .contain)
    }
}

struct PermissionDeniedView: View {
    var message: String = L("Your role does not allow this. Ask an administrator if you need access.")

    var body: some View {
        StateMessageView(systemImage: "lock.shield", title: L("Access restricted"), message: message, tone: .neutral)
    }
}

/// Explicit "unavailable" state for missing dependencies (face SDK, re-ID,
/// live streaming). Never replaced with fake data.
struct UnavailableStateView: View {
    let title: String
    let message: String
    var retry: (() async -> Void)?

    var body: some View {
        StateMessageView(systemImage: "slash.circle", title: title, message: message, tone: .warning,
                         actionTitle: retry == nil ? nil : L("Check again"), action: retry)
    }
}

struct EmptyStateView: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        StateMessageView(systemImage: systemImage, title: title, message: message, tone: .neutral,
                         actionTitle: actionTitle, action: wrappedAction)
    }

    private var wrappedAction: (() async -> Void)? {
        guard let action else { return nil }
        return { action() }
    }
}

/// Inline error banner for forms.
struct ErrorBanner: View {
    let error: UserFacingError

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            InfoBanner(text: error.message, tone: .critical, systemImage: "xmark.octagon")
            if let requestId = error.requestId {
                Text(LF("Request ID: %@", requestId))
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.rgSecondaryText)
                    .textSelection(.enabled)
            }
        }
    }
}

/// "Load more" control for cursor pagination.
struct LoadMoreButton: View {
    let isLoading: Bool
    let action: () async -> Void

    var body: some View {
        Button {
            Task { await action() }
        } label: {
            HStack {
                if isLoading { ProgressView() }
                Text(L("Load more"))
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.rgSecondaryWide)
        .disabled(isLoading)
    }
}
