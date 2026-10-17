// Shared native text/selection boundary for VB properties and Win32 adapters. MIT.
#pragma once
#include "appkit.hpp"
namespace vb6 {
// Native cell hooks preserve explicit selection across shared-editor attachment.
NSTextField* nativeTextField(bool secure);
NSSearchField* nativeSearchField();
NSComboBox* nativeComboBox();
bool isNativeEdit(const MacControl&) noexcept;
Text nativeEditText(MacControl&);
NSRange nativeEditSelection(MacControl&);
void nativeEditSelect(MacControl&, NSRange);
void nativeEditCapture(MacControl&, NSText* editor = nil);
void nativeEditSetText(MacControl&, const Text&);
void nativeEditSetSelection(MacControl&, const std::string&, Value);
void nativeEditChanged(MacControl&);
}
