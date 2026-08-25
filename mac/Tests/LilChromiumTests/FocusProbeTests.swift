import Testing
@testable import LilFocusProbe

/// LILFOCUS (issue #30). The probe's only job is to turn one raw CGWindowList
/// reading into a comparable z-order snapshot, so these tests pin the three
/// decisions the harness's verdict depends on: which windows count, what order
/// they are in, and which display each one is on.
struct FocusProbeTests {

    private func rect(_ x: Double, _ y: Double, _ w: Double = 100, _ h: Double = 100) -> ProbeRect {
        ProbeRect(x: x, y: y, w: w, h: h)
    }

    /// Two displays side by side in CoreGraphics space (origin top-left).
    private let displays = [
        ProbeDisplay(index: 0, frame: ProbeRect(x: 0, y: 0, w: 1000, h: 800), isPrimary: true),
        ProbeDisplay(index: 1, frame: ProbeRect(x: 1000, y: 0, w: 1000, h: 800), isPrimary: false),
    ]

    /// Menus, status items, and window shades sit on non-zero layers. Letting
    /// them into the snapshot would make every stacking comparison noise.
    @Test func onlyOrdinaryWindowsEnterTheSnapshot() {
        let snapshot = FocusProbe.snapshot(
            windows: [
                RawProbeWindow(number: 1, pid: 10, owner: "Window Server", layer: 2_147_483_630, bounds: rect(0, 0)),
                RawProbeWindow(number: 2, pid: 20, owner: "Helium", layer: 0, bounds: rect(10, 10)),
                RawProbeWindow(number: 3, pid: 30, owner: "MonitorControl", layer: 2_147_483_628, bounds: rect(0, 0)),
                RawProbeWindow(number: 4, pid: 40, owner: "Mail", layer: 0, bounds: rect(20, 20)),
            ],
            displays: displays,
            bundleIds: [:],
            frontmost: nil,
            label: "before",
            now: 1
        )

        #expect(snapshot.windows.map(\.number) == [2, 4])
    }

    /// `order` is the front-to-back rank the whole verdict rests on, and it is
    /// numbered after filtering — otherwise a hidden menu layer would offset it.
    @Test func orderIsFrontToBackAfterFiltering() {
        let snapshot = FocusProbe.snapshot(
            windows: [
                RawProbeWindow(number: 9, pid: 1, owner: "Window Server", layer: 25, bounds: rect(0, 0)),
                RawProbeWindow(number: 7, pid: 2, owner: "Mail", layer: 0, bounds: rect(0, 0)),
                RawProbeWindow(number: 8, pid: 3, owner: "Helium", layer: 0, bounds: rect(0, 0)),
            ],
            displays: displays,
            bundleIds: [:],
            frontmost: nil,
            label: "after",
            now: 1
        )

        #expect(snapshot.windows.map { ($0.number, $0.order) }.map(\.0) == [7, 8])
        #expect(snapshot.windows.map(\.order) == [0, 1])
    }

    /// Cross-display scenarios are only distinguishable if a window is placed on
    /// the display holding its center, not the one holding its origin.
    @Test func windowsLandOnTheDisplayHoldingTheirCenter() {
        let snapshot = FocusProbe.snapshot(
            windows: [
                // Straddles the seam, but its center is on display 1.
                RawProbeWindow(number: 1, pid: 1, owner: "Helium", layer: 0, bounds: rect(900, 100, 400, 400)),
                RawProbeWindow(number: 2, pid: 1, owner: "Helium", layer: 0, bounds: rect(50, 50, 200, 200)),
                // Off every display (e.g. dragged fully offscreen).
                RawProbeWindow(number: 3, pid: 1, owner: "Helium", layer: 0, bounds: rect(-900, -900, 10, 10)),
            ],
            displays: displays,
            bundleIds: [:],
            frontmost: nil,
            label: "before",
            now: 1
        )

        #expect(snapshot.windows.map(\.display) == [1, 0, nil])
    }

    /// The harness separates Helium's windows from every other app's by bundle
    /// id, so the pid -> bundle mapping has to survive into the snapshot — and a
    /// process with no bundle id must not invent one.
    @Test func bundleIdentifiersAreCarriedPerProcess() {
        let snapshot = FocusProbe.snapshot(
            windows: [
                RawProbeWindow(number: 1, pid: 100, owner: "Helium", layer: 0, bounds: rect(0, 0)),
                RawProbeWindow(number: 2, pid: 200, owner: "some-daemon", layer: 0, bounds: rect(0, 0)),
            ],
            displays: displays,
            bundleIds: [100: "net.imput.helium"],
            frontmost: ProbeApp(pid: 100, bundleId: "net.imput.helium", name: "Helium"),
            label: "afterClose",
            now: 42
        )

        #expect(snapshot.windows.map(\.bundleId) == ["net.imput.helium", nil])
        #expect(snapshot.frontmost?.bundleId == "net.imput.helium")
        #expect(snapshot.tag == "LILFOCUS")
        #expect(snapshot.label == "afterClose")
    }
}
