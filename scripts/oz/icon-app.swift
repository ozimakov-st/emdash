import AppKit

// Usage: swift make.swift <src 1024 png> <out png>
let args = CommandLine.arguments
let src = NSImage(contentsOfFile: args[1])!
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let full = NSRect(x: 0, y: 0, width: size, height: size)
src.draw(in: full, from: .zero, operation: .copy, fraction: 1)

let emerald = NSColor(srgbRed: 0.20, green: 0.83, blue: 0.60, alpha: 1)  // #34D399
// Recolor the dash (top-left coords from the source art), AppKit y is flipped.
func p(_ x: CGFloat, _ yTop: CGFloat) -> NSPoint { NSPoint(x: x, y: 1024 - yTop) }
let dash = NSBezierPath()
dash.move(to: p(338, 425)); dash.line(to: p(829, 425)); dash.line(to: p(688, 599)); dash.line(to: p(195, 599)); dash.close()
emerald.setFill(); dash.fill()

// "OZ" under the dash.
let font = NSFont.systemFont(ofSize: 190, weight: .heavy)
let style = NSMutableParagraphStyle(); style.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: emerald, .paragraphStyle: style, .kern: 12]
let text = NSAttributedString(string: "OZ", attributes: attrs)
let h = text.size().height
text.draw(in: NSRect(x: 0, y: 1024 - 640 - h, width: 1024, height: h))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
