/** Shared immutable compiler/runtime intrinsic constants. */
export const VB_CONSTANTS = {
  vbTrue:-1,vbFalse:0,vbCr:'\r',vbLf:'\n',vbCrLf:'\r\n',vbNewLine:'\r\n',vbTab:'\t',vbNullChar:'\0',vbNullString:'',vbBack:'\b',vbFormFeed:'\f',vbVerticalTab:'\v',
  vbBlack:0,vbRed:255,vbGreen:65280,vbYellow:65535,vbBlue:16711680,vbMagenta:16711935,vbCyan:16776960,vbWhite:16777215,
  vbButtonFace:-2147483633,vbWindowBackground:-2147483643,vbWindowText:-2147483640,vbButtonText:-2147483630,
  vbOKOnly:0,vbOKCancel:1,vbAbortRetryIgnore:2,vbYesNoCancel:3,vbYesNo:4,vbRetryCancel:5,vbCritical:16,vbQuestion:32,vbExclamation:48,vbInformation:64,vbDefaultButton1:0,vbDefaultButton2:256,vbDefaultButton3:512,
  vbOK:1,vbCancel:2,vbAbort:3,vbRetry:4,vbIgnore:5,vbYes:6,vbNo:7,vbModal:1,vbModeless:0,
  vbCascade:0,vbTileHorizontal:1,vbTileVertical:2,vbArrangeIcons:3,vbNormal:0,vbMinimized:1,vbMaximized:2,vbFormControlMenu:0,vbFormCode:1,vbFormMDIForm:4,vbResBitmap:0,vbResIcon:1,vbResCursor:2,vbEmpty:0,vbNull:1,vbInteger:2,vbLong:3,vbSingle:4,vbDouble:5,vbCurrency:6,vbDate:7,vbString:8,vbObject:9,vbError:10,vbBoolean:11,vbVariant:12,vbDecimal:14,vbByte:17,vbArray:8192,
  vbMethod:1,vbGet:2,vbLet:4,vbSet:8,vbUseSystem:0,vbFirstJan1:1,vbFirstFourDays:2,vbFirstFullWeek:3,
  vbBinaryCompare:0,vbTextCompare:1,vbUseCompareOption:-1,vbUpperCase:1,vbLowerCase:2,vbProperCase:3,vbSunday:1,vbMonday:2,vbTuesday:3,vbWednesday:4,vbThursday:5,vbFriday:6,vbSaturday:7,
  vbTwips:1,vbPoints:2,vbPixels:3,vbCharacters:4,vbInches:5,vbMillimeters:6,vbCentimeters:7,vbUser:0,
  vbUnchecked:0,vbChecked:1,vbGrayed:2,vbNormal:0,vbMinimized:1,vbMaximized:2,vbLeftJustify:0,vbRightJustify:1,vbCenter:2,
  vbKeyBack:8,vbKeyTab:9,vbKeyReturn:13,vbKeyShift:16,vbKeyControl:17,vbKeyMenu:18,vbKeyEscape:27,vbKeySpace:32,vbKeyPageUp:33,vbKeyPageDown:34,vbKeyEnd:35,vbKeyHome:36,vbKeyLeft:37,vbKeyUp:38,vbKeyRight:39,vbKeyDown:40,vbKeyInsert:45,vbKeyDelete:46,
  vbObjectError:-2147221504,adOpenForwardOnly:0,adOpenKeyset:1,adOpenDynamic:2,adOpenStatic:3,adLockReadOnly:1,adLockOptimistic:3,adUseClient:3,adStateClosed:0,adStateOpen:1,adVarChar:200,adInteger:3,adDouble:5,adSmallInt:2,adSingle:4,adCurrency:6,adDate:7,adBoolean:11,adUnsignedTinyInt:17,adVarWChar:202,adLongVarWChar:203,adEditNone:0,adEditInProgress:1,adEditAdd:2,adFilterNone:0,adAffectCurrent:1,adGetRowsRest:-1,adPosUnknown:-1,adPosBOF:-2,adPosEOF:-3,
  rtfRTF:0,rtfText:1,rtfLeft:0,rtfRight:1,rtfCenter:2,rtfJustify:3,rtfWholeWord:2,rtfMatchCase:4,rtfNoHighlight:8,
  tvwChild:4,lvwIcon:0,lvwSmallIcon:1,lvwList:2,lvwReport:3,ccFixedSingle:1,ccFlat:0,cc3D:1,sbrText:0,
};
for(let i=0;i<26;i++)VB_CONSTANTS['vbKey'+String.fromCharCode(65+i)]=65+i;
for(let i=1;i<=16;i++)VB_CONSTANTS['vbKeyF'+i]=111+i;
Object.freeze(VB_CONSTANTS);
