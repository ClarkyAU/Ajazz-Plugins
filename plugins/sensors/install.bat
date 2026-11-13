@echo off
rem System Vitals plugin installer for the Ajazz / Stream Dock software.
rem Closes the software, copies the plugin into its plugins folder and starts it again.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
