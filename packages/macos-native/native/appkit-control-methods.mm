// Native AppKit control implementation. MIT.
#include "appkit-control-utils.hpp"
#include "appkit-recordsets.hpp"
#include "appkit-edit.hpp"
#include "appkit-appearance.hpp"
#include "appkit-collections.hpp"
namespace vb6 {
Value MacControl::invoke(Runtime&rt,const std::string&raw,Args args){
  if(disposed)fail(91);bool put=raw.rfind("let:",0)==0||raw.rfind("set:",0)==0;auto name=lower(put?raw.substr(4):raw);if(name.empty())name=defaultMember();
  // Toolbar.Buttons(key) and the other collection properties invoke Item.
  // Preserve the collection's identity, index rules and argument diagnostics.
  if(!put&&(name=="nodes"||name=="listitems"||name=="columnheaders"||name=="panels"||name=="buttons"||name=="listimages"||(name=="tabs"&&spec.type!="SSTab")))
    return args.empty()?Value::object(items(name)):items(name)->invoke(rt,"item",std::move(args));
  if(spec.type=="SSTab"&&(name=="tabcaption"||name=="tabenabled"||name=="tabvisible")) {
    if(args.size()!=(put?2:1))fail(450);return nativeIndexedTab(*this,name,args[0].value.integral(),put?&args[1].value:nullptr);
  }
  if(name=="list"||name=="itemdata"||name=="selected"){
    if(args.size()!=(put?2:1))fail(450);auto index=args[0].value.integral();rangeCheck(index,list.size());size_t i=size_t(index);
    if(put){if(name=="list")list[i]=args[1].value.string();else if(name=="itemdata")itemData[i]=static_cast<int32_t>(coerce(args[1].value,"long").integral());else{if(args[1].value.truth()){if(!flag("multiselect"))selected.clear();selected.insert(i);}else selected.erase(i);}reloadList();return {};}
    return name=="list"?Value::string(list[i]):name=="itemdata"?Value::integer(itemData[i]):Value::boolean(selected.count(i));
  }
  if(name=="textmatrix"||name=="textarray"||name=="data"){
    size_t count=name=="textmatrix"?2:0;bool chart=name=="data"&&spec.type=="MSChart";if(chart)count=0;else if(name!="textmatrix")count=1;
    if(args.size()!=count+(put?1:0))fail(450);int64_t r=chart?int64_t(number("row",1))-1:name=="textmatrix"?args[0].value.integral():grid.empty()?0:args[0].value.integral()/int64_t(grid[0].size());int64_t c=chart?int64_t(number("column",1))-1:name=="textmatrix"?args[1].value.integral():grid.empty()?0:args[0].value.integral()%int64_t(grid[0].size());
    if(r<0||c<0||size_t(r)>=grid.size()||size_t(c)>=grid[size_t(r)].size())fail(381);
    if(put){writeNativeRecordsetCell(*this,size_t(r),size_t(c),args[count].value);return {};}return Value::string(grid[size_t(r)][size_t(c)]);
  }
  if(name=="colwidth"||name=="rowheight"){
    if(args.size()!=(put?2:1))fail(450);int i=int(args[0].value.integral());if(i<0)fail(381);auto&map=name=="colwidth"?columnWidths:rowHeights;if(put){double n=args[1].value.floating();if(n<0||n>300000)fail(380);map[i]=n/15;updateColumns();reloadList();return {};}return Value::real((map.count(i)?map[i]:name=="colwidth"?90:20)*15);
  }
  if(put&&args.size()==1){set(rt,name,args[0].value);return {};}
  if(name=="print")return nativePrint(*this,std::move(args));
  if(name=="paintpicture"){if(args.size()<3||args.size()>9)fail(450);auto image=std::dynamic_pointer_cast<MacImage>(args[0].value.asObject());if(!image||!image->image)fail(5);auto command=nativeCommand(*this,"image");command.image=image->image;auto origin=point(args[1].value.floating(),args[2].value.floating());double width=argument(args,3,Value::real(image->image.size.width/unit(-1,true))).floating(),height=argument(args,4,Value::real(image->image.size.height/unit(-1,false))).floating();command.coordinates={origin.x,origin.y,width*unit(-1,true),height*unit(-1,false)};if(args.size()>5){command.coordinates.push_back(argument(args,5,Value::real(0)).floating()*unit(-1,true));command.coordinates.push_back(argument(args,6,Value::real(0)).floating()*unit(-1,false));command.coordinates.push_back(argument(args,7,Value::real(width)).floating()*unit(-1,true));command.coordinates.push_back(argument(args,8,Value::real(height)).floating()*unit(-1,false));}appendCommand(*this,std::move(command));return {};}
  if(name=="additem"){
    if(args.empty()||args.size()>2)fail(450);Text item=args[0].value.string();int64_t index=integerArgument(args,1,list.size());if(index<0||index>int64_t(list.size()))fail(5);if(list.size()>=1000000)fail(7);
    if(flag("sorted"))index=std::lower_bound(list.begin(),list.end(),item)-list.begin();list.insert(list.begin()+index,item);itemData.insert(itemData.begin()+index,0);
    std::set<size_t> shifted;for(auto i:selected)shifted.insert(i>=size_t(index)?i+1:i);selected.swap(shifted);
    auto prior=property("listindex",Value::integer(-1)).integral();if(prior>=index)properties["listindex"]=Value::integer(prior+1);properties["newindex"]=Value::integer(index);reloadList();return {};
  }
  if(name=="removeitem"){if(args.size()!=1)fail(450);auto index=args[0].value.integral();rangeCheck(index,list.size());list.erase(list.begin()+index);itemData.erase(itemData.begin()+index);
    std::set<size_t> shifted;for(auto i:selected)if(i!=size_t(index))shifted.insert(i>size_t(index)?i-1:i);selected.swap(shifted);
    auto prior=property("listindex",Value::integer(-1)).integral();properties["listindex"]=Value::integer(prior==index?-1:prior>index?prior-1:prior);reloadList();return {};}
  if(name=="clear"){if(dataBinding)fail(380,"Clear requires detaching the Recordset");if(!args.empty())fail(450);list.clear();itemData.clear();selected.clear();properties["listindex"]=Value::integer(-1);for(auto&row:grid)for(auto&cell:row)cell.clear();reloadList();return {};}
  if(name=="setfocus"){if(!args.empty())fail(450);if(!view||view.hidden||!flag("enabled",true))fail(5);auto window=view.window;auto selection=isNativeEdit(*this)?nativeEditSelection(*this):NSMakeRange(0,0);if(!window||![window makeFirstResponder:nativeFocusView(*this)])fail(5);if(isNativeEdit(*this))nativeEditSelect(*this,selection);return {};}
  if(name=="refresh"){view.needsDisplay=YES;widget.needsDisplay=YES;[view displayIfNeeded];return {};}
  if(name=="move"){if(args.size()<2||args.size()>4)fail(450);const char*names[]={"left","top","width","height"};for(size_t i=0;i<args.size();i++)if(args[i].value.type!=Type::Missing)properties[names[i]]=args[i].value;applyFrame();return {};}
  if(name=="zorder"){auto mode=integerArgument(args,0,0);if(mode!=0&&mode!=1)fail(5);auto parent=view.superview;if(parent){[view removeFromSuperview];[parent addSubview:view positioned:mode==0?NSWindowAbove:NSWindowBelow relativeTo:nil];}return {};}
  if(name=="cls"){graphics.clear();currentX=currentY=0;view.needsDisplay=YES;widget.needsDisplay=YES;return {};}
  if(name=="textwidth"||name=="textheight"){
    if(args.size()!=1)fail(450);NSFont*font=[NSFont systemFontOfSize:number("fontsize",8.25)*4/3];NSSize size=[ns(args[0].value.string())sizeWithAttributes:@{NSFontAttributeName:font}];return Value::real(name=="textwidth"?size.width/unit(-1,true):size.height/unit(-1,false),Type::Single);
  }
  if(name=="scalex"||name=="scaley"){if(args.empty()||args.size()>3)fail(450);bool x=name=="scalex";return Value::real(args[0].value.floating()*unit(int(integerArgument(args,1,number("scalemode",1))),x)/unit(int(integerArgument(args,2,number("scalemode",1))),x),Type::Single);}
  if(name=="showopen"||name=="showsave"||name=="showcolor"||name=="showfont"||name=="showprinter")return host->dialog(*this,name);
  if(name=="getdc")return host->api(rt,"user32.GetDC",{Arg(Value::integer(handle))});
  if(name=="click"){event("click");return {};}
  if(name=="loadfile"&&spec.type=="RichTextBox"){
    auto file=std::filesystem::path(toUTF8(stringArgument(args,0)));NSError*error=nil;NSAttributedString*rich=[[NSAttributedString alloc]initWithURL:[NSURL fileURLWithPath:ns(fromUTF8(file.string()))]options:@{} documentAttributes:nullptr error:&error];if(!rich)fail(53,toUTF8(text(error.localizedDescription)));[textView(*this).textStorage setAttributedString:rich];changed("text");return {};
  }
  if(name=="savefile"&&spec.type=="RichTextBox"){
    NSData*data=integerArgument(args,1,0)==1?[textView(*this).string dataUsingEncoding:NSWindowsCP1252StringEncoding allowLossyConversion:NO]:[textView(*this)RTFFromRange:NSMakeRange(0,textView(*this).string.length)];NSError*error=nil;if(!data||![data writeToFile:ns(stringArgument(args,0)) options:NSDataWritingAtomic error:&error])fail(75,error?toUTF8(text(error.localizedDescription)):"Text cannot be encoded");return {};
  }
  if(args.empty())return get(rt,name);fail(438,"Unsupported native method "+spec.type+"."+raw);
}
void MacControl::reloadFiles(){
  list.clear();itemData.clear();selected.clear();
  if(spec.type=="DriveListBox"){
    NSArray<NSURL*>*volumes=[NSFileManager.defaultManager mountedVolumeURLsIncludingResourceValuesForKeys:nil options:0];for(NSURL*url in volumes)list.push_back(text(url.path));if(list.empty())list.push_back(u"/");properties["drive"]=Value::string(u"/");
  }else{
    auto folder=std::filesystem::path(toUTF8(property("path",Value::string(u"/")).string()));std::error_code error;if(!std::filesystem::is_directory(folder,error))fail(76);
    auto pattern=property("pattern",Value::string(u"*.*")).string();if(pattern==u"*.*")pattern=u"*";
    for(auto it=std::filesystem::directory_iterator(folder,error);!error&&it!=std::filesystem::directory_iterator();it.increment(error)){
      bool directory=it->is_directory(error);if(error)break;auto name=fromUTF8(it->path().filename().string());if((spec.type=="DirListBox"&&directory)||(spec.type=="FileListBox"&&!directory&&like(name,pattern,true)))list.push_back(name);
    }
    if(error)fail(75,error.message());std::sort(list.begin(),list.end());
  }
  itemData.resize(list.size());reloadList();
}
void MacControl::reloadList(){
  struct Reload {MacControl& c;explicit Reload(MacControl& value):c(value){++c.eventSuppression;}~Reload(){--c.eventSuppression;}} reload(*this);
  const auto saved=selected;

  if([widget isKindOfClass:NSComboBox.class]){
    auto combo=(NSComboBox*)widget;auto live=nativeEditText(*this);auto selection=nativeEditSelection(*this);[combo removeAllItems];for(auto&item:list)[combo addItemWithObjectValue:ns(item)];auto i=number("listindex",-1);if(i>=0&&size_t(i)<list.size())[combo selectItemAtIndex:NSInteger(i)];combo.stringValue=ns(spec.type=="DriveListBox"?property("drive",Value::string(u"")).string():live);if(spec.type=="ComboBox")nativeEditSelect(*this,selection);
  }else if(auto table=tableView(*this)){[table reloadData];NSMutableIndexSet*indices=[NSMutableIndexSet indexSet];for(size_t i:saved)if(i<size_t(table.numberOfRows))[indices addIndex:i];[table selectRowIndexes:indices byExtendingSelection:NO];}
  view.needsDisplay=YES;widget.needsDisplay=YES;
}
void MacControl::resizeGrid(size_t rows,size_t cols){if(rows>100000||cols>10000||(cols&&rows>1000000/cols))fail(7,"Grid exceeds one million cells");grid.resize(rows);for(auto&row:grid)row.resize(cols);}
void MacControl::updateColumns(){
  auto table=tableView(*this);if(!table)return;for(NSTableColumn*column in table.tableColumns.copy)[table removeTableColumn:column];
  size_t count=!grid.empty()?grid[0].size():spec.type=="ListView"?std::max(size_t(1),items("columnheaders")->items.size()):1;
  table.headerView=(dataBinding||spec.type=="ListBox"||spec.type=="FileListBox"||spec.type=="DirListBox"||spec.type=="TreeView")?nil:[NSTableHeaderView new];
  for(size_t i=0;i<count;i++){
    auto column=[[NSTableColumn alloc]initWithIdentifier:[NSString stringWithFormat:@"%zu",i]];column.width=columnWidths.count(int(i))?columnWidths[int(i)]:90;
    column.title=spec.type=="ListView"&&i<items("columnheaders")->items.size()?ns(items("columnheaders")->items[i]->properties["text"].string()):[NSString stringWithFormat:@"%zu",i+1];
    column.editable=spec.type=="DataGrid";[table addTableColumn:column];if(spec.type=="TreeView"&&i==0)((NSOutlineView*)table).outlineTableColumn=column;
  }
}
Value MacControlArray::get(Runtime&,const std::string&name){if(lower(name)=="count")return Value::integer(elements.size());if(lower(name)=="lbound")return Value::integer(elements.empty()?0:elements.begin()->first);if(lower(name)=="ubound")return Value::integer(elements.empty()?-1:elements.rbegin()->first);fail(438);}
Value MacControlArray::invoke(Runtime&rt,const std::string&raw,Args args){
  auto name=lower(raw);if(name.empty()||name=="item"){if(args.size()!=1)fail(450);int index=int(coerce(args[0].value,"integer").integral());auto it=elements.find(index);if(it==elements.end())fail(340,"Control array element does not exist");return Value::object(it->second);}
  if(name=="load"){if(args.size()!=1)fail(450);int index=int(coerce(args[0].value,"integer").integral());if(index<0||elements.count(index))fail(360,"Control already loaded or invalid index");auto f=owner.lock();if(!f)fail(91);auto spec=prototype;spec.index=index;spec.properties.push_back({"index",Value::integer(index,Type::Integer)});spec.properties.push_back({"visible",Value::boolean(false)});elements[index]=host->createControl(f,std::move(spec),true);return {};}
  if(name=="unload"){if(args.size()!=1)fail(450);int index=int(coerce(args[0].value,"integer").integral());auto it=elements.find(index);if(it==elements.end())fail(340);if(designElements.count(index))fail(362,"Cannot unload a design-time control");it->second->dispose();elements.erase(it);return {};}
  if(args.empty())return get(rt,name);fail(438);
}
std::vector<Value>MacControlArray::enumerate(Runtime&){std::vector<Value>out;for(auto&entry:elements)out.push_back(Value::object(entry.second));return out;}
} // namespace vb6
