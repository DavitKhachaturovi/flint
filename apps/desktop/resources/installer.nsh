; AGENT-02 (D-185 Q14): flint.exe's folder on the user's PATH. The matching and the guards (the
; value left alone when it reads back empty or is 8,000+ characters, its type kept, no duplicate,
; only the exact entry removed) are flint.exe's own `path add` / `path remove`, unit-tested; the
; installer runs them and tells Windows the environment changed, so new terminals see it.
!macro flintBroadcastEnvironment
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customInstall
  nsExec::Exec '"$INSTDIR\resources\bin\flint.exe" path add'
  Pop $0
  !insertmacro flintBroadcastEnvironment
!macroend

; Uninstall cleanup (docs/05 §6, D-32). Flint itself registers flint:// (R-3 toast buttons) and its
; start-with-Windows entry (APP-01) at runtime, and the installer keeps a copy of itself for a future
; updater (%LOCALAPPDATA%\flint-updater), so the uninstaller removes all three. Skipped on update,
; where the new version needs them. App data and the Flint folder are never touched.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Only when flint:// still points at this installation (not at a development build).
    ReadRegStr $0 HKCU "Software\Classes\flint\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey HKCU "Software\Classes\flint"
    ${endIf}
    ; AGENT-02: the PATH entry goes too (an update keeps it).
    nsExec::Exec '"$INSTDIR\resources\bin\flint.exe" path remove'
    Pop $0
    !insertmacro flintBroadcastEnvironment
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"
    !ifdef APP_INSTALLER_STORE_FILE
      Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
      RMDir "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif
  ${endIf}
!macroend
