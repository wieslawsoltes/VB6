// RichTextBox member dispatch and native GtkTextBuffer integration. MIT.
#pragma once
#include "gtk.hpp"
#include "gtk-rtf.hpp"
namespace vb6 {
void gtkRichInitialize(GtkControl&);
void gtkRichDispose(GtkControl&);
void gtkRichSelectionChanged(GtkControl&, bool fire = true);
void gtkRichSetPlain(GtkControl&, const Text&, bool whole, bool fire = true);
bool gtkRichProperty(const std::string&) noexcept;
Value gtkRichGet(GtkControl&, const std::string&);
void gtkRichSet(GtkControl&, const std::string&, Value);
bool gtkRichMethod(const std::string&) noexcept;
Value gtkRichCall(GtkControl&, const std::string&, Args, bool put = false);
GtkRtfDocument gtkRichSnapshot(GtkControl&);
}
