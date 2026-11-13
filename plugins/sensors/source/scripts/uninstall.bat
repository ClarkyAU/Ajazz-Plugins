@echo off
rem Removes the System Vitals plugin from the Ajazz / Stream Dock software.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
pause
