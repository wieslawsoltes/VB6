// Real GTK/CUPS host contracts; the test runner supplies a loopback IPP service.
#include "gtk.hpp"
#include "gtk-printers.hpp"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <unistd.h>
#include "gtk-cursor-contracts.hpp"
#include "gtk-dialog-contracts.hpp"

using namespace vb6;
namespace {
void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
template<class F>void error(int number,F operation){try{operation();}catch(const Error& found){if(found.number!=number)throw std::runtime_error("Expected VB error "+std::to_string(number)+", received "+std::to_string(found.number)+": "+found.what());return;}throw std::runtime_error("Expected VB error "+std::to_string(number));}
void command(const char* expected){std::string line;require(bool(std::getline(std::cin,line))&&line==expected,"Unexpected fixture command");}
void probe(bool replace){
  Runtime runtime(makeNativeHost());auto& host=static_cast<GtkHost&>(*runtime.host);
  require(!host.initialized,"Application instance registration initialized GTK");
  std::cout<<"READY "<<getpid()<<'\n'<<std::flush;
  if(replace){execl("/bin/sh","sh","-c","printf 'EXEC_READY\\n'; read command",static_cast<char*>(nullptr));throw std::runtime_error("exec failed");}
  std::string line;
  while(std::getline(std::cin,line)){
    if(line=="get")std::cout<<(host.appProperty(runtime,"previnstance").truth()?"PREVIOUS":"FIRST")<<'\n'<<std::flush;
    else if(line=="same-process"){Runtime other(makeNativeHost());require(other.host->appProperty(other,"previnstance").truth()==host.appProperty(runtime,"previnstance").truth(),"Two native runtimes registered the same process twice");std::cout<<"SAME_PROCESS_OK\n"<<std::flush;}
    else if(line=="exit")return;else throw std::runtime_error("Invalid application probe command");
  }
}
void printers(bool populated,bool print){
  Runtime runtime(makeNativeHost());auto& host=static_cast<GtkHost&>(*runtime.host);
  auto collection=gtkPrinter(host,"printers").asObject();auto current=gtkPrinter(host,"printer").asObject();
  require(!host.initialized,"Printer inventory initialized GTK eagerly");
  require(collection->get(runtime,"Count").integral()==(populated?2:0),"CUPS destination count differs");
  error(9,[&]{collection->invoke(runtime,"",{Arg(Value::integer(-1))});});
  error(9,[&]{collection->invoke(runtime,"Item",{Arg(Value::integer(2))});});
  error(450,[&]{collection->invoke(runtime,"Item",{});});
  error(13,[&]{gtkSetPrinter(host,Value::integer(42));});
  error(13,[&]{gtkSetPrinter(host,createLibraryObject(runtime,"collection"));});
  error(13,[&]{gtkSetPrinter(host,Value::object(nullptr));});
  error(484,[&]{current->set(runtime,"DeviceName",Value::string(u"missing"));});
  if(!populated){
    require(collection->enumerate(runtime).empty(),"Empty CUPS service returned imaginary printers");
    require(current->get(runtime,"DeviceName").string().empty(),"No default printer was silently invented");
    require(!host.initialized,"Headless empty printer queries initialized GTK");
    std::cout<<"LINUX_PRINTERS_EMPTY_OK\n";return;
  }
  auto values=collection->enumerate(runtime);require(values.size()==2,"For Each printer inventory differs");
  auto first=collection->invoke(runtime,"Item",{Arg(Value::integer(0))}).asObject();
  auto second=collection->invoke(runtime,"",{Arg(Value::integer(1))}).asObject();
  require(first->get(runtime,"DeviceName").string()==u"VB6_A"&&second->get(runtime,"DeviceName").string()==u"VB6_B","Printers collection index is not zero based");
  require(current->get(runtime,"DeviceName").string()==u"VB6_B","CUPS user default printer was not selected");
  require(first->get(runtime,"DriverName").string()==u"VB6 Virtual IPP Printer","Printer driver metadata is not from CUPS");
  require(toUTF8(first->get(runtime,"Port").string()).find("/printers/VB6_A")!=std::string::npos,"Printer port is not the CUPS destination URI");
  require(first->get(runtime,"Copies").integral()==2,"CUPS copies default was ignored");
  require(first->get(runtime,"Duplex").integral()==2&&first->get(runtime,"ColorMode").integral()==2,"CUPS print settings were ignored");
  require(first->get(runtime,"Collate").truth(),"CUPS collation default was ignored");
  require(first->get(runtime,"PaperSize").integral()==9,"CUPS A4 media was not converted to VB PaperSize");
  require(first->get(runtime,"PrintQuality").integral()==600,"CUPS printer resolution was ignored");
  const auto width=first->get(runtime,"Width").number(),height=first->get(runtime,"Height").number();
  require(std::abs(width-210.0/25.4*1440)<1&&std::abs(height-297.0/25.4*1440)<1,"A4 physical dimensions are incorrect");
  first->set(runtime,"Orientation",Value::integer(2));
  require(std::abs(first->get(runtime,"Width").number()-height)<1&&std::abs(first->get(runtime,"Height").number()-width)<1,"Landscape paper dimensions did not rotate");
  for(auto entry:std::vector<std::pair<std::string,int>>{{"Copies",3},{"Duplex",3},{"ColorMode",1},{"Zoom",75},{"PrintQuality",-4},{"PaperSize",1}}){first->set(runtime,entry.first,Value::integer(entry.second));require(first->get(runtime,entry.first).integral()==entry.second,"Printer property did not round trip");}
  first->set(runtime,"Collate",Value::boolean(false));require(!first->get(runtime,"Collate").truth(),"Collate did not change");
  assign(runtime,first->reference(runtime,"Copies"),Value::integer(3),false);
  for(auto entry:std::vector<std::pair<std::string,int>>{{"Copies",0},{"Copies",32768},{"Duplex",4},{"ColorMode",3},{"Zoom",401},{"PrintQuality",0},{"Orientation",3},{"PaperSize",0},{"PaperSize",118}})error(380,[&]{first->set(runtime,entry.first,Value::integer(entry.second));});
  error(380,[&]{first->set(runtime,"PaperSize",Value::real(4294967297.0));});
  error(383,[&]{first->set(runtime,"DriverName",Value::string(u"fake"));});
  gtkSetPrinter(host,Value::object(first));
  require(current==gtkPrinter(host,"printer").asObject(),"Set Printer replaced the cached global object");
  require(current->get(runtime,"DeviceName").string()==u"VB6_A"&&current->get(runtime,"Copies").integral()==3&&!current->get(runtime,"TrackDefault").truth(),"Set Printer did not copy the selected destination and settings");
  error(484,[&]{current->set(runtime,"DeviceName",Value::string(u"not-installed"));});
  require(current->get(runtime,"DeviceName").string()==u"VB6_A","Invalid selection mutated the current printer");
  current->set(runtime,"DeviceName",Value::string(u"VB6_B"));require(current->get(runtime,"Copies").integral()==2,"DeviceName selection did not load destination defaults");
  current->set(runtime,"TrackDefault",Value::boolean(true));
  require(!host.initialized,"Printer enumeration, selection or settings required a display");
  std::cout<<"READY_DEFAULT\n"<<std::flush;command("default-changed");
  require(current->get(runtime,"DeviceName").string()==u"VB6_A","TrackDefault did not follow the CUPS default");
  current->set(runtime,"TrackDefault",Value::boolean(false));
  std::cout<<"READY_REMOVE\n"<<std::flush;command("printer-removed");
  error(484,[&]{gtkSetPrinter(host,Value::object(second));});
  require(current->get(runtime,"DeviceName").string()==u"VB6_A","Removed destination selection changed the active printer");
  require(collection->get(runtime,"Count").integral()==1,"Printer inventory did not refresh after removal");
  if(print){
    current->set(runtime,"Copies",Value::integer(3));current->set(runtime,"PaperSize",Value::integer(9));
    current->set(runtime,"Orientation",Value::integer(1));current->set(runtime,"FontName",Value::string(u"Sans"));
    auto surface=gtkDrawingControl(host,Value::object(current));
    require(surface->get(runtime,"ScaleWidth").number()>9000&&surface->get(runtime,"ScaleHeight").number()>13000,"Printer drawing surface has invalid printable dimensions");
    current->invoke(runtime,"Print",{Arg(Value::string(u"VB6 CUPS qualification page one Ω"))});
    error(482,[&]{current->set(runtime,"Orientation",Value::integer(2));});
    current->invoke(runtime,"NewPage",{});current->invoke(runtime,"Print",{Arg(Value::string(u"VB6 CUPS qualification page two"))});
    require(current->get(runtime,"Page").integral()==2,"NewPage did not advance the document");
    current->invoke(runtime,"EndDoc",{});require(current->get(runtime,"Page").integral()==1,"EndDoc did not release submitted pages");
    current->invoke(runtime,"Print",{Arg(Value::string(u"This cancelled page must never be submitted"))});
    current->invoke(runtime,"KillDoc",{});current->invoke(runtime,"EndDoc",{});
    current->invoke(runtime,"Print",{Arg(Value::string(u"This rejected page must remain available for retry"))});
    std::cout<<"READY_REJECT\n"<<std::flush;command("reject-jobs");
    error(482,[&]{current->invoke(runtime,"EndDoc",{});});
    require(!surface->drawings.empty(),"A rejected print job discarded the pending page");
    current->invoke(runtime,"KillDoc",{});require(surface->drawings.empty(),"KillDoc did not release the rejected document");
  }
  runtime.stop();error(91,[&]{collection->get(runtime,"Count");});error(91,[&]{current->get(runtime,"DeviceName");});
  std::cout<<(print?"LINUX_PRINTERS_PRINT_OK":"LINUX_PRINTERS_NATIVE_OK")<<'\n';
}
}
int main(int argc,char** argv){
  try{
    const std::string mode=argc>1?argv[1]:"--app-probe";
    if(mode=="--app-probe"||mode=="--exec")probe(mode=="--exec");
    else if(mode=="--empty"||mode=="--printers"||mode=="--print")printers(mode!="--empty",mode=="--print");
    else if(mode=="--dialogs"){Runtime runtime(makeNativeHost());auto& host=static_cast<GtkHost&>(*runtime.host);qualifyGtkScreenCursors(runtime,host);qualifyGtkPrinterDialogs(runtime,host);}
    else throw std::runtime_error("Unknown native service fixture mode");
    return 0;
  }catch(const Error& found){std::cerr<<"Native service VB error "<<found.number<<": "<<found.what()<<'\n';return 1;}
  catch(const std::exception& found){std::cerr<<"Native service contract failure: "<<found.what()<<'\n';return 1;}
}
