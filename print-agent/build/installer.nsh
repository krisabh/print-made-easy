; PrintMadeEasy Agent — custom NSIS hooks
; Startup uses Electron app.setLoginItemSettings (HKCU Run), not NSIS shortcuts.
; Remove that single Run value on uninstall so no stale startup entry remains.

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PrintMadeEasy Agent"
!macroend
