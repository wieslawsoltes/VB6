// Native collection-backed controls: tables, outline trees, tabs and command bars.
#include "appkit.hpp"
#include "appkit-recordsets.hpp"
#include "appkit-appearance.hpp"
namespace vb6 {
std::shared_ptr<MacItems>MacControl::items(const std::string&raw){auto name=lower(raw);auto found=collections.find(name);if(found!=collections.end())return found->second;auto collection=std::make_shared<MacItems>(name);collection->owner=self();collections[name]=collection;return collection;}
static Text itemText(const MacItem&item,const std::string&name="text"){auto it=item.properties.find(name);return it==item.properties.end()?Text():it->second.string();}
static bool itemFlag(const MacItem&item,const std::string&name,bool fallback=false){auto it=item.properties.find(name);return it==item.properties.end()?fallback:it->second.truth();}
std::string MacItem::className()const{if(kind=="nodes")return "Node";if(kind=="listitems")return "ListItem";if(kind=="columnheaders")return "ColumnHeader";if(kind=="listimages")return "ListImage";if(kind=="panels")return "Panel";if(kind=="buttons")return "Button";if(kind=="tabs")return "Tab";return "ListSubItem";}
size_t MacItems::index(Value value)const{
  if(value.type==Type::String){auto key=changeCase(value.string(),false);for(size_t i=0;i<items.size();i++)if(changeCase(itemText(*items[i],"key"),false)==key&&!key.empty())return i;fail(35601,"Element not found");}
  auto index=value.integral();if(index<1||uint64_t(index)>items.size())fail(35600,"Index out of bounds");return size_t(index-1);
}
std::shared_ptr<MacItem>MacItems::item(Value value)const{return items[index(value)];}
Value MacItems::get(Runtime&,const std::string&raw){if(lower(raw)=="count")return Value::integer(items.size());fail(438);}
std::vector<Value>MacItems::enumerate(Runtime&){std::vector<Value>out;out.reserve(items.size());for(auto&item:items)out.push_back(Value::object(item));return out;}
void MacItems::changed(){
  auto c=owner.lock();if(!c||c->disposed)return;
  if(kind=="columnheaders")c->updateColumns();
  if(kind=="tabs"&&[c->widget isKindOfClass:NSTabView.class]){
    auto tabs=(NSTabView*)c->widget;NSString*selected=tabs.selectedTabViewItem.identifier;NSMutableDictionary<NSString*,NSTabViewItem*>*old=[NSMutableDictionary dictionary];
    for(NSTabViewItem*tab in tabs.tabViewItems.copy){if([tab.identifier isKindOfClass:NSString.class])old[tab.identifier]=tab;[tabs removeTabViewItem:tab];}
    for(auto&item:items){NSString*key=[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(item->identity)];auto tab=old[key]?:[[NSTabViewItem alloc]initWithIdentifier:key];tab.label=ns(itemText(*item));if(!tab.view)tab.view=[VB6Canvas new];[tabs addTabViewItem:tab];}
    if(selected){auto index=[tabs indexOfTabViewItemWithIdentifier:selected];if(index!=NSNotFound)[tabs selectTabViewItemAtIndex:index];}
  }
  if(kind=="buttons"||kind=="panels"){
    for(NSView*view in c->widget.subviews.copy)[view removeFromSuperview];double x=0;size_t i=0;
    for(auto&item:items){auto button=[NSButton new];button.title=ns(captionText(itemText(*item)));button.bordered=kind=="buttons";button.bezelStyle=NSBezelStyleRounded;button.target=c->delegate;button.action=@selector(itemAction:);button.tag=NSInteger(i++);button.enabled=itemFlag(*item,"enabled",true);button.hidden=!itemFlag(*item,"visible",true);button.state=itemFlag(*item,"value")?NSControlStateValueOn:NSControlStateValueOff;
      if(item->properties.count("style")&&item->properties.at("style").integral()==2)[button setButtonType:NSButtonTypePushOnPushOff];
      applyNativeItemAppearance(*c,button);
      double width=item->properties.count("width")?item->properties.at("width").floating()/15:kind=="panels"?std::max(80.0,c->widget.bounds.size.width/std::max(size_t(1),items.size())):std::max(28.0,double(button.intrinsicContentSize.width));
      button.frame=NSMakeRect(x,0,width,c->widget.bounds.size.height);button.autoresizingMask=NSViewHeightSizable;[c->widget addSubview:button];x+=width;
    }
  }
  c->reloadList();
}
Value MacItems::invoke(Runtime&rt,const std::string&raw,Args args){
  auto name=lower(raw);auto c=owner.lock();if(!c||c->disposed)fail(91);
  if(name.empty()||name=="item"){if(args.size()!=1)fail(450);return Value::object(item(args[0].value));}
  if(name=="clear"){if(!args.empty())fail(450);for(auto&item:items){item->owner.reset();item->children.clear();}items.clear();c->outlineTokens.clear();changed();return {};}
  if(name=="remove"){
    if(args.size()!=1)fail(450);auto victim=item(args[0].value);std::set<MacItem*>remove;
    std::function<void(const std::shared_ptr<MacItem>&)>mark=[&](auto&n){remove.insert(n.get());for(auto&child:n->children)mark(child);};mark(victim);
    if(auto p=victim->parent.lock())p->children.erase(std::remove(p->children.begin(),p->children.end(),victim),p->children.end());
    for(auto&n:items)if(remove.count(n.get())){n->owner.reset();c->outlineTokens.erase(n->identity);}items.erase(std::remove_if(items.begin(),items.end(),[&](auto&n){return remove.count(n.get());}),items.end());changed();return {};
  }
  if(name=="add"){
    if(items.size()>=100000)fail(7,"Native collection exceeds 100000 elements");
    const auto signature=kind=="nodes"?"relative?,relationship?,key?,text?,image?,selectedimage?":kind=="listimages"?"index?,key?,picture":kind=="columnheaders"?"index?,key?,text?,width?,alignment?,icon?":kind=="listitems"?"index?,key?,text?,icon?,smallicon?":kind=="panels"?"index?,key?,text?,style?,picture?":kind=="buttons"?"index?,key?,caption?,style?,image?":"index?,key?,caption?,image?";
    args=bindNamed(std::move(args),signature);size_t keyIndex=kind=="nodes"?2:1,textIndex=kind=="nodes"?3:2;
    auto key=stringArgument(args,keyIndex);if(!key.empty())for(auto&n:items)if(changeCase(itemText(*n,"key"),false)==changeCase(key,false))fail(35602,"Key is not unique");
    auto value=std::make_shared<MacItem>();value->owner=c;value->collection=std::static_pointer_cast<MacItems>(shared_from_this());value->kind=kind;value->identity=nextIdentity++;value->properties["key"]=Value::string(key);value->properties["text"]=Value::string(kind=="listimages"?Text():stringArgument(args,textIndex));value->properties["enabled"]=Value::boolean(true);value->properties["visible"]=Value::boolean(true);value->properties["tag"]=Value::string(u"");
    size_t at=items.size();
    if(kind=="nodes"){
      const auto relative=argument(args,0);auto relationship=integerArgument(args,1,0);if(relationship<0||relationship>4)fail(5);
      if(relative.type!=Type::Missing&&relative.type!=Type::Empty){auto target=item(relative);auto parent=relationship==4?target:target->parent.lock();value->parent=parent;
        if(parent){auto&siblings=parent->children;auto found=std::find(siblings.begin(),siblings.end(),target);size_t pos=relationship==1?0:relationship==2&&found!=siblings.end()?size_t(found-siblings.begin()+1):relationship==3&&found!=siblings.end()?size_t(found-siblings.begin()):siblings.size();siblings.insert(siblings.begin()+pos,value);}
        if(relationship==1)at=0;else if(relationship==2||relationship==3){auto found=std::find(items.begin(),items.end(),target);at=size_t(found-items.begin())+(relationship==2?1:0);}
      }
      value->properties["image"]=argument(args,4,Value::integer(0));value->properties["selectedimage"]=argument(args,5,Value::integer(0));
    }else{
      auto index=argument(args,0);if(index.type!=Type::Missing){auto n=index.integral();if(n<1||uint64_t(n)>items.size()+1)fail(35600);at=size_t(n-1);}
      if(kind=="listimages"){auto picture=argument(args,2);auto image=std::dynamic_pointer_cast<MacImage>(picture.asObject());if(!image)fail(13);value->properties["picture"]=picture;}
      if(kind=="columnheaders"){value->properties["width"]=argument(args,3,Value::integer(1440));value->properties["alignment"]=argument(args,4,Value::integer(0,Type::Integer));}
      if(kind=="buttons"||kind=="panels")value->properties["style"]=argument(args,3,Value::integer(0,Type::Integer));
      if(kind=="listitems"||kind=="listsubitems"){value->subitems=std::make_shared<MacItems>("listsubitems");value->subitems->owner=c;value->subitems->parent=value;}
    }
    items.insert(items.begin()+at,value);changed();return Value::object(value);
  }
  if(args.empty())return get(rt,name);fail(438,"Unsupported native collection method "+kind+"."+raw);
}
Value MacItem::get(Runtime&rt,const std::string&raw){
  auto c=owner.lock();if(!c||c->disposed)fail(91);auto name=lower(raw.empty()?"text":raw);if(name=="caption")name="text";
  if(name=="index"){auto list=collection.lock();if(!list)fail(91);auto it=std::find(list->items.begin(),list->items.end(),std::static_pointer_cast<MacItem>(shared_from_this()));if(it==list->items.end())fail(91);return Value::integer(it-list->items.begin()+1);}
  if(name=="children")return Value::integer(children.size());if(name=="parent")return Value::object(parent.lock());if(name=="child")return Value::object(children.empty()?nullptr:children.front());
  if(name=="root"){auto node=std::static_pointer_cast<MacItem>(shared_from_this());while(auto p=node->parent.lock())node=p;return Value::object(node);}
  if(name=="fullpath"){Text path=itemText(*this);auto current=parent.lock();while(current){path=itemText(*current)+u"\\"+path;current=current->parent.lock();}return Value::string(path);}
  if(name=="next"||name=="previous"||name=="firstsibling"||name=="lastsibling"){
    std::vector<std::shared_ptr<MacItem>>siblings;if(auto p=parent.lock())siblings=p->children;else if(auto list=collection.lock())for(auto&node:list->items)if(node->parent.expired())siblings.push_back(node);
    auto it=std::find_if(siblings.begin(),siblings.end(),[&](auto&n){return n.get()==this;});if(it==siblings.end())return Value::object(nullptr);
    if(name=="firstsibling")return Value::object(siblings.front());if(name=="lastsibling")return Value::object(siblings.back());if(name=="next")return Value::object(it+1==siblings.end()?nullptr:*(it+1));return Value::object(it==siblings.begin()?nullptr:*(it-1));
  }
  if(name=="selected"){auto selected=c->get(rt,"selecteditem");return Value::boolean(selected.type==Type::Object&&std::get<ObjectPtr>(selected.payload).get()==this);}
  if(name=="expanded"&&kind=="nodes"){auto token=c->outlineTokens.find(identity);return Value::boolean(token!=c->outlineTokens.end()&&[(NSOutlineView*)c->widget isItemExpanded:token->second]);}
  if(name=="listsubitems"){if(!subitems){subitems=std::make_shared<MacItems>("listsubitems");subitems->owner=c;subitems->parent=std::static_pointer_cast<MacItem>(shared_from_this());}return Value::object(subitems);}
  auto it=properties.find(name);if(it!=properties.end())return it->second;
  if(name=="checked"||name=="bold")return Value::boolean(false);if(name=="forecolor")return Value::integer(-2147483640);if(name=="backcolor")return Value::integer(-2147483643);fail(438);
}
void MacItem::set(Runtime&rt,const std::string&raw,Value value,bool){
  auto c=owner.lock();if(!c||c->disposed)fail(91);auto name=lower(raw.empty()?"text":raw);if(name=="caption")name="text";
  if(name=="index"||name=="children"||name=="fullpath")fail(383);
  if(name=="selected"){if(value.truth())c->set(rt,"selecteditem",Value::object(shared_from_this()));else if([c->widget isKindOfClass:NSTableView.class])[(NSTableView*)c->widget deselectAll:nil];return;}
  if(name=="expanded"&&kind=="nodes"){auto token=c->outlineTokens.find(identity);if(token==c->outlineTokens.end()){c->reloadList();token=c->outlineTokens.find(identity);}if(token!=c->outlineTokens.end()){if(value.truth())[(NSOutlineView*)c->widget expandItem:token->second];else [(NSOutlineView*)c->widget collapseItem:token->second];}properties[name]=value;return;}
  if(name=="key"){auto list=collection.lock();if(!list)fail(91);auto key=value.string();for(auto&item:list->items)if(item.get()!=this&&!key.empty()&&changeCase(itemText(*item,"key"),false)==changeCase(key,false))fail(35602);}
  const std::set<std::string>allowed={"text","key","tag","enabled","visible","checked","bold","forecolor","backcolor","width","alignment","image","selectedimage","smallicon","icon","picture","value","style","tooltiptext","autosize","bevel","minwidth"};
  if(!allowed.count(name))fail(438,"Unsupported native item property "+raw);if(name=="text"||name=="key"||name=="tooltiptext")value=coerce(value,"string");properties[name]=value;
  if(auto list=collection.lock())list->changed();
}
Value MacItem::invoke(Runtime&rt,const std::string&raw,Args args){
  auto name=lower(raw);bool put=name.rfind("let:",0)==0||name.rfind("set:",0)==0;if(put)name=name.substr(4);
  if(name=="subitems"){
    if(args.size()!=(put?2:1))fail(450);int64_t index=args[0].value.integral();if(index<1||index>10000)fail(381);auto c=owner.lock();if(!c)fail(91);
    if(!subitems){subitems=std::make_shared<MacItems>("listsubitems");subitems->owner=c;subitems->parent=std::static_pointer_cast<MacItem>(shared_from_this());}
    if(put){while(subitems->items.size()<size_t(index))subitems->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::string(u"")),Arg(Value::string(u""))});subitems->items[size_t(index-1)]->set(rt,"text",args[1].value);return {};}
    return Value::string(size_t(index)<=subitems->items.size()?itemText(*subitems->items[size_t(index-1)]):Text());
  }
  if(put&&args.size()==1){set(rt,name,args[0].value);return {};}
  if(name=="ensurevisible"){
    auto c=owner.lock();if(!c)fail(91);if(kind=="nodes"){auto node=parent.lock();while(node){node->set(rt,"expanded",Value::boolean(true));node=node->parent.lock();}auto token=c->outlineTokens.find(identity);if(token!=c->outlineTokens.end()){auto row=[(NSOutlineView*)c->widget rowForItem:token->second];if(row>=0)[(NSOutlineView*)c->widget scrollRowToVisible:row];}}
    else if(kind=="listitems")[(NSTableView*)c->widget scrollRowToVisible:get(rt,"index").integral()-1];return Value::boolean(true);
  }
  if(args.empty())return get(rt,name);fail(438);
}
} // namespace vb6

@implementation VB6OutlineToken
@end
@implementation VB6TableDelegate
-(NSInteger)numberOfRowsInTableView:(NSTableView*)table{(void)table;if(auto c=model.lock()){if(c->spec.type=="ListView")return NSInteger(c->items("listitems")->items.size());if(!c->grid.empty())return NSInteger(c->grid.size());return NSInteger(c->list.size());}return 0;}
-(id)tableView:(NSTableView*)table objectValueForTableColumn:(NSTableColumn*)column row:(NSInteger)row{
  (void)table;auto c=model.lock();if(!c||row<0)return @"";size_t r=size_t(row),col=size_t(column.identifier.integerValue);id result=@"";
  c->host->event([&]{if(c->spec.type=="ListView"){auto items=c->items("listitems");if(r<items->items.size()){auto item=items->items[r];result=col==0?vb6::ns(item->get(*c->host->runtime,"text").string()):vb6::ns(item->invoke(*c->host->runtime,"subitems",{vb6::Arg(vb6::Value::integer(col))}).string());}}
    else if(!c->grid.empty()){if(r<c->grid.size()&&col<c->grid[r].size())result=vb6::ns(c->grid[r][col]);}else if(r<c->list.size())result=vb6::ns(c->list[r]);});return result;
}
-(BOOL)tableView:(NSTableView*)table shouldEditTableColumn:(NSTableColumn*)column row:(NSInteger)row{
  (void)table;auto c=model.lock();if(!c||row<0||c->disposed)return NO;
  if(!c->dataBinding)return c->spec.type=="DataGrid";
  BOOL accepted=NO;c->host->event([&]{
    if(c->spec.type!="DataGrid"||c->flag("locked")||!c->flag("enabled",true))return;
    auto col=column.identifier.integerValue;if(row==0||col<0)return;
    c->boundEdit=c->dataBinding->begin(size_t(row),size_t(col));accepted=YES;
  });return accepted;
}
-(void)tableView:(NSTableView*)table setObjectValue:(id)value forTableColumn:(NSTableColumn*)column row:(NSInteger)row{
  (void)table;if(auto c=model.lock())c->host->event([c,value,column,row]{auto col=column.identifier.integerValue;if(row<0||col<0||size_t(row)>=c->grid.size()||size_t(col)>=c->grid[size_t(row)].size())vb6::fail(381);if(c->dataBinding||c->boundEdit){
      auto token=c->boundEdit;c->boundEdit.reset();
      if(!token||!c->dataBinding)vb6::fail(3218,"Native grid editor is stale");
      c->dataBinding->commit(*token,vb6::Value::string(vb6::text([value description])));
    }else c->grid[size_t(row)][size_t(col)]=vb6::text([value description]);
    c->event("aftercoledit",{vb6::Arg(vb6::Value::integer(col,vb6::Type::Integer))});});
}
-(CGFloat)tableView:(NSTableView*)table heightOfRow:(NSInteger)row{if(auto c=model.lock()){auto found=c->rowHeights.find(int(row));if(found!=c->rowHeights.end())return found->second;}return table.rowHeight;}
-(void)tableView:(NSTableView*)table willDisplayCell:(id)cell forTableColumn:(NSTableColumn*)column row:(NSInteger)row{
  (void)column;auto c=model.lock();if(!c||![cell respondsToSelector:@selector(setTextColor:)])return;
  if([table isRowSelected:row])return;
  auto role=c->property("macosforegroundrole",vb6::Value::string(u"")).string();
  [cell setTextColor:!role.empty()||c->properties.count("forecolor")?vb6::nativeForegroundColor(*c):NSColor.controlTextColor];
}
-(void)tableViewSelectionDidChange:(NSNotification*)notification{auto c=model.lock();if(c&&!(c->spec.type=="ListBox"||c->spec.type=="FileListBox"||c->spec.type=="DirListBox"||c->spec.type=="ListView"))c->host->event([c,notification]{auto table=(NSTableView*)notification.object;if(c->eventSuppression)return;if(c->dataBinding){auto row=table.selectedRow;c->boundSelection=row>0&&size_t(row)<=c->dataBinding->rowIds.size()?c->dataBinding->rowIds[size_t(row)-1]:0;}c->properties["row"]=vb6::Value::integer(std::max(NSInteger(0),table.selectedRow));c->event("selchange");});}
@end
@implementation VB6OutlineDelegate
-(NSInteger)outlineView:(NSOutlineView*)outline numberOfChildrenOfItem:(id)token{
  (void)outline;auto c=model.lock();if(!c)return 0;if(token)return [token isKindOfClass:VB6OutlineToken.class]?NSInteger(((VB6OutlineToken*)token)->item->children.size()):0;
  size_t count=0;for(auto&node:c->items("nodes")->items)if(node->parent.expired())count++;return NSInteger(count);
}
-(id)outlineView:(NSOutlineView*)outline child:(NSInteger)index ofItem:(id)token{
  (void)outline;auto c=model.lock();if(!c||index<0)return nil;std::shared_ptr<vb6::MacItem>item;
  if(token&&[token isKindOfClass:VB6OutlineToken.class]){auto parent=((VB6OutlineToken*)token)->item;if(size_t(index)<parent->children.size())item=parent->children[size_t(index)];}
  else{size_t current=0;for(auto&node:c->items("nodes")->items)if(node->parent.expired()&&current++==size_t(index)){item=node;break;}}
  if(!item)return nil;auto found=c->outlineTokens.find(item->identity);if(found!=c->outlineTokens.end())return found->second;auto out=[VB6OutlineToken new];out->item=item;c->outlineTokens[item->identity]=out;return out;
}
-(BOOL)outlineView:(NSOutlineView*)outline isItemExpandable:(id)token{(void)outline;return [token isKindOfClass:VB6OutlineToken.class]&&!((VB6OutlineToken*)token)->item->children.empty();}
-(id)outlineView:(NSOutlineView*)outline objectValueForTableColumn:(NSTableColumn*)column byItem:(id)token{
  (void)outline;(void)column;auto c=model.lock();if(!c||![token isKindOfClass:VB6OutlineToken.class])return @"";id result=@"";c->host->event([&]{result=vb6::ns(((VB6OutlineToken*)token)->item->get(*c->host->runtime,"text").string());});return result;
}
-(void)outlineView:(NSOutlineView*)outline willDisplayCell:(id)cell forTableColumn:(NSTableColumn*)column item:(id)token{
  (void)column;auto c=model.lock();if(!c||![token isKindOfClass:VB6OutlineToken.class])return;c->host->event([&]{auto item=((VB6OutlineToken*)token)->item;if([cell respondsToSelector:@selector(setTextColor:)]&&![outline isRowSelected:[outline rowForItem:token]]){auto role=c->property("macosforegroundrole",vb6::Value::string(u"")).string();[cell setTextColor:item->properties.count("forecolor")?vb6::color(item->get(*c->host->runtime,"forecolor").integral()):!role.empty()||c->properties.count("forecolor")?vb6::nativeForegroundColor(*c):NSColor.controlTextColor];}if([cell respondsToSelector:@selector(setFont:)]){NSFont*font=[NSFont systemFontOfSize:c->number("fontsize",8.25)*4/3];if(item->get(*c->host->runtime,"bold").truth())font=[NSFontManager.sharedFontManager convertFont:font toHaveTrait:NSBoldFontMask];[cell setFont:font];}});
}
-(void)outlineViewItemDidExpand:(NSNotification*)note{auto c=model.lock();id token=note.userInfo[@"NSObject"];if(c&&[token isKindOfClass:VB6OutlineToken.class])c->host->event([c,token]{c->event("expand",{vb6::Arg(vb6::Value::object(((VB6OutlineToken*)token)->item))});});}
-(void)outlineViewItemDidCollapse:(NSNotification*)note{auto c=model.lock();id token=note.userInfo[@"NSObject"];if(c&&[token isKindOfClass:VB6OutlineToken.class])c->host->event([c,token]{c->event("collapse",{vb6::Arg(vb6::Value::object(((VB6OutlineToken*)token)->item))});});}
@end
@implementation VB6ControlDelegate (Collections)
-(void)itemAction:(id)sender{if(auto c=model.lock())c->host->event([c,sender]{auto collection=c->items(c->spec.type=="Toolbar"?"buttons":"panels");NSInteger index=[sender tag];if(index<0||size_t(index)>=collection->items.size())return;auto item=collection->items[size_t(index)];if([sender isKindOfClass:NSButton.class])item->properties["value"]=vb6::Value::integer([(NSButton*)sender state]==NSControlStateValueOn?1:0,vb6::Type::Integer);c->event(c->spec.type=="Toolbar"?"buttonclick":"panelclick",{vb6::Arg(vb6::Value::object(item))});});}
@end
