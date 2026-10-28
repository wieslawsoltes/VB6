// Persistent native collection models and their AppKit presentations. MIT.
#pragma once
#include "appkit.hpp"
namespace vb6 {
void initializeNativeItems(MacControl&,const std::string&);
void reconcileNativeTabs(MacControl&);
void layoutNativeTabPages(MacControl&);
void validateNativeSegmentItems(const MacControl&,const std::vector<std::shared_ptr<MacItem>>&,
  const std::map<MacItem*,std::map<std::string,Value>>& overrides={});
void setNativeItemProperty(MacItem&,const std::string&,Value);
void activateNativeToolbarItem(MacControl&,const std::shared_ptr<MacItem>&,bool);
bool nativeTabShouldSelect(MacControl&,NSTabViewItem*);
void nativeTabDidSelect(MacControl&,NSTabViewItem*);
void selectNativeTab(MacControl&,int64_t);
void setNativeTabCount(MacControl&,int64_t);
Value nativeIndexedTab(MacControl&,const std::string&,int64_t,const Value* value=nullptr);
NSView* nativeTabContainer(MacControl&,int64_t);
}
