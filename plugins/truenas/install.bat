@echo off
setlocal
title Install TrueNAS plugin for Stream Dock
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer.ps1" -Mode install
if errorlevel 1 (
  echo.
  pause
) else (
  timeout /t 6 >nul
)
