// Authored macOS appearance scalars mapped to public AppKit APIs. MIT.
#pragma once
#include "appkit.hpp"
namespace vb6 {
bool nativeAppearanceProperty(const std::string&);
Value nativeAppearanceDefault(const std::string&);
void validateNativeAppearance(const MacControl&);
void setNativeAppearance(MacControl&, const std::string&, Value);
void prepareNativeAppearance(MacControl&);
void applyNativeAppearance(MacControl&);
void refreshNativePlaceholder(MacControl&);
void layoutNativeAppearance(MacControl&);
void refreshNativeSegments(MacControl&);
NSView* nativeFocusView(const MacControl&);
bool nativeMaterialActive(const MacControl&);
NSColor* nativeSemanticColor(const Text&);
NSColor* nativeBackgroundColor(const MacControl&);
NSColor* nativeForegroundColor(const MacControl&);
NSControlSize nativeControlSize(const MacControl&);
NSBox* nativeAppearanceBox(const std::shared_ptr<MacControl>&);
NSImageView* nativeAppearanceImage(const std::shared_ptr<MacControl>&);
NSTextView* nativeAppearanceTextView(const std::shared_ptr<MacControl>&);
void applyNativeItemAppearance(MacControl&, NSButton*);
NSView* nativeSwitchView(MacControl&, NSSwitch*);
void clickNativeSwitch(MacControl&);
}
