/** Actual decoded Picture pixels must survive the new backing-surface route. */
import {nativeDataUri,nativeTestBitmap} from '../tests/support/native-picture-fixtures.mjs';
const picture=nativeDataUri(nativeTestBitmap());
export function nativeSurfacePictureFixture(fixture){
 const {control,add,check,finish}=fixture('AotControlSurfacePicture');
 control('PictureBox','Canvas',{Width:1800,Height:1800,AutoRedraw:-1,ScaleMode:3,BackColor:0xffffff,Picture:picture});
 add('Dim dc As Long,n As Long,other As Long\ndc=Canvas.hDC');
 check('GetPixel(dc,0,0)=255 And GetPixel(dc,4,4)=&HFFFFFF','initial backing paints the actual authored bitmap at its native dimensions');
 add('n=SetPixelV(dc,0,0,&HFF0000)\nCanvas.Cls');
 check('GetPixel(dc,0,0)=255','Cls restores Picture pixels rather than replacing the background with a solid color');
 add('n=SetPixelV(dc,0,0,&HFF0000)\nCanvas.Width=3600\nother=Canvas.hDC');
 check('other=dc And GetPixel(dc,0,0)=&HFF0000 And GetPixel(dc,150,10)=&HFFFFFF','growing a pictured surface keeps drawn overlap and initializes the new backing area');
 add('Set Canvas.Picture=LoadPicture("")');
 check('GetPixel(dc,0,0)=&HFFFFFF','clearing the Picture property removes the former bitmap from retained backing');
 add('Set Canvas.Picture=LoadPicture("'+picture+'")');
 check('GetPixel(dc,0,0)=255','replacing Picture repaints the existing retained HDC without a stale resource reference');
 add('Me.AutoRedraw=True\nSet Me.Picture=Canvas.Picture\nother=Me.hDC');
 check('GetPixel(other,0,0)=255','Form backing uses its own retained Picture owner');
 add('Set Canvas.Picture=Nothing\nMe.Cls');
 check('GetPixel(other,0,0)=255 And GetPixel(dc,0,0)=&HFFFFFF','independent Picture references preserve one surface when another releases its owner');
 return finish(`Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function SetPixelV Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal color As Long) As Long`);
}
