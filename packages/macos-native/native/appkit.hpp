// AppKit backend internals. Exported applications use real Cocoa controls.
#pragma once
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include "vb6.hpp"
#include "library.hpp"
#include "calendar.hpp"
#include "handles.hpp"
#include "recordset-grid.hpp"
#include <exception>
#include <unordered_map>
@class VB6Canvas;@class VB6ControlDelegate;@class VB6WindowDelegate;@class VB6ApplicationDelegate;@class VB6TableDelegate;@class VB6OutlineDelegate;
namespace vb6 {
constexpr double TwipsPerLogicalPixel=15.0;
struct MacHost;struct MacControl;struct MacForm;struct MacItems;struct MacItem;
NSString*ns(const Text&);Text text(NSString*);NSColor*color(int64_t);int32_t colorValue(NSColor*);Text captionText(const Text&);
struct GraphicCommand {std::string kind;std::vector<double>coordinates;int32_t color=0;bool fill=false;double width=1;Text text;NSImage*image=nil;Text fontName=u"Helvetica";double fontSize=11;bool bold=false,italic=false,underline=false,strikeout=false;int style=0;uint32_t flags=0;};
struct MacPictureFrames;
struct MacImage final:Object {NSImage*image=nil;int32_t handle=0,pictureType=1;bool isCursor=false;NSPoint hotspot=NSZeroPoint;std::vector<uint8_t>encoded;std::shared_ptr<MacPictureFrames>frames;NSCursor*cachedCursor=nil;std::weak_ptr<int>ownerLife;HandleRegistry*ownerHandles=nullptr;~MacImage()override;explicit MacImage(NSImage*value):image(value){}std::string className()const override{return "StdPicture";}Value get(Runtime&,const std::string&)override;};
struct MacItem:Object {
  std::weak_ptr<MacControl>owner;std::weak_ptr<MacItems>collection;std::weak_ptr<MacItem>parent;
  std::vector<std::shared_ptr<MacItem>>children;std::map<std::string,Value>properties;std::shared_ptr<MacItems>subitems;std::string kind;uint64_t identity=0;
  std::string className()const override;Value get(Runtime&,const std::string&)override;void set(Runtime&,const std::string&,Value,bool=false)override;Value invoke(Runtime&,const std::string&,Args)override;
};
struct MacItems:Object {
  std::weak_ptr<MacControl>owner;std::weak_ptr<MacItem>parent;std::vector<std::shared_ptr<MacItem>>items;std::string kind;uint64_t nextIdentity=1;
  explicit MacItems(std::string value):kind(std::move(value)){}
  std::string className()const override{return kind;}Value get(Runtime&,const std::string&)override;Value invoke(Runtime&,const std::string&,Args)override;std::vector<Value>enumerate(Runtime&)override;
  std::shared_ptr<MacItem>item(Value)const;size_t index(Value)const;void changed();
};
struct MacControl:Object {
  MacHost*host;std::weak_ptr<Instance>owner;ControlSpec spec;std::map<std::string,Value>properties;
  NSView*view=nil;NSView*widget=nil;NSMenuItem*menu=nil;VB6ControlDelegate*delegate=nil;VB6TableDelegate*tableDelegate=nil;VB6OutlineDelegate*outlineDelegate=nil;NSTimer*timer=nil;NSTrackingArea*cursorTracking=nil;
  // The authored container survives adding/removing an effect around it. The
  // widget remains the event, field-editor and child-container owner.
  NSView*appearanceContent=nil;NSTextField*appearancePlaceholder=nil;NSTextField*appearanceCaption=nil;
  std::string appliedMaterial="none";bool applyingAppearance=false;
  int32_t handle=0;bool initialized=false,disposed=false,eventActive=false,editSelectionPending=false;std::vector<Text>list;std::vector<int32_t>itemData;std::set<size_t>selected;
  std::map<std::string,std::shared_ptr<MacItems>>collections;std::vector<std::vector<Text>>grid;std::map<int,double>columnWidths,rowHeights;std::vector<GraphicCommand>graphics;
  std::shared_ptr<NativeRecordsetGrid> dataBinding;
  std::optional<RecordsetGridEdit> boundEdit;
  uint64_t boundSelection=0;bool boundColumnsReady=false;
  std::map<uint64_t,id>outlineTokens;double currentX=0,currentY=0;size_t suspendLayout=0,eventSuppression=0;NSSize originalParentSize=NSZeroSize;NSRect originalFrame=NSZeroRect;
  MacControl(MacHost&h,std::shared_ptr<Instance>f,ControlSpec s):host(&h),owner(f),spec(std::move(s)){}
  std::string className()const override{return spec.type;}
  Value get(Runtime&,const std::string&)override;void set(Runtime&,const std::string&,Value,bool=false)override;Value invoke(Runtime&,const std::string&,Args)override;Ref reference(Runtime&,const std::string&,Args={})override;
  Value property(const std::string&,Value fallback={})const;double number(const std::string&,double fallback=0)const;bool flag(const std::string&,bool fallback=false)const;
  void initialize();void refresh();void dispose();void event(const std::string&,Args={});void changed(const std::string&);void timerChanged();void reloadList();void applyFont();void applyFrame();
  std::shared_ptr<MacControl>self();std::shared_ptr<MacForm>form()const;NSView*container()const;double unit(int mode= -1,bool horizontal=true)const;NSPoint point(double,double)const;
  std::shared_ptr<MacItems>items(const std::string&);void resizeGrid(size_t,size_t);void updateColumns();void reloadFiles();std::string defaultMember()const;
};
struct MacControlArray:Object {
  MacHost*host;std::weak_ptr<Instance>owner;ControlSpec prototype;std::map<int,std::shared_ptr<MacControl>>elements;std::set<int>designElements;
  std::string className()const override{return "ControlArray";}Value get(Runtime&,const std::string&)override;Value invoke(Runtime&,const std::string&,Args)override;std::vector<Value>enumerate(Runtime&)override;
};
struct MacForm {
  std::shared_ptr<Instance>owner;std::shared_ptr<MacControl>surface;NSWindow*window=nil;VB6WindowDelegate*delegate=nil;NSMenu*menu=nil;
  bool modal=false,closing=false,enabled=true;NSSize originalSize=NSZeroSize;
};
struct MacHost final:NativeHost {
  Runtime*runtime=nullptr;ObjectPtr printer;std::map<std::string,ObjectPtr>systemObjects;std::shared_ptr<int>life=std::make_shared<int>(0);HandleRegistry handles;std::map<Instance*,std::shared_ptr<MacForm>>forms;std::map<std::pair<int32_t,int32_t>,NSTimer*>apiTimers;std::map<std::pair<int32_t,int32_t>,ObjectPtr>apiTimerOwners;
  VB6ApplicationDelegate*applicationDelegate=nil;id monitor=nil;bool initialized=false,running=false,closing=false;std::exception_ptr pending;
  std::chrono::steady_clock::time_point started=std::chrono::steady_clock::now();
  void cancelWindowTimers(int32_t);
  void attach(Runtime&)override;void ensureApplication();void event(const std::function<void()>&);void stopLoop();void check();
  std::shared_ptr<MacForm>form(const std::shared_ptr<Instance>&)const;std::shared_ptr<MacControl>control(int32_t)const;std::shared_ptr<MacControl>controlForView(NSView*)const;std::shared_ptr<MacControl>createControl(const std::shared_ptr<Instance>&,ControlSpec,bool dynamic=false);
  void createForm(const std::shared_ptr<Instance>&)override;Value formGet(const std::shared_ptr<Instance>&,const std::string&)override;void formSet(const std::shared_ptr<Instance>&,const std::string&,Value)override;Value formCall(const std::shared_ptr<Instance>&,const std::string&,Args)override;
  void rebuildMenus(const std::shared_ptr<MacForm>&);void resize(const std::shared_ptr<MacForm>&);void activate(const std::shared_ptr<MacForm>&,bool);bool closeForm(const std::shared_ptr<MacForm>&);bool terminate();NSEvent*routeEvent(NSEvent*);
  Value createObject(Runtime&,const std::string&)override;Value appProperty(Runtime&,const std::string&)override;Value builtin(Frame&,const std::string&,Args)override;
  Value api(Runtime&,const std::string&,Args)override;void graphics(Frame&,Value,const std::string&,std::vector<Value>,Value,bool)override;
  int run(Runtime&)override;void pump()override;void shutdown()override;
  bool hasOpenForms()const noexcept override{return !forms.empty();}
  Value messageBox(const Text&,int64_t,const Text&);Value inputBox(const Text&,const Text&,const Text&);Value dialog(MacControl&,const std::string&);
};
Value createNativePrinter(MacHost&,const std::string&);
Value createNativeFont(std::weak_ptr<MacControl> owner={});
GraphicCommand nativeCommand(MacControl&,std::string);
void appendCommand(MacControl&,GraphicCommand);
Value nativePrint(MacControl&,Args);
std::shared_ptr<MacControl> nativeDrawingControl(MacHost&,Value);
void drawControl(MacControl&,NSRect);std::unique_ptr<NativeHost>makeNativeHost();
}
@interface VB6Canvas:NSView { @public std::weak_ptr<vb6::MacControl>model; }
@end
@interface VB6ControlDelegate:NSObject<NSTextFieldDelegate,NSTextViewDelegate,NSComboBoxDelegate,NSTabViewDelegate> { @public std::weak_ptr<vb6::MacControl>model; }
-(void)action:(id)sender;
-(void)doubleAction:(id)sender;
@end
@interface VB6WindowDelegate:NSObject<NSWindowDelegate> { @public vb6::MacHost*host;std::weak_ptr<vb6::MacForm>model; }
@end
@interface VB6ApplicationDelegate:NSObject<NSApplicationDelegate> { @public vb6::MacHost*host; }
@end
@interface VB6TableDelegate:NSObject<NSTableViewDataSource,NSTableViewDelegate> { @public std::weak_ptr<vb6::MacControl>model; }
@end
@interface VB6OutlineDelegate:NSObject<NSOutlineViewDataSource,NSOutlineViewDelegate> { @public std::weak_ptr<vb6::MacControl>model; }
@end
@interface VB6OutlineToken:NSObject { @public std::shared_ptr<vb6::MacItem>item; }
@end

@interface VB6ControlDelegate (Collections)
-(void)itemAction:(id)sender;
@end
