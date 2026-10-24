// Bounded RTF interchange model. Uses the shared VB strings/errors, not a VM.
// Syntax: Microsoft RTF specification 1.6 / 1.9.1. MIT.
#pragma once
#include "vb6.hpp"
#include <tuple>

namespace vb6 {
constexpr size_t GtkRtfMaxBytes = 16 * 1024 * 1024;
constexpr size_t GtkRtfMaxText = 4 * 1024 * 1024;
constexpr size_t GtkRtfMaxRuns = 65536;
constexpr size_t GtkRtfMaxTable = 4096;

struct GtkRtfParagraph {
  int alignment = 0; // VB: left, right, center, justified.
  int left = 0, right = 0, first = 0; // RTF twips; first is relative to left.
  int before = 0, after = 0, lineExtra = 0;
  bool rtl = false, bullet = false;
  std::vector<int> tabs;
  auto key() const { return std::tie(alignment,left,right,first,before,after,lineExtra,rtl,bullet,tabs); }
  bool operator==(const GtkRtfParagraph& value) const { return key()==value.key(); }
  bool operator!=(const GtkRtfParagraph& value) const { return !(*this==value); }
};
struct GtkRtfStyle {
  Text font = u"Sans";
  double size = 12;
  bool bold = false, italic = false, strike = false, hidden = false, protectedText = false, smallCaps = false;
  int underline = 0; // none, single, double, wave.
  int foreground = -1, background = -1; // COLORREF, -1 means automatic.
  int rise = 0, spacing = 0; // twips.
  int script = 0; // -1 subscript, 0 normal, 1 superscript.
  int language = 0, charset = 0;
  GtkRtfParagraph paragraph;
  auto key() const { return std::tie(font,size,bold,italic,strike,hidden,protectedText,smallCaps,underline,foreground,background,rise,spacing,script,language,charset); }
  bool operator==(const GtkRtfStyle& value) const { return key()==value.key()&&paragraph==value.paragraph; }
  bool operator!=(const GtkRtfStyle& value) const { return !(*this==value); }
  bool operator<(const GtkRtfStyle& value) const { return key()<value.key()||(key()==value.key()&&paragraph.key()<value.paragraph.key()); }
};
struct GtkRtfRun {
  size_t first = 0, last = 0; // UTF-16 boundaries in document.text.
  GtkRtfStyle style;
};
struct GtkRtfDocument {
  Text text;
  std::vector<GtkRtfRun> runs;
  GtkRtfStyle emptyStyle; // Also retains formatting of a trailing empty paragraph.
  // Non-content document properties (page geometry, view hints, metadata) are
  // retained for whole-document saves; they never import files or active objects.
  std::vector<std::string> metadata;
};

bool gtkRtfParagraphEnd(const Text&, size_t position) noexcept;
void gtkRtfValidateText(const Text&);
void gtkRtfAppend(GtkRtfDocument&, const Text&, const GtkRtfStyle&);
GtkRtfDocument gtkRtfParse(const std::string&);
std::string gtkRtfWrite(const GtkRtfDocument&);
std::string gtkRtfBytes(const Text&);
Text gtkRtfDecode(const std::string&, int codepage);
}
