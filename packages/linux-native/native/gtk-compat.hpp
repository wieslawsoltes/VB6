// Version-specific GTK mechanisms behind the shared native VB control model. MIT.
#pragma once
#include <gtk/gtk.h>

namespace vb6 {
struct GtkControl;
GtkWidget* gtkNativeFixedNew();
GtkWidget* gtkNativeTextViewNew();
void gtkNativeConnectDrawing(GtkControl&);
bool gtkNativeToggle(GtkWidget*);
bool gtkNativeToggleActive(GtkWidget*);
void gtkNativeToggleSet(GtkWidget*,bool,bool = false);
bool gtkNativeRange(GtkWidget*);
double gtkNativeRangeValue(GtkWidget*);
void gtkNativeRangeSet(GtkWidget*,double,double,double,double,double);
bool gtkNativeX11Display(GtkWidget*);
void gtkNativeRequireX11(GtkWidget*,const char*);
inline gboolean gtkNativeCanFocus(GtkWidget* widget) {
#if GTK_MAJOR_VERSION >= 4
  return gtk_widget_get_focusable(widget)||GTK_IS_ENTRY(widget)||GTK_IS_SPIN_BUTTON(widget)||GTK_IS_COMBO_BOX(widget);
#else
  return gtk_widget_get_can_focus(widget);
#endif
}

#if GTK_MAJOR_VERSION >= 4
// GTK4 removed generic containers and GdkWindow. Keep the small mechanical
// adapters here; controllers, menus, cursors and snapshots use GTK4 directly.
using GtkContainer = GtkWidget;
using GtkBin = GtkWidget;
using GtkAccelGroup = GtkShortcutController;
using GtkToolbar = GtkBox;
using GtkToolItem = GtkWidget;
using GtkToolButton = GtkButton;
using GtkToggleToolButton = GtkToggleButton;
struct GdkEventKey { guint keyval=0; guint state=0; gint length=0; gchar* string=nullptr; };
using GdkWindow = GdkSurface;
using GdkWindowState = GdkToplevelState;
constexpr auto GDK_MOD1_MASK = GDK_ALT_MASK;
constexpr auto GDK_WINDOW_STATE_ICONIFIED = GDK_TOPLEVEL_STATE_MINIMIZED;
constexpr auto GDK_WINDOW_STATE_MAXIMIZED = GDK_TOPLEVEL_STATE_MAXIMIZED;
constexpr int GTK_WINDOW_TOPLEVEL=0,GTK_WIN_POS_CENTER=1,GDK_WINDOW_TYPE_HINT_DIALOG=1,GTK_RELIEF_NONE=0;
#define GTK_CONTAINER(value) GTK_WIDGET(value)
#define GTK_BIN(value) GTK_WIDGET(value)
#define GTK_TOOLBAR(value) GTK_BOX(value)
#define GTK_IS_TOOLBAR(value) GTK_IS_BOX(value)
#define GTK_TOOL_BUTTON(value) GTK_BUTTON(value)
#define GTK_IS_TOOL_BUTTON(value) GTK_IS_BUTTON(value)
#define GTK_TOGGLE_TOOL_BUTTON(value) GTK_TOGGLE_BUTTON(value)
#define GTK_IS_TOGGLE_TOOL_BUTTON(value) GTK_IS_TOGGLE_BUTTON(value)
#define GTK_IS_EVENT_BOX(value) false

inline gboolean gtk_init_check(gint*,gchar***) { return ::gtk_init_check(); }
inline GtkWidget* gtk_window_new(int) { return ::gtk_window_new(); }
inline GtkWidget* gtk_scrolled_window_new(GtkAdjustment* horizontal,GtkAdjustment* vertical) {
  auto* widget=::gtk_scrolled_window_new();
  if(horizontal)gtk_scrolled_window_set_hadjustment(GTK_SCROLLED_WINDOW(widget),horizontal);
  if(vertical)gtk_scrolled_window_set_vadjustment(GTK_SCROLLED_WINDOW(widget),vertical);
  return widget;
}
void gtk_container_add(GtkContainer*,GtkWidget*);
void gtk_container_remove(GtkContainer*,GtkWidget*);
GList* gtk_container_get_children(GtkContainer*);
GtkWidget* gtk_bin_get_child(GtkBin*);
void gtk_widget_destroy(GtkWidget*);
void gtk_widget_show_all(GtkWidget*);
void gtk_box_pack_start(GtkBox*,GtkWidget*,gboolean,gboolean,guint);
void gtk_box_pack_end(GtkBox*,GtkWidget*,gboolean,gboolean,guint);
inline GtkWidget* gtk_event_box_new() { return gtk_box_new(GTK_ORIENTATION_VERTICAL,0); }
inline const char* gtk_entry_get_text(GtkEntry* entry) { return gtk_editable_get_text(GTK_EDITABLE(entry)); }
inline void gtk_entry_set_text(GtkEntry* entry,const char* text) { gtk_editable_set_text(GTK_EDITABLE(entry),text); }
inline void gtk_label_set_line_wrap(GtkLabel* label,gboolean wrap) { gtk_label_set_wrap(label,wrap); }
inline void gtk_widget_set_can_default(GtkWidget* widget,gboolean value) { gtk_widget_set_receives_default(widget,value); }
inline void gtk_window_set_default(GtkWindow* window,GtkWidget* widget) { gtk_window_set_default_widget(window,widget); }
inline void gtk_widget_queue_draw_area(GtkWidget* widget,int,int,int,int) { gtk_widget_queue_draw(widget); }
inline void gtk_widget_size_allocate(GtkWidget* widget,const GtkAllocation* allocation) { ::gtk_widget_size_allocate(widget,allocation,-1); }
gboolean gtk_widget_translate_coordinates(GtkWidget*,GtkWidget*,int,int,int*,int*);
void gtk_widget_override_font(GtkWidget*,const PangoFontDescription*);
void gtk_widget_override_color(GtkWidget*,GtkStateFlags,const GdkRGBA*);
void gtk_widget_override_background_color(GtkWidget*,GtkStateFlags,const GdkRGBA*);
void gtk_button_set_image(GtkButton*,GtkWidget*);
inline void gtk_button_set_always_show_image(GtkButton*,gboolean) {}
inline void gtk_button_set_relief(GtkButton* button,int) { gtk_widget_add_css_class(GTK_WIDGET(button),"flat"); }
inline void gtk_button_clicked(GtkButton* button) { g_signal_emit_by_name(button,"clicked"); }
inline GtkWidget* gtk_toolbar_new() { return gtk_box_new(GTK_ORIENTATION_HORIZONTAL,0); }
inline GtkToolItem* gtk_separator_tool_item_new() { return gtk_separator_new(GTK_ORIENTATION_VERTICAL); }
inline GtkToolItem* gtk_toggle_tool_button_new() { return gtk_toggle_button_new(); }
inline GtkToolItem* gtk_tool_button_new(GtkWidget*,const char* label) { return gtk_button_new_with_label(label); }
inline void gtk_tool_button_set_label(GtkToolButton* button,const char* label) { gtk_button_set_label(button,label); }
inline void gtk_toolbar_insert(GtkToolbar* toolbar,GtkToolItem* item,int) { gtk_box_append(toolbar,item); }
inline void gtk_toggle_tool_button_set_active(GtkToggleToolButton* button,gboolean active) { gtk_toggle_button_set_active(button,active); }
inline gboolean gtk_toggle_tool_button_get_active(GtkToggleToolButton* button) { return gtk_toggle_button_get_active(button); }
void gtk_calendar_select_month(GtkCalendar*,guint,guint);
void gtk_calendar_select_day(GtkCalendar*,guint);
void gtk_calendar_get_date(GtkCalendar*,guint*,guint*,guint*);
GdkMonitor* gdk_display_get_monitor(GdkDisplay*,int);
GdkMonitor* gdk_display_get_primary_monitor(GdkDisplay*);
int gdk_display_get_n_monitors(GdkDisplay*);
GdkSurface* gtk_widget_get_window(GtkWidget*);
inline GdkToplevelState gdk_window_get_state(GdkSurface* surface) { return GDK_IS_TOPLEVEL(surface)?gdk_toplevel_get_state(GDK_TOPLEVEL(surface)):GdkToplevelState(0); }
void gtk_window_get_position(GtkWindow*,int*,int*);
void gtk_window_move(GtkWindow*,int,int);
void gtk_window_get_size(GtkWindow*,int*,int*);
inline void gtk_window_resize(GtkWindow* window,int width,int height) { gtk_window_set_default_size(window,width,height); }
inline void gtk_window_iconify(GtkWindow* window) { gtk_window_minimize(window); }
inline void gtk_window_deiconify(GtkWindow* window) { gtk_window_unminimize(window); }
void gtk_window_set_position(GtkWindow*,int);
void gtk_window_set_type_hint(GtkWindow*,int);
void gtk_window_set_icon(GtkWindow*,GdkPixbuf*);
void gdk_window_raise(GdkSurface*);
void gdk_window_lower(GdkSurface*);
inline GtkAccelGroup* gtk_accel_group_new() { return GTK_SHORTCUT_CONTROLLER(gtk_shortcut_controller_new()); }
inline void gtk_window_add_accel_group(GtkWindow* window,GtkAccelGroup* group) { gtk_shortcut_controller_set_scope(group,GTK_SHORTCUT_SCOPE_GLOBAL);gtk_widget_add_controller(GTK_WIDGET(window),GTK_EVENT_CONTROLLER(g_object_ref(group))); }
void gtk_widget_draw(GtkWidget*,cairo_t*);
gint gtk_dialog_run(GtkDialog*);
void gtk_file_chooser_set_current_folder(GtkFileChooser*,const char*);
void gtk_file_chooser_set_filename(GtkFileChooser*,const char*);
char* gtk_file_chooser_get_filename(GtkFileChooser*);
GSList* gtk_file_chooser_get_filenames(GtkFileChooser*);
GSList* gtk_file_chooser_list_filters(GtkFileChooser*);
// GTK4's file chooser always confirms replacement when saving an existing file.
inline void gtk_file_chooser_set_do_overwrite_confirmation(GtkFileChooser*,gboolean) {}
using GtkClipboard=GdkClipboard;
constexpr int GDK_SELECTION_CLIPBOARD=0;
inline GtkClipboard* gtk_clipboard_get(int) { return gdk_display_get_clipboard(gdk_display_get_default()); }
inline void gtk_clipboard_clear(GtkClipboard* clipboard) { gdk_clipboard_set_content(clipboard,nullptr); }
void gtk_clipboard_set_text(GtkClipboard*,const char*,int);
void gtk_clipboard_store(GtkClipboard*);
char* gtk_clipboard_wait_for_text(GtkClipboard*);
gboolean gtk_clipboard_wait_is_text_available(GtkClipboard*);
gboolean gtk_clipboard_wait_is_image_available(GtkClipboard*);
void gtk_clipboard_set_image(GtkClipboard*,GdkPixbuf*);
GdkPixbuf* gtk_clipboard_wait_for_image(GtkClipboard*);
#endif
}
