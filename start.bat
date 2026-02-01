@echo off
echo Starting LLM Council Launcher...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo The PowerShell script encountered an error.
)
echo.
echo Press any key to close this window...
pause >nul
