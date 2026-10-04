VERSION 5.00
Begin VB.Form Form1
   Caption         =   "Classic VB6 runtime executable"
   ClientHeight    =   2400
   ClientLeft      =   120
   ClientTop       =   450
   ClientWidth     =   5400
   StartUpPosition =   2
   Begin VB.CommandButton Command1
      Caption         =   "Close"
      Height          =   495
      Left            =   1920
      TabIndex        =   0
      Top             =   1320
      Width           =   1455
   End
   Begin VB.Label Label1
      Caption         =   "Running on MSVBVM60.DLL with classic VB6 controls."
      Height          =   735
      Left            =   360
      Top             =   360
      Width           =   4695
   End
End
Attribute VB_Name = "Form1"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Option Explicit

Private Sub Command1_Click()
    Unload Me
End Sub
