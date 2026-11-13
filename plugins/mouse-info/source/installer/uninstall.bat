@echo off
rem Mouse Info uninstaller: closes the Ajazz software, removes the plugin, starts the software again.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Action uninstall
pause
