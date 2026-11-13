@echo off
rem Undo the Soundpad patch: puts the store plugin back exactly as it was.
cd /d "%~dp0"
taskkill /F /IM "Stream Dock AJAZZ.exe" >nul 2>&1
taskkill /F /IM SoundpadPlugin.exe >nul 2>&1
timeout /t 2 /nobreak >nul
copy /y manifest.original.json manifest.json >nul
echo Patch removed. Start the Stream Dock software again.
pause
