@echo off
rem Mouse Info installer: closes the Ajazz software, installs the plugin, starts the software again.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Action install
pause
