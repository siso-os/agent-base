// Synthetic WKWebView scheduling probe. No window is ever ordered on screen, no external URL is loaded.
// Mirrors wry's setHidden and WKPreferences.inactiveSchedulingPolicy used by browser_prefetch.
import AppKit
import WebKit

final class Probe: NSObject, WKNavigationDelegate {
    let app = NSApplication.shared
    let window = NSWindow(contentRect: NSRect(x: 20000, y: 0, width: 1000, height: 700), styleMask: .borderless, backing: .buffered, defer: false)
    var view: WKWebView!
    var index = 0
    var results: [[String: Any]] = []
    var start: [String: Any] = [:]
    var pid: Int = 0
    let modes = ["disabled-before", "default-candidate", "disabled-restore"]
    func begin() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.inactiveSchedulingPolicy = .none // Load/query while awake, then apply the tested policy.
        view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 700), configuration: config)
        view.navigationDelegate = self
        window.contentView!.addSubview(view)
        view.isHidden = true
        // Busy timer is a deliberately bounded synthetic third-party page workload, not app content.
        view.loadHTMLString("""
        <title>Synthetic hidden prefetch</title><p>Fixture</p><script>
        window.fixture={count:0,busyMs:0,nonce:Math.random().toString(36)};
        setInterval(()=>{const t=performance.now();while(performance.now()-t<4){};fixture.busyMs+=performance.now()-t;fixture.count++},20);
        </script>
        """, baseURL: nil)
    }
    func cpu() -> Double {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/ps")
        p.arguments = ["-p", String(pid), "-o", "time="]
        let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return -1 }
        let text = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        p.waitUntilExit()
        let nums = text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ":").compactMap { Double($0) }
        return nums.count == 2 ? nums[0]*60+nums[1] : -1
    }
    func snap(_ done: @escaping ([String: Any]) -> Void) {
        let before = ProcessInfo.processInfo.systemUptime
        let cpuSeconds = cpu()
        view.evaluateJavaScript("({...fixture,hidden:document.hidden,ready:document.readyState})") { value, error in
            var result = value as? [String: Any] ?? ["error": String(describing: error)]
            result["monotonic"] = before; result["cpuSeconds"] = cpuSeconds
            result["evalMs"] = (ProcessInfo.processInfo.systemUptime-before)*1000
            done(result)
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let selector = NSSelectorFromString("_webProcessIdentifier")
        if view.responds(to: selector), let value = view.value(forKey: "_webProcessIdentifier") as? NSNumber { pid = value.intValue }
        guard pid > 0 else { print("Missing owned WebContent PID"); exit(2) }
        fputs("loaded \(modes[index]) pid \(pid)\n", stderr)
        self.snap { initial in
            let policy = self.index == 1 ? WKPreferences().inactiveSchedulingPolicy : WKPreferences.InactiveSchedulingPolicy.none
            self.view.configuration.preferences.inactiveSchedulingPolicy = policy
            // Do not evaluate JS during a suspended window: querying can wake it or wait indefinitely.
            DispatchQueue.main.asyncAfter(deadline: .now()+15) {
                let startCPU = self.cpu(), startTime = ProcessInfo.processInfo.systemUptime
                DispatchQueue.main.asyncAfter(deadline: .now()+20) {
                    let endCPU = self.cpu(), endTime = ProcessInfo.processInfo.systemUptime
                    self.view.configuration.preferences.inactiveSchedulingPolicy = .none
                    self.snap { end in
                        self.results.append(["mode": self.modes[self.index], "pid": self.pid, "policy": policy.rawValue,
                            "cpuSeconds": endCPU-startCPU, "elapsedSeconds": endTime-startTime, "initial": initial, "end": end,
                            "sameDocument": initial["nonce"] as? String == end["nonce"] as? String])
                        fputs("finished \(self.modes[self.index]) cpu \(endCPU-startCPU)\n", stderr)
                        self.view.stopLoading(); self.view.navigationDelegate = nil
                        self.view.removeFromSuperview(); self.view = nil
                        self.index += 1
                        if self.index < self.modes.count { self.begin() }
                        else {
                            let data = try! JSONSerialization.data(withJSONObject: ["scope":"native hidden synthetic WKWebView timer workload; not live app or GPU", "results":self.results], options:[.prettyPrinted,.sortedKeys])
                            print(String(data:data,encoding:.utf8)!); exit(0)
                        }
                    }
                }
            }
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = Probe()
DispatchQueue.main.async { probe.begin() }
DispatchQueue.main.asyncAfter(deadline: .now()+160) { let data = try! JSONSerialization.data(withJSONObject: ["timeout":true,"partial":probe.results], options:[.prettyPrinted]); print(String(data:data,encoding:.utf8)!); fputs("probe timeout\n",stderr); exit(3) }
app.run()
