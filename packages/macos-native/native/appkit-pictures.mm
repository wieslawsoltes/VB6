// Native resource pictures and control ownership. AppKit owns decoded pixels;
// VB picture values own the image and retain checked source format/hotspot data.
#include "appkit-pictures.hpp"
namespace vb6 {
struct MacPictureFrames {
  std::vector<NativePictureFrame> entries;
  NSArray<NSBitmapImageRep*>* decoded=nil;
  std::map<size_t,NSCursor*> cursors;
};
namespace {
NSImage* decodeImage(const std::vector<uint8_t>& bytes,uint32_t width,uint32_t height) {
  NSData* encoded=[NSData dataWithBytes:bytes.data() length:bytes.size()];
  NSImage* image=[[NSImage alloc]initWithData:encoded];if(!image||!image.valid)fail(481,"AppKit could not decode picture");
  CGImageRef decoded=[image CGImageForProposedRect:nullptr context:nil hints:nil];
  if(!decoded||CGImageGetWidth(decoded)!=width||CGImageGetHeight(decoded)!=height)fail(481,"Decoded picture dimensions disagree with checked header");
  image.size=NSMakeSize(width,height);return image;
}

std::shared_ptr<MacImage> picture(Value value){
  if(value.type!=Type::Object)fail(13,"Picture assignment requires a picture object");
  auto object=std::get<ObjectPtr>(value.payload);if(!object)return nullptr;
  auto result=std::dynamic_pointer_cast<MacImage>(object);if(!result)fail(13,"Picture assignment requires StdPicture");return result;
}
void checkType(const std::string& name,const std::shared_ptr<MacImage>& image){
  if(!image||!image->image)return;
  if(name=="icon"&&(image->pictureType!=3||image->isCursor))fail(485,"Form Icon requires an icon picture");
  if(name!="mouseicon"&&image->isCursor)fail(485,"Cursor pictures are valid only as MouseIcon");
}
std::shared_ptr<MacImage> controlPicture(MacControl& c,const std::string& name){return picture(c.property(name,Value::object(nullptr)));}
}
MacImage::~MacImage(){if(ownerHandles&&!ownerLife.expired())ownerHandles->remove(handle);}
Value loadNativeImage(MacHost& host,std::vector<uint8_t> bytes){
  auto data=decodeNativePicture(std::move(bytes));
  const NSSize logical=NSMakeSize(data.width,data.height);
  NSImage* image=nil;std::shared_ptr<MacPictureFrames> frames;
  if(data.frames.empty())image=decodeImage(data.bytes,data.width,data.height);
  else {
    image=[[NSImage alloc]initWithSize:logical];image.prefersColorMatch=NO;
    frames=std::make_shared<MacPictureFrames>();frames->entries=data.frames;
    NSMutableArray<NSBitmapImageRep*>* decoded=[NSMutableArray arrayWithCapacity:data.frames.size()];
    std::map<std::pair<uint32_t,uint32_t>,size_t> best;
    for(size_t i=0;i<data.frames.size();++i){
      const auto& frame=data.frames[i];
      NSImage* single=decodeImage(nativePictureFrameBytes(data,i),frame.width,frame.height);
      auto cg=[single CGImageForProposedRect:nullptr context:nil hints:nil];
      NSBitmapImageRep* rep=[[NSBitmapImageRep alloc]initWithCGImage:cg];if(!rep)fail(7);
      // All representations share logical point size; their pixel counts retain
      // the original detail. Never flatten a multi-resolution NSImage to CGImage.
      // https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Optimizing/Optimizing.html
      rep.size=logical;[decoded addObject:rep];
      auto key=std::make_pair(frame.width,frame.height);auto found=best.find(key);
      if(found==best.end()||frame.bits>data.frames[found->second].bits)best[key]=i;
    }
    // Decode and retain every entry. For equal physical dimensions, materialize
    // the highest source depth for drawing, with stable directory-order ties.
    for(const auto& entry:best)[image addRepresentation:decoded[entry.second]];
    frames->decoded=[decoded copy];
  }
  auto value=std::make_shared<MacImage>(image);value->pictureType=data.type;value->isCursor=data.cursor;
  value->hotspot=NSMakePoint(data.hotspotX,data.hotspotY);value->encoded=std::move(data.bytes);value->frames=std::move(frames);
  value->handle=host.handles.add(value,HandleKind::Image);value->ownerLife=host.life;value->ownerHandles=&host.handles;return Value::object(value);
}
NSCursor* nativePictureCursor(MacImage& picture,double scale){
  if(!picture.image||!std::isfinite(scale)||scale<=0||scale>16)fail(5,"Invalid native cursor scale");
  if(!picture.frames){
    if(!picture.cachedCursor)picture.cachedCursor=[[NSCursor alloc]initWithImage:picture.image hotSpot:picture.hotspot];
    return picture.cachedCursor;
  }
  auto& frames=*picture.frames;const auto size=picture.image.size;
  const auto index=selectNativePictureFrame(frames.entries,uint32_t(std::ceil(size.width*scale)),uint32_t(std::ceil(size.height*scale)));
  auto found=frames.cursors.find(index);if(found!=frames.cursors.end())return found->second;
  const auto& frame=frames.entries[index];
  NSImage* image=[[NSImage alloc]initWithSize:size];[image addRepresentation:frames.decoded[index]];
  // CUR hotspots belong to each physical frame, not just the first directory
  // entry. Convert the selected hotspot to AppKit's logical point coordinates.
  const auto spot=NSMakePoint(frame.hotspotX*size.width/frame.width,frame.hotspotY*size.height/frame.height);
  NSCursor* cursor=[[NSCursor alloc]initWithImage:image hotSpot:spot];if(!cursor)fail(7);
  frames.cursors.emplace(index,cursor);return cursor;
}
bool nativePictureProperty(const std::string& name){return name=="picture"||name=="image"||name=="icon"||name=="mouseicon"||name=="disabledpicture"||name=="downpicture";}
void initializeNativePictures(MacControl& c){
  for(auto& entry:c.properties)if(nativePictureProperty(entry.first)){
    if(entry.second.type==Type::Object){checkType(entry.first,picture(entry.second));continue;}
    const auto id=entry.second.integral();if(id<0||id>65535)fail(481,"Invalid compiled picture ID");
    entry.second=id?loadNativeImage(*c.host,nativeResources(*c.host->runtime).designer(uint16_t(id))):Value::object(nullptr);
    checkType(entry.first,picture(entry.second));
  }
}
void updateNativeCursor(MacControl& c){
  if(c.disposed)return;const auto pointer=c.number("mousepointer",0);
  if(pointer==99){auto image=controlPicture(c,"mouseicon");if(image&&image->image){const double scale=c.view.window?c.view.window.backingScaleFactor:1;[nativePictureCursor(*image,scale) set];return;}}
  if(pointer==0||pointer==99||pointer==1)[NSCursor.arrowCursor set];else if(pointer==2)[NSCursor.crosshairCursor set];else if(pointer==3)[NSCursor.IBeamCursor set];else if(pointer==11)[NSCursor.operationNotAllowedCursor set];else if(pointer==15)[NSCursor.pointingHandCursor set];
}
void refreshNativePictures(MacControl& c){
  auto image=controlPicture(c,"picture"),alternate=controlPicture(c,"downpicture");
  if(!c.flag("enabled",true)){auto disabled=controlPicture(c,"disabledpicture");if(disabled)image=std::move(disabled);}
  if([c.widget isKindOfClass:NSImageView.class]){
    auto view=(NSImageView*)c.widget;view.image=image?image->image:nil;view.imageScaling=c.flag("stretch",false)?NSImageScaleAxesIndependently:NSImageScaleNone;view.imageAlignment=NSImageAlignTopLeft;
  }else if([c.widget isKindOfClass:NSButton.class]){
    auto button=(NSButton*)c.widget;button.image=image?image->image:nil;button.alternateImage=alternate?alternate->image:nil;
    button.imagePosition=image?(button.title.length?NSImageLeft:NSImageOnly):NSNoImage;
  }
  if(c.spec.type=="Form"||c.spec.type=="MDIForm"){
    auto icon=controlPicture(c,"icon");auto owner=c.owner.lock();if(owner){auto found=c.host->forms.find(owner.get());if(found!=c.host->forms.end())found->second->window.miniwindowImage=icon?icon->image:nil;}if(c.properties.count("icon"))NSApp.applicationIconImage=icon?icon->image:nil;
  }
  if(c.view&&!c.cursorTracking&&(c.properties.count("mouseicon")||c.properties.count("mousepointer"))){
    c.cursorTracking=[[NSTrackingArea alloc]initWithRect:NSZeroRect options:NSTrackingCursorUpdate|NSTrackingActiveInKeyWindow|NSTrackingInVisibleRect owner:c.delegate userInfo:nil];[c.view addTrackingArea:c.cursorTracking];
  }
  c.view.needsDisplay=YES;c.widget.needsDisplay=YES;
}
namespace {
std::optional<NSSize> naturalSize(MacControl& c,const std::shared_ptr<MacImage>& image,bool stretch,bool autoSize){
  if(!image||!image->image||!((c.spec.type=="Image"&&!stretch)||(c.spec.type=="PictureBox"&&autoSize)))return {};
  const auto size=image->image.size;
  const double left=c.number("left",0)/15,top=c.number("top",0)/15;
  if(!std::isfinite(size.width)||!std::isfinite(size.height)||size.width<0||size.height<0||
      size.width>20000||size.height>20000||!std::isfinite(left)||!std::isfinite(top)||
      std::abs(left)>20000||std::abs(top)>20000)fail(380,"Picture geometry exceeds native control limits");
  return size;
}
void applyNaturalSize(MacControl& c,const std::optional<NSSize>& size){
  if(!size)return;
  c.properties["width"]=Value::real(size->width*15);c.properties["height"]=Value::real(size->height*15);c.applyFrame();
}
}
void setNativePicture(MacControl& c,const std::string& name,Value value){
  auto image=picture(value);checkType(name,image);
  // Validate before replacing the old object or geometry. A valid decoded
  // image may exceed the smaller control-layout budget when AutoSize is used.
  const auto size=name=="picture"?naturalSize(c,image,c.flag("stretch",false),c.flag("autosize",false)):std::optional<NSSize>{};
  c.properties[name]=std::move(value);applyNaturalSize(c,size);refreshNativePictures(c);
}
void setNativePictureLayout(MacControl& c,const std::string& name,Value value){
  if(name!="autosize"&&name!="stretch")fail(438);
  const bool enabled=value.truth();
  const auto size=naturalSize(c,controlPicture(c,"picture"),name=="stretch"?enabled:c.flag("stretch",false),name=="autosize"?enabled:c.flag("autosize",false));
  c.properties[name]=Value::boolean(enabled);applyNaturalSize(c,size);refreshNativePictures(c);
}
} // namespace vb6
@implementation VB6ControlDelegate (Pictures)
-(void)cursorUpdate:(NSEvent*)event{(void)event;if(auto c=model.lock())c->host->event([c]{vb6::updateNativeCursor(*c);});}
@end
