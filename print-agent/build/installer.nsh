; PrintMadeEasy Agent — custom NSIS hooks
; Startup uses Electron app.setLoginItemSettings (HKCU Run), not NSIS shortcuts.
; Remove that single Run value on uninstall so no stale startup entry remains.
; Skip on upgrade uninstall (--updated): the new Agent re-applies openAtLogin from
; ProgramData config on launch. Deleting the Run key during upgrade would briefly
; (or permanently, if restart fails) clear auto-start.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PrintMadeEasy Agent"
  ${endIf}
!macroend
