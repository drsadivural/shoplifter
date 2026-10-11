import SwiftUI
import RetailGuardCore

/// Mockup header: eyebrow, large title, store subtitle.
struct ScreenHeader: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L("RETAILGUARD MOBILE"))
                .font(.caption.weight(.semibold))
                .tracking(1.5)
                .foregroundStyle(Color.rgPrimary)
                .accessibilityHidden(true)
            Text(title)
                .font(.largeTitle.bold())
                .foregroundStyle(Color.rgInk)
                .accessibilityAddTraits(.isHeader)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.body)
                    .foregroundStyle(Color.rgSecondaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Standard scrolling screen with the mockup header, token background and
/// an appearance toggle.
struct ScreenScaffold<Content: View>: View {
    @Environment(AppState.self) private var appState
    let title: String
    var subtitle: String?
    var showsStoreSubtitle = true
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(title: title, subtitle: resolvedSubtitle)
                if !appState.network.isOnline {
                    OfflineBanner()
                }
                content()
            }
            .padding(.horizontal, RGMetrics.gutter)
            .padding(.vertical, 12)
        }
        .background(Color.rgBackground.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { AppearanceMenu() }
        }
    }

    private var resolvedSubtitle: String? {
        if let subtitle { return subtitle }
        guard showsStoreSubtitle else { return nil }
        return LF("%@ · Review evidence. Respond with confidence.", appState.storeTitle)
    }
}

struct AppearanceMenu: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Menu {
            ForEach(AppearancePreference.allCases) { option in
                Button {
                    appState.preferences.appearance = option
                } label: {
                    if appState.preferences.appearance == option {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
            }
        } label: {
            Image(systemName: "circle.lefthalf.filled")
                .rgTapTarget()
        }
        .accessibilityLabel(L("Appearance"))
        .accessibilityValue(appState.preferences.appearance.title)
    }
}

struct OfflineBanner: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Button {
            appState.open(.offline)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "wifi.slash")
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Offline mode"))
                        .font(.subheadline.weight(.semibold))
                    Text(L("Latest records are unavailable. Reconnect and refresh before taking action."))
                        .font(.caption)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption)
            }
            .foregroundStyle(Color.rgWarning)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tone.warning.background, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityHint(L("Opens offline mode details"))
    }
}

struct StatusBadge: View {
    let text: String
    var systemImage: String?
    var tone: Tone = .neutral

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            Text(text)
                .lineLimit(2)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tone.background, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

struct InfoBanner: View {
    let text: String
    var tone: Tone = .warning
    var systemImage = "exclamationmark.triangle"

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.foreground)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Color.rgInk)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .leading) {
            Rectangle().fill(tone.foreground).frame(width: 3)
                .clipShape(RoundedRectangle(cornerRadius: 2))
        }
        .accessibilityElement(children: .combine)
    }
}

/// "AI signals require review" notice shown wherever model output appears.
struct HumanReviewNotice: View {
    var body: some View {
        InfoBanner(text: L("AI signals require review. Check the footage and observed facts before recording an outcome."))
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    var caption: String?
    var systemImage: String?
    var action: (() -> Void)?

    var body: some View {
        Group {
            if let action {
                Button(action: action) { content }
                    .buttonStyle(.plain)
                    .accessibilityHint(L("Opens the matching records"))
            } else {
                content
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage).foregroundStyle(Color.rgPrimary).accessibilityHidden(true)
                }
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(Color.rgSecondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(value)
                .font(.title.bold())
                .foregroundStyle(Color.rgInk)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            if let caption {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(Color.rgSecondaryText)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 100, alignment: .topLeading)
        .rgCard()
        .accessibilityElement(children: .combine)
    }
}

struct SectionTitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.title3.bold())
            .foregroundStyle(Color.rgInk)
            .accessibilityAddTraits(.isHeader)
    }
}

struct KeyValueRow: View {
    let label: String
    let value: String
    var valueTone: Tone?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(Color.rgSecondaryText)
            Spacer(minLength: 12)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(valueTone?.foreground ?? Color.rgInk)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

struct FieldHint: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(Color.rgSecondaryText)
    }
}

struct FieldError: View {
    let text: String?
    var body: some View {
        if let text {
            Label(text, systemImage: "exclamationmark.circle")
                .font(.caption)
                .foregroundStyle(Color.rgCritical)
        }
    }
}

/// Styled single-line input matching the mockups.
struct LabeledInput<Field: View>: View {
    let label: String
    var hint: String?
    var error: String?
    @ViewBuilder var field: () -> Field

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.rgInk)
            field()
                .padding(.horizontal, 12)
                .frame(minHeight: RGMetrics.minTapTarget)
                .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: RGMetrics.buttonRadius))
                .overlay(RoundedRectangle(cornerRadius: RGMetrics.buttonRadius)
                    .strokeBorder(error == nil ? Color.rgBorder : Color.rgCritical, lineWidth: 1))
            if let error {
                FieldError(text: error)
            } else if let hint {
                FieldHint(text: hint)
            }
        }
    }
}

/// Sheet collecting a required reason for an audited command.
struct ReasonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let message: String
    let confirmTitle: String
    var destructive = false
    let onConfirm: (String) async -> UserFacingError?

    @State private var reason = ""
    @State private var busy = false
    @State private var error: UserFacingError?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(Color.rgSecondaryText)
                }
                Section(L("Reason")) {
                    TextField(L("Required"), text: $reason, axis: .vertical)
                        .lineLimit(3...8)
                }
                if let error {
                    Section { InfoBanner(text: error.message, tone: .critical, systemImage: "xmark.octagon") }
                }
                Section {
                    Text(L("Saved changes appear in the audit log."))
                        .font(.caption)
                        .foregroundStyle(Color.rgSecondaryText)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(confirmTitle, role: destructive ? .destructive : nil) {
                        Task { await submit() }
                    }
                    .disabled(busy)
                }
            }
            .overlay { if busy { ProgressView().controlSize(.large) } }
        }
    }

    private func submit() async {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            error = UserFacingError(kind: .validation(["reason": "required"]), message: L("Enter a reason."), requestId: nil)
            return
        }
        busy = true
        defer { busy = false }
        if let failure = await onConfirm(trimmed) {
            error = failure
        } else {
            dismiss()
        }
    }
}

/// Multi-select list of the user's assigned stores.
struct StoreMultiSelect: View {
    let stores: [StoreRef]
    @Binding var selection: Set<String>

    var body: some View {
        ForEach(stores, id: \.id) { store in
            Button {
                if selection.contains(store.id) { selection.remove(store.id) } else { selection.insert(store.id) }
            } label: {
                HStack {
                    Text(store.name).foregroundStyle(Color.rgInk)
                    Spacer()
                    Image(systemName: selection.contains(store.id) ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selection.contains(store.id) ? Color.rgPrimary : Color.rgSecondaryText)
                        .accessibilityHidden(true)
                }
                .rgTapTarget()
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selection.contains(store.id) ? [.isSelected] : [])
        }
    }
}
