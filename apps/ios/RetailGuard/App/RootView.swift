import SwiftUI
import RetailGuardCore

/// Switches between the authentication/onboarding flow and the main tabs.
struct RootView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            switch appState.phase {
            case .launching:
                LaunchView()
            case .welcome:
                WelcomeView()
            case .login:
                LoginView()
            case .mfa(let stage):
                MFAView(stage: stage)
            case .locked:
                LockedView()
            case .sessionExpired:
                SessionExpiredView()
            case .onboardingFaceID:
                FaceIDSetupView()
            case .onboardingNotifications:
                NotificationPermissionView()
            case .selectStore:
                NavigationStack { StoreSelectionView(isOnboarding: true) }
            case .main:
                MainTabView()
            case .offlineLaunch:
                NavigationStack { OfflineView() }
            }
        }
        .animation(.rgDefault(reduceMotion: reduceMotion), value: appState.phase)
    }
}

struct LaunchView: View {
    var body: some View {
        VStack(spacing: 16) {
            BrandMark()
            ProgressView()
                .accessibilityLabel(L("Loading…"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.rgBackground.ignoresSafeArea())
    }
}

struct BrandMark: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.rgOnPrimary)
                .frame(width: 44, height: 44)
                .background(Color.rgPrimary, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            Text(verbatim: "RetailGuard")
                .font(.title.bold())
                .foregroundStyle(Color.rgInk)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Ayonix RetailGuard")
    }
}

struct MainTabView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        TabView(selection: $appState.selectedTab) {
            tab(.home) { HomeView() }
                .tabItem { Label(L("Home"), systemImage: "house") }
                .tag(AppTab.home)
            tab(.alerts) { AlertsView() }
                .tabItem { Label(L("Alerts"), systemImage: "bell.badge") }
                .tag(AppTab.alerts)
            tab(.search) { SearchView() }
                .tabItem { Label(L("Search"), systemImage: "magnifyingglass") }
                .tag(AppTab.search)
            tab(.history) { HistoryView() }
                .tabItem { Label(L("History"), systemImage: "list.bullet.rectangle") }
                .tag(AppTab.history)
            tab(.account) { AccountView() }
                .tabItem { Label(L("Account"), systemImage: "gearshape") }
                .tag(AppTab.account)
        }
    }

    private func tab<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: appState.path(for: tab)) {
            content()
                .navigationDestination(for: Route.self) { route in
                    RouteDestination(route: route)
                }
        }
    }
}
