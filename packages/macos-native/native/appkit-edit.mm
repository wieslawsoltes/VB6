// AppKit owns the editor; the VB object owns its durable UTF-16 selection. MIT.
#include "appkit-edit.hpp"
#include "appkit-appearance.hpp"
namespace vb6 {
namespace {
NSText* editor(MacControl& c) {
  if ([c.widget isKindOfClass:NSTextView.class]) return (NSTextView*)c.widget;
  if ([c.widget isKindOfClass:NSTextField.class]) return [(NSTextField*)c.widget currentEditor];
  return nil;
}
NSRange bounded(NSRange range, size_t size) {
  range.location = std::min(range.location, size);
  range.length = std::min(range.length, size - range.location);
  return range;
}
void remember(MacControl& c, NSRange range) {
  c.properties["selstart"] = Value::integer(range.location);
  c.properties["sellength"] = Value::integer(range.length);
}
struct Mutation {
  MacControl& control;
  explicit Mutation(MacControl& c) : control(c) { ++control.eventSuppression; }
  ~Mutation() { --control.eventSuppression; }
};
void write(MacControl& c, const Text& value) {
  if (auto e = editor(c)) if (![e.string isEqualToString:ns(value)]) e.string = ns(value);
  if ([c.widget isKindOfClass:NSTextField.class]) {
    auto field = (NSTextField*)c.widget;
    if (![field.stringValue isEqualToString:ns(value)]) field.stringValue = ns(value);
  }
}
}
bool isNativeEdit(const MacControl& c) noexcept {
  return c.spec.type == "TextBox" || c.spec.type == "RichTextBox" || c.spec.type == "ComboBox";
}
Text nativeEditText(MacControl& c) {
  if (auto e = editor(c)) return text(e.string);
  if ([c.widget isKindOfClass:NSTextField.class]) return text([(NSTextField*)c.widget stringValue]);
  return c.property("text", Value::string(u"")).string();
}
NSRange nativeEditSelection(MacControl& c) {
  auto size = nativeEditText(c).size();
  if (auto e = editor(c)) return bounded(e.selectedRange, size);
  auto start = std::max(int64_t(0), c.property("selstart", Value::integer(0)).integral());
  auto length = std::max(int64_t(0), c.property("sellength", Value::integer(0)).integral());
  return bounded(NSMakeRange(size_t(start), size_t(length)), size);
}
void nativeEditSelect(MacControl& c, NSRange range) {
  range = bounded(range, nativeEditText(c).size());
  remember(c, range);
  auto e = editor(c);
  c.editSelectionPending = !e;
  if (e) {
    e.selectedRange = range;
    if ([e isKindOfClass:NSTextView.class]) [(NSTextView*)e scrollRangeToVisible:range];
  }
}
void nativeEditCapture(MacControl& c, NSText* source) {
  if (!isNativeEdit(c) || c.disposed) return;
  if (!source) source = editor(c);
  if (source) {
    remember(c, bounded(source.selectedRange, source.string.length));
    c.editSelectionPending = true;
  }
}
bool nativeEditValidate(MacControl& c, NSText* source) {
  if(c.disposed||c.eventSuppression||c.editValidationSuppression)return true;
  nativeEditCapture(c,source);
  struct Validation {MacControl&control;explicit Validation(MacControl&value):control(value){++control.editValidationSuppression;}~Validation(){--control.editValidationSuppression;}} validation(c);
  auto control=c.self();auto cancel=std::make_shared<Cell>(Value::boolean(false),"boolean");
  c.host->event([control,cancel]{control->event("validate",{Arg(cellRef(cancel))});});
  return !cancel->get().truth();
}
void nativeEditSetText(MacControl& c, const Text& value) {
  if (value.size() > size_t(INT32_MAX)) fail(7, "Native text exceeds VB Long indexing");
  const auto old = nativeEditText(c);
  {
    Mutation mutation(c);
    // Commit text and caret before Change. A reentrant handler owns any further
    // changes; nothing in this setter overwrites its result after dispatch.
    c.properties["text"] = Value::string(value);
    write(c, value);
    nativeEditSelect(c, NSMakeRange(0, 0));
    refreshNativePlaceholder(c);
  }
  if (value != old) c.event("change");
}
void nativeEditSetSelection(MacControl& c, const std::string& name, Value value) {
  if (!isNativeEdit(c)) fail(438, "Control has no native text selection");
  auto current = nativeEditText(c);
  auto range = nativeEditSelection(c);
  if (name != "seltext") {
    auto n = coerce(value, "long").integral();
    if (n < 0) fail(380, "Text selection cannot be negative");
    if (name == "selstart") range = NSMakeRange(std::min(size_t(n), current.size()), 0);
    else range.length = std::min(size_t(n), current.size() - range.location);
    nativeEditSelect(c, range);
    return;
  }
  const auto replacement = value.string();
  if (replacement.size() > size_t(INT32_MAX) - (current.size() - range.length))
    fail(7, "Native text exceeds VB Long indexing");
  auto next = current;
  next.replace(range.location, range.length, replacement);
  {
    Mutation mutation(c);
    // Preserve rich text outside the selection and inherit insertion formatting.
    if ([c.widget isKindOfClass:NSTextView.class]) {
      auto view = (NSTextView*)c.widget;
      NSDictionary* attributes = view.typingAttributes;
      if (range.length && range.location < view.textStorage.length)
        attributes = [view.textStorage attributesAtIndex:range.location effectiveRange:nullptr];
      auto inserted = [[NSAttributedString alloc] initWithString:ns(replacement) attributes:attributes];
      [view.textStorage replaceCharactersInRange:range withAttributedString:inserted];
    } else write(c, next);
    c.properties["text"] = Value::string(next);
    nativeEditSelect(c, NSMakeRange(range.location + replacement.size(), 0));
    refreshNativePlaceholder(c);
  }
  if (next != current) c.event("change");
}
void nativeEditChanged(MacControl& c) {
  if (c.disposed || c.eventSuppression) return;
  auto value = nativeEditText(c);
  auto selection = nativeEditSelection(c);
  auto old = c.property("text", Value::string(u"")).string();
  auto limit = c.property("maxlength", Value::integer(0)).integral();
  if (limit < 0 || limit > INT32_MAX) fail(380, "MaxLength must be 0..2147483647");
  // Do not truncate an IME's intermediate marked text. The committed edit is
  // bounded on its subsequent change notification, preserving existing suffixes.
  auto e = editor(c);
  bool marked = [e isKindOfClass:NSTextView.class] && [(NSTextView*)e hasMarkedText];
  if (!marked && limit && value.size() > size_t(limit) && value.size() > old.size()) {
    size_t prefix = 0, suffix = 0;
    while (prefix < old.size() && prefix < value.size() && old[prefix] == value[prefix]) ++prefix;
    while (suffix < old.size()-prefix && suffix < value.size()-prefix &&
           old[old.size()-suffix-1] == value[value.size()-suffix-1]) ++suffix;
    const auto retained = prefix + suffix;
    size_t accepted = size_t(limit) > retained ? size_t(limit)-retained : 0;
    // Native user editing must not cut a surrogate pair at the input limit.
    if (accepted && prefix+accepted < value.size() &&
        value[prefix+accepted-1] >= 0xd800 && value[prefix+accepted-1] <= 0xdbff &&
        value[prefix+accepted] >= 0xdc00 && value[prefix+accepted] <= 0xdfff) --accepted;
    const auto cut = value.size()-suffix-prefix-accepted;
    value.erase(prefix+accepted, cut);
    selection = NSMakeRange(std::min(selection.location, prefix+accepted), 0);
    Mutation mutation(c);
    if ([c.widget isKindOfClass:NSTextView.class])
      [[(NSTextView*)c.widget textStorage] deleteCharactersInRange:NSMakeRange(prefix+accepted, cut)];
    else write(c, value);
    nativeEditSelect(c, selection);
  }
  // Marked composition is live text but not the committed MaxLength baseline.
  // Do not emit intermediate Change events or lose the pre-composition value.
  refreshNativePlaceholder(c);
  if (marked) return;
  c.properties["text"] = Value::string(value);
  remember(c, bounded(selection, value.size()));
  if (value != old) c.event("change");
}
} // namespace vb6
