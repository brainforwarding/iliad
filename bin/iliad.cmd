@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\Iliad MD.exe" "%~dp0iliad.mjs" %*
exit /b %errorlevel%
