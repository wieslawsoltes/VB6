// Native Linux/GTK host for the shared VB6 AOT runtime. MIT.
#pragma once
#include <gtk/gtk.h>
#include <cairo.h>
#include <exception>
#include <thread>
#include "vb6.hpp"
#include "library.hpp"
#include "calendar.hpp"
#include "handles.hpp"
#include "recordset-grid.hpp"
#include "resources.hpp"

namespace vb6 {
constexpr double GtkTwipsPerPixel = 15.0;
struct GtkHost;
struct GtkControl;
struct GtkForm;
struct GtkItems;
struct GtkItem;
struct GtkRichText;

struct GtkPicture final : Object {
  GdkPixbuf* pixels = nullptr;
  int32_t handle = 0;
  int pictureType = 1;
  bool cursor = false;
  uint32_t hotspotX = 0, hotspotY = 0;
  std::vector<uint8_t> encoded;
  std::weak_ptr<int> ownerLife;
  HandleRegistry* registry = nullptr;
  explicit GtkPicture(GdkPixbuf* value = nullptr);
  ~GtkPicture() override;
  std::string className() const override { return "StdPicture"; }
  Value get(Runtime&, const std::string&) override;
};

struct GtkDrawing {
  std::string kind;
  std::vector<double> coordinates;
  int32_t color = 0;
  double width = 1;
  int style = 0;
  bool fill = false;
  Text text;
  Text fontName = u"Sans";
  double fontSize = 8.25;
  bool bold = false, italic = false, underline = false, strikeout = false;
  std::shared_ptr<GtkPicture> picture;
};

struct GtkItem final : Object {
  std::weak_ptr<GtkControl> owner;
  std::weak_ptr<GtkItems> collection;
  std::weak_ptr<GtkItem> parent;
  std::vector<std::shared_ptr<GtkItem>> children;
  std::shared_ptr<GtkItems> subitems;
  std::map<std::string, Value> properties;
  std::string kind;
  uint64_t identity = 0;
  std::string className() const override;
  Value get(Runtime&, const std::string&) override;
  void set(Runtime&, const std::string&, Value, bool = false) override;
  Value invoke(Runtime&, const std::string&, Args) override;
  Ref reference(Runtime&, const std::string&, Args = {}) override;
};

struct GtkItems final : Object {
  std::weak_ptr<GtkControl> owner;
  std::weak_ptr<GtkItem> parent;
  std::vector<std::shared_ptr<GtkItem>> values;
  std::string kind;
  uint64_t nextIdentity = 1;
  explicit GtkItems(std::string value) : kind(std::move(value)) {}
  std::string className() const override { return kind; }
  Value get(Runtime&, const std::string&) override;
  Value invoke(Runtime&, const std::string&, Args) override;
  std::vector<Value> enumerate(Runtime&) override;
  size_t index(Value) const;
  std::shared_ptr<GtkItem> item(Value value) const { return values[index(value)]; }
  void changed();
};

struct GtkControl final : Object {
  GtkHost* host;
  std::weak_ptr<int> hostLife;
  std::weak_ptr<Instance> owner;
  ControlSpec spec;
  std::map<std::string, Value> properties;
  // view is an owned reference. widget/content are borrowed descendants.
  GtkWidget *view = nullptr, *widget = nullptr, *content = nullptr;
  GtkWidget* menu = nullptr;
  GtkTreeModel* model = nullptr;
  GtkCssProvider* css = nullptr;
  int32_t handle = 0;
  int32_t persistentDC = 0;
  guint timer = 0;
  bool initialized = false, disposed = false, eventActive = false, resizing = false;
  size_t suppressEvents = 0;
  std::vector<Text> list;
  std::vector<int32_t> itemData;
  std::set<size_t> selected;
  std::map<std::string, std::shared_ptr<GtkItems>> collections;
  std::map<uint64_t, std::string> treePaths;
  std::map<uint64_t, GtkWidget*> tabPages;
  std::vector<std::vector<Text>> grid;
  std::map<int, double> columnWidths, rowHeights;
  std::shared_ptr<NativeRecordsetGrid> dataBinding;
  std::optional<RecordsetGridEdit> pendingEdit;
  uint64_t boundSelection = 0;
  std::vector<GtkDrawing> drawings;
  std::shared_ptr<GtkRichText> richText;
  double currentX = 0, currentY = 0;
  GdkRectangle initialRect{0, 0, 0, 0};
  int initialParentWidth = 0, initialParentHeight = 0;

  GtkControl(GtkHost& h, std::shared_ptr<Instance> instance, ControlSpec value)
    : host(&h), owner(instance), spec(std::move(value)) {}
  ~GtkControl() override;
  std::string className() const override { return spec.type; }
  std::shared_ptr<GtkControl> self();
  std::shared_ptr<GtkForm> form() const;
  Value property(const std::string&, Value fallback = {}) const;
  double number(const std::string&, double fallback = 0) const;
  bool flag(const std::string&, bool fallback = false) const;
  std::string defaultMember() const;
  GtkWidget* container() const;
  GtkWidget* editor() const;
  Text editText() const;
  std::pair<size_t, size_t> editSelection() const;
  void editSelect(size_t, size_t);
  void editSetText(const Text&, bool fire = true);
  double unit(int mode = -1, bool horizontal = true) const;
  std::pair<double, double> point(double, double) const;
  void initialize();
  void dispose();
  void refresh();
  void applyFrame();
  void applyFont();
  void timerChanged();
  void event(const std::string&, Args = {});
  void changed(const std::string&);
  void reloadList();
  void reloadFiles();
  void updateColumns();
  void resizeGrid(size_t, size_t);
  void bindRecordset(Value);
  void writeCell(size_t, size_t, Value);
  std::shared_ptr<GtkItems> items(const std::string&);
  Value get(Runtime&, const std::string&) override;
  void set(Runtime&, const std::string&, Value, bool = false) override;
  Value invoke(Runtime&, const std::string&, Args) override;
  Ref reference(Runtime&, const std::string&, Args = {}) override;
};

struct GtkControlArray final : Object {
  GtkHost* host = nullptr;
  std::weak_ptr<Instance> owner;
  ControlSpec prototype;
  std::map<int, std::shared_ptr<GtkControl>> elements;
  std::set<int> designElements;
  std::string className() const override { return "ControlArray"; }
  Value get(Runtime&, const std::string&) override;
  Value invoke(Runtime&, const std::string&, Args) override;
  std::vector<Value> enumerate(Runtime&) override;
};

struct GtkForm {
  std::shared_ptr<Instance> owner;
  std::shared_ptr<GtkControl> surface;
  GtkWidget *window = nullptr, *box = nullptr, *menuBar = nullptr;
  GtkAccelGroup* accelerators = nullptr;
  GMainLoop* modalLoop = nullptr;
  bool closing = false, enabled = true, sizing = false;
  int width = 0, height = 0;
};

struct GtkHost final : NativeHost {
  Runtime* runtime = nullptr;
  bool initialized = false, closing = false;
  std::thread::id thread;
  std::exception_ptr pending;
  std::shared_ptr<int> life = std::make_shared<int>(0);
  HandleRegistry handles;
  std::map<std::string,ObjectPtr> systemObjects;
  std::map<Instance*, std::shared_ptr<GtkForm>> forms;
  std::map<std::pair<int32_t, int32_t>, guint> apiTimers;
  std::vector<GMainLoop*> loops;
  std::vector<GtkWidget*> dialogs;
  std::chrono::steady_clock::time_point started = std::chrono::steady_clock::now();
  ~GtkHost() override;
  void attach(Runtime&) override;
  void ensureApplication();
  void event(const std::function<void()>&) noexcept;
  void check();
  void stopLoops();
  void cancelTimers(int32_t);
  std::shared_ptr<GtkForm> form(const std::shared_ptr<Instance>&) const;
  std::shared_ptr<GtkControl> control(int32_t) const;
  std::shared_ptr<GtkControl> controlForWidget(GtkWidget*) const;
  std::shared_ptr<GtkControl> createControl(const std::shared_ptr<Instance>&, ControlSpec, bool = false);
  void createForm(const std::shared_ptr<Instance>&) override;
  Value formGet(const std::shared_ptr<Instance>&, const std::string&) override;
  void formSet(const std::shared_ptr<Instance>&, const std::string&, Value) override;
  Value formCall(const std::shared_ptr<Instance>&, const std::string&, Args) override;
  void rebuildMenus(const std::shared_ptr<GtkForm>&);
  void resize(const std::shared_ptr<GtkForm>&);
  bool closeForm(const std::shared_ptr<GtkForm>&);
  gboolean keyEvent(GtkControl&, GdkEventKey*, bool);
  Value createObject(Runtime&, const std::string&) override;
  Value appProperty(Runtime&, const std::string&) override;
  Value builtin(Frame&, const std::string&, Args) override;
  Value api(Runtime&, const std::string&, Args) override;
  void graphics(Frame&, Value, const std::string&, std::vector<Value>, Value, bool) override;
  int run(Runtime&) override;
  void pump() override;
  void shutdown() override;
  bool hasOpenForms() const noexcept override { return !forms.empty(); }
  GtkWindow* activeWindow() const;
  int runDialog(GtkWidget*);
  Value messageBox(const Text&, int64_t, const Text&);
  Value inputBox(const Text&, const Text&, const Text&);
  Value dialog(GtkControl&, const std::string&);
};

struct GtkEventSuppression {
  GtkControl& control;
  explicit GtkEventSuppression(GtkControl& value) : control(value) { ++control.suppressEvents; }
  ~GtkEventSuppression() { --control.suppressEvents; }
};

inline std::shared_ptr<GtkControl> gtkModel(gpointer data) {
  return static_cast<std::weak_ptr<GtkControl>*>(data)->lock();
}
template<class F> void gtkEvent(gpointer data, F&& function) noexcept {
  auto control = gtkModel(data);
  if (control && !control->disposed)
    control->host->event([&] { function(*control); });
}
void gtkSignal(gpointer, const char*, GCallback, const std::shared_ptr<GtkControl>&);
std::vector<std::shared_ptr<GtkControl>> gtkFormControls(const std::shared_ptr<Instance>&);
std::string gtkCaption(const Text&, bool mnemonic = true);
GdkRGBA gtkColor(int64_t);
int32_t gtkColorValue(const GdkRGBA&);
void gtkConnectInput(GtkControl&);
void gtkConnectTree(GtkControl&);
void gtkDraw(GtkControl&, cairo_t*);
GtkDrawing gtkDrawing(GtkControl&, std::string);
void gtkAppendDrawing(GtkControl&, GtkDrawing);
Value gtkPrint(GtkControl&, Args);
Value gtkFont(std::weak_ptr<GtkControl> = {});
Value gtkLoadPicture(GtkHost&, const std::vector<uint8_t>&);
Value gtkHostObject(GtkHost&, const std::string&);
Value gtkPrinter(GtkHost&, const std::string&);
Value gtkPrintForm(GtkHost&, const std::shared_ptr<GtkForm>&);
std::shared_ptr<GtkControl> gtkDrawingControl(GtkHost&, Value);
}
