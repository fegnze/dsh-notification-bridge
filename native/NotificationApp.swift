import AppKit
import UserNotifications

// Local-only app identity; no impersonation of the DSH bundle identifier.
final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let center = UNUserNotificationCenter.current()
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/MySpaceNotifications")
    var timer: Timer?
    var busy = Set<String>()
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        center.delegate = self
        do { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { NSApp.terminate(nil); return }
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: root.path),
              attrs[.type] as? FileAttributeType == .typeDirectory,
              (attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else { NSApp.terminate(nil); return }
        do { try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path) }
        catch { NSApp.terminate(nil); return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in self.scan() }
        scan()
    }
    func reply(_ id: String, _ value: [String: Any]) {
        defer { busy.remove(id) }
        do {
            let data = try JSONSerialization.data(withJSONObject: value)
            let file = root.appendingPathComponent(id + ".response")
            try data.write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        } catch { NSLog("Notification response failed: %@", String(describing: error)) }
    }
    func scan() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey, .isSymbolicLinkKey]) else { return }
        for file in files.prefix(256) {
            let id = file.deletingPathExtension().lastPathComponent
            guard UUID(uuidString: id) != nil else { continue }
            if let attrs = try? file.resourceValues(forKeys: [.contentModificationDateKey, .isSymbolicLinkKey]), attrs.isSymbolicLink == true { continue }
            if let attrs = try? file.resourceValues(forKeys: [.contentModificationDateKey]), let date = attrs.contentModificationDate, Date().timeIntervalSince(date) > 120 {
                try? FileManager.default.removeItem(at: file); continue
            }
            guard file.pathExtension == "request", !busy.contains(id) else { continue }
            busy.insert(id)
            guard let data = try? Data(contentsOf: file), data.count <= 16384,
                  let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                try? FileManager.default.removeItem(at: file)
                reply(id, ["ok": false, "error": "invalid request"]); continue
            }
            try? FileManager.default.removeItem(at: file)
            switch request["operation"] as? String {
            case "status":
                center.getNotificationSettings { settings in
                    DispatchQueue.main.async { self.reply(id, ["ok": true, "authorization": settings.authorizationStatus.rawValue]) }
                }
            case "authorize":
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                    DispatchQueue.main.async { self.reply(id, ["ok": granted, "error": error?.localizedDescription ?? (granted ? "" : "notification permission denied")]) }
                }
            case "send":
                guard let title = request["title"] as? String, !title.isEmpty, title.count <= 200,
                      let body = request["body"] as? String, body.count <= 2000,
                      let subtitle = request["subtitle"] as? String, subtitle.count <= 300 else {
                    reply(id, ["ok": false, "error": "invalid notification fields"]); continue
                }
                center.getNotificationSettings { settings in
                    guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                        DispatchQueue.main.async { self.reply(id, ["ok": false, "error": "notification permission not granted; run authorize"]) }; return
                    }
                    let content = UNMutableNotificationContent()
                    content.title = title; content.body = body; content.subtitle = subtitle
                    if request["sound"] as? Bool == true { content.sound = .default }
                    content.userInfo = ["action": request["action"] as? String ?? "none"]
                    self.center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
                        DispatchQueue.main.async { self.reply(id, ["ok": error == nil, "accepted": error == nil, "error": error?.localizedDescription ?? ""]) }
                    }
                }
            default: reply(id, ["ok": false, "error": "unknown operation"])
            }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completion: @escaping (UNNotificationPresentationOptions) -> Void) {
        completion([.banner, .list, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completion: @escaping () -> Void) {
        if response.notification.request.content.userInfo["action"] as? String == "open-dsh" {
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: "/Applications/DeepSeek Harness.app"), configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
        }
        completion()
    }
}
let delegate = Delegate()
let app = NSApplication.shared
app.delegate = delegate
app.run()
