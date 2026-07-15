import Foundation
import UserNotifications

/// APNs delegate for iOS push notification handling.
/// Manages token registration, foreground/background/terminated notification handling.
class APNsDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = APNsDelegate()

    private override init() {
        super.init()
    }

    // MARK: - Permission Request

    func requestPermission(completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            DispatchQueue.main.async {
                if let error = error {
                    print("[APNs] Permission error: \(error.localizedDescription)")
                    completion(false)
                    return
                }
                completion(granted)
            }
        }
    }

    // MARK: - Token Registration

    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[APNs] Device token: \(token)")
        // TODO: Register token with NotificationManager via KMP bridge
    }

    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[APNs] Registration failed: \(error.localizedDescription)")
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Called when notification received while app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        print("[APNs] Foreground notification: \(userInfo)")

        // Show banner even in foreground
        completionHandler([.banner, .badge, .sound])
    }

    /// Called when user taps on notification
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        print("[APNs] Notification tapped: \(userInfo)")

        // Extract deep link and route
        if let deepLink = userInfo["deepLink"] as? String ?? userInfo["link"] as? String {
            NotificationCenter.default.post(
                name: .init("DeepLinkNotification"),
                object: nil,
                userInfo: ["url": deepLink]
            )
        }

        completionHandler()
    }
}
