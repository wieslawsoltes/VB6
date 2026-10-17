// Native AppKit delegate and notification boundary. MIT.
#include "appkit-edit.hpp"
#include "appkit-appearance.hpp"
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
-(BOOL)control:(NSControl*)control textShouldEndEditing:(NSText*)editor{(void)control;auto c=model.lock();if(!c)return YES;vb6::nativeEditCapture(*c,editor);auto cancel=std::make_shared<vb6::Cell>(vb6::Value::boolean(false),"boolean");c->host->event([c,cancel]{c->event("validate",{vb6::Arg(vb6::cellRef(cancel))});});return !cancel->get().truth();}
-(void)comboBoxSelectionDidChange:(NSNotification*)note{[self action:note.object];}
-(void)tabView:(NSTabView*)tabs didSelectTabViewItem:(NSTabViewItem*)item{if(auto c=model.lock())c->host->event([c,tabs,item]{auto previous=c->number("tab",0);auto index=[tabs indexOfTabViewItem:item];c->properties["tab"]=vb6::Value::integer(index,vb6::Type::Integer);c->event("click",c->spec.type=="SSTab"?vb6::Args{vb6::Arg(vb6::Value::integer(int64_t(previous),vb6::Type::Integer))}:vb6::Args{});});}
@end
