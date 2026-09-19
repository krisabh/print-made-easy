; PrintYantra Agent — custom NSIS hooks
; Startup uses Electron app.setLoginItemSettings (HKCU Run), not NSIS shortcuts.
; Remove that single Run value on uninstall so no stale startup entry remains.
; Skip on upgrade uninstall (--updated): the new Agent re-applies openAtLogin from
; ProgramData config on launch. Deleting the Run key during upgrade would briefly
; (or permanently, if restart fails) clear auto-start.
;
; On install: retire the PrintMadeEasy Agent 1.4.0 Run key so dual-install machines
; do not keep launching the old product after PrintYantra is installed. The new
; Agent registers "PrintYantra Agent" via setLoginItemSettings on first launch.

!macro customInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PrintMadeEasy Agent"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PrintYantra Agent"
  ${endIf}
!macroend
