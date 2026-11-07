import UIKit
import Capacitor

/// W1095 — the UIScene life cycle.
///
/// Apple: starting with iOS 27, an app BUILT WITH THE iOS 27 SDK (Xcode 27) must use the
/// scene-based life cycle or it fails to launch. Capacitor 6's app shell predates that rule
/// (an app delegate + Main.storyboard, no scene), so build 595 (3.0.15, the first App Store
/// build made with Xcode 27) closed at launch on every iOS 27 phone — Kat and Galilea,
/// 2026-10-24/25 — while iOS 26 phones ran it fine.
///
/// UIKit builds this scene's window and loads Main.storyboard (Capacitor's bridge view
/// controller) into it from the scene configuration (Info.plist UIApplicationSceneManifest,
/// and AppDelegate's configurationForConnecting, both written by scripts/prep-local-build.sh
/// step 8e). This class only forwards the links that used to reach the app delegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        for context in connectionOptions.urlContexts {
            openLink(context.url)
        }
        for activity in connectionOptions.userActivities {
            continueActivity(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            openLink(context.url)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        continueActivity(userActivity)
    }

    private func openLink(_ url: URL) {
        let app: UIApplication = UIApplication.shared
        let options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        _ = ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    private func continueActivity(_ activity: NSUserActivity) {
        let app: UIApplication = UIApplication.shared
        _ = ApplicationDelegateProxy.shared.application(app, continue: activity, restorationHandler: { _ in })
    }
}
