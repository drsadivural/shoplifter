import SwiftUI
import RetailGuardCore

/// ios-20 — Enroll subject. Creates a *draft* watchlist profile with evidence
/// basis, supporting confirmed incident, scope, expiry and review date. Photos
/// are added next; approval by a different reviewer is required. Nothing is
/// enrolled automatically from an alert.
struct SubjectEnrollView: View {
    @Environment(AppState.self) private var appState
    let sourceIncidentId: String?

    @State private var reference = ""
    @State private var displayName = ""
    @State private var basis = ""
    @State private var incidentId: String?
    @State private var storeIds: Set<String> = []
    @State private var expiry = Calendar.current.date(byAdding: .day, value: 90, to: Date()) ?? Date()
    @State private var reviewDate = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date()
    @State private var incidents: Loadable<[IncidentSummary]> = .idle
    @State private var errors: [String: String] = [:]
    @State private var error: UserFacingError?
    @State private var busy = false
    @State private var initialized = false

    var body: some View {
        ScreenScaffold(title: L("Enroll subject"), subtitle: L("Creates a draft for review. Matching is not active until approved.")) {
            if !appState.can(.watchlistManage) {
                PermissionDeniedView()
            } else {
                form
            }
        }
        .onAppear {
            guard !initialized else { return }
            initialized = true
            incidentId = sourceIncidentId
            if let store = appState.selectedStoreId { storeIds = [store] }
        }
        .task { await loadIncidents() }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                LabeledInput(label: L("Reference ID"), hint: L("Internal reference. Do not enter a real name unless policy requires it."),
                             error: errors["reference"]) {
                    TextField(L("Required"), text: $reference)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }
                LabeledInput(label: L("Display name"), hint: L("Optional."), error: nil) {
                    TextField(L("Optional"), text: $displayName)
                }
            }
            .rgCard()

            VStack(alignment: .leading, spacing: 8) {
                Text(L("Incident")).font(.subheadline.weight(.semibold))
                Text(L("Choose the reviewed incident with a confirmed human outcome that supports this enrollment."))
                    .font(.caption).foregroundStyle(Color.rgSecondaryText)
                switch incidents {
                case .idle, .loading:
                    ProgressView()
                case .failed(let failure):
                    FieldError(text: failure.message)
                case .loaded(let items):
                    Picker(L("Supporting incident"), selection: $incidentId) {
                        Text(L("Select option")).tag(String?.none)
                        if let sourceIncidentId, !items.contains(where: { $0.id == sourceIncidentId }) {
                            Text(L("Incident from previous screen")).tag(String?.some(sourceIncidentId))
                        }
                        ForEach(items) { item in
                            Text(verbatim: "\(item.ref) · \(appState.format(item.capturedAt, storeId: item.storeId, style: .date))")
                                .tag(String?.some(item.id))
                        }
                    }
                    if items.isEmpty && sourceIncidentId == nil {
                        FieldHint(text: L("No confirmed incidents found in your stores. A subject can only be enrolled from a confirmed incident."))
                    }
                }
                FieldError(text: errors["incident"])
            }
            .rgCard()

            VStack(alignment: .leading, spacing: 12) {
                LabeledInput(label: L("Reason"), hint: L("Evidence basis: what was confirmed, by whom, and why enrollment is necessary."),
                             error: errors["basis"]) {
                    TextField(L("Required"), text: $basis, axis: .vertical)
                        .lineLimit(3...8)
                        .padding(.vertical, 8)
                }
            }
            .rgCard()

            VStack(alignment: .leading, spacing: 8) {
                Text(L("Scope")).font(.subheadline.weight(.semibold))
                StoreMultiSelect(stores: appState.me?.stores ?? [], selection: $storeIds)
                FieldError(text: errors["stores"])
            }
            .rgCard()

            VStack(alignment: .leading, spacing: 8) {
                DatePicker(L("Expiry"), selection: $expiry, in: today..., displayedComponents: .date)
                DatePicker(L("Review date"), selection: $reviewDate, in: today...max(expiry, today), displayedComponents: .date)
                FieldError(text: errors["dates"])
                FieldHint(text: L("Your organization's maximum profile expiry is enforced by the server."))
            }
            .environment(\.timeZone, storeTime.timeZone)
            .rgCard()

            VStack(alignment: .leading, spacing: 8) {
                Text(L("Photos")).font(.subheadline.weight(.semibold))
                Text(L("After saving, add quality-checked reference photos on the profile, then submit it for review."))
                    .font(.caption).foregroundStyle(Color.rgSecondaryText)
            }
            .rgCard()

            if let error { ErrorBanner(error: error) }
            Button {
                Task { await save() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Save"))
                }
            }
            .buttonStyle(.rgPrimaryWide)
            .disabled(busy)
        }
    }

    private var storeTime: StoreTime { appState.storeTime(for: storeIds.first ?? appState.selectedStoreId) }

    /// Start of the current store-local day (stable lower bound for pickers).
    private var today: Date { storeTime.dayBounds(containing: Date()).start }

    private func loadIncidents() async {
        guard case .idle = incidents else { return }
        incidents = .loading
        do {
            let page = try await appState.api.incidents(IncidentQuery(storeId: appState.selectedStoreId, status: .resolved,
                                                                      outcome: .confirmed, limit: 100))
            incidents = .loaded(page.items)
        } catch {
            incidents = .failed(appState.present(error))
        }
    }

    private func save() async {
        var found: [String: String] = [:]
        if reference.trimmingCharacters(in: .whitespaces).isEmpty { found["reference"] = L("Enter a reference ID.") }
        if incidentId == nil { found["incident"] = L("Choose the supporting confirmed incident.") }
        if basis.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { found["basis"] = L("Describe the evidence basis.") }
        if storeIds.isEmpty { found["stores"] = L("Choose at least one store.") }
        if reviewDate > expiry { found["dates"] = L("The review date must be on or before the expiry date.") }
        errors = found
        guard found.isEmpty, let incidentId else { return }
        busy = true
        defer { busy = false }
        do {
            let profile = try await appState.api.createWatchlistProfile(CreateWatchlistProfile(
                reference: reference.trimmingCharacters(in: .whitespaces),
                displayName: displayName.trimmingCharacters(in: .whitespaces).isEmpty ? nil : displayName.trimmingCharacters(in: .whitespaces),
                basis: basis.trimmingCharacters(in: .whitespacesAndNewlines),
                sourceIncidentId: incidentId,
                storeIds: Array(storeIds).sorted(),
                expiresAt: storeTime.endOfDay(expiry),
                reviewAt: storeTime.endOfDay(reviewDate)))
            appState.replaceTop(with: .profile(profile.id))
        } catch {
            let failure = appState.present(error)
            if case .validation(let fields) = failure.kind {
                for (key, _) in fields { errors[key] = failure.message }
            }
            self.error = failure
        }
    }
}

/// ios-22 — Enroll staff. Requires that the photo-use notice was recorded.
struct StaffEnrollView: View {
    @Environment(AppState.self) private var appState

    @State private var employeeId = ""
    @State private var name = ""
    @State private var roleContext = ""
    @State private var storeIds: Set<String> = []
    @State private var noticeRecorded = false
    @State private var expiry = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var errors: [String: String] = [:]
    @State private var error: UserFacingError?
    @State private var busy = false
    @State private var initialized = false

    var body: some View {
        ScreenScaffold(title: L("Enroll staff"), subtitle: L("Creates a draft for review. Photos are added on the profile.")) {
            if !appState.can(.staffManage) {
                PermissionDeniedView()
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledInput(label: L("Employee ID"), hint: nil, error: errors["reference"]) {
                            TextField(L("Required"), text: $employeeId)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                        }
                        LabeledInput(label: L("Name"), hint: nil, error: errors["display_name"]) {
                            TextField(L("Required"), text: $name)
                                .textContentType(.name)
                        }
                        LabeledInput(label: L("Role"), hint: L("Workflow context, for example cashier or security."),
                                     error: errors["role_context"]) {
                            TextField(L("Required"), text: $roleContext)
                        }
                    }
                    .rgCard()

                    VStack(alignment: .leading, spacing: 8) {
                        Text(L("Store")).font(.subheadline.weight(.semibold))
                        StoreMultiSelect(stores: appState.me?.stores ?? [], selection: $storeIds)
                        FieldError(text: errors["stores"])
                    }
                    .rgCard()

                    VStack(alignment: .leading, spacing: 8) {
                        Toggle(L("Notice recorded"), isOn: $noticeRecorded)
                            .tint(Color.rgPrimary)
                        FieldHint(text: L("Confirm the employee received the photo-use notice required by your policy."))
                        FieldError(text: errors["notice"])
                        DatePicker(L("Expiry"), selection: $expiry, in: today..., displayedComponents: .date)
                            .environment(\.timeZone, storeTime.timeZone)
                    }
                    .rgCard()

                    VStack(alignment: .leading, spacing: 8) {
                        Text(L("Photos")).font(.subheadline.weight(.semibold))
                        Text(L("After saving, add quality-checked reference photos on the profile, then submit it for review."))
                            .font(.caption).foregroundStyle(Color.rgSecondaryText)
                    }
                    .rgCard()

                    if let error { ErrorBanner(error: error) }
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            if busy { ProgressView().tint(Color.rgOnPrimary) }
                            Text(L("Save"))
                        }
                    }
                    .buttonStyle(.rgPrimaryWide)
                    .disabled(busy)
                }
            }
        }
        .onAppear {
            guard !initialized else { return }
            initialized = true
            if let store = appState.selectedStoreId { storeIds = [store] }
        }
    }

    private var storeTime: StoreTime { appState.storeTime(for: storeIds.first ?? appState.selectedStoreId) }

    /// Start of the current store-local day (stable lower bound for pickers).
    private var today: Date { storeTime.dayBounds(containing: Date()).start }

    private func save() async {
        var found: [String: String] = [:]
        if employeeId.trimmingCharacters(in: .whitespaces).isEmpty { found["reference"] = L("Enter the employee ID.") }
        if name.trimmingCharacters(in: .whitespaces).isEmpty { found["display_name"] = L("Enter the name.") }
        if roleContext.trimmingCharacters(in: .whitespaces).isEmpty { found["role_context"] = L("Enter the role.") }
        if storeIds.isEmpty { found["stores"] = L("Choose at least one store.") }
        if !noticeRecorded { found["notice"] = L("The photo-use notice must be recorded before enrollment.") }
        errors = found
        guard found.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let profile = try await appState.api.createStaffProfile(CreateStaffProfile(
                reference: employeeId.trimmingCharacters(in: .whitespaces),
                displayName: name.trimmingCharacters(in: .whitespaces),
                storeIds: Array(storeIds).sorted(),
                roleContext: roleContext.trimmingCharacters(in: .whitespaces),
                noticeRecorded: true,
                expiresAt: storeTime.endOfDay(expiry)))
            appState.replaceTop(with: .profile(profile.id))
        } catch {
            let failure = appState.present(error)
            if case .validation(let fields) = failure.kind {
                for (key, _) in fields { errors[key] = failure.message }
            }
            self.error = failure
        }
    }
}
