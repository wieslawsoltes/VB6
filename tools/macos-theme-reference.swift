// Native AppKit reference capture. MIT; no platform artwork or fonts are bundled.
// This records native drawing, not a claim that browser pixels already match it.
#if canImport(AppKit)
import AppKit
import Foundation

// Keep the atlas dimensions independent of the runner's desktop resolution.
// This changes window placement only; AppKit still draws every native view.
final class ReferenceWindow: NSWindow {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

final class ReferenceCanvas: NSView {
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        dirtyRect.fill()
    }
}

final class ReferenceTable: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    let rows = [["Palette", "Ready"], ["Control", "Selected"], ["Window", "Active"]]
    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let column = tableColumn?.identifier.rawValue == "state" ? 1 : 0
        return NSTextField(labelWithString: rows[row][column])
    }
}

struct Specimen {
    let name: String
    let view: NSView
}

enum ReferenceError: Error {
    case wrongOS(Int), image(String), invalidImage(String), invalidArguments, activation, atlasBounds, inactiveWindow
}

func settle(_ window: NSWindow) {
    // A Foundation RunLoop alone does not dispatch the application's activation
    // events. Drive the actual AppKit event queue, as NSApplication.run would.
    let app = NSApplication.shared
    let deadline = Date(timeIntervalSinceNow: 0.12)
    while Date() < deadline {
        if let event = app.nextEvent(matching: .any,
                                     until: min(deadline, Date(timeIntervalSinceNow: 0.01)),
                                     inMode: .default, dequeue: true) {
            app.sendEvent(event)
        }
        app.updateWindows()
    }
    window.contentView?.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
}

func rectJSON(_ rect: NSRect) -> [String: Double] {
    ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
}

func capture(_ view: NSView, name: String, scale: Int, directory: URL) throws -> [String: Any] {
    let bounds = view.bounds
    let width = Int(ceil(bounds.width * CGFloat(scale)))
    let height = Int(ceil(bounds.height * CGFloat(scale)))
    guard width > 0, height > 0,
          let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                                        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                        isPlanar: false, colorSpaceName: .deviceRGB,
                                        bytesPerRow: 0, bitsPerPixel: 0) else {
        throw ReferenceError.image(name)
    }
    bitmap.size = bounds.size
    view.cacheDisplay(in: bounds, to: bitmap)
    guard let srgb = bitmap.converting(to: .sRGB, renderingIntent: .default),
          let pixels = srgb.bitmapData, srgb.bitsPerSample == 8, srgb.samplesPerPixel == 4 else {
        throw ReferenceError.invalidImage(name)
    }
    var varied = false
    var visible = false
    let alpha = srgb.bitmapFormat.contains(.alphaFirst) ? 0 : 3
    for y in 0..<height {
        for x in 0..<width {
            let offset = y * srgb.bytesPerRow + x * 4
            visible = visible || pixels[offset + alpha] != 0
            for channel in 0..<4 where pixels[offset + channel] != pixels[channel] { varied = true }
        }
    }
    guard visible, varied || bounds.height <= 1 else { throw ReferenceError.invalidImage(name + " (blank)") }
    guard let data = srgb.representation(using: .png, properties: [:]),
          let decoded = NSBitmapImageRep(data: data), decoded.pixelsWide == width,
          decoded.pixelsHigh == height else { throw ReferenceError.invalidImage(name) }
    let filename = "\(name)-\(scale)x.png"
    try data.write(to: directory.appendingPathComponent(filename), options: .atomic)
    return ["name": name, "file": filename, "scale": scale, "pixels": [width, height],
            "bounds": rectJSON(bounds), "frame": rectJSON(view.frame),
            "nativeClass": NSStringFromClass(type(of: view)), "bytes": data.count,
            "colorSpace": "sRGB", "nonUniform": varied]
}

func colorJSON(_ color: NSColor) -> [Double] {
    guard let rgb = color.usingColorSpace(.sRGB) else { return [] }
    return [rgb.redComponent, rgb.greenComponent, rgb.blueComponent, rgb.alphaComponent]
}

func main() throws {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    guard version.majorVersion == 26 else { throw ReferenceError.wrongOS(version.majorVersion) }
    guard CommandLine.arguments.count <= 2 else { throw ReferenceError.invalidArguments }
    let destination = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "reports/macos-theme-reference",
                          isDirectory: true)
    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
    // Process-local defaults only; never modify the runner's global preferences.
    UserDefaults.standard.register(defaults: ["AppleAccentColor": 4])
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    // This command-line capture owns its event loop instead of calling run().
    app.finishLaunching()
    let tableDelegate = ReferenceTable()
    var images = [[String: Any]]()
    var palettes = [String: Any]()
    var environments = [[String: Any]]()
    var inactiveEnvironments = [[String: Any]]()

    for (scheme, appearanceName) in [("light", NSAppearance.Name.aqua), ("dark", NSAppearance.Name.darkAqua)] {
        guard let appearance = NSAppearance(named: appearanceName) else { throw ReferenceError.image(scheme) }
        app.appearance = appearance
        let window = ReferenceWindow(contentRect: NSRect(x: 40, y: 40, width: 980, height: 840),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "VB6 — macOS 26 native reference"
        window.appearance = appearance
        let canvas = ReferenceCanvas(frame: NSRect(x: 0, y: 0, width: 980, height: 840))
        window.contentView = canvas
        var specimens = [Specimen]()
        func add(_ name: String, _ view: NSView, height: CGFloat = 28) {
            let index = specimens.count
            let x = CGFloat(index % 3) * 320 + 20
            let y = CGFloat(index / 3) * 116 + 34
            let label = NSTextField(labelWithString: name)
            label.font = .systemFont(ofSize: 11)
            label.textColor = .secondaryLabelColor
            label.frame = NSRect(x: x, y: y - 22, width: 280, height: 18)
            view.frame = NSRect(x: x, y: y, width: 280, height: height)
            view.identifier = NSUserInterfaceItemIdentifier(name)
            canvas.addSubview(label)
            canvas.addSubview(view)
            specimens.append(Specimen(name: name, view: view))
        }
        func button(_ title: String) -> NSButton {
            let result = NSButton(title: title, target: nil, action: nil)
            result.bezelStyle = .rounded
            result.controlSize = .regular
            return result
        }
        let primary = button("Apply")
        primary.keyEquivalent = "\r"
        add("default-button", primary)
        window.defaultButtonCell = primary.cell as? NSButtonCell
        let secondary = button("Cancel")
        add("secondary-button", secondary)
        let disabled = button("Unavailable")
        disabled.isEnabled = false
        add("disabled-button", disabled)
        for (name, state) in [("check-off", NSControl.StateValue.off), ("check-on", .on), ("check-mixed", .mixed)] {
            let check = NSButton(checkboxWithTitle: "Check box", target: nil, action: nil)
            check.allowsMixedState = true
            check.state = state
            add(name, check)
        }
        let radio = NSButton(radioButtonWithTitle: "Option button", target: nil, action: nil)
        radio.state = .on
        add("radio-on", radio)
        let field = NSTextField(string: "Editable text")
        add("text-field", field)
        let combo = NSComboBox()
        combo.addItems(withObjectValues: ["Alpha", "Beta", "Gamma"])
        combo.selectItem(at: 0)
        add("combo-box", combo)
        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        popup.addItems(withTitles: ["Alpha", "Beta", "Gamma"])
        add("popup-button", popup)
        let segmented = NSSegmentedControl(labels: ["First", "Second", "Third"], trackingMode: .selectOne,
                                           target: nil, action: nil)
        segmented.selectedSegment = 0
        add("segmented-control", segmented)
        let slider = NSSlider(value: 50, minValue: 0, maxValue: 100, target: nil, action: nil)
        add("slider", slider)
        let progress = NSProgressIndicator()
        progress.style = .bar
        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 100
        progress.doubleValue = 50
        add("progress", progress)
        let date = NSDatePicker()
        date.datePickerStyle = .textFieldAndStepper
        date.datePickerElements = .yearMonthDay
        date.timeZone = TimeZone(secondsFromGMT: 0)
        date.dateValue = Date(timeIntervalSince1970: 1767225600)
        add("date-picker", date)
        let search = NSSearchField(string: "")
        search.placeholderString = "Search"
        add("search-field", search)
        let box = NSBox()
        box.title = "Group"
        add("group-box", box, height: 80)
        let richScroll = NSScrollView()
        richScroll.borderType = .bezelBorder
        richScroll.hasVerticalScroller = true
        let richText = NSTextView(frame: NSRect(x: 0, y: 0, width: 278, height: 160))
        richText.string = "Styled text\nA second line\nA third line"
        richText.font = .systemFont(ofSize: 13)
        richScroll.documentView = richText
        add("rich-text", richScroll, height: 80)
        let table = NSTableView()
        for (id, title) in [("name", "Name"), ("state", "State")] {
            let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(id))
            column.title = title
            column.width = 134
            table.addTableColumn(column)
        }
        table.rowHeight = 20
        table.dataSource = tableDelegate
        table.delegate = tableDelegate
        table.reloadData()
        table.selectRowIndexes(IndexSet(integer: 1), byExtendingSelection: false)
        let tableScroll = NSScrollView()
        tableScroll.borderType = .bezelBorder
        tableScroll.hasVerticalScroller = true
        tableScroll.documentView = table
        add("table-view", tableScroll, height: 80)
        let tabs = NSTabView()
        for title in ["First", "Second"] {
            let item = NSTabViewItem(identifier: title)
            item.label = title
            tabs.addTabViewItem(item)
        }
        add("tab-view", tabs, height: 80)
        let separator = NSBox()
        separator.boxType = .separator
        add("separator", separator, height: 1)
        let stepper = NSStepper()
        stepper.minValue = 0
        stepper.maxValue = 10
        stepper.doubleValue = 5
        add("stepper", stepper)

        window.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps: true)
        window.makeFirstResponder(primary)
        let activationDeadline = Date(timeIntervalSinceNow: 5)
        repeat { settle(window) } while (!app.isActive || !window.isKeyWindow) && Date() < activationDeadline
        guard app.isActive, window.isKeyWindow else { throw ReferenceError.activation }
        guard canvas.bounds.size == NSSize(width: 980, height: 840) else { throw ReferenceError.atlasBounds }
        for scale in [1, 2] {
            images.append(try capture(canvas, name: "\(scheme)-gallery", scale: scale, directory: destination))
            // Frame-view capture includes AppKit-owned title controls, not the
            // WindowServer's outside shadow, wallpaper or Liquid Glass refraction.
            if let frameView = canvas.superview {
                images.append(try capture(frameView, name: "\(scheme)-window", scale: scale, directory: destination))
            }
            for specimen in specimens {
                images.append(try capture(specimen.view, name: "\(scheme)-\(specimen.name)", scale: scale,
                                          directory: destination))
            }
            primary.highlight(true)
            settle(window)
            images.append(try capture(primary, name: "\(scheme)-default-pressed", scale: scale, directory: destination))
            primary.highlight(false)
            secondary.highlight(true)
            settle(window)
            images.append(try capture(secondary, name: "\(scheme)-secondary-pressed", scale: scale, directory: destination))
            secondary.highlight(false)
            let disabledNames: Set<String> = ["default-button", "check-off", "check-on", "check-mixed", "radio-on",
                                              "text-field", "combo-box", "popup-button", "slider", "stepper"]
            for specimen in specimens where disabledNames.contains(specimen.name) {
                guard let control = specimen.view as? NSControl else { throw ReferenceError.image(specimen.name) }
                let wasEnabled = control.isEnabled
                control.isEnabled = false
                settle(window)
                let stateName = specimen.name == "default-button" ? "default-disabled" : specimen.name + "-disabled"
                images.append(try capture(control, name: "\(scheme)-\(stateName)", scale: scale, directory: destination))
                control.isEnabled = wasEnabled
                settle(window)
            }
            // Let AppKit perform a real key-window transition. Calling resignKey
            // directly or recoloring the canvas would not exercise native state.
            let activator = ReferenceWindow(contentRect: NSRect(x: 60, y: 60, width: 200, height: 100),
                                            styleMask: [.titled], backing: .buffered, defer: false)
            activator.isReleasedWhenClosed = false
            activator.appearance = appearance
            activator.makeKeyAndOrderFront(nil)
            settle(window)
            guard app.isActive, activator.isKeyWindow, !window.isKeyWindow else { throw ReferenceError.inactiveWindow }
            inactiveEnvironments.append(["scheme": scheme, "scale": scale, "applicationActive": app.isActive,
                                         "keyWindow": window.isKeyWindow, "otherWindowIsKey": activator.isKeyWindow])
            images.append(try capture(canvas, name: "\(scheme)-inactive-gallery", scale: scale, directory: destination))
            if let frameView = canvas.superview {
                images.append(try capture(frameView, name: "\(scheme)-inactive-window", scale: scale, directory: destination))
            }
            for specimen in specimens {
                images.append(try capture(specimen.view, name: "\(scheme)-inactive-\(specimen.name)", scale: scale,
                                          directory: destination))
            }
            activator.orderOut(nil)
            activator.close()
            window.makeKeyAndOrderFront(nil)
            window.makeFirstResponder(primary)
            settle(window)
            guard app.isActive, window.isKeyWindow else { throw ReferenceError.activation }
        }
        appearance.performAsCurrentDrawingAppearance {
            palettes[scheme] = ["windowBackground": colorJSON(.windowBackgroundColor),
                                "controlBackground": colorJSON(.controlBackgroundColor),
                                "text": colorJSON(.textColor), "label": colorJSON(.labelColor),
                                "disabledText": colorJSON(.disabledControlTextColor),
                                "accent": colorJSON(.controlAccentColor),
                                "selection": colorJSON(.selectedContentBackgroundColor),
                                "selectionText": colorJSON(.selectedTextColor),
                                "separator": colorJSON(.separatorColor), "focus": colorJSON(.keyboardFocusIndicatorColor)]
        }
        environments.append(["scheme": scheme, "appearance": appearance.name.rawValue,
                             "keyWindow": window.isKeyWindow, "applicationActive": app.isActive,
                             "windowBackingScale": window.backingScaleFactor])
        window.orderOut(nil)
        window.close()
    }
    let report: [String: Any] = [
        "schema": 1, "target": "macOS 26", "os": ProcessInfo.processInfo.operatingSystemVersionString,
        "operatingSystemVersion": [version.majorVersion, version.minorVersion, version.patchVersion],
        "environment": environments, "inactiveEnvironment": inactiveEnvironments, "colorsSRGB": palettes, "captures": images,
        "nativePixelParityCertified": false,
        "limitations": ["Native view drawing reference only; no browser/native pixel comparison is inferred.",
                        "WindowServer outside shadows, wallpaper sampling and refraction are not captured.",
                        "No Apple fonts or symbol resources are copied or embedded."]
    ]
    let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: destination.appendingPathComponent("reference.json"), options: .atomic)
    print("Captured \(images.count) native AppKit references: \(destination.path)")
}

do { try main() } catch {
    fputs("Native macOS reference capture failed: \(error)\n", stderr)
    exit(1)
}
#else
import Foundation
fputs("Native reference capture requires macOS 26 and AppKit.\n", stderr)
exit(77)
#endif
