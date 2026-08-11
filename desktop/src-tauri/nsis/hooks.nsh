; Farhad Flow CI NSIS hooks.
; Do NOT force $INSTDIR — installer page lets staff pick Program Files,
; LocalAppData, or another drive. Uninstaller never wipes {config_dir}.

!macro NSIS_HOOK_PREINSTALL
  ; no-op — keep NSIS / Tauri default directory page (selectable)
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; no-op — Start Menu + optional Desktop shortcut handled by Tauri finish page
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Intentionally do NOT delete user config / flows-repo.
  ; config_dir: %APPDATA%\zeenome\FarhadFlowCI\ (outside $INSTDIR).
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; no-op — userdata retained by design
!macroend
