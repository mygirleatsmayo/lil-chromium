import AppKit
import Carbon.HIToolbox

/// A single global hotkey via Carbon RegisterEventHotKey (no accessibility
/// permission required). Pattern verified against soffes/HotKey (MIT).
///
/// We register one hotkey (⌘⌥N) and route kEventHotKeyPressed to a stored
/// closure. The C event handler is a free function that trampolines through the
/// shared instance.
final class GlobalHotKey {

    static let shared = GlobalHotKey()

    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private var handler: (() -> Void)?

    // Arbitrary 4-char signature to tag our hotkey id.
    private let signature: FourCharCode = {
        // "lchk"
        let chars: [FourCharCode] = [0x6C, 0x63, 0x68, 0x6B]
        return (chars[0] << 24) | (chars[1] << 16) | (chars[2] << 8) | chars[3]
    }()
    private let hotKeyID: UInt32 = 1

    private init() {}

    /// Register ⌘⌥N. `onPressed` is invoked on the main queue.
    func register(onPressed: @escaping () -> Void) {
        self.handler = onPressed

        // Install the application-level event handler once.
        if eventHandlerRef == nil {
            var eventType = EventTypeSpec(
                eventClass: OSType(kEventClassKeyboard),
                eventKind: UInt32(kEventHotKeyPressed)
            )
            let selfPtr = Unmanaged.passUnretained(self).toOpaque()
            InstallEventHandler(
                GetEventDispatcherTarget(),
                hotKeyEventHandlerCallback,
                1,
                &eventType,
                selfPtr,
                &eventHandlerRef
            )
        }

        // kVK_ANSI_N == 45; modifiers cmd + option.
        let keyCode = UInt32(kVK_ANSI_N)
        let modifiers = UInt32(cmdKey | optionKey)
        let hkID = EventHotKeyID(signature: signature, id: hotKeyID)

        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(
            keyCode,
            modifiers,
            hkID,
            GetEventDispatcherTarget(),
            0,
            &ref
        )
        if status == noErr {
            hotKeyRef = ref
        } else {
            NSLog("lil-chromium: RegisterEventHotKey failed (\(status))")
        }
    }

    func unregister() {
        if let ref = hotKeyRef {
            UnregisterEventHotKey(ref)
            hotKeyRef = nil
        }
    }

    /// Called by the C trampoline on the main thread (Carbon events dispatch on
    /// the main run loop).
    fileprivate func handlePressed(id: UInt32) {
        guard id == hotKeyID else { return }
        handler?()
    }
}

/// C-compatible Carbon event handler. Extracts the EventHotKeyID and forwards.
private func hotKeyEventHandlerCallback(
    _ nextHandler: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let event = event else { return OSStatus(eventNotHandledErr) }

    var hkID = EventHotKeyID()
    let err = GetEventParameter(
        event,
        UInt32(kEventParamDirectObject),
        UInt32(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hkID
    )
    if err != noErr { return err }

    if let userData = userData {
        let instance = Unmanaged<GlobalHotKey>.fromOpaque(userData).takeUnretainedValue()
        instance.handlePressed(id: hkID.id)
    }
    return noErr
}
