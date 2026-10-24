// CUPS destination discovery and the GTK Printer selection boundary. MIT.
#pragma once
#include <map>
#include <string>
#include <vector>
namespace vb6 {
struct GtkHost;
struct GtkControl;
struct Value;
struct GtkPrinterDestination {
  std::string name,queue,instance;
  bool isDefault=false;
  std::map<std::string,std::string> options;
  std::string option(const std::string& key,const std::string& fallback="")const{
    auto found=options.find(key);return found==options.end()?fallback:found->second;
  }
};
std::vector<GtkPrinterDestination> gtkPrinterDestinations();
GtkPrinterDestination gtkFindPrinterDestination(const std::string&);
GtkPrinterDestination gtkPrinterDetails(GtkPrinterDestination);
void gtkSubmitPrintFile(const GtkPrinterDestination&,const std::string&,const std::string&,const std::map<std::string,std::string>&);
void gtkSetPrinter(GtkHost&,Value);
void gtkShowPrinterDialog(GtkHost&,GtkControl&);
}
