import AppKit
let a = CommandLine.arguments
let src = NSImage(contentsOfFile: a[1])!
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
src.draw(in: NSRect(x: 0, y: 0, width: 1024, height: 1024), from: .zero, operation: .copy, fraction: 1)
let emerald = NSColor(srgbRed: 0.06, green: 0.73, blue: 0.51, alpha: 1)  // #10B981, darker for a light background
let style = NSMutableParagraphStyle(); style.alignment = .center
let t = NSAttributedString(string: "OZ", attributes: [.font: NSFont.systemFont(ofSize: 190, weight: .heavy), .foregroundColor: emerald, .paragraphStyle: style, .kern: 12])
let h = t.size().height
t.draw(in: NSRect(x: 0, y: 1024 - 635 - h, width: 1024, height: h))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
