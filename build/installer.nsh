!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!ifndef BUILD_UNINSTALLER
Var IliadCliChoice
Var IliadCliCheckbox
LangString IliadCliTitle 1033 "Command-line integration"
LangString IliadCliTitle 3082 "Integración con la terminal"
LangString IliadCliDescription 1033 "Choose whether to install the iliad command."
LangString IliadCliDescription 3082 "Elige si deseas instalar el comando iliad."
LangString IliadCliHelp 1033 "Optional command-line integration. You can also install the command later from the application menu."
LangString IliadCliHelp 3082 "La integración con la terminal es opcional. También puedes instalar el comando después desde el menú de la aplicación."
LangString IliadCliLabel 1033 "Install the iliad command (add to my PATH)"
LangString IliadCliLabel 3082 "Instalar el comando iliad (añadir a mi PATH)"
!endif

!macro customInit
  StrCpy $IliadCliChoice 0
  ReadRegDWORD $0 HKCU "Software\Iliad MD" "InstallCLI"
  ${If} $0 == 1
    StrCpy $IliadCliChoice 1
  ${EndIf}
  ; A command installed later from the application menu also survives upgrades.
  ClearErrors
  FileOpen $2 "$LOCALAPPDATA\Iliad\bin\iliad.cmd" r
  ${IfNot} ${Errors}
    FileRead $2 $3
    FileClose $2
    ${If} $3 == "@rem Iliad managed command v1$\r$\n"
      StrCpy $IliadCliChoice 1
    ${EndIf}
  ${EndIf}
  ${GetParameters} $1
  ClearErrors
  ${GetOptions} $1 "/ILIADCLI=" $0
  ${IfNot} ${Errors}
    ${If} $0 == "1"
      StrCpy $IliadCliChoice 1
    ${ElseIf} $0 == "0"
      StrCpy $IliadCliChoice 0
    ${Else}
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom IliadCliPage IliadCliPageLeave
!macroend

!ifndef BUILD_UNINSTALLER
Function IliadCliPage
  !insertmacro MUI_HEADER_TEXT "$(IliadCliTitle)" "$(IliadCliDescription)"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 30u "$(IliadCliHelp)"
  Pop $0
  ${NSD_CreateCheckbox} 0 40u 100% 20u "$(IliadCliLabel)"
  Pop $IliadCliCheckbox
  ${NSD_SetState} $IliadCliCheckbox $IliadCliChoice
  nsDialogs::Show
FunctionEnd

Function IliadCliPageLeave
  ${NSD_GetState} $IliadCliCheckbox $IliadCliChoice
FunctionEnd

!endif

!macro customInstall
  ${If} $IliadCliChoice == 1
    nsExec::ExecToLog '"$SYSDIR\cmd.exe" /D /S /C ""$INSTDIR\resources\bin\iliad.cmd" install --json"'
  ${Else}
    nsExec::ExecToLog '"$SYSDIR\cmd.exe" /D /S /C ""$INSTDIR\resources\bin\iliad.cmd" uninstall --json"'
  ${EndIf}
  Pop $0
  ${If} $0 == 0
    WriteRegDWORD HKCU "Software\Iliad MD" "InstallCLI" $IliadCliChoice
  ${Else}
    DetailPrint "Could not update the iliad command. Retry from File > Install iliad Command."
    IfSilent 0 +2
      SetErrorLevel 1
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /D /S /C ""$INSTDIR\resources\bin\iliad.cmd" uninstall --json"'
  Pop $0
  ${If} $0 == 0
    DeleteRegValue HKCU "Software\Iliad MD" "InstallCLI"
    DeleteRegKey /ifempty HKCU "Software\Iliad MD"
  ${Else}
    DetailPrint "The command could not be removed; its PATH entry may need manual removal."
  ${EndIf}
!macroend
