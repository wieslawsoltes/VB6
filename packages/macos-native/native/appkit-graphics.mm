// Retained native drawing, fonts, pictures and Cocoa printing. MIT.
#include "appkit.hpp"
#include "appkit-appearance.hpp"

namespace vb6 {
struct NativePrinter;
}
@interface VB6PrintView:NSView { @public std::weak_ptr<vb6::NativePrinter>printer; }
@end

namespace vb6 {
namespace {
NSFont* commandFont(const GraphicCommand&command){
  NSFont*font=[NSFont fontWithName:ns(command.fontName)size:command.fontSize]?:[NSFont systemFontOfSize:command.fontSize];NSFontTraitMask traits=0;if(command.bold)traits|=NSBoldFontMask;if(command.italic)traits|=NSItalicFontMask;if(traits)font=[NSFontManager.sharedFontManager convertFont:font toHaveTrait:traits];return font;
}
void drawCommands(const std::vector<GraphicCommand>&commands){
  for(const auto&command:commands){
    const auto&v=command.coordinates;[color(command.color)set];NSBezierPath*path=[NSBezierPath bezierPath];path.lineWidth=command.width;
    if(command.style==1){CGFloat pattern[]={4,2};[path setLineDash:pattern count:2 phase:0];}else if(command.style==2){CGFloat pattern[]={1,2};[path setLineDash:pattern count:2 phase:0];}
    if(command.kind=="line"&&v.size()>=4){[path moveToPoint:NSMakePoint(v[0],v[1])];[path lineToPoint:NSMakePoint(v[2],v[3])];[path stroke];}
    else if((command.kind=="rect"||command.kind=="ellipse")&&v.size()>=4){NSRect rect=NSMakeRect(std::min(v[0],v[2]),std::min(v[1],v[3]),std::abs(v[2]-v[0]),std::abs(v[3]-v[1]));if(command.kind=="ellipse")[path appendBezierPathWithOvalInRect:rect];else[path appendBezierPathWithRect:rect];if(command.fill)[path fill];else[path stroke];}
    else if(command.kind=="pixel"&&v.size()>=2){NSRectFill(NSMakeRect(v[0],v[1],1,1));}
    else if((command.kind=="text"||command.kind=="textrect")&&v.size()>=2){
      NSMutableDictionary*attributes=[@{NSFontAttributeName:commandFont(command),NSForegroundColorAttributeName:color(command.color)}mutableCopy];
      if(command.underline)attributes[NSUnderlineStyleAttributeName]=@(NSUnderlineStyleSingle);if(command.strikeout)attributes[NSStrikethroughStyleAttributeName]=@(NSUnderlineStyleSingle);
      if(command.kind=="textrect"&&v.size()>=4){NSMutableParagraphStyle*style=[NSMutableParagraphStyle new];style.alignment=command.flags&2?NSTextAlignmentRight:command.flags&1?NSTextAlignmentCenter:NSTextAlignmentLeft;style.lineBreakMode=command.flags&0x8000?NSLineBreakByTruncatingTail:command.flags&0x20?NSLineBreakByClipping:NSLineBreakByWordWrapping;attributes[NSParagraphStyleAttributeName]=style;[ns(command.text)drawInRect:NSMakeRect(v[0],v[1],std::max(0.0,v[2]-v[0]),std::max(0.0,v[3]-v[1]))withAttributes:attributes];}
      else[ns(command.text)drawAtPoint:NSMakePoint(v[0],v[1])withAttributes:attributes];
    }else if(command.kind=="image"&&command.image&&v.size()>=4){NSRect destination=NSMakeRect(v[0],v[1],v[2],v[3]);NSRect source=v.size()>=8?NSMakeRect(v[4],v[5],v[6],v[7]):NSZeroRect;[command.image drawInRect:destination fromRect:source operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];}
  }
}
struct NativeFont final:Object {
  std::weak_ptr<MacControl>owner;std::map<std::string,Value>properties;
  explicit NativeFont(std::weak_ptr<MacControl>value):owner(std::move(value)){
    properties={{"name",Value::string(u"Helvetica")},{"size",Value::currency(u"8.25")},{"bold",Value::boolean(false)},{"italic",Value::boolean(false)},{"underline",Value::boolean(false)},{"strikethrough",Value::boolean(false)},{"charset",Value::integer(0,Type::Integer)}};
  }
  std::string className()const override{return "StdFont";}
  bool supports(const std::string&name)const override{return Object::supports(name)||lower(name)=="font";}
  Value get(Runtime&,const std::string&raw)override{
    auto name=lower(raw);if(name.empty())name="name";if(name=="weight")return Value::integer(getValue("bold").truth()?700:400,Type::Integer);return getValue(name);
  }
  Value getValue(const std::string&name){
    auto it=properties.find(name);if(it==properties.end())fail(438);if(auto c=owner.lock()){auto key=name=="strikethrough"?"fontstrikethru":"font"+name;auto value=c->property(key,it->second);return name=="size"?coerce(value,"currency"):value;}return it->second;
  }
  void set(Runtime&,const std::string&raw,Value value,bool)override{
    auto name=lower(raw);if(name.empty())name="name";if(name=="weight"){auto n=value.integral();if(n<0||n>1000)fail(380);name="bold";value=Value::boolean(n>=600);}
    if(!properties.count(name))fail(438);value=coerce(value,name=="name"?"string":name=="size"?"currency":name=="charset"?"integer":"boolean");if(name=="size"&&(value.number()<=0||value.number()>3072))fail(380);
    properties[name]=value;if(auto c=owner.lock())c->set(*c->host->runtime,name=="strikethrough"?"fontstrikethru":"font"+name,value);
  }
};
}
Value createNativeFont(std::weak_ptr<MacControl>owner){return Value::object(std::make_shared<NativeFont>(std::move(owner)));}
GraphicCommand nativeCommand(MacControl&control,std::string kind){
  GraphicCommand command;command.kind=std::move(kind);command.color=int32_t(control.number("forecolor",0));command.width=std::max(1.0,control.number("drawwidth",1));command.style=int(control.number("drawstyle",0));
  if(!control.property("macosforegroundrole",Value::string(u"")).string().empty())command.color=colorValue(nativeForegroundColor(control));
  command.fontName=control.property("fontname",Value::string(u"Helvetica")).string();command.fontSize=control.number("fontsize",8.25)*4/3;command.bold=control.flag("fontbold");command.italic=control.flag("fontitalic");command.underline=control.flag("fontunderline");command.strikeout=control.flag("fontstrikethru");return command;
}
void appendCommand(MacControl&control,GraphicCommand command){
  if(control.graphics.size()>=1000000)fail(7,"Drawing exceeds one million retained commands");for(double value:command.coordinates)if(!std::isfinite(value)||std::abs(value)>1e9)fail(5,"Invalid drawing coordinate");
  if(!std::isfinite(command.width)||command.width<0||command.width>65535)fail(5);control.graphics.push_back(std::move(command));control.view.needsDisplay=YES;control.widget.needsDisplay=YES;
}
Value nativePrint(MacControl&control,Args args){
  Text output;for(auto&arg:args)output+=printValue(scalar(*control.host->runtime,arg.value));auto command=nativeCommand(control,"text");auto point=control.point(control.currentX,control.currentY);command.coordinates={point.x,point.y};command.text=output;appendCommand(control,command);
  NSFont*font=commandFont(command);double height=std::ceil(font.ascender-font.descender+font.leading);control.currentX=control.number("scaleleft",0);control.currentY+=height/control.unit(-1,false);return {};
}
void drawControl(MacControl&control,NSRect dirty){
  (void)dirty;[NSGraphicsContext saveGraphicsState];@try{
    NSRect bounds=control.view.bounds;[NSBezierPath clipRect:bounds];
    if(control.spec.type!="Shape"&&control.spec.type!="Line"&&!nativeMaterialActive(control)){[nativeBackgroundColor(control)set];NSRectFill(bounds);}
    auto picture=control.property("picture");if(picture.type==Type::Object)if(auto image=std::dynamic_pointer_cast<MacImage>(std::get<ObjectPtr>(picture.payload)))if(image->image)[image->image drawInRect:NSMakeRect(0,0,image->image.size.width,image->image.size.height) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
    if(control.spec.type=="Shape"||control.spec.type=="Line"){
      auto command=nativeCommand(control,control.spec.type=="Line"?"line":int(control.number("shape",0))==2||int(control.number("shape",0))==3?"ellipse":"rect");command.color=int32_t(control.number("bordercolor",0));command.width=control.number("borderwidth",1);command.coordinates={0,0,bounds.size.width,bounds.size.height};
      if(control.spec.type=="Shape"&&int(control.number("fillstyle",1))==0){auto fill=command;fill.fill=true;fill.color=int32_t(control.number("fillcolor",0xffffff));drawCommands({fill});}drawCommands({command});
    }
    if(control.spec.type=="StatusBar"&&control.items("panels")->items.empty()){
      auto command=nativeCommand(control,"text");command.text=control.property("simpletext",Value::string(u"")).string();if(control.property("macoscontrolsize",Value::string(u"regular")).string()!=u"regular")command.fontSize=[NSFont systemFontSizeForControlSize:nativeControlSize(control)];command.coordinates={4,2};drawCommands({command});
    }
    if(control.spec.type=="MSChart"&&!control.grid.empty()&&!control.grid[0].empty()){
      double maximum=0;for(auto&row:control.grid)for(auto&cell:row)if(!cell.empty()){try{maximum=std::max(maximum,std::abs(Value::string(cell).floating()));}catch(const Error&) {}}
      if(maximum<=0)maximum=1;size_t rows=control.grid.size(),cols=control.grid[0].size();double left=30,top=12,width=std::max(1.0,bounds.size.width-42),height=std::max(1.0,bounds.size.height-36);int chart=int(control.number("charttype",1));
      for(size_t col=0;col<cols;col++){NSColor*paint=[NSColor colorWithHue:double(col)/std::max(size_t(1),cols) saturation:0.6 brightness:0.8 alpha:1];NSPoint previous=NSZeroPoint;bool hasPrevious=false;
        for(size_t row=0;row<rows;row++){double value=0;try{if(!control.grid[row][col].empty())value=Value::string(control.grid[row][col]).floating();}catch(const Error&){}
          double x=left+(row+0.5)*width/rows,y=top+height*(1-value/maximum);auto command=nativeCommand(control,chart==3||chart==5?"line":"rect");command.color=colorValue(paint);
          if(command.kind=="line"){if(hasPrevious){command.coordinates={previous.x,previous.y,x,y};drawCommands({command});}previous=NSMakePoint(x,y);hasPrevious=true;}
          else{double bar=width/rows/std::max(size_t(1),cols)*0.85;command.fill=true;command.coordinates={left+row*width/rows+col*bar,y,left+row*width/rows+(col+1)*bar,top+height};drawCommands({command});}
        }
      }
    }
    drawCommands(control.graphics);
  }@finally{[NSGraphicsContext restoreGraphicsState];}
}
struct NativePrinter final:Object {
  MacHost*host;Module module;std::shared_ptr<Instance>context;std::shared_ptr<MacControl>canvas;std::vector<std::vector<GraphicCommand>>pages;NSPrintInfo*info;VB6PrintView*view=nil;std::string device;
  explicit NativePrinter(MacHost&h):host(&h),info([NSPrintInfo.sharedPrintInfo copy]){
    module.name="NativePrinter";context=std::make_shared<Instance>(*h.runtime,module);ControlSpec spec;spec.name="Printer";spec.type="PictureBox";spec.properties={{"scalemode",Value::integer(1,Type::Integer)},{"forecolor",Value::integer(0)},{"backcolor",Value::integer(0xffffff)},{"fontsize",Value::real(10)}};
    canvas=std::make_shared<MacControl>(h,context,spec);canvas->initialize();updateSize();
  }
  void updateSize(){auto size=info.paperSize;canvas->view.frame=NSMakeRect(0,0,size.width*4/3,size.height*4/3);info.scalingFactor=0.75;}
  ~NativePrinter()override{if(canvas)canvas->dispose();}
  std::string className()const override{return "Printer";}
  Value get(Runtime&rt,const std::string&raw)override{
    auto name=lower(raw);if(name=="devicename")return Value::string(text(info.printer.name));if(name=="drivername")return Value::string(u"AppKit");if(name=="port")return Value::string(u"Cocoa");
    if(name=="width")return Value::integer(bankers(info.paperSize.width*20));if(name=="height")return Value::integer(bankers(info.paperSize.height*20));if(name=="orientation")return Value::integer(info.orientation==NSPaperOrientationLandscape?2:1,Type::Integer);
    if(name=="page")return Value::integer(pages.size()+1);if(name=="copies")return Value::integer([info.dictionary[NSPrintCopies]integerValue]);if(name=="twipsperpixelx"||name=="twipsperpixely")return Value::integer(15,Type::Integer);return canvas->get(rt,raw);
  }
  void set(Runtime&rt,const std::string&raw,Value value,bool objectSet)override{
    auto name=lower(raw);if(name=="orientation"){auto n=value.integral();if(n!=1&&n!=2)fail(380);info.orientation=n==1?NSPaperOrientationPortrait:NSPaperOrientationLandscape;updateSize();return;}
    if(name=="copies"){auto n=value.integral();if(n<1||n>32767)fail(380);info.dictionary[NSPrintCopies]=@(n);return;}
    if(name=="devicename"){auto printer=[NSPrinter printerWithName:ns(value.string())];if(!printer)fail(484,"Printer is not available");info.printer=printer;return;}
    canvas->set(rt,raw,value,objectSet);
  }
  Value invoke(Runtime&rt,const std::string&raw,Args args)override{
    auto name=lower(raw);if(name=="print")return nativePrint(*canvas,std::move(args));
    if(name=="newpage"){if(pages.size()>=1000)fail(7,"Print job exceeds 1000 pages");pages.push_back(std::move(canvas->graphics));canvas->graphics.clear();canvas->currentX=canvas->currentY=0;return {};}
    if(name=="killdoc"){pages.clear();canvas->graphics.clear();canvas->currentX=canvas->currentY=0;return {};}
    if(name=="enddoc"){
      host->ensureApplication();if(pages.empty()&&canvas->graphics.empty())return {};pages.push_back(std::move(canvas->graphics));canvas->graphics.clear();
      view=[VB6PrintView new];view->printer=std::static_pointer_cast<NativePrinter>(shared_from_this());view.frame=NSMakeRect(0,0,canvas->view.bounds.size.width,canvas->view.bounds.size.height*pages.size());
      auto operation=[NSPrintOperation printOperationWithView:view printInfo:info];operation.showsPrintPanel=YES;operation.showsProgressPanel=YES;[operation runOperation];host->check();pages.clear();view=nil;canvas->currentX=canvas->currentY=0;return {};
    }
    return canvas->invoke(rt,raw,std::move(args));
  }
};
struct NativePrinters final:Object {
  MacHost*host;explicit NativePrinters(MacHost&h):host(&h){}
  std::string className()const override{return "Printers";}
  Value get(Runtime&,const std::string&raw)override{if(lower(raw)=="count")return Value::integer(NSPrinter.printerNames.count);fail(438);}
  Value invoke(Runtime&rt,const std::string&raw,Args args)override{auto name=lower(raw);if(name.empty()||name=="item"){if(args.size()!=1)fail(450);auto n=args[0].value.integral();auto names=NSPrinter.printerNames;if(n<0||size_t(n)>=names.count)fail(9);auto printer=std::make_shared<NativePrinter>(*host);printer->info.printer=[NSPrinter printerWithName:names[NSUInteger(n)]];return Value::object(printer);}if(args.empty())return get(rt,raw);fail(438);}
  std::vector<Value>enumerate(Runtime&rt)override{std::vector<Value>out;for(size_t i=0;i<NSPrinter.printerNames.count;i++)out.push_back(invoke(rt,"item",{Arg(Value::integer(i))}));return out;}
};
Value createNativePrinter(MacHost&host,const std::string&name){
  host.ensureApplication();if(name=="printers")return Value::object(std::make_shared<NativePrinters>(host));if(!host.printer)host.printer=std::make_shared<NativePrinter>(host);return Value::object(host.printer);
}
std::shared_ptr<MacControl> nativeDrawingControl(MacHost&host,Value receiver){
  auto object=receiver.asObject();if(auto control=std::dynamic_pointer_cast<MacControl>(object))return control;if(auto form=std::dynamic_pointer_cast<Instance>(object)){host.runtime->load(form);return host.form(form)->surface;}if(auto printer=std::dynamic_pointer_cast<NativePrinter>(object))return printer->canvas;fail(438,"Object is not a native drawing surface");
}
void MacHost::graphics(Frame&,Value receiver,const std::string&kind,std::vector<Value>coords,Value paint,bool fill){
  auto target=nativeDrawingControl(*this,receiver);auto command=nativeCommand(*target,kind);if(paint.type!=Type::Missing)command.color=int32_t(coerce(paint,"long").integral());command.fill=fill;
  std::vector<double>values;for(auto&value:coords)values.push_back(value.floating());
  if(kind=="line"||kind=="rect"){if(values.size()!=4)fail(5);auto a=target->point(values[0],values[1]),b=target->point(values[2],values[3]);command.coordinates={a.x,a.y,b.x,b.y};target->currentX=values[2];target->currentY=values[3];}
  else if(kind=="pixel"){if(values.size()!=2)fail(5);auto p=target->point(values[0],values[1]);command.coordinates={p.x,p.y};target->currentX=values[0];target->currentY=values[1];}
  else if(kind=="circle"){if(values.size()!=3||values[2]<0)fail(5);auto p=target->point(values[0],values[1]);double x=values[2]*target->unit(-1,true),y=values[2]*target->unit(-1,false);command.kind="ellipse";command.coordinates={p.x-x,p.y-y,p.x+x,p.y+y};target->currentX=values[0];target->currentY=values[1];}
  else fail(438,"Unsupported native graphics command: "+kind);
  appendCommand(*target,std::move(command));
}
} // namespace vb6

@implementation VB6PrintView
-(BOOL)isFlipped{return YES;}
-(BOOL)knowsPageRange:(NSRangePointer)range{auto p=printer.lock();if(!p)return NO;range->location=1;range->length=p->pages.size();return YES;}
-(NSRect)rectForPage:(NSInteger)page{auto p=printer.lock();if(!p||page<1||size_t(page)>p->pages.size())return NSZeroRect;auto size=p->canvas->view.bounds.size;return NSMakeRect(0,(page-1)*size.height,size.width,size.height);}
-(void)drawRect:(NSRect)dirty{auto p=printer.lock();if(!p)return;p->host->event([p,dirty]{auto size=p->canvas->view.bounds.size;if(size.height<=0)return;size_t first=size_t(std::max(0.0,std::floor(dirty.origin.y/size.height))),last=std::min(p->pages.size(),size_t(std::ceil(NSMaxY(dirty)/size.height)));for(size_t i=first;i<last;i++){[NSGraphicsContext saveGraphicsState];NSAffineTransform*transform=[NSAffineTransform transform];[transform translateXBy:0 yBy:i*size.height];[transform concat];vb6::drawCommands(p->pages[i]);[NSGraphicsContext restoreGraphicsState];}});}
@end
