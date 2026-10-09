import AppKit
import AVFoundation
import CoreGraphics
import Foundation

// Native APIs stay behind an explicit owner gate. Test mode substitutes OS I/O,
// but uses the same hotkey session and transcription lifecycle.
// Idle costs nothing: the owner is read with one held request to the node (it answers when the
// owner or the bar changes, or after 10 s) and the parent's exit is a kqueue source, not a timer.
// The voice bar (t-0500) lives here too, so it floats over every app without another process.
let env = ProcessInfo.processInfo.environment
let testMode = env["AB_DICTATION_TEST"] == "1"
let base = URL(string: "http://127.0.0.1:\(env["AB_PORT"] ?? "5401")")!
var engineChild: pid_t = 0
let stampFormat: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"; return f }()
/// One line per event on stderr, which launchd writes to ~/Library/Logs/com.siso.agent-base/voice.log: presses, the mic,
/// each part's answer, what the self-check fixed. Never the words, never audio (9 Oct: the log had stayed empty all night).
func say(_ line: String) {
    FileHandle.standardError.write(Data("\(stampFormat.string(from: Date())) [\(getpid())] \(line)\n".utf8))
}
/** The node's retry queue (dictation.ts `pending`): a recording the node never answered for waits there, not in /tmp. */
/// `id` is the take's own id, sent to the node too: if the node already saved its copy under it, that one stands.
func keepForRetry(_ url: URL, id: String, app: String, bundle: String) -> Bool {
    let dir = URL(fileURLWithPath: env["AB_DICTATION_DIR"] ?? (NSHomeDirectory() + "/.local/state/agent-base/dictation")).appendingPathComponent("pending")
    let meta: [String: Any] = ["id": id, "at": ISO8601DateFormatter().string(from: Date()), "app": app, "bundleId": bundle, "tries": 0]
    if FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id).wav").path) { try? FileManager.default.removeItem(at: url); return true }
    do {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        // Metadata first: if moving the audio fails, the original still exists.
        let data = try JSONSerialization.data(withJSONObject: meta)
        try data.write(to: dir.appendingPathComponent("\(id).json"), options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: dir.appendingPathComponent("\(id).json").path)
        try FileManager.default.moveItem(at: url, to: dir.appendingPathComponent("\(id).wav"))
        return true
    } catch {
        return false
    }
}

// Parts can answer in any order, including while a later take is recording.
final class DictationTake {
    let epoch: Int
    var submitted = 0, pending = 0
    var texts: [Int: String] = [:]
    var stopped = false, cancelled = false, completed = false, saved = false
    var error = ""
    var noSpeech = ""
    var pasteOnFinish = true
    var app: NSRunningApplication?
    /// The self-check's view of the take: when it began, the loudest meter reading, how often the mic was revived.
    let began = Date()
    var peak: Float = -160
    var revived = 0
    init(epoch: Int) { self.epoch = epoch }
}

final class Dictation {
    var tap: CFMachPort?
    var source: CFRunLoopSource?
    var recorder: AVAudioRecorder?
    var recordURL: URL?
    /// Test mode's stand-in for the focused app; the harness moves it to prove the words follow him (t-0506).
    var testRollFailure = env["AB_DICTATION_TEST_ROLL_FAIL"] == "1"
    var testFocus = (app: env["AB_DICTATION_TEST_APP"] ?? "Fake Editor", bundle: env["AB_DICTATION_TEST_BUNDLE"] ?? "com.fake.editor", typeable: true)
    var owner = false
    var wantsOwnership = false
    var registering = false
    var polling = false
    var recording = false
    var mode = "hold"
    var ownershipEpoch = 0
    var take: DictationTake?
    var deferredNotice = ""
    var roll: Timer?
    // Even an accidentally large override cannot grow a part beyond four minutes (~7.7 MB).
    let rollSeconds: TimeInterval = {
        let value = Double(env["AB_DICTATION_ROLL_S"] ?? "") ?? 240
        return value.isFinite && value > 0 ? min(value, 240) : 240
    }()
    var actionCount = 0
    var nativeError = ""
    var holdDown = false
    var toggleDown = false
    var barWanted = true
    var rev = -1
    var meter: Timer?
    var bar: VoiceBar? = testMode ? nil : VoiceBar()
    /// The self-check (9 Oct, "not hearing anything"): the tap is looked at with each answer of the held owner request
    /// (about every 10 s, no timer of its own) and after sleep; a held Fn whose release was lost under load is let go; a
    /// mic that sends nothing is restarted. `issue` is its last finding.
    var issue = ""
    var issueAt = Date.distantPast
    var silentTicks = 0
    var releaseTicks = 0
    var fnVisible = false
    var tapRearms = 0

    var micWord: String {
        if testMode { return "test" }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not-asked"
        @unknown default: return "unknown"
        }
    }
    var deviceName: String { testMode ? "Test mic" : (AVCaptureDevice.default(for: .audio)?.localizedName ?? "no input device") }
    func note(_ finding: String) { issue = "\(finding) (\(stampFormat.string(from: Date()).dropFirst(11).prefix(5)))"; issueAt = Date(); say("self-check: \(finding)"); heartbeat() }

    func record(_ action: String, _ extra: [String: Any] = [:]) {
        guard testMode else { return }
        actionCount += 1
        let value: [String: Any] = extra.merging(["action": action, "count": actionCount]) { $1 }
        if let data = try? JSONSerialization.data(withJSONObject: value) {
            FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
        }
    }
    func json(_ object: [String: Any], path: String) {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = "POST"; request.timeoutInterval = 3
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: object)
        URLSession.shared.dataTask(with: request).resume()
    }
    func phase(_ value: String, error: String = "") {
        json(["phase": value, "error": error], path: "/api/dictation/events")
        DispatchQueue.main.async { self.bar?.show(phase: value, error: error) }
    }
    func heartbeat() {
        // A finding is news for ten minutes; after that the page goes back to what is true now.
        if !issue.isEmpty && Date().timeIntervalSince(issueAt) > 600 { issue = "" }
        var body: [String: Any] = ["registered": owner, "permission": testMode || AXIsProcessTrusted(), "error": nativeError, "issue": issue]
        if !testMode { body["mic"] = micWord; body["device"] = deviceName; if owner, let tap { body["tap"] = CFMachPortIsValid(tap) && CGEvent.tapIsEnabled(tap: tap) } }
        json(body, path: "/api/dictation/native")
    }
    func pollOwner() {
        guard !polling else { return }; polling = true
        var parts = URLComponents(url: base.appendingPathComponent("/api/dictation/status"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "rev", value: String(rev))]
        var request = URLRequest(url: parts.url!); request.timeoutInterval = 20
        let sent = Date()
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }; self.polling = false
                guard (response as? HTTPURLResponse)?.statusCode == 200, let data,
                      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let next = value["owner"] as? String else {
                    // Keep the last confirmed owner through outages, including while stopped
                    // parts are finishing. Only an explicit handoff or parent exit releases it.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.pollOwner() }
                    return
                }
                self.wantsOwnership = next == "agent-base"
                if self.wantsOwnership && !self.owner && !self.registering { self.register() }
                if !self.wantsOwnership && (self.owner || self.registering) { self.release() }
                self.barWanted = (value["bar"] as? Bool) ?? true
                self.bar?.setAvailable(self.owner && self.barWanted)
                self.checkTap(reason: "watch")
                self.heartbeat()
                // A node that does not hold the request (no rev) is asked again a little later, as before.
                let held = value["rev"] as? Int
                if let held { self.rev = held }
                let again = held == nil && Date().timeIntervalSince(sent) < 0.25 ? 0.3 : 0
                DispatchQueue.main.asyncAfter(deadline: .now() + again) { self.pollOwner() }
            }
        }.resume()
    }
    func register() {
        nativeError = ""
        if testMode { owner = true; heartbeat(); return }
        guard AXIsProcessTrusted() else { nativeError = "Allow Agent Base in System Settings → Privacy & Security → Accessibility, then switch again."; heartbeat(); return }
        registering = true
        let finish: (Bool) -> Void = { allowed in
            DispatchQueue.main.async {
                self.registering = false
                guard self.wantsOwnership else { return }
                guard allowed else { self.nativeError = "Allow Agent Base in System Settings → Privacy & Security → Microphone, then switch again."; say("register: no microphone permission"); self.heartbeat(); return }
                guard self.installTap() else {
                    self.nativeError = "The global hotkey could not register. Check Accessibility and Input Monitoring permissions."; say("register: the hotkey tap could not be created"); self.heartbeat(); return
                }
                self.owner = true; say("registered · mic \(self.deviceName) (\(self.micWord))"); self.heartbeat()
                self.bar?.setAvailable(self.barWanted)
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: finish(true)
        case .notDetermined: AVCaptureDevice.requestAccess(for: .audio, completionHandler: finish)
        default: finish(false)
        }
    }
    /// The hotkey's event tap, on the main run loop. Used at registration and again when the self-check re-arms it.
    func installTap() -> Bool {
        removeTap()
        let mask = CGEventMask(1) << CGEventType.flagsChanged.rawValue
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: { _, type, event, info in
            let me = Unmanaged<Dictation>.fromOpaque(info!).takeUnretainedValue()
            return me.handle(type, event) ? nil : Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let tap, let made = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            if let tap { CFMachPortInvalidate(tap) }; tap = nil; return false
        }
        source = made; CFRunLoopAddSource(CFRunLoopGetMain(), made, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }
    func removeTap() {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }; source = nil; tap = nil
    }
    /// While it holds the hotkey: a tap macOS switched off is switched on, a dead one is made again.
    func checkTap(reason: String) {
        guard owner, !testMode else { return }
        if let tap, CFMachPortIsValid(tap) {
            if CGEvent.tapIsEnabled(tap: tap) && reason == "watch" { return }
            CGEvent.tapEnable(tap: tap, enable: true)
            if CGEvent.tapIsEnabled(tap: tap) {
                if reason != "watch" { say("tap re-armed after \(reason)") } else { tapRearms += 1; note("The hotkey had been switched off by macOS; switched it back on") }
                resyncKeys(); heartbeat(); return
            }
        }
        if installTap() { tapRearms += 1; note("The hotkey had stopped (\(reason)); made it again") }
        else { nativeError = "The global hotkey stopped and could not be made again. Check Accessibility and Input Monitoring."; say("self-check: the tap could not be made again (\(reason))"); heartbeat() }
        resyncKeys()
    }
    /// A key release lost while the tap was off (load, sleep) would leave hold-to-talk recording: read the keys as they are.
    func resyncKeys() {
        guard !testMode, recording, mode == "hold", holdDown, fnVisible else { return }
        if !CGEventSource.flagsState(.combinedSessionState).contains(.maskSecondaryFn) { say("self-check: Fn was let go while the hotkey was off; stopping the take"); key("hold", down: false) }
    }
    func release() {
        ownershipEpoch += 1; take?.cancelled = true; take = nil; stopRoll(); owner = false; wantsOwnership = false; registering = false
        holdDown = false; toggleDown = false; deferredNotice = ""
        stopMeter(); recorder?.stop(); recorder = nil
        if let url = recordURL { try? FileManager.default.removeItem(at: url) }
        recordURL = nil
        if recording { record("record-cancel") }; recording = false
        bar?.setAvailable(false)
        removeTap()
        nativeError = ""; say("released the hotkey"); phase("idle"); heartbeat()
    }
    func key(_ kind: String, down: Bool) {
        guard owner else { return }
        if kind == "hold" {
            guard holdDown != down else { return }; holdDown = down
            if down { start("hold") } else if mode == "hold" { stopRecording() }
        } else {
            guard toggleDown != down else { return }; toggleDown = down
            if down { recording ? stopRecording() : start("toggle") }
        }
    }
    /** The bar's own buttons: the pill (or ✓) is the toggle key; ✕ throws the take away. */
    func barToggle() { guard owner else { return }; recording ? stopRecording() : start("toggle") }
    func cancel() {
        guard recording else { return }
        take?.cancelled = true; take = nil; stopRoll(); recording = false; stopMeter(); recorder?.stop(); recorder = nil
        if let url = recordURL { try? FileManager.default.removeItem(at: url) }
        recordURL = nil; holdDown = false; record("record-cancel"); say("take thrown away (✕)"); phase("idle")
    }
    func startMeter() {
        guard !testMode else { return }
        meter?.invalidate()
        silentTicks = 0; releaseTicks = 0
        meter = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self, let recorder = self.recorder else { return }
            recorder.updateMeters()
            let db = recorder.averagePower(forChannel: 0)
            self.bar?.push(level: CGFloat(max(0, min(1, (db + 52) / 46))))
            self.selfCheck(recorder, db)
        }
        RunLoop.main.add(meter!, forMode: .common)
    }
    func stopMeter() { meter?.invalidate(); meter = nil }
    /// Thirty times a second while recording. A working mic never reads below about -90 dB, even in a silent room; a
    /// recorder that stopped, or 1.5 s of nothing at all, means the input went away (a device change, a lost grant), so the
    /// take moves to a fresh recorder on the current input, at most twice. A Fn release the tap missed ends a held take.
    func selfCheck(_ recorder: AVAudioRecorder, _ db: Float) {
        guard let take else { return }
        take.peak = max(take.peak, db)
        silentTicks = (db <= -100 || !recorder.isRecording) ? silentTicks + 1 : 0
        if silentTicks >= 45 && take.revived < 2 {
            silentTicks = 0; take.revived += 1
            let why = !recorder.isRecording ? "the recorder stopped" : "the mic sent nothing for 1.5 s"
            note("\(why) on \(deviceName); restarted it")
            rollPart()
        }
        if mode == "hold" && holdDown && fnVisible {
            releaseTicks = CGEventSource.flagsState(.combinedSessionState).contains(.maskSecondaryFn) ? 0 : releaseTicks + 1
            if releaseTicks >= 12 { releaseTicks = 0; say("self-check: Fn is up but its release never arrived; stopping the take"); key("hold", down: false) }
        }
    }
    func handle(_ type: CGEventType, _ event: CGEvent) -> Bool {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            say("macOS switched the hotkey off (\(type == .tapDisabledByTimeout ? "timeout: the Mac was busy" : "user input")); switched it back on")
            DispatchQueue.main.async { self.resyncKeys() }
            return false
        }
        guard owner, type == .flagsChanged else { return false }
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if code == 63 { key("hold", down: event.flags.contains(.maskSecondaryFn)); return true }
        // NX_DEVICERALT distinguishes Right Option when Left Option remains held.
        if code == 61 { key("toggle", down: event.flags.rawValue & 0x40 != 0); return true }
        return false
    }
    /// The next recorder is running before the old one stops, keeping the boundary gap minimal.
    func newPart() throws -> (AVAudioRecorder?, URL) {
        // Test audio stays inside the harness's owned scratch directory, even on a failed retry.
        let directory = testMode && env["AB_DICTATION_TEST_AUDIO"] != nil
            ? URL(fileURLWithPath: env["AB_DICTATION_TEST_AUDIO"]!).deletingLastPathComponent()
            : FileManager.default.temporaryDirectory
        let url = directory.appendingPathComponent("agent-base-dictation-\(UUID().uuidString).wav")
        do {
            if testMode {
                guard let fixture = env["AB_DICTATION_TEST_AUDIO"] else { throw NSError(domain: "dictation", code: 1) }
                try FileManager.default.copyItem(at: URL(fileURLWithPath: fixture), to: url)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
                return (nil, url)
            }
            let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
            let next = try AVAudioRecorder(url: url, settings: settings)
            next.isMeteringEnabled = true
            guard next.prepareToRecord() else { throw NSError(domain: "dictation", code: 1) }
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            guard next.record() else { throw NSError(domain: "dictation", code: 1) }
            return (next, url)
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }
    func start(_ mode: String) {
        guard owner, !recording else { return }
        self.mode = mode
        do {
            let (next, url) = try newPart()
            recorder = next; recordURL = url
        } catch {
            say("press (\(mode)) but the mic did not start: \(deviceName), \(micWord)")
            phase("error", error: micWord == "authorized" ? "The microphone (\(deviceName)) did not start. Check the input device." : "Microphone access is off: System Settings → Privacy & Security → Microphone."); return
        }
        take = DictationTake(epoch: ownershipEpoch)
        fnVisible = !testMode && mode == "hold" && CGEventSource.flagsState(.combinedSessionState).contains(.maskSecondaryFn)
        say("start \(mode) · \(deviceName) · mic \(micWord)")
        recording = true; record("record-start"); phase("recording"); startMeter()
        let timer = Timer(timeInterval: rollSeconds, repeats: true) { [weak self] _ in self?.rollPart() }
        RunLoop.main.add(timer, forMode: .common); roll = timer
    }
    func stopRoll() { roll?.invalidate(); roll = nil }
    func rollPart() {
        guard recording, let take, let oldURL = recordURL else { return }
        do {
            if testMode && testRollFailure { throw NSError(domain: "dictation", code: 2) }
            let (next, url) = try newPart()
            let previous = recorder
            recorder = next; recordURL = url
            previous?.stop()
            record("record-roll")
            sendPart(oldURL, take: take)
        } catch {
            // Keep the finished audio and make the device failure visible immediately, never silently idle.
            take.error = "The microphone stopped. Your recorded parts are saved; check the input device."
            stopRecording(pasteOnFinish: false)
            phase("error", error: take.error)
        }
    }
    func stopRecording(pasteOnFinish: Bool = true) {
        guard recording, let take, let url = recordURL else { return }
        recording = false; stopRoll(); stopMeter(); recorder?.stop(); recorder = nil; recordURL = nil
        self.take = nil; take.stopped = true; take.pasteOnFinish = pasteOnFinish
        // Capture the app only at the user's stop, even when earlier parts have already answered.
        take.app = testMode ? nil : NSWorkspace.shared.frontmostApplication
        do { say(String(format: "stop · %.1f s · peak %.0f dB · %d part(s) · into %@", Date().timeIntervalSince(take.began), take.peak, take.submitted + 1, take.app?.localizedName ?? "?")) }
        record("record-stop"); phase("transcribing")
        sendPart(url, take: take)
    }
    func sendPart(_ url: URL, take: DictationTake) {
        let index = take.submitted; take.submitted += 1; take.pending += 1
        let app = take.stopped ? take.app : (testMode ? nil : NSWorkspace.shared.frontmostApplication)
        let name = testMode ? testFocus.app : (app?.localizedName ?? "Unknown app")
        let bundle = testMode ? testFocus.bundle : (app?.bundleIdentifier ?? "")
        let id = UUID().uuidString.lowercased()
        guard let audio = try? Data(contentsOf: url) else {
            say("part \(index): the recording could not be read; queued it")
            let retained = keepForRetry(url, id: id, app: name, bundle: bundle)
            take.saved = take.saved || retained
            if !retained { take.error = "Could not queue the audio. The recording is still on this Mac; check free disk space." }
            take.pending -= 1; finish(take); return
        }
        var parts = URLComponents(url: base.appendingPathComponent("/api/dictation/transcribe"), resolvingAgainstBaseURL: false)!
        // Native owns the take's phase; a part must not put the bar into Writing while the mic is on.
        parts.queryItems = [URLQueryItem(name: "app", value: name), URLQueryItem(name: "bundleId", value: bundle), URLQueryItem(name: "quiet", value: "1"), URLQueryItem(name: "id", value: id)]
        var request = URLRequest(url: parts.url!); request.httpMethod = "POST"; request.httpBody = audio; request.timeoutInterval = 600
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        record("part-send", ["part": index])
        let sent = Date()
        URLSession.shared.dataTask(with: request) { [weak self] data, response, failure in
            let status = (response as? HTTPURLResponse)?.statusCode
            do { say("part \(index) → \(status.map(String.init) ?? "no answer\(failure.map { " (\($0.localizedDescription))" } ?? "")") in \(Int(Date().timeIntervalSince(sent) * 1000)) ms · \(audio.count / 1024) kB") }
            let result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let text = result?["text"] as? String
            // 202 means the node already saved it. No answer or an invalid answer keeps our own copy for retry.
            let saved = status == 202 || status == nil || (status != 200 && status != 422) || (status == 200 && (text ?? "").isEmpty)
            var retained = status == 202
            if saved && status != 202 { retained = keepForRetry(url, id: id, app: name, bundle: bundle) }
            else { try? FileManager.default.removeItem(at: url) }
            DispatchQueue.main.async {
                guard let self else { return }
                take.pending -= 1
                if status == 200, let text, !text.isEmpty { take.texts[index] = text }
                else if saved {
                    take.saved = take.saved || retained
                    if !retained { take.error = "Could not queue the audio. The recording is still on this Mac; check free disk space." }
                }
                else { take.noSpeech = result?["error"] as? String ?? "No speech was recognized." }
                self.finish(take)
            }
        }.resume()
    }
    func finish(_ take: DictationTake) {
        guard owner, take.epoch == ownershipEpoch, !take.cancelled, take.stopped, take.pending == 0, !take.completed else { return }
        take.completed = true
        let text = (0..<take.submitted).compactMap { take.texts[$0] }.joined(separator: " ")
        var notices = [take.error, take.saved ? "Saved. I'll write the rest down in the background: Voice → History" : ""]
        if text.isEmpty && !take.saved {
            // Nothing heard at all is the mic, not him: say which mic, and where to fix it.
            if !testMode && take.peak <= -100 {
                notices.append(micWord == "authorized" ? "Your mic (\(deviceName)) sent nothing. Check System Settings → Sound → Input." : "Microphone access is off: System Settings → Privacy & Security → Microphone.")
                note("a take heard nothing at all on \(deviceName) (mic \(micWord))")
            } else { notices.append(take.noSpeech) }
        }
        do { say("take done · \(text.isEmpty ? (take.saved ? "saved for retry" : "nothing written") : "\(text.count) chars") · \(take.pasteOnFinish ? "paste" : "offer")") }
        if !recording && !deferredNotice.isEmpty { notices.append(deferredNotice) }
        let message = notices.filter { !$0.isEmpty }.joined(separator: " ")
        if recording && !message.isEmpty { deferredNotice = message }
        if !recording { deferredNotice = "" }
        guard !text.isEmpty else { if !recording { phase("error", error: message) }; return }
        if !take.pasteOnFinish {
            if !recording {
                record("offer")
                json(["phase": "error", "error": message], path: "/api/dictation/events")
                bar?.notice(message, offering: text)
            }
            return
        }
        paste(text, into: take.app, quiet: recording) { [weak self] pasted in
            guard let self, self.owner, take.epoch == self.ownershipEpoch, !self.recording, !message.isEmpty else { return }
            // Show the saved notice, then restore the same words and Copy fallback.
            if pasted { self.phase("error", error: message) }
            else {
                self.json(["phase": "error", "error": message], path: "/api/dictation/events")
                DispatchQueue.main.async { self.bar?.notice(message, offering: text) }
            }
        }
    }
    /// What has focus, and whether it takes typing. Only plain evidence of nowhere to type counts (no focused element,
    /// or a list, a button, a page with no field focused); when unsure it types, since the words are safe anyway.
    func focus() -> (typeable: Bool, role: String) {
        var focused: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute as CFString, &focused)
        if err == .noValue { return (false, "none") }
        guard err == .success, let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() else { return (true, "unknown(\(err.rawValue))") }
        let element = focused as! AXUIElement
        var roleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
        let role = roleRef as? String ?? "?"
        var settable: DarwinBoolean = false
        if AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue { return (true, role) }
        let notText: Set<String> = ["AXList", "AXOutline", "AXTable", "AXBrowser", "AXRow", "AXCell", "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuItem", "AXImage", "AXWebArea", "AXScrollArea"]
        return (!notText.contains(role), role)
    }
    /// The words go on the clipboard and stay there (they are in History already), then ⌘V types them where he is.
    /// Nowhere to type, or no Accessibility: the bar holds them with a Copy button. Never an error, never lost (t-0506).
    /// `strict` is the re-paste from History: it types only into the app the take came from.
    func paste(_ text: String, into app: NSRunningApplication?, quiet: Bool = false, strict: Bool = false, completion: @escaping (Bool) -> Void) {
        guard !text.isEmpty else { completion(false); return }
        if testMode {
            record("clipboard")
            if strict || testFocus.typeable { record("paste", ["bundle": testFocus.bundle, "text": text]); if !quiet { phase("pasting"); phase("idle") } }
            else { record("offer"); if !quiet { offer(text) } }
            completion(strict || testFocus.typeable); return
        }
        let pb = NSPasteboard.general
        pb.clearContents(); pb.setString(text, forType: .string)
        // The app he stopped in comes forward if something else took focus while the words were written.
        if let app, !app.isTerminated, NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier { app.activate(options: [.activateIgnoringOtherApps]) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            let front = NSWorkspace.shared.frontmostApplication
            let source = CGEventSource(stateID: .combinedSessionState)
            guard AXIsProcessTrusted(), front != nil, !strict || front?.processIdentifier == app?.processIdentifier, self.focus().typeable,
                  let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true), let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else {
                if !quiet && !strict { self.offer(text) }; completion(false); return
            }
            down.flags = .maskCommand; up.flags = .maskCommand
            down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
            if !quiet && !self.recording { self.phase("pasting") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { if !quiet && !self.recording { self.phase("idle") }; completion(true) }
        }
    }
    /// Nowhere to type: the words stay up on the bar with a Copy button.
    func offer(_ text: String) {
        json(["phase": "idle", "error": ""], path: "/api/dictation/events")
        DispatchQueue.main.async { self.bar?.offer(text) }
    }
}


// MARK: - The voice bar (t-0500, ui-hub/voice/v2/SPEC.md)

/// Agent Base's warm dark glass, his purple waves, amber for the one action.
enum BarInk {
    static let shell = NSColor(srgbRed: 0.090, green: 0.090, blue: 0.082, alpha: 0.95)
    static let rim = NSColor(white: 1, alpha: 0.11)
    static let text = NSColor(srgbRed: 0.925, green: 0.925, blue: 0.91, alpha: 1)
    static let muted = NSColor(srgbRed: 0.62, green: 0.62, blue: 0.596, alpha: 1)
    static let violet = NSColor(srgbRed: 0.66, green: 0.50, blue: 1.0, alpha: 1)
    static let pink = NSColor(srgbRed: 0.96, green: 0.42, blue: 0.86, alpha: 1)
    static let amber = NSColor(srgbRed: 1.0, green: 0.655, blue: 0.149, alpha: 1)
    static let onAmber = NSColor(srgbRed: 0.102, green: 0.071, blue: 0.035, alpha: 1)
    static let green = NSColor(srgbRed: 0.42, green: 0.86, blue: 0.56, alpha: 1)
    static let red = NSColor(srgbRed: 1.0, green: 0.38, blue: 0.44, alpha: 1)
}

enum BarState: Equatable { case idle, listening, writing, done, copied, error(String), offer(String) }

final class BarView: NSView {
    var state: BarState = .idle { didSet { needsDisplay = true } }
    var history = [CGFloat](repeating: 0, count: 46)
    var startedAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    var now: TimeInterval = ProcessInfo.processInfo.systemUptime
    var hover = false { didSet { if hover != oldValue { needsDisplay = true } } }
    var onToggle: (() -> Void)?, onCancel: (() -> Void)?, onCopy: (() -> Void)?, onDismiss: (() -> Void)?, onMenu: ((NSEvent) -> Void)?
    var onDragBegin: ((NSPoint) -> Void)?, onDrag: ((NSPoint) -> Void)?, onDragEnd: (() -> Void)?
    private var downAt: NSPoint?
    private var dragged = false
    private var tracking: NSTrackingArea?

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    var shell: NSRect { bounds.insetBy(dx: 3, dy: 3) }
    var stopRect: NSRect { NSRect(x: shell.maxX - 31, y: shell.midY - 13, width: 26, height: 26) }
    var cancelRect: NSRect { NSRect(x: shell.maxX - 61, y: shell.midY - 13, width: 26, height: 26) }
    var copyRect: NSRect { NSRect(x: shell.maxX - 62, y: shell.midY - 13, width: 57, height: 26) }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); tracking = area
    }
    override func mouseEntered(with event: NSEvent) { hover = true }
    override func mouseExited(with event: NSEvent) { hover = false }
    override func mouseDown(with event: NSEvent) { downAt = NSEvent.mouseLocation; dragged = false; onDragBegin?(NSEvent.mouseLocation) }
    override func mouseDragged(with event: NSEvent) {
        let at = NSEvent.mouseLocation
        if let downAt, hypot(at.x - downAt.x, at.y - downAt.y) > 3 { dragged = true }
        if dragged { onDrag?(at) }
    }
    override func mouseUp(with event: NSEvent) {
        defer { downAt = nil }
        if dragged { onDragEnd?(); return }
        let p = convert(event.locationInWindow, from: nil)
        switch state {
        case .idle: onToggle?()
        case .listening: if stopRect.insetBy(dx: -3, dy: -4).contains(p) { onToggle?() } else if cancelRect.insetBy(dx: -3, dy: -4).contains(p) { onCancel?() }
        case .offer: if copyRect.insetBy(dx: -4, dy: -6).contains(p) { onCopy?() } else { onDismiss?() }
        default: break
        }
    }
    override func rightMouseDown(with event: NSEvent) { onMenu?(event) }

    override func draw(_ dirtyRect: NSRect) {
        let r = shell, radius = r.height / 2
        let body = NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius)
        BarInk.shell.setFill(); body.fill()
        if state == .listening || state == .writing {
            let tint = state == .listening ? BarInk.violet : BarInk.pink
            NSGradient(colors: [tint.withAlphaComponent(0.20), tint.withAlphaComponent(0.04), .clear])?.draw(in: body, angle: 0)
        }
        NSGradient(colors: [NSColor(white: 1, alpha: 0.07), .clear])?.draw(in: body, angle: -90)
        (hover && state == .idle ? BarInk.violet.withAlphaComponent(0.45) : BarInk.rim).setStroke()
        body.lineWidth = 1; body.stroke()
        switch state {
        case .idle: drawIdle(r)
        case .listening: drawListening(r)
        case .writing: drawWriting(r)
        case .done: drawNote(r, color: BarInk.green, text: "Pasted", check: true)
        case .copied: drawNote(r, color: BarInk.green, text: "Copied", check: true)
        case .offer(let words): drawOffer(r, words)
        case .error(let message): drawNote(r, color: BarInk.red, text: message, check: false)
        }
    }

    private func dot(_ c: NSPoint, _ size: CGFloat, _ color: NSColor, glow: CGFloat) {
        if glow > 0 { color.withAlphaComponent(0.22 * glow).setFill(); NSBezierPath(ovalIn: NSRect(x: c.x - size, y: c.y - size, width: size * 2, height: size * 2)).fill() }
        color.setFill(); NSBezierPath(ovalIn: NSRect(x: c.x - size / 2, y: c.y - size / 2, width: size, height: size)).fill()
    }
    private func text(_ s: String, at p: NSPoint, size: CGFloat, color: NSColor, mono: Bool = false, maxWidth: CGFloat = 400) {
        let font = mono ? NSFont.monospacedDigitSystemFont(ofSize: size, weight: .medium) : NSFont.systemFont(ofSize: size, weight: .medium)
        var label = s
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        while label.count > 4 && (label as NSString).size(withAttributes: attrs).width > maxWidth { label = String(label.dropLast(2)) + "…" }
        let h = (label as NSString).size(withAttributes: attrs).height
        (label as NSString).draw(at: NSPoint(x: p.x, y: p.y - h / 2), withAttributes: attrs)
    }
    /// One wave: vertical strokes, violet → pink along the bar, newest brightest, under a soft glow.
    private func wave(_ levels: [CGFloat], in area: NSRect, from a: NSColor, to b: NSColor, floor: CGFloat = 0.9) {
        let n = levels.count, step = area.width / CGFloat(max(1, n - 1)), maxExtent = area.height / 2
        for pass in 0..<2 {
            for (i, level) in levels.enumerated() {
                let t = CGFloat(i) / CGFloat(max(1, n - 1))
                let color = a.blended(withFraction: t, of: b) ?? a
                let extent = max(floor, sqrt(max(0, level)) * maxExtent)
                let x = area.minX + CGFloat(i) * step
                let line = NSBezierPath(); line.move(to: NSPoint(x: x, y: area.midY - extent)); line.line(to: NSPoint(x: x, y: area.midY + extent))
                line.lineCapStyle = .round
                if pass == 0 { line.lineWidth = 4.2; color.withAlphaComponent(0.13 * (0.4 + t)).setStroke() }
                else { line.lineWidth = 1.9; color.withAlphaComponent(0.35 + 0.65 * t).setStroke() }
                line.stroke()
            }
        }
    }
    private func drawIdle(_ r: NSRect) {
        dot(NSPoint(x: r.minX + 15, y: r.midY), 7, BarInk.violet, glow: hover ? 1 : 0.5)
        let resting = (0..<13).map { i -> CGFloat in let x = CGFloat(i) / 12; return 0.012 + 0.05 * pow(sin(.pi * x), 2) * (0.6 + 0.4 * sin(CGFloat(i) * 1.7)) }
        wave(resting, in: NSRect(x: r.minX + 28, y: r.minY + 6, width: r.width - 62, height: r.height - 12), from: BarInk.violet.withAlphaComponent(0.7), to: BarInk.pink.withAlphaComponent(0.7))
        let key = NSRect(x: r.maxX - 26, y: r.midY - 9, width: 18, height: 18)
        let cap = NSBezierPath(roundedRect: key, xRadius: 5, yRadius: 5)
        NSColor(white: 1, alpha: hover ? 0.10 : 0.06).setFill(); cap.fill()
        NSColor(white: 1, alpha: 0.10).setStroke(); cap.lineWidth = 0.8; cap.stroke()
        text("⌥", at: NSPoint(x: key.minX + 4.2, y: key.midY), size: 11, color: hover ? BarInk.text : BarInk.muted)
    }
    private func drawListening(_ r: NSRect) {
        let pulse = 0.55 + 0.45 * CGFloat(sin((now - startedAt) * 5))
        dot(NSPoint(x: r.minX + 16, y: r.midY), 7, BarInk.pink.blended(withFraction: 0.35, of: BarInk.red) ?? BarInk.pink, glow: pulse)
        let waveArea = NSRect(x: r.minX + 30, y: r.minY + 5, width: cancelRect.minX - 48 - (r.minX + 30), height: r.height - 10)
        wave(history, in: waveArea, from: BarInk.violet, to: BarInk.pink)
        let secs = Int(max(0, now - startedAt))
        text(String(format: "%d:%02d", secs / 60, secs % 60), at: NSPoint(x: cancelRect.minX - 40, y: r.midY), size: 11, color: BarInk.muted, mono: true)
        let c = NSBezierPath(ovalIn: cancelRect); NSColor(white: 1, alpha: 0.07).setFill(); c.fill()
        let x = NSBezierPath(); let k = cancelRect.insetBy(dx: 9, dy: 9)
        x.move(to: NSPoint(x: k.minX, y: k.minY)); x.line(to: NSPoint(x: k.maxX, y: k.maxY)); x.move(to: NSPoint(x: k.minX, y: k.maxY)); x.line(to: NSPoint(x: k.maxX, y: k.minY))
        x.lineWidth = 1.6; x.lineCapStyle = .round; BarInk.muted.setStroke(); x.stroke()
        let s = NSBezierPath(ovalIn: stopRect); BarInk.amber.setFill(); s.fill()
        tick(in: stopRect.insetBy(dx: 7.5, dy: 8.5), color: BarInk.onAmber, width: 2)
    }
    private func drawWriting(_ r: NSRect) {
        dot(NSPoint(x: r.minX + 16, y: r.midY), 7, BarInk.pink, glow: 0.8)
        let t = now
        let levels = (0..<history.count).map { i -> CGFloat in 0.04 + 0.42 * pow(0.5 + 0.5 * CGFloat(sin(t * 6 - Double(i) * 0.32)), 3) }
        wave(levels, in: NSRect(x: r.minX + 30, y: r.minY + 5, width: r.width - 120, height: r.height - 10), from: BarInk.violet, to: BarInk.pink)
        text("Writing…", at: NSPoint(x: r.maxX - 78, y: r.midY), size: 12, color: BarInk.text)
    }
    private func tick(in k: NSRect, color: NSColor, width: CGFloat) {
        let t = NSBezierPath(); t.move(to: NSPoint(x: k.minX, y: k.midY)); t.line(to: NSPoint(x: k.minX + k.width * 0.38, y: k.minY)); t.line(to: NSPoint(x: k.maxX, y: k.maxY))
        t.lineWidth = width; t.lineCapStyle = .round; t.lineJoinStyle = .round; color.setStroke(); t.stroke()
    }
    /// Nowhere to type: his words, and one amber Copy (they are on the clipboard already; this is the visible promise).
    private func drawOffer(_ r: NSRect, _ words: String) {
        dot(NSPoint(x: r.minX + 16, y: r.midY), 7, BarInk.violet, glow: 0.5)
        let line = String(words.replacingOccurrences(of: "\n", with: " ").prefix(140))
        text(line, at: NSPoint(x: r.minX + 30, y: r.midY), size: 12, color: BarInk.text, maxWidth: copyRect.minX - r.minX - 38)
        let pill = NSBezierPath(roundedRect: copyRect, xRadius: copyRect.height / 2, yRadius: copyRect.height / 2)
        BarInk.amber.setFill(); pill.fill()
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: BarInk.onAmber]
        let size = ("Copy" as NSString).size(withAttributes: attrs)
        ("Copy" as NSString).draw(at: NSPoint(x: copyRect.midX - size.width / 2, y: copyRect.midY - size.height / 2), withAttributes: attrs)
    }
    private func drawNote(_ r: NSRect, color: NSColor, text message: String, check: Bool) {
        if check { tick(in: NSRect(x: r.minX + 11, y: r.midY - 5, width: 13, height: 10), color: color, width: 2) }
        else { dot(NSPoint(x: r.minX + 16, y: r.midY), 7, color, glow: 0.6) }
        text(message, at: NSPoint(x: r.minX + 32, y: r.midY), size: 12, color: check ? BarInk.text : color, maxWidth: r.width - 46)
    }
}

/// The floating panel: over every app and Space, nonactivating (a click never steals his focus), remembered where he left it.
final class VoiceBar: NSObject {
    var onToggle: (() -> Void)?, onCancel: (() -> Void)?, onOpen: (() -> Void)?, onHide: (() -> Void)?
    static let idleSize = NSSize(width: 114, height: 38), wideSize = NSSize(width: 312, height: 46), noteSize = NSSize(width: 150, height: 46)
    private var panel: NSPanel?
    private(set) var view: BarView?
    private var available = false
    private var frames: Timer?
    private var lastPhase = "idle"
    private var settle: DispatchWorkItem?
    private var grab = NSSize.zero
    private var smoothed: CGFloat = 0
    private let d = UserDefaults.standard

    func setAvailable(_ on: Bool) {
        guard on != available else { return }; available = on
        if on { ensure(); place(); panel?.orderFrontRegardless() } else { panel?.orderOut(nil); stopFrames() }
    }
    func show(phase: String, error: String) {
        defer { lastPhase = phase }
        guard view != nil else { return }
        settle?.cancel()
        switch phase {
        case "recording", "starting":
            view?.history = Array(repeating: 0, count: view?.history.count ?? 46); smoothed = 0
            view?.startedAt = ProcessInfo.processInfo.systemUptime; set(.listening)
        case "transcribing": set(.writing)
        case "pasting": set(.done)
        case "error": set(.error(error.isEmpty ? "Something went wrong" : error)); later(2.6)
        default:
            if lastPhase == "pasting" { later(1.0); return }
            switch view?.state { case .error?, .offer?: break; default: set(.idle) }
        }
    }
    /// The words he can't paste anywhere stay up for 20 s (and in History for good).
    func offer(_ text: String) {
        guard view != nil else { return }
        settle?.cancel(); set(.offer(text)); later(20)
    }
    func notice(_ message: String, offering text: String) {
        settle?.cancel(); set(.error(message))
        let work = DispatchWorkItem { [weak self] in self?.offer(text) }
        settle = work; DispatchQueue.main.asyncAfter(deadline: .now() + 2.6, execute: work)
    }
    private func copyOffer() {
        guard case .offer(let text) = view?.state else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
        settle?.cancel(); set(.copied); later(1.2)
    }
    func push(level: CGFloat) {
        guard let view, view.state == .listening else { return }
        smoothed += (level - smoothed) * (level > smoothed ? 0.55 : 0.2)
        view.history.removeFirst(); view.history.append(smoothed)
        view.now = ProcessInfo.processInfo.systemUptime; view.needsDisplay = true
    }
    private func later(_ seconds: Double) {
        let work = DispatchWorkItem { [weak self] in self?.set(.idle) }
        settle = work; DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }
    private func set(_ state: BarState) {
        guard let view else { return }
        view.state = state; view.now = ProcessInfo.processInfo.systemUptime
        resize(to: state == .idle ? Self.idleSize : state == .done || state == .copied ? Self.noteSize : Self.wideSize)
        // Only the "Writing…" sweep needs its own clock; listening redraws on each meter tick, idle never.
        if state == .writing { startFrames() } else { stopFrames() }
    }
    private func startFrames() {
        guard frames == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let view = self?.view else { return }; view.now = ProcessInfo.processInfo.systemUptime; view.needsDisplay = true
        }
        RunLoop.main.add(timer, forMode: .common); frames = timer
    }
    private func stopFrames() { frames?.invalidate(); frames = nil }

    private func ensure() {
        guard panel == nil else { return }
        let view = BarView(frame: NSRect(origin: .zero, size: Self.idleSize))
        view.autoresizingMask = [.width, .height]
        view.toolTip = "Voice: click or press right ⌥ to talk · drag to move · right-click for more"
        view.onToggle = { [weak self] in self?.onToggle?() }
        view.onCancel = { [weak self] in self?.onCancel?() }
        view.onCopy = { [weak self] in self?.copyOffer() }
        view.onDismiss = { [weak self] in self?.settle?.cancel(); self?.set(.idle) }
        view.onMenu = { [weak self] event in self?.menu(event) }
        view.onDragBegin = { [weak self] at in guard let self, let panel = self.panel else { return }; self.grab = NSSize(width: at.x - panel.frame.minX, height: at.y - panel.frame.minY) }
        view.onDrag = { [weak self] at in guard let self, let panel = self.panel else { return }; panel.setFrameOrigin(NSPoint(x: at.x - self.grab.width, y: at.y - self.grab.height)) }
        view.onDragEnd = { [weak self] in self?.dropped() }
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: Self.idleSize), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true; panel.level = .statusBar
        panel.isFloatingPanel = true; panel.becomesKeyOnlyIfNeeded = true; panel.hidesOnDeactivate = false; panel.isMovable = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isReleasedWhenClosed = false; panel.contentView = view
        self.panel = panel; self.view = view
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.place() }
    }
    private var savedScreen: NSScreen {
        let id = d.integer(forKey: "voice_bar_screen")
        return NSScreen.screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue == id } ?? NSScreen.main ?? NSScreen.screens[0]
    }
    /// Where the bar's centre goes: docked under the top edge at a remembered x, or anywhere he dropped it.
    private func centre(on screen: NSScreen, size: NSSize) -> NSPoint {
        let area = screen.visibleFrame
        let x = d.object(forKey: "voice_bar_x") as? Double ?? 0.5
        if d.string(forKey: "voice_bar_dock") == "free", let y = d.object(forKey: "voice_bar_y") as? Double {
            return NSPoint(x: area.minX + CGFloat(x) * area.width, y: area.minY + CGFloat(y) * area.height)
        }
        return NSPoint(x: area.minX + CGFloat(x) * area.width, y: area.maxY - size.height / 2 - 6)
    }
    private func clamp(_ frame: NSRect, _ area: NSRect) -> NSRect {
        var f = frame
        f.origin.x = min(max(f.minX, area.minX + 4), area.maxX - f.width - 4)
        f.origin.y = min(max(f.minY, area.minY + 4), area.maxY - f.height)
        return f
    }
    func place() {
        guard let panel else { return }
        let size = panel.frame.size == .zero ? Self.idleSize : panel.frame.size, screen = savedScreen
        let c = centre(on: screen, size: size)
        panel.setFrame(clamp(NSRect(x: c.x - size.width / 2, y: c.y - size.height / 2, width: size.width, height: size.height), screen.visibleFrame), display: true)
    }
    private func resize(to size: NSSize) {
        guard let panel, panel.frame.size != size else { return }
        let c = NSPoint(x: panel.frame.midX, y: panel.frame.midY)
        let area = (panel.screen ?? savedScreen).visibleFrame
        let docked = d.string(forKey: "voice_bar_dock") != "free"
        var target = NSRect(x: c.x - size.width / 2, y: docked ? area.maxY - size.height - 6 + 3 : c.y - size.height / 2, width: size.width, height: size.height)
        target = clamp(target, area)
        NSAnimationContext.runAnimationGroup { ctx in ctx.duration = 0.18; ctx.timingFunction = CAMediaTimingFunction(name: .easeOut); panel.animator().setFrame(target, display: true) }
    }
    private func dropped() {
        guard let panel else { return }
        let screen = NSScreen.screens.first { $0.frame.contains(NSPoint(x: panel.frame.midX, y: panel.frame.midY)) } ?? savedScreen
        let area = screen.visibleFrame
        let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0
        var x = Double((panel.frame.midX - area.minX) / max(1, area.width))
        if abs(x - 0.5) < 0.04 { x = 0.5 }
        d.set(id, forKey: "voice_bar_screen"); d.set(min(1, max(0, x)), forKey: "voice_bar_x")
        if panel.frame.maxY > area.maxY - 34 { d.set("top", forKey: "voice_bar_dock") }
        else { d.set("free", forKey: "voice_bar_dock"); d.set(Double(min(1, max(0, (panel.frame.midY - area.minY) / max(1, area.height)))), forKey: "voice_bar_y") }
        let frame = panel.frame
        place()
        let settled = panel.frame; panel.setFrame(frame, display: false)
        NSAnimationContext.runAnimationGroup { ctx in ctx.duration = 0.16; panel.animator().setFrame(settled, display: true) }
    }
    private func menu(_ event: NSEvent) {
        guard let view else { return }
        let menu = NSMenu(title: "Voice")
        let items: [(String, Selector)] = [("Open Voice in Agent Base", #selector(openVoice)), ("Move to top centre", #selector(resetSpot)), ("Hide the bar", #selector(hideBar))]
        for (i, (title, action)) in items.enumerated() {
            if i == 2 { menu.addItem(.separator()) }
            let item = NSMenuItem(title: title, action: action, keyEquivalent: ""); item.target = self; menu.addItem(item)
        }
        NSMenu.popUpContextMenu(menu, with: event, for: view)
    }
    @objc private func openVoice() { onOpen?() }
    @objc private func resetSpot() { d.set("top", forKey: "voice_bar_dock"); d.set(0.5, forKey: "voice_bar_x"); d.removeObject(forKey: "voice_bar_screen"); NSAnimationContext.runAnimationGroup { _ in place() } }
    @objc private func hideBar() { onHide?() }
}

/// `--bar-preview DIR`: each state drawn off-screen to DIR/bar-<state>.png at 2x, for the ui-hub shots. No window, no mic.
func renderBarPreviews(to dir: String) {
    let fake = (0..<46).map { i -> CGFloat in let t = CGFloat(i) / 45; return max(0.02, 0.55 * pow(sin(t * 9.5) * 0.5 + 0.5, 2) * (0.35 + 0.65 * t) + 0.06 * sin(t * 31)) }
    let states: [(String, BarState, NSSize)] = [("idle", .idle, VoiceBar.idleSize), ("listening", .listening, VoiceBar.wideSize), ("writing", .writing, VoiceBar.wideSize), ("done", .done, VoiceBar.noteSize), ("offer", .offer("Let's meet Wednesday after lunch and go through the launch plan together."), VoiceBar.wideSize), ("copied", .copied, VoiceBar.noteSize), ("error", .error("Transcription failed. Check the Voice space."), VoiceBar.wideSize)]
    for (name, state, size) in states {
        let view = BarView(frame: NSRect(origin: .zero, size: size))
        view.history = fake; view.state = state; view.startedAt = 0; view.now = 7.4
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { continue }
        rep.size = size
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: dir).appendingPathComponent("bar-\(name).png"))
    }
}

if let i = CommandLine.arguments.firstIndex(of: "--bar-preview"), i + 1 < CommandLine.arguments.count {
    renderBarPreviews(to: CommandLine.arguments[i + 1]); exit(0)
}
// macOS asks the responsible process for Accessibility, Input Monitoring and the mic. Started by Agent Base, that is
// Agent Base; so the helper starts itself again as its own responsible process (as Terminal and Chromium do), and
// macOS asks the voice engine's own signed identity, which keeps SISO Voice's permissions (t-0505).
if !testMode && env["AB_DICTATION_ENGINE"] != "1", let disclaimSym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") {
    typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
    var attr: posix_spawnattr_t? = nil
    posix_spawnattr_init(&attr)
    _ = unsafeBitCast(disclaimSym, to: Disclaim.self)(&attr, 1)
    var childEnv = env; childEnv["AB_DICTATION_ENGINE"] = "1"
    if let parent = env["AB_PARENT_PID"] { childEnv["AB_APP_PID"] = parent }
    childEnv["AB_PARENT_PID"] = String(getpid())
    let argv = CommandLine.arguments.map { strdup($0) } + [nil]
    let envp = childEnv.map { strdup("\($0.key)=\($0.value)") } + [nil]
    var child: pid_t = 0
    if posix_spawn(&child, Bundle.main.executablePath ?? CommandLine.arguments[0], nil, &attr, argv, envp) == 0 {
        for sig in [SIGTERM, SIGINT, SIGHUP] { signal(sig) { s in kill(engineChild, s); exit(0) } }
        engineChild = child
        var status: Int32 = 0
        while waitpid(child, &status, 0) == -1 && errno == EINTR {}
        exit((status & 0x7f) == 0 ? (status >> 8) & 0xff : 1)
    }
}
let dictation = Dictation()
// `--focus-probe`: what has focus now and whether the bar would type into it (the live check for t-0506). Reads only.
if CommandLine.arguments.contains("--focus-probe") {
    let front = NSWorkspace.shared.frontmostApplication, f = dictation.focus()
    print("{\"app\":\"\(front?.bundleIdentifier ?? "")\",\"role\":\"\(f.role)\",\"typeable\":\(f.typeable),\"trusted\":\(AXIsProcessTrusted())}"); exit(0)
}
if CommandLine.arguments.contains("--paste-only") {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let text = value["text"] as? String, let bundle = value["bundleId"] as? String, !bundle.isEmpty else { exit(2) }
    // Test mode never inspects real running applications.
    let app = testMode ? nil : NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first
    var complete = false, success = false
    dictation.paste(text, into: app, strict: true) { success = $0; complete = true }
    let deadline = Date(timeIntervalSinceNow: 3)
    while !complete && Date() < deadline { RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.02)) }
    exit(success ? 0 : 1)
}
if testMode {
    DispatchQueue.global().async {
        while let line = readLine() {
            guard let data = line.data(using: .utf8), let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let action = command["action"] as? String else { continue }
            DispatchQueue.main.async {
                switch action {
                case "down": dictation.key((command["mode"] as? String) ?? "hold", down: true)
                case "up": dictation.key((command["mode"] as? String) ?? "hold", down: false)
                case "toggle": dictation.key("toggle", down: true); dictation.key("toggle", down: false)
                case "roll-fail": dictation.testRollFailure = true
                case "focus": dictation.testFocus = (command["app"] as? String ?? "", command["bundle"] as? String ?? "", command["typeable"] as? Bool ?? true)
                default: break
                }
            }
        }
    }
}
// The parent's exit ends the helper at once, with no polling.
var parentWatch: DispatchSourceProcess?
if let parent = env["AB_PARENT_PID"].flatMap({ Int32($0) }) {
    if getppid() != parent { exit(0) }
    let watch = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .main)
    watch.setEventHandler { dictation.release(); exit(0) }
    watch.resume(); parentWatch = watch
}
dictation.bar?.onToggle = { dictation.barToggle() }
dictation.bar?.onCancel = { dictation.cancel() }
dictation.bar?.onOpen = {
    if let parent = (env["AB_APP_PID"] ?? env["AB_PARENT_PID"]).flatMap({ Int32($0) }), let app = NSRunningApplication(processIdentifier: parent), app.bundleIdentifier == "com.siso.agent-base" { app.activate(options: [.activateIgnoringOtherApps]) }
    // Run by launchd (t-0539) there is no app parent: open Agent Base itself.
    else if let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.siso.agent-base").first { app.activate(options: [.activateIgnoringOtherApps]) }
    else if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.siso.agent-base") { NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) }
}
dictation.bar?.onHide = { dictation.json(["bar": false], path: "/api/dictation/bar") }
// After sleep or a switch back to this login, the hotkey's tap is looked at at once rather than at the next owner answer (about 10 s).
if !testMode {
    let center = NSWorkspace.shared.notificationCenter
    for name in [NSWorkspace.didWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification, NSWorkspace.screensDidWakeNotification] {
        center.addObserver(forName: name, object: nil, queue: .main) { _ in say("woke (\(name.rawValue.replacingOccurrences(of: "NSWorkspace", with: "")))"); dictation.checkTap(reason: "wake") }
    }
    say("voice helper up · pid \(getpid()) · node \(base.absoluteString)")
}
dictation.pollOwner()
if testMode { RunLoop.main.run() } else {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.run()
}
