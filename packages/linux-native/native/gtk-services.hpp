#pragma once
namespace vb6 {
struct GtkHost;
struct GtkControl;
void gtkRegisterApplication(GtkHost&);
void gtkApplyMousePointer(GtkControl&);
void gtkConnectMousePointer(GtkControl&);
}
