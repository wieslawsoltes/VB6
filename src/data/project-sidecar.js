/** Browser data definitions accompanying .vbp source exports. Never a native VB6 designer format. */
import {normalizeDataSources,assertData} from './common.js';
import {VirtualFileSystem} from '../runtime/filesystem.js';
const FORMAT='VB6Studio.DataSources';
export function dataSidecarPath(projectPath){return projectPath+'.vb6data.json';}
export function encodeDataSidecar(project){
  const dataSources=normalizeDataSources(project.dataSources);
  if(!dataSources.connections.length&&!dataSources.commands.length)return null;
  const text=JSON.stringify({format:FORMAT,version:1,dataSources,vfs:new VirtualFileSystem(project.vfs).snapshot()},null,2)+'\n';
  const bytes=new TextEncoder().encode(text);assertData(bytes.length<=20*1024*1024,'Data sidecar exceeds the 20 MiB native file limit',7);return bytes;
}
export function decodeDataSidecar(bytes){
  assertData(bytes.length<=20*1024*1024,'Data sidecar exceeds the 20 MiB native file limit',7);
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  assertData(value?.format===FORMAT&&value.version===1,'Unsupported VB6 Studio data sidecar',1002);
  const dataSources=normalizeDataSources(value.dataSources),fs=new VirtualFileSystem(value.vfs);
  assertData(fs.files.size<=2000&&fs.directories.size<=2000,'Data sidecar file limit exceeded',7);
  for(const [name,data]of fs.files){assertData(fs.normalize(name)===name,'Data sidecar has a noncanonical virtual path',1002);assertData(data.length<=20*1024*1024,'Data sidecar virtual file limit exceeded',7);}
  return {dataSources,vfs:fs.snapshot()};
}
