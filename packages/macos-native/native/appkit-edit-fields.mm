// Hook the field editor's attachment, not the first text-change notification. MIT.
#include "appkit-edit.hpp"
namespace {
std::shared_ptr<vb6::MacControl> model(NSView* view) {
  if (![view isKindOfClass:NSTextField.class]) return {};
  id delegate = ((NSTextField*)view).delegate;
  if (![delegate isKindOfClass:VB6ControlDelegate.class]) return {};
  auto c = ((VB6ControlDelegate*)delegate)->model.lock();
  return c && !c->disposed ? c : nullptr;
}
struct Selection {
  std::shared_ptr<vb6::MacControl> control;
  NSRange range;
};
Selection beginSelection(NSView* view, NSInteger start, NSInteger length) {
  Selection state{{}, NSMakeRange(NSUInteger(start), NSUInteger(length))};
  auto c = model(view);
  if (c && c->editSelectionPending) c->host->event([&] {
    auto size = size_t(((NSTextField*)view).stringValue.length);
    auto savedStart = c->property("selstart", vb6::Value::integer(0)).integral();
    auto savedLength = c->property("sellength", vb6::Value::integer(0)).integral();
    auto location = std::min(size_t(std::max(int64_t(0), savedStart)), size);
    state.control = c;
    state.range = NSMakeRange(location, std::min(size_t(std::max(int64_t(0), savedLength)), size-location));
    c->editSelectionPending = false;
  });
  return state;
}
void finishSelection(const Selection& state, NSText* editor) {
  if (auto c = state.control) c->host->event([&] {
    // Super has now installed the editor and its text. Setting only the range
    // preserves AppKit's secure-input, field-editor and input-method ownership.
    editor.selectedRange = state.range;
    vb6::nativeEditSelect(*c, state.range);
  });
}
void mouseSelection(NSView* view) {
  // A new mouse selection supersedes a previously stored programmatic range.
  if (auto c = model(view)) c->editSelectionPending = false;
}
void endSelection(NSText* editor) {
  id delegate = editor.delegate;
  if (![delegate isKindOfClass:NSView.class]) return;
  if (auto c = model((NSView*)delegate)) c->host->event([&] { vb6::nativeEditCapture(*c, editor); });
}
}
// Cocoa's field families must retain their respective base implementations.
// Share only these attachment hooks; never replace the secure field's editor.
#define VB6_EDIT_CELL(CLASS, BASE) \
@interface CLASS : BASE @end \
@implementation CLASS \
-(void)selectWithFrame:(NSRect)rect inView:(NSView*)view editor:(NSText*)editor delegate:(id)delegate start:(NSInteger)start length:(NSInteger)length { \
  auto state = beginSelection(view, start, length); \
  [super selectWithFrame:rect inView:view editor:editor delegate:delegate start:NSInteger(state.range.location) length:NSInteger(state.range.length)]; \
  finishSelection(state, editor); \
} \
-(void)editWithFrame:(NSRect)rect inView:(NSView*)view editor:(NSText*)editor delegate:(id)delegate event:(NSEvent*)event { \
  mouseSelection(view); \
  [super editWithFrame:rect inView:view editor:editor delegate:delegate event:event]; \
} \
-(void)endEditing:(NSText*)editor { endSelection(editor); [super endEditing:editor]; } \
@end
VB6_EDIT_CELL(VB6TextFieldCell, NSTextFieldCell)
VB6_EDIT_CELL(VB6SecureTextFieldCell, NSSecureTextFieldCell)
VB6_EDIT_CELL(VB6ComboBoxCell, NSComboBoxCell)
VB6_EDIT_CELL(VB6SearchFieldCell, NSSearchFieldCell)
#undef VB6_EDIT_CELL

@interface VB6TextField : NSTextField @end
@implementation VB6TextField
+(Class)cellClass { return VB6TextFieldCell.class; }
@end
@interface VB6SecureTextField : NSSecureTextField @end
@implementation VB6SecureTextField
+(Class)cellClass { return VB6SecureTextFieldCell.class; }
@end
@interface VB6ComboBox : NSComboBox @end
@implementation VB6ComboBox
+(Class)cellClass { return VB6ComboBoxCell.class; }
@end
@interface VB6SearchField : NSSearchField @end
@implementation VB6SearchField
+(Class)cellClass { return VB6SearchFieldCell.class; }
@end
namespace vb6 {
NSTextField* nativeTextField(bool secure) {
  return secure ? [[VB6SecureTextField alloc] initWithFrame:NSZeroRect] : [[VB6TextField alloc] initWithFrame:NSZeroRect];
}
NSComboBox* nativeComboBox() { return [[VB6ComboBox alloc] initWithFrame:NSZeroRect]; }
NSSearchField* nativeSearchField() { auto field=[[VB6SearchField alloc] initWithFrame:NSZeroRect];field.sendsSearchStringImmediately=YES;return field; }
}
