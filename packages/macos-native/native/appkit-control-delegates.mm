// Native AppKit delegate and notification boundary. MIT.
#include "appkit-edit.hpp"
#include "appkit-appearance.hpp"
#include "appkit-collections.hpp"
namespace {
BOOL nativeEditShouldEnd(const std::weak_ptr<vb6::MacControl>&model,NSText*editor) {
  auto c=model.lock();if(!c||c->disposed)return YES;
  return vb6::nativeEditValidate(*c,editor);
}
}
@implementation VB6Canvas
-(BOOL)isFlipped{return YES;}
-(BOOL)acceptsFirstResponder{return YES;}
-(void)viewDidChangeEffectiveAppearance{[super viewDidChangeEffectiveAppearance];self.needsDisplay=YES;}
-(void)drawRect:(NSRect)dirty{if(auto c=model.lock())c->host->event([c,dirty]{vb6::drawControl(*c,dirty);});}
@end
@implementation VB6ControlDelegate
-(void)action:(id)sender{if(auto c=model.lock())if(!c->eventSuppression)c->host->event([c,sender]{
  if([sender isKindOfClass:NSButton.class]&&c->spec.type=="CommandButton"||[sender isKindOfClass:NSMenuItem.class])c->event("click");
  else if([sender isKindOfClass:NSTableView.class]){auto table=(NSTableView*)sender;c->properties["listindex"]=vb6::Value::integer(table.selectedRow);c->selected.clear();[table.selectedRowIndexes enumerateIndexesUsingBlock:^(NSUInteger index,BOOL*){c->selected.insert(index);}];c->event("click");if(c->spec.type=="ListView"){auto value=c->get(*c->host->runtime,"selecteditem");if(value.type==vb6::Type::Object&&std::get<vb6::ObjectPtr>(value.payload))c->event("itemclick",{vb6::Arg(value)});}else if(c->spec.type=="TreeView"){auto value=c->get(*c->host->runtime,"selecteditem");if(value.type==vb6::Type::Object&&std::get<vb6::ObjectPtr>(value.payload))c->event("nodeclick",{vb6::Arg(value)});}}
  else if([sender isKindOfClass:NSComboBox.class]){c->properties["listindex"]=vb6::Value::integer([(NSComboBox*)sender indexOfSelectedItem]);c->changed("text");c->event("click");}
  else if(c->spec.type=="TextBox"||c->spec.type=="RichTextBox")c->changed("text");else c->changed("value");
});}
-(void)doubleAction:(id)sender{(void)sender;if(auto c=model.lock())c->host->event([c]{c->event("dblclick");});}
-(void)controlTextDidChange:(NSNotification*)note{(void)note;if(auto c=model.lock())c->host->event([c]{c->changed("text");});}
-(void)textDidChange:(NSNotification*)note{(void)note;if(auto c=model.lock())c->host->event([c]{c->changed("text");});}
-(void)controlTextDidBeginEditing:(NSNotification*)note{(void)note;if(auto c=model.lock())c->host->event([c]{c->event("gotfocus");});}
-(void)controlTextDidEndEditing:(NSNotification*)note{(void)note;if(auto c=model.lock())c->host->event([c]{c->event("lostfocus");});}
-(BOOL)control:(NSControl*)control textShouldEndEditing:(NSText*)editor{(void)control;return nativeEditShouldEnd(model,editor);}
// NSTextView sends NSTextDelegate callbacks directly; the shared field editor
// reaches the NSControl delegate methods above through its owning text field.
-(void)textDidBeginEditing:(NSNotification*)note{[self controlTextDidBeginEditing:note];}
-(void)textDidEndEditing:(NSNotification*)note{[self controlTextDidEndEditing:note];}
-(BOOL)textShouldEndEditing:(NSText*)editor{return nativeEditShouldEnd(model,editor);}
-(void)comboBoxSelectionDidChange:(NSNotification*)note{[self action:note.object];}
-(BOOL)tabView:(NSTabView*)tabs shouldSelectTabViewItem:(NSTabViewItem*)item{(void)tabs;auto c=model.lock();if(!c)return NO;BOOL accepted=NO;c->host->event([&]{accepted=vb6::nativeTabShouldSelect(*c,item);});return accepted;}
-(void)tabView:(NSTabView*)tabs didSelectTabViewItem:(NSTabViewItem*)item{(void)tabs;if(auto c=model.lock())c->host->event([c,item]{vb6::nativeTabDidSelect(*c,item);});}
@end
