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
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"
    !ifdef APP_INSTALLER_STORE_FILE
      Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
      RMDir "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif
  ${endIf}
!macroend
