@echo off
setlocal
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\WebClipperManagerService.vbs"

(
  echo Set WshShell = CreateObject("WScript.Shell"^)
  echo WshShell.CurrentDirectory = "%ROOT%"
  echo WshShell.Run "node ""%ROOT%\local-service\host.js""", 0, False
) > "%VBS%"

echo Installed silent autostart launcher:
echo   %VBS%
echo To remove it, delete that file from your Startup folder.
pause
