$ErrorActionPreference = "Stop"

Write-Host "Starting LLM Council..." -ForegroundColor Cyan
Write-Host ""

# Start backend
Write-Host "Starting backend on http://localhost:8001..." -ForegroundColor Green
$backendProcess = Start-Process -FilePath "uv" -ArgumentList "run", "python", "-m", "backend.main" -PassThru -NoNewWindow

# Wait a bit for backend to start
Start-Sleep -Seconds 2

# Start frontend
Write-Host "Starting frontend on http://localhost:5173..." -ForegroundColor Green
Push-Location frontend
# On Windows, npm is a batch file, so we need to run it via cmd or directly if in path, but Start-Process with npm works if npm is in path.
# However, to ensure we catch the process correctly, we'll use npm.cmd if available or just npm.
$frontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -PassThru -NoNewWindow
Pop-Location

Write-Host ""
Write-Host "[OK] LLM Council is running!" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:8001"
Write-Host "  Frontend: http://localhost:5173"
Write-Host ""
Write-Host "Press any key to stop both servers..." -ForegroundColor Yellow

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host "Stopping servers..." -ForegroundColor Yellow
if ($backendProcess) {
    Stop-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue -Force
}
if ($frontendProcess) {
    # npm spawns child processes, we might need to be more aggressive or just hope killing the parent works enough for dev.
    # For a robust kill, we'd need to find children, but for now simple stop is okay.
    Stop-Process -Id $frontendProcess.Id -ErrorAction SilentlyContinue -Force
}
Write-Host "Stopped." -ForegroundColor Cyan
