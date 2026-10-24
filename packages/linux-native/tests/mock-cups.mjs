/** A loopback IPP service for exercising the real CUPS/GTK clients without a printer. */
import http from 'node:http';
import {once} from 'node:events';

const integer=value=>{const bytes=Buffer.alloc(4);bytes.writeInt32BE(value);return bytes;};
const resolution=value=>Buffer.concat([integer(value),integer(value),Buffer.from([3])]);
function attribute(tag,name,value) {
  const key=Buffer.from(name),bytes=Buffer.isBuffer(value)?value:Buffer.from(String(value));
  const header=Buffer.alloc(3);header[0]=tag;header.writeUInt16BE(key.length,1);
  const length=Buffer.alloc(2);length.writeUInt16BE(bytes.length);
  return Buffer.concat([header,key,length,bytes]);
}
function attributes(group,entries) {
  return Buffer.concat([Buffer.from([group]),...entries.flatMap(([tag,name,values])=>(Array.isArray(values)?values:[values]).map((value,index)=>attribute(tag,index?'':name,value)))]);
}
function requestAttributes(bytes) {
  const result=new Map();let offset=8,name='';
  while(offset<bytes.length) {
    const tag=bytes[offset++];if(tag===3)return {attributes:result,document:bytes.subarray(offset)};
    if(tag<=15)continue;
    if(offset+2>bytes.length)throw new Error('Truncated IPP attribute name');
    const size=bytes.readUInt16BE(offset);offset+=2;
    if(offset+size+2>bytes.length)throw new Error('Truncated IPP attribute');
    if(size)name=bytes.subarray(offset,offset+size).toString();offset+=size;
    const length=bytes.readUInt16BE(offset);offset+=2;
    if(offset+length>bytes.length)throw new Error('Truncated IPP attribute value');
    const value=bytes.subarray(offset,offset+length);offset+=length;
    const values=result.get(name)||[];values.push({tag,value});result.set(name,values);
  }
  throw new Error('IPP request omitted end-of-attributes');
}
const first=(values,name)=>values.get(name)?.[0]?.value.toString()||'';

const ppd=`*PPD-Adobe: "4.3"
*FormatVersion: "4.3"
*FileVersion: "1.0"
*LanguageVersion: English
*LanguageEncoding: ISOLatin1
*PCFileName: "VB6TEST.PPD"
*Manufacturer: "VB6 Test"
*Product: "(Virtual IPP Printer)"
*ModelName: "VB6 Virtual IPP Printer"
*NickName: "VB6 Virtual IPP Printer"
*PSVersion: "(3010.000) 0"
*LanguageLevel: "3"
*ColorDevice: True
*DefaultColorSpace: RGB
*FileSystem: False
*Throughput: "10"
*cupsVersion: 1.1
*cupsManualCopies: True
*cupsFilter: "application/vnd.cups-pdf 0 -"
*OpenUI *PageSize/Paper Size: PickOne
*OrderDependency: 10 AnySetup *PageSize
*DefaultPageSize: A4
*PageSize A4/A4: "<</PageSize[595 842]>>setpagedevice"
*PageSize Letter/Letter: "<</PageSize[612 792]>>setpagedevice"
*CloseUI: *PageSize
*OpenUI *PageRegion/Paper Region: PickOne
*OrderDependency: 10 AnySetup *PageRegion
*DefaultPageRegion: A4
*PageRegion A4/A4: "<</PageSize[595 842]>>setpagedevice"
*PageRegion Letter/Letter: "<</PageSize[612 792]>>setpagedevice"
*CloseUI: *PageRegion
*DefaultImageableArea: A4
*ImageableArea A4: "18 18 577 824"
*ImageableArea Letter: "18 18 594 774"
*DefaultPaperDimension: A4
*PaperDimension A4: "595 842"
*PaperDimension Letter: "612 792"
*DefaultResolution: 600dpi
*Resolution 600dpi: "<</HWResolution[600 600]>>setpagedevice"
`;

export async function createMockCups({printers=['VB6_A','VB6_B'],defaultPrinter='VB6_B'}={}) {
  const state={printers:[...printers],defaultPrinter,requests:[],documents:[],errors:[],nextJob:1,rejectJobs:false};
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.method==='GET'&&/^\/printers\/VB6_[AB]\.ppd$/.test(req.url)) {
        state.requests.push({method:'GET',url:req.url});res.writeHead(200,{'Content-Type':'application/vnd.cups-ppd','Last-Modified':new Date(0).toUTCString()});res.end(ppd);return;
      }
      if(req.method!=='POST'){res.writeHead(404);res.end();return;}
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)throw new Error('IPP fixture request exceeds 32 MiB');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);if(bytes.length<9)throw new Error('Invalid IPP request');
      const operation=bytes.readUInt16BE(2),parsed=requestAttributes(bytes),values=parsed.attributes;
      const record={method:'POST',url:req.url,operation,attributes:values,document:parsed.document};state.requests.push(record);
      const response=Buffer.alloc(8);response[0]=2;response[1]=0;bytes.copy(response,4,4,8);
      const output=[response,attributes(1,[[0x47,'attributes-charset','utf-8'],[0x48,'attributes-natural-language','en']])];
      const uri=name=>'ipp://127.0.0.1:'+server.address().port+'/printers/'+name;
      const printer=name=>attributes(4,[
        [0x42,'printer-name',name],[0x41,'printer-info','VB6 test '+name],
        [0x41,'printer-location','Loopback test service'],[0x41,'printer-make-and-model','VB6 Virtual IPP Printer'],
        [0x45,'printer-uri-supported',uri(name)],[0x45,'device-uri',uri(name)],
        [0x23,'printer-type',integer(name===state.defaultPrinter?0x20000:0)],
        [0x22,'printer-is-accepting-jobs',Buffer.from([1])],[0x22,'printer-is-shared',Buffer.from([1])],
        [0x22,'printer-is-default',Buffer.from([name===state.defaultPrinter?1:0])],
        [0x22,'printer-is-temporary',Buffer.from([0])],[0x23,'printer-state',integer(3)],
        [0x44,'printer-state-reasons','none'],[0x44,'ipp-versions-supported',['1.1','2.0']],
        [0x23,'operations-supported',[2,4,5,6,8,9,11].map(integer)],
        [0x49,'document-format-supported',['application/pdf','application/postscript','application/octet-stream']],
        [0x49,'document-format-default','application/pdf'],[0x21,'copies-default',integer(2)],
        [0x33,'copies-supported',Buffer.concat([integer(1),integer(99)])],
        [0x44,'media-default','iso_a4_210x297mm'],[0x44,'media-supported',['iso_a4_210x297mm','na_letter_8.5x11in']],
        [0x44,'sides-default','two-sided-long-edge'],[0x44,'sides-supported',['one-sided','two-sided-long-edge','two-sided-short-edge']],
        [0x44,'print-color-mode-default','color'],[0x44,'print-color-mode-supported',['color','monochrome']],
        [0x32,'printer-resolution-default',resolution(600)],[0x32,'printer-resolution-supported',resolution(600)],
        [0x23,'orientation-requested-default',integer(3)],[0x23,'orientation-requested-supported',[3,4].map(integer)],
        [0x23,'print-quality-default',integer(4)],[0x23,'print-quality-supported',[3,4,5].map(integer)],
        [0x44,'multiple-document-handling-default','separate-documents-collated-copies'],
        [0x44,'multiple-document-handling-supported',['separate-documents-collated-copies','separate-documents-uncollated-copies']],
        [0x44,'job-creation-attributes-supported',['copies','media','sides','print-color-mode','printer-resolution','orientation-requested']]
      ]);
      if(operation===0x4002)output.push(...state.printers.map(printer));
      else if(operation===0x4001){if(state.printers.includes(state.defaultPrinter))output.push(printer(state.defaultPrinter));else response.writeUInt16BE(0x0406,2);}
      else if(operation===0x000b){const name=decodeURIComponent(first(values,'printer-uri').split('/').at(-1));if(state.printers.includes(name))output.push(printer(name));else response.writeUInt16BE(0x0406,2);}
      else if(operation===0x0002||operation===0x0005||operation===0x0006){
        if(state.rejectJobs){response.writeUInt16BE(0x0502,2);record.rejected=true;}
        else{
        const job=operation===6?(values.get('job-id')?.[0]?.value.readInt32BE()||1):state.nextJob++;
        output.push(attributes(2,[[0x21,'job-id',integer(job)],[0x45,'job-uri','ipp://127.0.0.1:'+server.address().port+'/jobs/'+job],[0x23,'job-state',integer(9)]]));
        if(parsed.document.length)state.documents.push({operation,attributes:values,bytes:parsed.document});
        }
      }
      else if(![0x0004,0x0008,0x0009,0x0010].includes(operation))response.writeUInt16BE(0x0501,2);
      output.push(Buffer.from([3]));const body=Buffer.concat(output);
      res.writeHead(200,{'Content-Type':'application/ipp','Content-Length':body.length});res.end(body);
    }catch(error){state.errors.push(error);res.writeHead(500);res.end(String(error));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return Object.assign(state,{server:'127.0.0.1:'+server.address().port,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})});
}
