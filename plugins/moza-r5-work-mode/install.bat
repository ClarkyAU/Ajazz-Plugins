@echo off
setlocal
set "ID=com.clarkyau.mozabase.sdPlugin"
set "SRC=%~dp0%ID%"
set "DEST=%APPDATA%\HotSpot\StreamDock\plugins\%ID%"
if not exist "%SRC%\manifest.json" (
  echo Can't find the plugin files next to this installer.
  pause
  exit /b 1
)
if not exist "%APPDATA%\HotSpot\StreamDock\plugins" (
  echo Can't find the Stream Dock plugins folder. Is the Ajazz software installed?
  pause
  exit /b 1
)
echo Closing the Ajazz software...
taskkill /f /im "Stream Dock AJAZZ.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
echo Installing...
if exist "%DEST%" (
  rem keep logs, replace everything else
  robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS >nul
) else (
  robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS >nul
)
if errorlevel 8 (
  echo Copy failed.
  pause
  exit /b 1
)
set "EXE=C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"
if exist "%EXE%" (
  echo Starting the Ajazz software...
  start "" "%EXE%"
) else (
  echo Installed. Please start the Ajazz software yourself.
)
echo Done.
timeout /t 3 >nul
