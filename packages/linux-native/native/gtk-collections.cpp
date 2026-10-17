// Stable VB collection identities, native GTK trees/tables/tabs and ADO grids. MIT.
#include "gtk.hpp"

namespace vb6 {
namespace {
Text itemText(const GtkItem& item,const std::string& name="text") {auto it=item.properties.find(name);return it==item.properties.end()?Text():it->second.string();}
bool itemFlag(const GtkItem& item,const std::string& name,bool fallback=false) {auto it=item.properties.find(name);return it==item.properties.end()?fallback:it->second.truth();}
void updateBinding(GtkControl& c) {
  if(c.disposed||!c.dataBinding)return;auto binding=c.dataBinding;
  c.grid=binding->cells;c.properties["fixedrows"]=Value::integer(1);c.properties["fixedcols"]=Value::integer(0);
  c.selected.clear();auto selected=std::find(binding->rowIds.begin(),binding->rowIds.end(),c.boundSelection);
  if(selected!=binding->rowIds.end())c.selected.insert(size_t(selected-binding->rowIds.begin())+1);
  c.properties["row"]=Value::integer(c.selected.empty()?0:int64_t(*c.selected.begin()));
  c.updateColumns();c.reloadList();
}
std::shared_ptr<GtkItem> selectedTreeItem(GtkControl& c,GtkTreeIter* iter) {
  if(!c.model)return nullptr;guint64 id=0;gtk_tree_model_get(c.model,iter,gtk_tree_model_get_n_columns(c.model)-1,&id,-1);
  auto kind=c.spec.type=="TreeView"?"nodes":"listitems";
  for(auto& item:c.items(kind)->values)if(item->identity==id)return item;
  return nullptr;
}
void selectChanged(GtkControl& c) {
  if(c.suppressEvents)return;auto* selection=gtk_tree_view_get_selection(GTK_TREE_VIEW(c.widget));
  auto* rows=gtk_tree_selection_get_selected_rows(selection,nullptr);c.selected.clear();
  for(auto* node=rows;node;node=node->next){auto* path=static_cast<GtkTreePath*>(node->data);auto* indices=gtk_tree_path_get_indices(path);if(indices)c.selected.insert(size_t(indices[0]));}
  c.properties["listindex"]=Value::integer(c.selected.empty()?-1:int64_t(*c.selected.begin()));
  c.properties["row"]=Value::integer(c.selected.empty()?0:int64_t(*c.selected.begin()));
  if(c.dataBinding){auto row=c.selected.empty()?0:*c.selected.begin();c.boundSelection=row>0&&row<=c.dataBinding->rowIds.size()?c.dataBinding->rowIds[row-1]:0;}
  std::shared_ptr<GtkItem> item;
  if(rows&&(c.spec.type=="TreeView"||c.spec.type=="ListView")){GtkTreeIter iter;if(gtk_tree_model_get_iter(c.model,&iter,static_cast<GtkTreePath*>(rows->data)))item=selectedTreeItem(c,&iter);}
  g_list_free_full(rows,reinterpret_cast<GDestroyNotify>(gtk_tree_path_free));
  if(c.spec.type=="TreeView"&&item)c.event("nodeclick",{Arg(Value::object(item))});
  else if(c.spec.type=="ListView"&&item)c.event("itemclick",{Arg(Value::object(item))});
  else if(c.spec.type=="ListBox"||c.spec.type=="FileListBox")c.event("click");
  else if(c.spec.type=="DirListBox")c.event("change");else c.event("selchange");
}
}

void gtkConnectTree(GtkControl& c) {
  gtkSignal(gtk_tree_view_get_selection(GTK_TREE_VIEW(c.widget)),"changed",G_CALLBACK(+[](GtkTreeSelection*,gpointer data){gtkEvent(data,[](GtkControl& c){selectChanged(c);});}),c.self());
  gtkSignal(c.widget,"row-activated",G_CALLBACK(+[](GtkTreeView*,GtkTreePath*,GtkTreeViewColumn*,gpointer data){gtkEvent(data,[](GtkControl& c){c.event("dblclick");});}),c.self());
  gtkSignal(c.widget,"cursor-changed",G_CALLBACK(+[](GtkTreeView*,gpointer data){gtkEvent(data,[](GtkControl& c){if(c.suppressEvents)return;GtkTreePath* path=nullptr;GtkTreeViewColumn* column=nullptr;gtk_tree_view_get_cursor(GTK_TREE_VIEW(c.widget),&path,&column);if(column)c.properties["col"]=Value::integer(GPOINTER_TO_INT(g_object_get_data(G_OBJECT(column),"vb6-column")));if(path)gtk_tree_path_free(path);});}),c.self());
  for(auto signal:{"row-expanded","row-collapsed"}) {
    if(std::string(signal)=="row-expanded")gtkSignal(c.widget,signal,G_CALLBACK(+[](GtkTreeView*,GtkTreeIter* iter,GtkTreePath*,gpointer data){gtkEvent(data,[&](GtkControl& c){if(c.suppressEvents)return;auto item=selectedTreeItem(c,iter);if(item){item->properties["expanded"]=Value::boolean(true);c.event("expand",{Arg(Value::object(item))});}});}),c.self());
    else gtkSignal(c.widget,signal,G_CALLBACK(+[](GtkTreeView*,GtkTreeIter* iter,GtkTreePath*,gpointer data){gtkEvent(data,[&](GtkControl& c){if(c.suppressEvents)return;auto item=selectedTreeItem(c,iter);if(item){item->properties["expanded"]=Value::boolean(false);c.event("collapse",{Arg(Value::object(item))});}});}),c.self());
  }
}
void GtkControl::updateColumns() {
  if(!GTK_IS_TREE_VIEW(widget))return;GtkEventSuppression guard(*this);
  auto* old=gtk_tree_view_get_columns(GTK_TREE_VIEW(widget));for(auto* it=old;it;it=it->next)gtk_tree_view_remove_column(GTK_TREE_VIEW(widget),GTK_TREE_VIEW_COLUMN(it->data));g_list_free(old);
  size_t count=!grid.empty()?std::max(size_t(1),grid.front().size()):spec.type=="ListView"?std::max(size_t(1),items("columnheaders")->values.size()):1;
  gtk_tree_view_set_headers_visible(GTK_TREE_VIEW(widget),!dataBinding&&(spec.type=="ListView"||!grid.empty()));
  gtk_tree_view_set_grid_lines(GTK_TREE_VIEW(widget),flag("gridlines")?GTK_TREE_VIEW_GRID_LINES_BOTH:GTK_TREE_VIEW_GRID_LINES_NONE);
  for(size_t i=0;i<count;++i) {
    auto title=spec.type=="ListView"&&i<items("columnheaders")->values.size()?toUTF8(itemText(*items("columnheaders")->values[i])):std::to_string(i+1);
    auto* renderer=gtk_cell_renderer_text_new();g_object_set_data(G_OBJECT(renderer),"vb6-column",GINT_TO_POINTER(int(i)));
    g_object_set(renderer,"editable",spec.type=="DataGrid"&&!flag("locked"),nullptr);
    auto* column=gtk_tree_view_column_new_with_attributes(title.c_str(),renderer,"text",int(i),nullptr);g_object_set_data(G_OBJECT(column),"vb6-column",GINT_TO_POINTER(int(i)));
    gtk_tree_view_column_set_resizable(column,TRUE);gtk_tree_view_column_set_sizing(column,GTK_TREE_VIEW_COLUMN_FIXED);
    double width=columnWidths.count(int(i))?columnWidths[int(i)]:spec.type=="ListView"&&i<items("columnheaders")->values.size()?items("columnheaders")->values[i]->properties["width"].floating()/15:90;
    gtk_tree_view_column_set_fixed_width(column,std::max(1,int(width)));gtk_tree_view_append_column(GTK_TREE_VIEW(widget),column);
    if(spec.type=="DataGrid") {
      gtkSignal(renderer,"editing-started",G_CALLBACK(+[](GtkCellRenderer* renderer,GtkCellEditable*,gchar* path,gpointer data){gtkEvent(data,[&](GtkControl& c){if(!c.dataBinding)return;auto* p=gtk_tree_path_new_from_string(path);auto* indices=gtk_tree_path_get_indices(p);auto row=indices?indices[0]:-1;gtk_tree_path_free(p);if(row<=0)fail(381,"Cannot edit a bound grid header");c.pendingEdit=c.dataBinding->begin(size_t(row),size_t(GPOINTER_TO_INT(g_object_get_data(G_OBJECT(renderer),"vb6-column"))));});}),self());
      gtkSignal(renderer,"editing-canceled",G_CALLBACK(+[](GtkCellRenderer*,gpointer data){gtkEvent(data,[](GtkControl& c){c.pendingEdit.reset();});}),self());
      gtkSignal(renderer,"edited",G_CALLBACK(+[](GtkCellRenderer* renderer,gchar* path,gchar* text,gpointer data){gtkEvent(data,[&](GtkControl& c){auto* p=gtk_tree_path_new_from_string(path);auto* indices=gtk_tree_path_get_indices(p);auto row=indices?indices[0]:-1;gtk_tree_path_free(p);auto col=GPOINTER_TO_INT(g_object_get_data(G_OBJECT(renderer),"vb6-column"));if(row<0||col<0)fail(381);if(c.pendingEdit||c.dataBinding){auto token=c.pendingEdit;c.pendingEdit.reset();if(!token||!c.dataBinding)fail(3218,"Native grid editor is stale");c.dataBinding->commit(*token,Value::string(fromUTF8(text)));}else c.writeCell(size_t(row),size_t(col),Value::string(fromUTF8(text)));c.event("aftercoledit",{Arg(Value::integer(col,Type::Integer))});});}),self());
    }
  }
}
void GtkControl::reloadList() {
  if(disposed||!widget)return;GtkEventSuppression guard(*this);
  if(GTK_IS_COMBO_BOX_TEXT(widget)) {
    auto text=editText();auto selection=editor()?editSelection():std::pair<size_t,size_t>{0,0};
    gtk_combo_box_text_remove_all(GTK_COMBO_BOX_TEXT(widget));for(auto& item:list)gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(widget),toUTF8(item).c_str());
    auto index=int(number("listindex",-1));gtk_combo_box_set_active(GTK_COMBO_BOX(widget),index>=0&&size_t(index)<list.size()?index:-1);
    if(editor()){editSetText(index>=0&&size_t(index)<list.size()?list[size_t(index)]:text,false);editSelect(selection.first,selection.second);}return;
  }
  if(!GTK_IS_TREE_VIEW(widget))return;
  size_t columns=!grid.empty()?std::max(size_t(1),grid.front().size()):spec.type=="ListView"?std::max(size_t(1),items("columnheaders")->values.size()):1;
  std::vector<GType> types(columns+1,G_TYPE_STRING);types.back()=G_TYPE_UINT64;
  std::unique_ptr<GtkTreeStore,decltype(&g_object_unref)> store(gtk_tree_store_newv(int(types.size()),types.data()),&g_object_unref);
  std::map<uint64_t,std::string> paths;
  auto append=[&](GtkTreeIter* parent,const std::vector<Text>& cells,uint64_t id) {
    GtkTreeIter iter;gtk_tree_store_append(store.get(),&iter,parent);
    for(size_t col=0;col<columns;++col)gtk_tree_store_set(store.get(),&iter,int(col),col<cells.size()?toUTF8(cells[col]).c_str():"",-1);
    gtk_tree_store_set(store.get(),&iter,int(columns),guint64(id),-1);
    if(id){auto* path=gtk_tree_model_get_path(GTK_TREE_MODEL(store.get()),&iter);auto* text=gtk_tree_path_to_string(path);paths[id]=text;g_free(text);gtk_tree_path_free(path);}return iter;
  };
  if(spec.type=="TreeView") {
    std::function<void(const std::shared_ptr<GtkItem>&,GtkTreeIter*,size_t)> add=[&](const auto& item,GtkTreeIter* parent,size_t depth){if(depth>1024)fail(7,"Tree exceeds native depth limit");auto iter=append(parent,{itemText(*item)},item->identity);for(auto& child:item->children)add(child,&iter,depth+1);};
    for(auto& item:items("nodes")->values)if(item->parent.expired())add(item,nullptr,0);
  } else if(spec.type=="ListView") {
    for(auto& item:items("listitems")->values){std::vector<Text> cells{itemText(*item)};if(item->subitems)for(auto& sub:item->subitems->values)cells.push_back(itemText(*sub));append(nullptr,cells,item->identity);}
  } else if(!grid.empty()) {for(auto& row:grid)append(nullptr,row,0);}
  else {for(auto& value:list)append(nullptr,{value},0);}
  auto* previous=model;model=GTK_TREE_MODEL(store.release());treePaths.swap(paths);gtk_tree_view_set_model(GTK_TREE_VIEW(widget),model);if(previous)g_object_unref(previous);
  auto* selection=gtk_tree_view_get_selection(GTK_TREE_VIEW(widget));gtk_tree_selection_set_mode(selection,flag("multiselect")?GTK_SELECTION_MULTIPLE:GTK_SELECTION_SINGLE);
  for(auto index:selected){auto* path=gtk_tree_path_new_from_indices(int(index),-1);gtk_tree_selection_select_path(selection,path);gtk_tree_path_free(path);}
  if(spec.type=="TreeView")for(auto& item:items("nodes")->values)if(itemFlag(*item,"expanded")){auto found=treePaths.find(item->identity);if(found!=treePaths.end()){auto* path=gtk_tree_path_new_from_string(found->second.c_str());gtk_tree_view_expand_row(GTK_TREE_VIEW(widget),path,FALSE);gtk_tree_path_free(path);}}
}
void GtkControl::resizeGrid(size_t rows,size_t columns) {if(rows>100000||columns>10000||(columns&&rows>1000000/columns))fail(7,"Grid exceeds one million cells");grid.resize(rows);for(auto& row:grid)row.resize(columns);}
void GtkControl::bindRecordset(Value input) {
  if(input.type!=Type::Object)fail(13);auto object=std::get<ObjectPtr>(input.payload);auto recordset=std::dynamic_pointer_cast<NativeRecordset>(object);if(object&&!recordset)fail(13,"DataSource requires a native Recordset");
  std::shared_ptr<NativeRecordsetGrid> next;if(recordset){std::weak_ptr<GtkControl> weak=self();next=NativeRecordsetGrid::create(recordset,[weak]{if(auto c=weak.lock())c->host->event([&]{updateBinding(*c);});});}
  if(dataBinding)dataBinding->detach();dataBinding=std::move(next);if(dataBinding){boundSelection=recordset->current;updateBinding(*this);}else{boundSelection=0;updateColumns();reloadList();}
}
void GtkControl::writeCell(size_t row,size_t column,Value value) {
  if(disposed)fail(91);if(row>=grid.size()||column>=grid[row].size())fail(381);
  if(dataBinding){auto token=dataBinding->begin(row,column);dataBinding->commit(token,std::move(value));}
  else{grid[row][column]=value.string();reloadList();}
}
std::shared_ptr<GtkItems> GtkControl::items(const std::string& raw) {
  auto name=lower(raw);auto found=collections.find(name);if(found!=collections.end())return found->second;
  auto value=std::make_shared<GtkItems>(name);value->owner=self();collections[name]=value;return value;
}
std::string GtkItem::className() const {
  if(kind=="nodes")return "Node";if(kind=="listitems")return "ListItem";if(kind=="columnheaders")return "ColumnHeader";if(kind=="listimages")return "ListImage";if(kind=="panels")return "Panel";if(kind=="buttons")return "Button";if(kind=="tabs")return "Tab";return "ListSubItem";
}
size_t GtkItems::index(Value value) const {
  if(value.type==Type::String){auto key=changeCase(value.string(),false);for(size_t i=0;i<values.size();++i)if(!key.empty()&&changeCase(itemText(*values[i],"key"),false)==key)return i;fail(35601,"Element not found");}
  auto n=value.integral();if(n<1||uint64_t(n)>values.size())fail(35600,"Index out of bounds");return size_t(n-1);
}
Value GtkItems::get(Runtime&,const std::string& raw) {if(lower(raw)=="count")return Value::integer(values.size());fail(438);}
std::vector<Value> GtkItems::enumerate(Runtime&) {std::vector<Value> result;for(auto& item:values)result.push_back(Value::object(item));return result;}
void GtkItems::changed() {
  auto c=owner.lock();if(!c||c->disposed)return;GtkEventSuppression guard(*c);
  if(kind=="columnheaders")c->updateColumns();
  if(kind=="tabs"&&GTK_IS_NOTEBOOK(c->widget)) {
    auto current=gtk_notebook_get_current_page(GTK_NOTEBOOK(c->widget));GtkWidget* selected=current>=0?gtk_notebook_get_nth_page(GTK_NOTEBOOK(c->widget),current):nullptr;
    while(gtk_notebook_get_n_pages(GTK_NOTEBOOK(c->widget)))gtk_notebook_remove_page(GTK_NOTEBOOK(c->widget),0);
    std::set<uint64_t> live;int selectedIndex=0;
    for(size_t i=0;i<values.size();++i){auto& item=values[i];live.insert(item->identity);auto found=c->tabPages.find(item->identity);GtkWidget* page;
      if(found==c->tabPages.end()){page=gtk_fixed_new();g_object_ref_sink(page);c->tabPages[item->identity]=page;}else page=found->second;
      if(page==selected)selectedIndex=int(i);auto* label=gtk_label_new_with_mnemonic(gtkCaption(itemText(*item)).c_str());gtk_notebook_append_page(GTK_NOTEBOOK(c->widget),page,label);gtk_widget_show(page);
    }
    for(auto it=c->tabPages.begin();it!=c->tabPages.end();)if(!live.count(it->first)){gtk_widget_destroy(it->second);g_object_unref(it->second);it=c->tabPages.erase(it);}else ++it;
    gtk_notebook_set_current_page(GTK_NOTEBOOK(c->widget),selectedIndex);
  }
  if(kind=="buttons"||kind=="panels") {
    auto* children=gtk_container_get_children(GTK_CONTAINER(c->widget));for(auto* node=children;node;node=node->next)gtk_widget_destroy(GTK_WIDGET(node->data));g_list_free(children);
    for(auto& item:values) {
      GtkWidget* button=nullptr;
      if(kind=="buttons") {
        auto style=item->properties.count("style")?item->properties["style"].integral():0;
        auto* tool=style==3?gtk_separator_tool_item_new():style==1||style==2?gtk_toggle_tool_button_new():gtk_tool_button_new(nullptr,gtkCaption(itemText(*item),false).c_str());
        if(GTK_IS_TOOL_BUTTON(tool)){gtk_tool_button_set_label(GTK_TOOL_BUTTON(tool),gtkCaption(itemText(*item),false).c_str());
          if(GTK_IS_TOGGLE_TOOL_BUTTON(tool))gtk_toggle_tool_button_set_active(GTK_TOGGLE_TOOL_BUTTON(tool),itemFlag(*item,"value"));}
        gtk_toolbar_insert(GTK_TOOLBAR(c->widget),tool,-1);button=GTK_WIDGET(tool);
      }else {
        button=gtk_button_new_with_label(gtkCaption(itemText(*item),false).c_str());gtk_button_set_relief(GTK_BUTTON(button),GTK_RELIEF_NONE);gtk_box_pack_start(GTK_BOX(c->widget),button,TRUE,TRUE,0);
      }
      gtk_widget_set_sensitive(button,itemFlag(*item,"enabled",true));gtk_widget_set_visible(button,itemFlag(*item,"visible",true));
      if(item->properties.count("width"))gtk_widget_set_size_request(button,std::max(1,int(item->properties["width"].floating()/15)),-1);
      if(GTK_IS_TOOL_BUTTON(button)||GTK_IS_BUTTON(button)) {
        struct Target{std::weak_ptr<GtkControl> control;std::weak_ptr<GtkItem> item;};
        auto* target=new Target{c,item};g_signal_connect_data(button,"clicked",G_CALLBACK(+[](GtkWidget* widget,gpointer data){auto* target=static_cast<Target*>(data);auto c=target->control.lock();auto item=target->item.lock();if(c&&item)c->host->event([&]{if(GTK_IS_TOGGLE_TOOL_BUTTON(widget))item->properties["value"]=Value::integer(gtk_toggle_tool_button_get_active(GTK_TOGGLE_TOOL_BUTTON(widget))?1:0,Type::Integer);c->event(c->spec.type=="Toolbar"?"buttonclick":"panelclick",{Arg(Value::object(item))});});}),target,+[](gpointer data,GClosure*){delete static_cast<Target*>(data);},GConnectFlags(0));
      }
    }
  }
  c->reloadList();
}
Value GtkItems::invoke(Runtime& rt,const std::string& raw,Args args) {
  auto name=lower(raw);auto c=owner.lock();if(!c||c->disposed)fail(91);
  if(name.empty()||name=="item"){if(args.size()!=1)fail(450);return Value::object(item(args[0].value));}
  if(name=="clear"){if(!args.empty())fail(450);for(auto& item:values){item->owner.reset();item->children.clear();}values.clear();changed();return {};}
  if(name=="remove") {
    if(args.size()!=1)fail(450);auto victim=item(args[0].value);std::set<GtkItem*> remove;
    std::vector<std::shared_ptr<GtkItem>> pending{victim};
    while(!pending.empty()){auto item=pending.back();pending.pop_back();if(remove.insert(item.get()).second)pending.insert(pending.end(),item->children.begin(),item->children.end());}
    if(auto p=victim->parent.lock())p->children.erase(std::remove(p->children.begin(),p->children.end(),victim),p->children.end());
    for(auto& value:values)if(remove.count(value.get())){value->owner.reset();value->children.clear();}values.erase(std::remove_if(values.begin(),values.end(),[&](auto& value){return remove.count(value.get());}),values.end());changed();return {};
  }
  if(name=="add") {
    if(values.size()>=100000)fail(7,"Native collection exceeds 100000 items");
    auto signature=kind=="nodes"?"relative?,relationship?,key?,text?,image?,selectedimage?":kind=="listimages"?"index?,key?,picture":kind=="columnheaders"?"index?,key?,text?,width?,alignment?,icon?":kind=="listitems"?"index?,key?,text?,icon?,smallicon?":kind=="panels"?"index?,key?,text?,style?,picture?":kind=="buttons"?"index?,key?,caption?,style?,image?":"index?,key?,caption?,image?";
    args=bindNamed(std::move(args),signature);size_t keyIndex=kind=="nodes"?2:1,textIndex=kind=="nodes"?3:2;auto key=stringArgument(args,keyIndex);
    if(!key.empty())for(auto& item:values)if(changeCase(itemText(*item,"key"),false)==changeCase(key,false))fail(35602,"Key is not unique");
    auto value=std::make_shared<GtkItem>();value->owner=c;value->collection=std::static_pointer_cast<GtkItems>(shared_from_this());value->kind=kind;value->identity=nextIdentity++;
    value->properties={{"key",Value::string(key)},{"text",Value::string(kind=="listimages"?Text():stringArgument(args,textIndex))},{"enabled",Value::boolean(true)},{"visible",Value::boolean(true)},{"tag",Value::string(u"")}};
    size_t at=values.size();
    if(kind=="nodes") {
      auto relative=argument(args,0);auto relationship=integerArgument(args,1,0);if(relationship<0||relationship>4)fail(5);
      if(relative.type!=Type::Missing&&relative.type!=Type::Empty){auto target=item(relative);auto p=relationship==4?target:target->parent.lock();
        size_t depth=0;for(auto ancestor=p;ancestor;ancestor=ancestor->parent.lock())if(++depth>1024)fail(7,"Tree exceeds native depth limit");
        value->parent=p;
        if(p){auto found=std::find(p->children.begin(),p->children.end(),target);auto pos=relationship==1?0:relationship==2&&found!=p->children.end()?size_t(found-p->children.begin()+1):relationship==3&&found!=p->children.end()?size_t(found-p->children.begin()):p->children.size();p->children.insert(p->children.begin()+pos,value);}
        if(relationship==1)at=0;else if(relationship==2||relationship==3){at=size_t(std::find(values.begin(),values.end(),target)-values.begin())+(relationship==2?1:0);}
      }
      value->properties["image"]=argument(args,4,Value::integer(0));value->properties["selectedimage"]=argument(args,5,Value::integer(0));
    }else {
      auto index=argument(args,0);if(index.type!=Type::Missing){auto n=index.integral();if(n<1||uint64_t(n)>values.size()+1)fail(35600);at=size_t(n-1);}
      if(kind=="listimages"){auto image=argument(args,2);if(!std::dynamic_pointer_cast<GtkPicture>(image.asObject()))fail(13);value->properties["picture"]=image;}
      if(kind=="columnheaders"){value->properties["width"]=argument(args,3,Value::integer(1440));value->properties["alignment"]=argument(args,4,Value::integer(0));}
      if(kind=="buttons"||kind=="panels")value->properties["style"]=argument(args,3,Value::integer(0));
    }
    values.insert(values.begin()+at,value);changed();return Value::object(value);
  }
  if(args.empty())return get(rt,name);fail(438,"Unsupported GTK collection method "+kind+"."+raw);
}
Value GtkItem::get(Runtime& rt,const std::string& raw) {
  auto c=owner.lock();if(!c||c->disposed)fail(91);auto name=lower(raw.empty()?"text":raw);if(name=="caption")name="text";
  if(name=="index"){auto values=collection.lock();if(!values)fail(91);auto it=std::find_if(values->values.begin(),values->values.end(),[&](auto& item){return item.get()==this;});if(it==values->values.end())fail(91);return Value::integer(it-values->values.begin()+1);}
  if(name=="children")return Value::integer(children.size());if(name=="parent")return Value::object(parent.lock());if(name=="child")return Value::object(children.empty()?nullptr:children.front());
  if(name=="root"){auto value=std::static_pointer_cast<GtkItem>(shared_from_this());while(auto p=value->parent.lock())value=p;return Value::object(value);}
  if(name=="fullpath"){auto text=itemText(*this);auto p=parent.lock();while(p){text=itemText(*p)+u"\\"+text;p=p->parent.lock();}return Value::string(text);}
  if(name=="next"||name=="previous"||name=="firstsibling"||name=="lastsibling") {std::vector<std::shared_ptr<GtkItem>> siblings;if(auto p=parent.lock())siblings=p->children;else if(auto values=collection.lock())for(auto& item:values->values)if(item->parent.expired())siblings.push_back(item);auto it=std::find_if(siblings.begin(),siblings.end(),[&](auto& item){return item.get()==this;});if(it==siblings.end())return Value::object(nullptr);if(name=="firstsibling")return Value::object(siblings.front());if(name=="lastsibling")return Value::object(siblings.back());if(name=="next")return Value::object(it+1==siblings.end()?nullptr:*(it+1));return Value::object(it==siblings.begin()?nullptr:*(it-1));}
  if(name=="selected"){auto value=c->get(rt,"selecteditem");return Value::boolean(value.type==Type::Object&&std::get<ObjectPtr>(value.payload).get()==this);}
  if(name=="listsubitems"){if(!subitems){subitems=std::make_shared<GtkItems>("listsubitems");subitems->owner=c;subitems->parent=std::static_pointer_cast<GtkItem>(shared_from_this());}return Value::object(subitems);}
  auto found=properties.find(name);if(found!=properties.end())return found->second;
  if(name=="checked"||name=="bold"||name=="expanded")return Value::boolean(false);if(name=="forecolor")return Value::integer(-2147483640);if(name=="backcolor")return Value::integer(-2147483643);fail(438);
}
void GtkItem::set(Runtime& rt,const std::string& raw,Value value,bool) {
  auto c=owner.lock();if(!c||c->disposed)fail(91);auto name=lower(raw.empty()?"text":raw);if(name=="caption")name="text";
  if(name=="index"||name=="children"||name=="fullpath")fail(383);
  if(name=="selected"){if(value.truth())c->set(rt,"selecteditem",Value::object(shared_from_this()));else if(GTK_IS_TREE_VIEW(c->widget))gtk_tree_selection_unselect_all(gtk_tree_view_get_selection(GTK_TREE_VIEW(c->widget)));return;}
  if(name=="expanded"&&kind=="nodes"){auto found=c->treePaths.find(identity);if(found!=c->treePaths.end()){auto* path=gtk_tree_path_new_from_string(found->second.c_str());if(value.truth())gtk_tree_view_expand_row(GTK_TREE_VIEW(c->widget),path,FALSE);else gtk_tree_view_collapse_row(GTK_TREE_VIEW(c->widget),path);gtk_tree_path_free(path);}properties[name]=value;return;}
  if(name=="key"){auto values=collection.lock();if(!values)fail(91);auto key=value.string();for(auto& item:values->values)if(item.get()!=this&&!key.empty()&&changeCase(itemText(*item,"key"),false)==changeCase(key,false))fail(35602);}
  const std::set<std::string> supported={"text","key","tag","enabled","visible","checked","bold","forecolor","backcolor","width","alignment","image","selectedimage","smallicon","icon","picture","value","style","tooltiptext","autosize","bevel","minwidth"};
  if(!supported.count(name))fail(438,"Unsupported GTK item property "+raw);properties[name]=value;if(auto values=collection.lock())values->changed();
}
Ref GtkItem::reference(Runtime& rt,const std::string& name,Args args) {
  if(args.empty())return Object::reference(rt,name,{});auto item=std::static_pointer_cast<GtkItem>(shared_from_this());
  return {[item,&rt,name,args]{return item->invoke(rt,name,args);},[item,&rt,name,args](Value value,bool){auto all=args;all.emplace_back(value);item->invoke(rt,"let:"+name,all);},"variant",false,false};
}
Value GtkItem::invoke(Runtime& rt,const std::string& raw,Args args) {
  auto name=lower(raw);bool put=name.rfind("let:",0)==0||name.rfind("set:",0)==0;if(put)name=name.substr(4);
  if(name=="subitems") {if(args.size()!=(put?2:1))fail(450);auto n=args[0].value.integral();if(n<1||n>10000)fail(381);auto values=get(rt,"listsubitems").asObject();auto list=std::static_pointer_cast<GtkItems>(values);if(put){while(list->values.size()<size_t(n))list->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::string(u"")),Arg(Value::string(u""))});list->values[size_t(n-1)]->set(rt,"text",args[1].value);return {};}return Value::string(size_t(n)<=list->values.size()?itemText(*list->values[size_t(n-1)]):Text());}
  if(put&&args.size()==1){set(rt,name,args[0].value);return {};}
  if(name=="ensurevisible"){auto c=owner.lock();if(!c)fail(91);auto found=c->treePaths.find(identity);if(found==c->treePaths.end())return Value::boolean(false);auto* path=gtk_tree_path_new_from_string(found->second.c_str());gtk_tree_view_expand_to_path(GTK_TREE_VIEW(c->widget),path);gtk_tree_view_scroll_to_cell(GTK_TREE_VIEW(c->widget),path,nullptr,FALSE,0,0);gtk_tree_path_free(path);return Value::boolean(true);}
  if(args.empty())return get(rt,name);fail(438);
}
}
