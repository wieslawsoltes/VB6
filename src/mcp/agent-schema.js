export const S = {type:'string',maxLength:1000};
export const TEXT={type:'string',maxLength:4000000};
export const B={type:'boolean'};
export const N = (min=0,max=1000000)=>({type:'integer',minimum:min,maximum:max});
export const E = values=>({type:'string',enum:values});
export const A = (items,max=1000)=>({type:'array',items,maxItems:max});
export const O = (properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
export const OBJ={type:'object'};
export const REV=N(1,Number.MAX_SAFE_INTEGER);
