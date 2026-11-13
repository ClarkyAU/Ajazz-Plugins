@echo off
setlocal
title Remove TrueNAS plugin from Stream Dock
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer.ps1" -Mode uninstall
if errorlevel 1 (
  echo.
  pause
) else (
  timeout /t 6 >nul
)
