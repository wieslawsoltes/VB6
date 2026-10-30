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
constexpr size_t GtkRtfMaxObjects = 1024;
constexpr size_t GtkRtfMaxImagePixels = 16 * 1024 * 1024;

struct GtkRtfParagraph {
  int alignment = 0; // VB: left, right, center, justified.
  int left = 0, right = 0, first = 0; // RTF twips; first is relative to left.
  int before = 0, after = 0, lineExtra = 0;
  int lineSpacing = 0, lineMultiple = 0, defaultTab = 720;
  bool rtl = false, bullet = false;
  std::vector<int> tabs;
  std::vector<int> tabAlignments; // Pango/RTF: left, right, center, decimal.
  int numbering = 0, numberStart = 1; // 0 none, 1 decimal, 2/3 Roman, 4/5 alphabetic.
  Text numberBefore, numberAfter = u".", marker;
  Text markerFont;
  double markerSize = 0; // Zero inherits the paragraph's character format.
  int markerBold = -1, markerItalic = -1, markerAlignment = 0, markerColor = -2; // -2 inherits; -1 is automatic.
  auto key() const { return std::tie(alignment,left,right,first,before,after,lineExtra,lineSpacing,lineMultiple,defaultTab,rtl,bullet,tabs,tabAlignments,numbering,numberStart,numberBefore,numberAfter,marker,markerFont,markerSize,markerBold,markerItalic,markerAlignment,markerColor); }
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
struct GtkRtfField {
  size_t first = 0, last = 0;
  Text instruction; // Inert field source; never evaluated or used for I/O.
  bool locked = false, dirty = false;
  auto key() const { return std::tie(first,last,instruction,locked,dirty); }
  bool operator==(const GtkRtfField& other) const { return key()==other.key(); }
};
struct GtkRtfDocument;
struct GtkRtfBorder {
  int style = 0, width = 15, color = -1; // none, solid, double, dashed, dotted.
};
struct GtkRtfCell {
  int right = 0, background = -1, vertical = 0;
  int merge = 0; // 0 ordinary, 1 starts horizontal merge, 2 continues it.
  std::array<GtkRtfBorder,4> borders; // top, right, bottom, left.
  std::shared_ptr<GtkRtfDocument> content;
};
struct GtkRtfObject {
  enum Kind {Picture,TableRow,Region,Embedded} kind = Picture;
  size_t first = 0, last = 0; // Pictures use U+FFFC; rows U+FFFC LF; other blocks U+FFFC U+2028.
  std::string format, bytes, destination;
  Text label;
  int width = 0, height = 0, widthGoal = 0, heightGoal = 0;
  int scaleX = 100, scaleY = 100, cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
  int left = 0, gap = 0, alignment = 0;
  std::vector<GtkRtfCell> cells;
  std::shared_ptr<GtkRtfDocument> content;
};
struct GtkRtfDocument {
  Text text;
  std::vector<GtkRtfRun> runs;
  GtkRtfStyle emptyStyle; // Also retains formatting of a trailing empty paragraph.
  // Non-content document properties (page geometry, view hints, metadata) are
  // retained for whole-document saves; they never import files or active objects.
  std::vector<std::string> metadata;
  std::vector<GtkRtfField> fields;
  std::vector<GtkRtfObject> objects;
};

bool gtkRtfParagraphEnd(const Text&, size_t position) noexcept;
void gtkRtfValidateText(const Text&);
void gtkRtfAppend(GtkRtfDocument&, const Text&, const GtkRtfStyle&);
GtkRtfDocument gtkRtfParse(const std::string&);
std::string gtkRtfWrite(const GtkRtfDocument&);
std::string gtkRtfBytes(const Text&);
Text gtkRtfDecode(const std::string&, int codepage);
Text gtkRtfListMarker(const GtkRtfParagraph&, int ordinal);
void gtkRtfValidateObjects(const GtkRtfDocument&);
}
