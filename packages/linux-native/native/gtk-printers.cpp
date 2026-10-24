#include "gtk-printers.hpp"
#include "vb6.hpp"
#include <cups/cups.h>
#include <cerrno>
#include <cmath>
#include <cstring>
#include <memory>
#include <sys/socket.h>

namespace vb6 {
namespace {
std::unique_ptr<http_t,decltype(&httpClose)> printerConnection(){
  const char* server=cupsServer();
  std::unique_ptr<http_t,decltype(&httpClose)> connection(
    httpConnect2(server,ippPort(),nullptr,AF_UNSPEC,cupsEncryption(),1,2000,nullptr),httpClose);
  if(!connection){
    // A desktop without a local CUPS service has no installed destinations.
    // A configured remote service failing to answer is a printing error.
    const std::string host=server?server:"";
    if((host.empty()||host[0]=='/'||host=="localhost"||host=="127.0.0.1"||host=="::1")&&
       (errno==ENOENT||errno==ECONNREFUSED))return {nullptr,httpClose};
    fail(482,std::string("Cannot connect to the CUPS print service: ")+std::strerror(errno));
  }
  httpSetTimeout(connection.get(),2.0,nullptr,nullptr);
  return connection;
}
}
std::vector<GtkPrinterDestination> gtkPrinterDestinations(){
  auto connection=printerConnection();if(!connection)return {};
  cups_dest_t* destinations=nullptr;
  const int count=cupsGetDests2(connection.get(),&destinations);
  struct FreeDestinations {int count;cups_dest_t* values;~FreeDestinations(){cupsFreeDests(count,values);}} free{count,destinations};
  auto status=cupsLastError();
  if(count<0||(count==0&&status>IPP_STATUS_OK_EVENTS_COMPLETE&&status!=IPP_STATUS_ERROR_NOT_FOUND))
    fail(482,std::string("CUPS printer enumeration failed: ")+cupsLastErrorString());
  if(count>16384)fail(7,"CUPS printer inventory exceeds its destination limit");
  std::map<std::string,GtkPrinterDestination> unique;
  for(int i=0;i<count;++i){
    const auto& source=destinations[i];if(!source.name||!*source.name)continue;
    GtkPrinterDestination destination;destination.queue=source.name;
    destination.instance=source.instance?source.instance:"";
    destination.name=destination.queue+(destination.instance.empty()?"":"/"+destination.instance);
    destination.isDefault=source.is_default!=0;
    if(destination.name.size()>1024||source.num_options>4096)fail(7,"CUPS destination metadata exceeds its limit");
    for(int n=0;n<source.num_options;++n){
      const auto& option=source.options[n];if(!option.name||!option.value)continue;
      if(std::strlen(option.name)>1024||std::strlen(option.value)>65536)fail(7,"CUPS printer option exceeds its limit");
      destination.options[option.name]=option.value;
    }
    unique[destination.name]=std::move(destination);
  }
  std::vector<GtkPrinterDestination> result;result.reserve(unique.size());
  for(auto& entry:unique)result.push_back(std::move(entry.second));
  return result;
}
GtkPrinterDestination gtkFindPrinterDestination(const std::string& name){
  if(name.empty()||name.size()>1024||name.find('\0')!=std::string::npos)fail(484,"Printer is not available");
  auto destinations=gtkPrinterDestinations();
  for(auto& destination:destinations)if(destination.name==name)return destination;
  fail(484,"Printer is not available: "+name);
}
GtkPrinterDestination gtkPrinterDetails(GtkPrinterDestination destination){
  if(destination.name.empty())return destination;
  // cupsGetDests2 intentionally omits resolution/quality attributes. Fetch these
  // defaults using IPP while retaining any explicit per-user CUPS options.
  if(destination.options.count("printer-resolution")&&destination.options.count("print-quality"))return destination;
  auto connection=printerConnection();if(!connection)fail(484,"Printer service is not available");
  auto uri=destination.option("printer-uri-supported");
  if(uri.empty()){
    char assembled[4096];auto resource="/printers/"+destination.queue;
    if(httpAssembleURI(HTTP_URI_CODING_ALL,assembled,sizeof(assembled),"ipp",nullptr,"localhost",ippPort(),resource.c_str())<HTTP_URI_STATUS_OK)fail(484,"Invalid printer URI");
    uri=assembled;
  }
  auto* request=ippNewRequest(IPP_OP_GET_PRINTER_ATTRIBUTES);
  ippAddString(request,IPP_TAG_OPERATION,IPP_TAG_URI,"printer-uri",nullptr,uri.c_str());
  const char* requested[]={"printer-resolution-default","print-quality-default"};
  ippAddStrings(request,IPP_TAG_OPERATION,IPP_TAG_KEYWORD,"requested-attributes",2,nullptr,requested);
  std::unique_ptr<ipp_t,decltype(&ippDelete)> response(cupsDoRequest(connection.get(),request,"/"),ippDelete);
  if(!response||ippGetStatusCode(response.get())>IPP_STATUS_OK_EVENTS_COMPLETE)
    fail(cupsLastError()==IPP_STATUS_ERROR_NOT_FOUND?484:482,std::string("CUPS printer attributes failed: ")+cupsLastErrorString());
  if(!destination.options.count("printer-resolution"))if(auto* resolution=ippFindAttribute(response.get(),"printer-resolution-default",IPP_TAG_RESOLUTION)){
    int height=0;ipp_res_t units=IPP_RES_PER_INCH;const int width=ippGetResolution(resolution,0,&height,&units);
    const auto dpi=units==IPP_RES_PER_CM?std::round(width*2.54):width;
    if(dpi>=1&&dpi<=9600)destination.options["printer-resolution"]=std::to_string(int(dpi));
  }
  if(!destination.options.count("print-quality"))if(auto* quality=ippFindAttribute(response.get(),"print-quality-default",IPP_TAG_ENUM)){
    const auto value=ippGetInteger(quality,0);if(value>=3&&value<=5)destination.options["print-quality"]=std::to_string(value);
  }
  return destination;
}
void gtkSubmitPrintFile(const GtkPrinterDestination& destination,const std::string& filename,const std::string& title,const std::map<std::string,std::string>& settings){
  auto connection=printerConnection();if(!connection)fail(482,"Printer service is not available");
  cups_option_t* options=nullptr;int count=0;
  struct FreeOptions{int& count;cups_option_t*& values;~FreeOptions(){cupsFreeOptions(count,values);}} cleanup{count,options};
  for(auto& entry:settings)count=cupsAddOption(entry.first.c_str(),entry.second.c_str(),count,&options);
  // A positive CUPS job id is the server's acknowledgement. GTK's asynchronous
  // print-operation result alone does not reliably propagate IPP rejection.
  if(cupsPrintFile2(connection.get(),destination.queue.c_str(),filename.c_str(),title.c_str(),count,options)<=0)
    fail(482,std::string("CUPS rejected the print job: ")+cupsLastErrorString());
}
}
