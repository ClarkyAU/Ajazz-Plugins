@echo off
setlocal
set "ID=com.clarkyau.mozabase.sdPlugin"
set "DEST=%APPDATA%\HotSpot\StreamDock\plugins\%ID%"
echo Closing the Ajazz software...
taskkill /f /im "Stream Dock AJAZZ.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
if exist "%DEST%" rmdir /s /q "%DEST%"
set "EXE=C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"
if exist "%EXE%" start "" "%EXE%"
echo Removed.
timeout /t 3 >nul
