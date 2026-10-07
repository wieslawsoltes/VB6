/** HRESULTs remain unsigned at the JS boundary; signedHRESULT is provided for VB Long. */
export const HRESULT = Object.freeze({
  S_OK:0, S_FALSE:1, E_NOTIMPL:0x80004001, E_NOINTERFACE:0x80004002,
  E_POINTER:0x80004003, E_ABORT:0x80004004, E_FAIL:0x80004005,
  E_UNEXPECTED:0x8000ffff, E_ACCESSDENIED:0x80070005, E_OUTOFMEMORY:0x8007000e,
  E_INVALIDARG:0x80070057, CO_E_OBJNOTCONNECTED:0x800401fd,
  CO_E_NOTINITIALIZED:0x800401f0, RPC_E_CHANGED_MODE:0x80010106,
  CLASS_E_NOAGGREGATION:0x80040110, CLASS_E_CLASSNOTAVAILABLE:0x80040111,
  REGDB_E_CLASSNOTREG:0x80040154, MK_E_UNAVAILABLE:0x800401e3,
  MK_S_MONIKERALREADYREGISTERED:0x000401e7,
  CONNECT_E_NOCONNECTION:0x80040200, CONNECT_E_ADVISELIMIT:0x80040201,
  CONNECT_E_CANNOTCONNECT:0x80040202,
  DISP_E_UNKNOWNINTERFACE:0x80020001, DISP_E_MEMBERNOTFOUND:0x80020003,
  DISP_E_PARAMNOTFOUND:0x80020004, DISP_E_TYPEMISMATCH:0x80020005,
  DISP_E_UNKNOWNNAME:0x80020006, DISP_E_EXCEPTION:0x80020009,
  DISP_E_BADPARAMCOUNT:0x8002000e, DISP_E_PARAMNOTOPTIONAL:0x8002000f,
  DV_E_FORMATETC:0x80040064, DV_E_LINDEX:0x80040068, DV_E_TYMED:0x80040069,
  DV_E_DVASPECT:0x8004006b, OLE_E_ADVISENOTSUPPORTED:0x80040003,
  OLE_E_NOCONNECTION:0x80040004, DATA_S_SAMEFORMATETC:0x00040130,
  DRAGDROP_S_DROP:0x00040100, DRAGDROP_S_CANCEL:0x00040101,
  DRAGDROP_S_USEDEFAULTCURSORS:0x00040102,
  STG_E_INVALIDFUNCTION:0x80030001, STG_E_FILENOTFOUND:0x80030002,
  STG_E_ACCESSDENIED:0x80030005, STG_E_INVALIDPOINTER:0x80030009,
  STG_E_MEDIUMFULL:0x80030070, STG_E_FILEALREADYEXISTS:0x80030050,
  STG_E_INVALIDNAME:0x800300fc, STG_E_REVERTED:0x80030102
});
export function unsignedHRESULT(value) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) throw new TypeError('HRESULT must be a 32-bit integer');
  return value >>> 0;
}
export function signedHRESULT(value) { return unsignedHRESULT(value) | 0; }
export function FAILED(value) { return (unsignedHRESULT(value) & 0x80000000) !== 0; }
export function SUCCEEDED(value) { return !FAILED(value); }
export class ComError extends Error {
  constructor(hresult, message='COM operation failed', details={}) {
    super(message); this.name='ComError'; this.hresult=unsignedHRESULT(hresult);
    for (const key of ['argErr','source','description','helpFile','helpContext','cause']) if (Object.hasOwn(details,key)) this[key]=details[key];
  }
}
export function checkHRESULT(value, message) { if (FAILED(value)) throw new ComError(value,message); return unsignedHRESULT(value); }
export function guid(value) {
  if (typeof value !== 'string' || value.startsWith('{') !== value.endsWith('}') || !/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(value)) throw new ComError(HRESULT.E_INVALIDARG,'Invalid GUID');
  return value.replace(/[{}]/g,'').toLowerCase();
}
export const IID = Object.freeze({
  IUnknown:'00000000-0000-0000-c000-000000000046',
  IClassFactory:'00000001-0000-0000-c000-000000000046',
  IDispatch:'00020400-0000-0000-c000-000000000046',
  IEnumVARIANT:'00020404-0000-0000-c000-000000000046',
  IConnectionPoint:'b196b286-bab4-101a-b69c-00aa00341d07',
  IEnumConnections:'b196b287-bab4-101a-b69c-00aa00341d07',
  IRunningObjectTable:'00000010-0000-0000-c000-000000000046',
  IMoniker:'0000000f-0000-0000-c000-000000000046',
  IEnumMoniker:'00000102-0000-0000-c000-000000000046',
  ISequentialStream:'0c733a30-2a1c-11ce-ade5-00aa0044773d',
  IStream:'0000000c-0000-0000-c000-000000000046',
  IDataObject:'0000010e-0000-0000-c000-000000000046',
  IEnumFORMATETC:'00000103-0000-0000-c000-000000000046',
  IEnumSTATDATA:'00000105-0000-0000-c000-000000000046',
  IAdviseSink:'0000010f-0000-0000-c000-000000000046',
  IDropSource:'00000121-0000-0000-c000-000000000046',
  IDropTarget:'00000122-0000-0000-c000-000000000046'
});
export function integer(value,min=0,max=0xffffffff) {
  if (!Number.isSafeInteger(value) || value<min || value>max) throw new ComError(HRESULT.E_INVALIDARG,'Integer outside supported bounds');
  return value;
}
