import AppKit

// Usage: swift icon-dev.swift <OZ app icon 1024 png> <out png>
// The dev-build icon: the OZ app icon with an amber "DEV" tag under "OZ".
let a = CommandLine.arguments
let src = NSImage(contentsOfFile: a[1])!
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
src.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)

let amber = NSColor(srgbRed: 0.96, green: 0.62, blue: 0.04, alpha: 1)  // #F59E0B
let tag = NSRect(x: 372, y: 46, width: 280, height: 120)
amber.setFill()
NSBezierPath(roundedRect: tag, xRadius: 40, yRadius: 40).fill()
let style = NSMutableParagraphStyle(); style.alignment = .center
let text = NSAttributedString(string: "DEV", attributes: [
    .font: NSFont.systemFont(ofSize: 88, weight: .heavy),
    .foregroundColor: NSColor(srgbRed: 0.13, green: 0.16, blue: 0.20, alpha: 1),
    .paragraphStyle: style, .kern: 6,
])
let h = text.size().height
text.draw(in: NSRect(x: tag.minX, y: tag.midY - h / 2, width: tag.width, height: h))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
