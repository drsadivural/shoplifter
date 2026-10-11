import SwiftUI
import UIKit
import UserNotifications
import RetailGuardCore

@main
struct RetailGuardApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            AppContainer()
                .environment(appDelegate.appState)
        }
        .onChange(of: scenePhase) { _, newPhase in
            appDelegate.appState.handleScenePhase(newPhase)
        }
    }
}

/// Applies appearance/language overrides and runs launch once.
private struct AppContainer: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        RootView()
            // Rebuild the hierarchy when the in-app language changes so every
            // L() lookup re-resolves. Launch state lives in AppState and is
            // unaffected.
            .id(appState.preferences.language)
            .environment(\.locale, Localizer.locale)
            .preferredColorScheme(appState.preferences.appearance.colorScheme)
            .tint(Color.rgPrimary)
            .task { await appState.launch() }
    }
}

/// Owns `AppState` so APNs callbacks and notification taps reach it.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let appState = AppState()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        appState.push.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        appState.push.didFailToRegister(error)
    }

    // Foreground delivery: show a banner and refresh the inbox from the API.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let valid = (try? PushPayload.parse(userInfo: notification.request.content.userInfo)) != nil
        completionHandler(valid ? [.banner, .list, .sound] : [])
        if valid {
            Task { @MainActor in self.appState.requestInboxReload() }
        }
    }

    // Tap: authenticate → fetch current incident → open detail. The payload
    // only provides the incident ID; nothing from it is displayed as fact.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let incidentId = (try? PushPayload.parse(userInfo: response.notification.request.content.userInfo))?.incidentId
        completionHandler()
        if let incidentId {
            Task { @MainActor in self.appState.handleNotificationTap(incidentId: incidentId) }
        }
    }
}
