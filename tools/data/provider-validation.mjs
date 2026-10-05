/** Run disposable provider checks serially without hiding later outcomes after a failure.
 * This helper controls reporting only; its unit tests are not native-provider certification.
 */
export async function runProviderChecks(cases,validate){
 if(!Array.isArray(cases)||typeof validate!=='function')throw new TypeError('Provider cases and validation callback required');
 const outcomes=[];
 for(const {label,profile} of cases){
  try{await validate(label,profile);outcomes.push({provider:label,passed:true});}
  catch(error){outcomes.push({provider:label,passed:false,error:{name:String(error?.name||'Error'),message:String(error?.message||error)}});}
 }
 return outcomes;
}
