// Native AppKit control implementation. MIT.
#include "appkit-control-utils.hpp"
#include "appkit-recordsets.hpp"
#include "appkit-edit.hpp"
#include "appkit-pictures.hpp"
#include "appkit-richtext.hpp"
#include "appkit-appearance.hpp"
namespace vb6 {
Value MacControl::get(Runtime&rt,const std::string&raw){
  if(disposed)fail(91,"Control has been unloaded");auto name=lower(raw.empty()?defaultMember():raw);
  if(name=="datasource"&&nativeRecordsetGridControl(*this))return Value::object(dataBinding?dataBinding->source:nullptr);
  if(name=="hwnd"||name=="handle")return Value::integer(handle);
  if(name=="font")return createNativeFont(self());
  if(name=="container"||name=="parent"){auto f=owner.lock();if(!f)fail(91);if(spec.parent.empty())return Value::object(f);return f->get(rt,spec.parent);}
  if(name=="controls"){auto f=owner.lock();if(!f)fail(91);return host->formGet(f,"controls");}
  if(name=="visible")return Value::boolean(menu?!menu.hidden:!view.hidden);
  if(name=="text"){
    if(isNativeEdit(*this))return Value::string(nativeEditText(*this));
    if(auto f=textField(*this))return Value::string(text(f.stringValue));
    if(auto t=tableView(*this);t&&grid.empty()){NSInteger index=t.selectedRow;return Value::string(index>=0&&size_t(index)<list.size()?list[size_t(index)]:Text());}
  }
  if(name=="selstart"||name=="sellength"||name=="seltext"){
    if(!isNativeEdit(*this))fail(438);auto range=nativeEditSelection(*this);
    return name=="selstart"?Value::integer(range.location):name=="sellength"?Value::integer(range.length):Value::string(nativeEditText(*this).substr(range.location,range.length));
  }
  if(nativeRichProperty(name))return nativeRichGet(*this,name);
  if(name=="listcount")return Value::integer(list.size());
  if(name=="listindex"){if([widget isKindOfClass:NSComboBox.class])return Value::integer([(NSComboBox*)widget indexOfSelectedItem]);if(auto t=tableView(*this))return Value::integer(t.selectedRow);return property(name,Value::integer(-1));}
  if(name=="selcount")return Value::integer(selected.size());
  if(name=="filename"&&spec.type=="FileListBox"){auto i=get(rt,"listindex").integral();return Value::string(i>=0&&size_t(i)<list.size()?list[size_t(i)]:Text());}
  if(name=="value"&&[widget isKindOfClass:NSDatePicker.class]){auto c=[[NSCalendar currentCalendar]components:NSCalendarUnitYear|NSCalendarUnitMonth|NSCalendarUnitDay|NSCalendarUnitHour|NSCalendarUnitMinute|NSCalendarUnitSecond fromDate:((NSDatePicker*)widget).dateValue];return civilDate({int(c.year),int(c.month),int(c.day),int(c.hour),int(c.minute),int(c.second)});}
  if(name=="nodes"||name=="listitems"||name=="columnheaders"||name=="panels"||name=="buttons"||name=="tabs"&&spec.type!="SSTab"||name=="listimages")return Value::object(items(name));
  if(name=="selecteditem"){
    if(spec.type=="TreeView"){id token=[(NSOutlineView*)widget itemAtRow:((NSOutlineView*)widget).selectedRow];return Value::object([token isKindOfClass:VB6OutlineToken.class]?((VB6OutlineToken*)token)->item:nullptr);}
    if(spec.type=="ListView"){auto i=((NSTableView*)widget).selectedRow;auto collection=items("listitems");return Value::object(i>=0&&size_t(i)<collection->items.size()?collection->items[size_t(i)]:nullptr);}
    if(spec.type=="TabStrip"){auto i=[(NSTabView*)widget indexOfTabViewItem:((NSTabView*)widget).selectedTabViewItem];auto collection=items("tabs");return Value::object(i>=0&&size_t(i)<collection->items.size()?collection->items[size_t(i)]:nullptr);}
  }
  if(name=="row"||name=="col"||name=="rows"||name=="cols"||name=="rowcount"||name=="columncount")return name=="rows"||name=="rowcount"?Value::integer(grid.size()):name=="cols"||name=="columncount"?Value::integer(grid.empty()?0:grid[0].size()):property(name,Value::integer(0));
  if(name=="text"&&!grid.empty()){auto r=size_t(number("row",0)),c=size_t(number("col",0));if(r>=grid.size()||c>=grid[r].size())fail(381);return Value::string(grid[r][c]);}
  if(name=="currentx")return Value::real(currentX,Type::Single);if(name=="currenty")return Value::real(currentY,Type::Single);
  if(name=="scalewidth")return property(name,Value::real(view.bounds.size.width/unit(-1,true),Type::Single));if(name=="scaleheight")return property(name,Value::real(view.bounds.size.height/unit(-1,false),Type::Single));
  if(nativePictureProperty(name))return property(name,Value::object(nullptr));
  if(name=="hDC"||name=="hdc")return invoke(rt,"getdc",{});
  auto it=properties.find(name);if(it!=properties.end())return it->second;
  if(nativeAppearanceProperty(name))return nativeAppearanceDefault(name);
  if(name=="enabled")return Value::boolean(true);if(name=="tag")return Value::string(u"");if(name=="tabindex")return Value::integer(0,Type::Integer);
  fail(438,"Unsupported native property "+spec.type+"."+raw);
}
void MacControl::set(Runtime&rt,const std::string&raw,Value value,bool){
  if(disposed)fail(91);auto name=lower(raw.empty()?defaultMember():raw);
  if(nativeAppearanceProperty(name)){setNativeAppearance(*this,name,std::move(value));return;}
  if(name=="datasource"){bindNativeRecordset(*this,std::move(value));return;}
  if(dataBinding&&(name=="rows"||name=="cols"||name=="rowcount"||name=="columncount"||(name=="fixedrows"&&value.integral()!=1)||(name=="fixedcols"&&value.integral()!=0)))fail(380,"Bound grid shape is owned by its Recordset");
  if(name=="name"||name=="index"||name=="hwnd"||name=="handle"||name=="listcount")fail(383,"Property is read-only");
  if(name=="font"){auto font=value.asObject();for(const auto&entry:std::map<std::string,std::string>{{"name","fontname"},{"size","fontsize"},{"bold","fontbold"},{"italic","fontitalic"},{"underline","fontunderline"},{"strikethrough","fontstrikethru"}})set(rt,entry.second,font->get(rt,entry.first));return;}
  if(name=="listindex"){
    auto i=value.integral();if(i< -1||i>=int64_t(list.size()))fail(380);auto previous=get(rt,"listindex").integral();
    properties[name]=Value::integer(i);selected.clear();if(i>=0)selected.insert(size_t(i));
    {
      struct Select {MacControl&c;explicit Select(MacControl&v):c(v){++c.eventSuppression;}~Select(){--c.eventSuppression;}} selection(*this);
      if([widget isKindOfClass:NSComboBox.class]){auto combo=(NSComboBox*)widget;if(i>=0){[combo selectItemAtIndex:i];if(isNativeEdit(*this))nativeEditSetText(*this,list[size_t(i)]);}else if(combo.indexOfSelectedItem>=0)[combo deselectItemAtIndex:combo.indexOfSelectedItem];}
      else if(auto table=tableView(*this)){[table selectRowIndexes:i<0?NSIndexSet.indexSet:[NSIndexSet indexSetWithIndex:size_t(i)] byExtendingSelection:NO];}
    }
    if(previous!=i)event("click");return;
  }
  if(name=="selstart"||name=="sellength"||name=="seltext"){nativeEditSetSelection(*this,name,std::move(value));return;}
  if(name=="text"&&isNativeEdit(*this)){nativeEditSetText(*this,value.string());return;}
  if(name=="maxlength"){auto n=coerce(value,"long").integral();if(n<0)fail(380);properties[name]=Value::integer(n);return;}
  if(nativeRichProperty(name)){nativeRichSet(*this,name,std::move(value));return;}
  if(name=="selecteditem"){
    auto item=std::dynamic_pointer_cast<MacItem>(value.asObject());if(!item)fail(13);if(spec.type=="TreeView"){id token=outlineTokens[item->identity];if(!token){[(NSOutlineView*)widget reloadData];token=outlineTokens[item->identity];}if(!token)fail(380);NSInteger row=[(NSOutlineView*)widget rowForItem:token];if(row<0)fail(380);[(NSTableView*)widget selectRowIndexes:[NSIndexSet indexSetWithIndex:size_t(row)]byExtendingSelection:NO];}
    else{auto collection=items(spec.type=="ListView"?"listitems":"tabs");auto it=std::find(collection->items.begin(),collection->items.end(),item);if(it==collection->items.end())fail(380);size_t i=size_t(it-collection->items.begin());if(spec.type=="ListView")[(NSTableView*)widget selectRowIndexes:[NSIndexSet indexSetWithIndex:i]byExtendingSelection:NO];else [(NSTabView*)widget selectTabViewItemAtIndex:i];}return;
  }
  if(name=="tab"&&spec.type=="SSTab"){auto i=value.integral();auto tabs=(NSTabView*)widget;if(i<0||i>=tabs.numberOfTabViewItems)fail(380);[tabs selectTabViewItemAtIndex:i];properties[name]=Value::integer(i,Type::Integer);return;}
  if(name=="text"&&!grid.empty()){auto r=size_t(number("row",0)),c=size_t(number("col",0));if(r>=grid.size()||c>=grid[r].size())fail(381);writeNativeRecordsetCell(*this,r,c,std::move(value));return;}
  if(name=="rows"||name=="cols"||name=="rowcount"||name=="columncount"){
    auto n=value.integral();if(n<0||n>100000)fail(380);auto rows=(name=="rows"||name=="rowcount")?size_t(n):grid.size(),cols=(name=="cols"||name=="columncount")?size_t(n):(grid.empty()?0:grid[0].size());resizeGrid(rows,cols);properties[name]=Value::integer(n);updateColumns();reloadList();return;
  }
  if(name=="row"||name=="col"){auto n=value.integral();if(n<0||name=="row"&&size_t(n)>=grid.size()||name=="col"&&(grid.empty()||size_t(n)>=grid[0].size()))fail(381);properties[name]=Value::integer(n);return;}
  if(name=="currentx"||name=="currenty"){double n=value.floating();if(name=="currentx")currentX=n;else currentY=n;return;}
  if(nativePictureProperty(name)){setNativePicture(*this,name,std::move(value));return;}
  if(name=="autosize"||name=="stretch"){setNativePictureLayout(*this,name,std::move(value));return;}
  if(name=="mousepointer"){const auto n=value.integral();if(n<0||(n>15&&n!=99))fail(380);properties[name]=Value::integer(n,Type::Integer);refreshNativePictures(*this);return;}
  if(name=="text"||name=="caption"){
    auto next=value.string(),old=property(name,Value::string(u"")).string();properties[name]=Value::string(next);refresh();
    if(name=="text"&&next!=old)event("change");return;
  }
  const std::set<std::string>supported={"left","top","width","height","visible","enabled","tag","tooltiptext","backcolor","forecolor","fontname","fontsize","fontbold","fontitalic","fontunderline","fontstrikethru","alignment","locked","maxlength","value","min","max","smallchange","largechange","tickfrequency","interval","checked","tabindex","tabstop","scalemode","scaleleft","scaletop","scalewidth","scaleheight","drawcolor","drawstyle","drawmode","drawwidth","fillcolor","fillstyle","bordercolor","borderwidth","shape","borderstyle","stretch","sorted","multiselect","gridlines","fullrowselect","view","fixedrows","fixedcols","rowsel","colsel","textmatrix","simpletext","style","filter","filterindex","filename","dialogtitle","initdir","defaultext","flags","cancelerror","path","pattern","drive","charttype","rowlabel","columnlabel","row","col","tab","redraw","enabled","mousepointer","color","fontcharset"};
  if(!supported.count(name))fail(438,"Unsupported native property "+spec.type+"."+raw);
  if(name=="interval"){auto n=value.integral();if(n<0||n>65535)fail(380);}
  if(name=="value"&&(spec.type=="CheckBox"||spec.type=="OptionButton")){auto n=value.integral();if(n<0||n>(spec.type=="CheckBox"?2:1))fail(380);}
  if(name=="value"&&spec.type=="CheckBox"&&property("macoscontrolstyle",Value::string(u"automatic")).string()==u"switch"&&value.floating()!=0&&value.floating()!=1)fail(380,"Native switches require a binary CheckBox Value of 0 or 1");
  if(name=="scalemode"){auto n=value.integral();if(n<0||n>7)fail(380);}
  auto previousProperties=properties;properties[name]=value;
  if(name=="backcolor")properties.erase("macosbackgroundrole");if(name=="forecolor")properties.erase("macosforegroundrole");
  try{
    if(name=="left"||name=="top"||name=="width"||name=="height")applyFrame();
    else if(name.rfind("font",0)==0)applyFont();
    else if(name=="interval"||name=="enabled"&&spec.type=="Timer")timerChanged();
    else if(name=="path"||name=="pattern"||name=="drive")reloadFiles();
    else if(name=="tooltiptext")view.toolTip=ns(value.string());
    else if(name=="visible"){view.hidden=!value.truth();applyNativeAppearance(*this);}
    else refresh();
  }catch(...){properties=std::move(previousProperties);throw;}
}
Ref MacControl::reference(Runtime&rt,const std::string&raw,Args args){
  if(lower(raw)=="datasource"&&args.empty()&&nativeRecordsetGridControl(*this)){
    auto control=self();return {[control]{if(control->disposed)fail(91);return Value::object(control->dataBinding?control->dataBinding->source:nullptr);},
      [control](Value value,bool){if(control->disposed)fail(91);bindNativeRecordset(*control,std::move(value));},"__native_datasource",false,false};
  }
  if(dataBinding&&lower(raw)=="textmatrix"&&args.size()==2){
    auto row=args[0].value.integral(),column=args[1].value.integral();if(row<0||column<0)fail(381);
    return nativeRecordsetCellReference(*this,size_t(row),size_t(column));
  }
  auto c=self();auto name=lower(raw);if(args.empty())return Object::reference(rt,name,args);
  return {[c,&rt,name,args]{return c->invoke(rt,name,args);},[c,&rt,name,args](Value v,bool){auto all=args;all.emplace_back(v);c->invoke(rt,"let:"+name,all);},"variant",false,false};
}
} // namespace vb6
