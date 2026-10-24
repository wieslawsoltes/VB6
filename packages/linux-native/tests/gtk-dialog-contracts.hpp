// Real GtkPrintUnixDialog settings/cancellation contracts. No print job is sent.
#pragma once
#include "gtk.hpp"
#include "gtk-printers.hpp"
#include <gtk/gtkunixprint.h>
#include <cmath>
#include <exception>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>

namespace gtkDialogContracts {
inline void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
template<class T>struct Unref{void operator()(T* value)const{if(value)g_object_unref(value);}};
using Settings=std::unique_ptr<GtkPrintSettings,Unref<GtkPrintSettings>>;
using Setup=std::unique_ptr<GtkPageSetup,Unref<GtkPageSetup>>;

struct Snapshot {
  std::string device;
  int copies,orientation,paper,duplex,color,quality,zoom,page;
  bool collate,trackDefault;
  double width,height;
  Snapshot(vb6::Runtime& runtime,const vb6::ObjectPtr& printer)
    :device(vb6::toUTF8(printer->get(runtime,"DeviceName").string())),
     copies(int(printer->get(runtime,"Copies").integral())),orientation(int(printer->get(runtime,"Orientation").integral())),
     paper(int(printer->get(runtime,"PaperSize").integral())),duplex(int(printer->get(runtime,"Duplex").integral())),
     color(int(printer->get(runtime,"ColorMode").integral())),quality(int(printer->get(runtime,"PrintQuality").integral())),
     zoom(int(printer->get(runtime,"Zoom").integral())),page(int(printer->get(runtime,"Page").integral())),
     collate(printer->get(runtime,"Collate").truth()),trackDefault(printer->get(runtime,"TrackDefault").truth()),
     width(printer->get(runtime,"Width").number()),height(printer->get(runtime,"Height").number()){}
  bool same(const Snapshot& other)const{
    return device==other.device&&copies==other.copies&&orientation==other.orientation&&paper==other.paper&&
      duplex==other.duplex&&color==other.color&&quality==other.quality&&zoom==other.zoom&&page==other.page&&
      collate==other.collate&&trackDefault==other.trackDefault&&std::abs(width-other.width)<0.01&&std::abs(height-other.height)<0.01;
  }
};

inline GtkPrintUnixDialog* visibleDialog(){
  auto* windows=gtk_window_list_toplevels();GtkPrintUnixDialog* found=nullptr;
  for(auto* entry=windows;entry;entry=entry->next)if(GTK_IS_PRINT_UNIX_DIALOG(entry->data)&&gtk_widget_get_visible(GTK_WIDGET(entry->data))){found=GTK_PRINT_UNIX_DIALOG(entry->data);break;}
  g_list_free(windows);return found;
}
inline bool paperMatches(GtkPageSetup* setup,int paper){
  auto* size=gtk_page_setup_get_paper_size(setup);
  const double width=paper==1?215.9:210,height=paper==1?279.4:297;
  return std::abs(gtk_paper_size_get_width(size,GTK_UNIT_MM)-width)<0.1&&std::abs(gtk_paper_size_get_height(size,GTK_UNIT_MM)-height)<0.1;
}
struct Interaction {
  vb6::GtkHost& host;Snapshot initial;std::string destination;
  int copies,orientation,paper,response,phase=0;bool seen=false,completed=false;
  // Only the explicit emulation runner relaxes the watchdog. Queue discovery,
  // settings changes, cancellation and every native GTK assertion still run.
  guint source=0;gint64 deadline=g_get_monotonic_time()+
    (g_strcmp0(g_getenv("VB6_GTK_TEST_EMULATED"),"1")==0?90:30)*G_TIME_SPAN_SECOND;
  std::exception_ptr failure;
  Interaction(vb6::GtkHost& value,Snapshot before,std::string selected,int count,int direction,int media,int answer)
    :host(value),initial(std::move(before)),destination(std::move(selected)),copies(count),orientation(direction),paper(media),response(answer){}
  ~Interaction(){if(source)g_source_remove(source);}
  void change(GtkPrintUnixDialog* dialog){
    Settings settings(gtk_print_unix_dialog_get_settings(dialog));
    gtk_print_settings_set_printer(settings.get(),destination.c_str());
    gtk_print_settings_set_n_copies(settings.get(),copies);
    gtk_print_settings_set_orientation(settings.get(),orientation==2?GTK_PAGE_ORIENTATION_LANDSCAPE:GTK_PAGE_ORIENTATION_PORTRAIT);
    Setup setup(gtk_page_setup_copy(gtk_print_unix_dialog_get_page_setup(dialog)));
    auto* media=gtk_paper_size_new(paper==1?GTK_PAPER_NAME_LETTER:GTK_PAPER_NAME_A4);
    gtk_page_setup_set_paper_size(setup.get(),media);gtk_print_settings_set_paper_size(settings.get(),media);gtk_paper_size_free(media);
    gtk_page_setup_set_orientation(setup.get(),orientation==2?GTK_PAGE_ORIENTATION_LANDSCAPE:GTK_PAGE_ORIENTATION_PORTRAIT);
    gtk_print_unix_dialog_set_settings(dialog,settings.get());gtk_print_unix_dialog_set_page_setup(dialog,setup.get());
  }
  static gboolean tick(gpointer data)noexcept{
    auto& state=*static_cast<Interaction*>(data);auto* dialog=visibleDialog();
    try{
      require(g_get_monotonic_time()<state.deadline,"Timed out waiting for the native CUPS print dialog or selected queue");
      if(!dialog)return G_SOURCE_CONTINUE;state.seen=true;
      auto* selected=gtk_print_unix_dialog_get_selected_printer(dialog);
      const std::string device=selected?gtk_printer_get_name(selected):"";
      if(state.phase==0){
        if(device!=state.initial.device)return G_SOURCE_CONTINUE;
        Settings settings(gtk_print_unix_dialog_get_settings(dialog));auto* setup=gtk_print_unix_dialog_get_page_setup(dialog);
        require(gtk_print_settings_get_n_copies(settings.get())==state.initial.copies,"ShowPrinter did not seed the selected Printer's copies");
        require(gtk_page_setup_get_orientation(setup)==(state.initial.orientation==2?GTK_PAGE_ORIENTATION_LANDSCAPE:GTK_PAGE_ORIENTATION_PORTRAIT),"ShowPrinter did not seed the selected Printer's orientation");
        require(paperMatches(setup,state.initial.paper),"ShowPrinter did not seed the selected Printer's paper size");
        state.change(dialog);state.phase=1;return G_SOURCE_CONTINUE;
      }
      if(device!=state.destination)return G_SOURCE_CONTINUE;
      if(state.phase==1){
        // CUPS discovers queue capabilities asynchronously. Reapply the edited
        // page settings after the requested native queue is actually selected.
        state.change(dialog);state.phase=2;return G_SOURCE_CONTINUE;
      }
      Settings settings(gtk_print_unix_dialog_get_settings(dialog));auto* setup=gtk_print_unix_dialog_get_page_setup(dialog);
      require(!gtk_printer_is_virtual(selected),"Dialog selected a virtual file printer instead of the real CUPS queue");
      require(gtk_print_settings_get_n_copies(settings.get())==state.copies,"Native dialog did not retain edited copies");
      require(gtk_page_setup_get_orientation(setup)==(state.orientation==2?GTK_PAGE_ORIENTATION_LANDSCAPE:GTK_PAGE_ORIENTATION_PORTRAIT),"Native dialog did not retain edited orientation");
      require(paperMatches(setup,state.paper),"Native dialog did not retain edited paper size");
      state.completed=true;state.source=0;gtk_dialog_response(GTK_DIALOG(dialog),state.response);return G_SOURCE_REMOVE;
    }catch(...){
      state.failure=std::current_exception();state.source=0;
      if(dialog)gtk_dialog_response(GTK_DIALOG(dialog),GTK_RESPONSE_CANCEL);
      else if(!state.host.dialogs.empty())gtk_dialog_response(GTK_DIALOG(state.host.dialogs.back()),GTK_RESPONSE_CANCEL);
      return G_SOURCE_REMOVE;
    }
  }
};
inline void run(vb6::GtkHost& host,vb6::GtkControl& control,Interaction& interaction,int expectedError){
  interaction.source=g_timeout_add(25,Interaction::tick,&interaction);
  int number=0;std::string message;
  try{host.dialog(control,"showprinter");}catch(const vb6::Error& found){number=found.number;message=found.what();}
  if(interaction.source){g_source_remove(interaction.source);interaction.source=0;}
  if(interaction.failure)std::rethrow_exception(interaction.failure);
  if(number!=expectedError)throw std::runtime_error("ShowPrinter expected VB error "+std::to_string(expectedError)+", received "+std::to_string(number)+": "+message);
  if(expectedError==482)require(!interaction.seen,"ShowPrinter opened a dialog during an active document");
  else require(interaction.seen&&interaction.completed,"ShowPrinter returned without the actual GTK dialog interaction");
  require(host.dialogs.empty()&&!visibleDialog(),"ShowPrinter left a live dialog after returning");
}
}

inline void qualifyGtkPrinterDialogs(vb6::Runtime& runtime,vb6::GtkHost& host){
  using namespace vb6;using namespace gtkDialogContracts;
  auto printer=gtkPrinter(host,"printer").asObject();
  // The loopback CUPS server advertises two real destinations, default VB6_B.
  Snapshot initial(runtime,printer);
  require(initial.device=="VB6_B"&&initial.copies==2&&initial.orientation==1&&initial.paper==9,"Printer dialog fixture requires the untouched CUPS defaults");
  Module module;module.name="DialogContracts";auto owner=std::make_shared<Instance>(runtime,module);
  ControlSpec spec;spec.name="Dialog1";spec.type="CommonDialog";
  auto control=std::make_shared<GtkControl>(host,owner,spec);control->initialize();
  struct ControlGuard{std::shared_ptr<GtkControl> value;~ControlGuard(){value->dispose();}} guard{control};
  control->set(runtime,"CancelError",Value::boolean(true));
  Interaction accept(host,initial,"VB6_A",4,2,1,GTK_RESPONSE_OK);run(host,*control,accept,0);
  Snapshot accepted(runtime,printer);
  require(printer==gtkPrinter(host,"printer").asObject(),"ShowPrinter replaced the cached global Printer object");
  require(accepted.device=="VB6_A"&&accepted.copies==4&&accepted.orientation==2&&accepted.paper==1&&!accepted.trackDefault,"ShowPrinter did not apply the accepted destination and settings");
  require(std::abs(accepted.width-11*1440)<1&&std::abs(accepted.height-8.5*1440)<1,"Accepted landscape Letter dimensions are incorrect");
  require(control->get(runtime,"Copies").integral()==4&&control->get(runtime,"Orientation").integral()==2,"CommonDialog did not expose the accepted printer settings");
  for(bool cancelError:{false,true}){
    control->set(runtime,"CancelError",Value::boolean(cancelError));
    Interaction cancel(host,Snapshot(runtime,printer),"VB6_B",7,1,9,GTK_RESPONSE_CANCEL);
    run(host,*control,cancel,cancelError?32755:0);
    require(accepted.same(Snapshot(runtime,printer)),"Cancelling ShowPrinter changed the global Printer or its settings");
    require(control->get(runtime,"Copies").integral()==4&&control->get(runtime,"Orientation").integral()==2,"Cancelling ShowPrinter changed the last accepted CommonDialog settings");
  }
  printer->invoke(runtime,"Print",{Arg(Value::string(u"This active document must never be submitted"))});
  auto canvas=gtkDrawingControl(host,Value::object(printer));const auto commands=canvas->drawings.size();
  require(commands>0,"Active-document ShowPrinter fixture did not create native drawing commands");
  Interaction active(host,Snapshot(runtime,printer),"VB6_B",7,1,9,GTK_RESPONSE_CANCEL);run(host,*control,active,482);
  require(accepted.same(Snapshot(runtime,printer))&&canvas->drawings.size()==commands,"Rejected ShowPrinter discarded or changed the active document");
  printer->invoke(runtime,"KillDoc",{});printer->invoke(runtime,"EndDoc",{});
  require(canvas->drawings.empty(),"Printer dialog fixture did not cancel its unsubmitted document");
  std::cout<<"LINUX_GTK_PRINTER_DIALOGS_OK\n";
}
