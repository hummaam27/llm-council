$ErrorActionPreference = "Stop"

Write-Host "Starting backend..."
$backendProcess = Start-Process -FilePath "uv" -ArgumentList "run", "python", "-m", "backend.main" -PassThru -NoNewWindow

try {
    # Wait for backend to start
    $retries = 10
    $started = $false
    while ($retries -gt 0) {
        Start-Sleep -Seconds 2
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:8001/" -Method Get -ErrorAction Stop
            if ($response.status -eq "ok") {
                $started = $true
                break
            }
        }
        catch {
            Write-Host "Waiting for backend... ($retries)"
        }
        $retries--
    }

    if (-not $started) {
        throw "Backend failed to start within timeout."
    }

    Write-Host "Backend started. Testing create conversation..."
    $response = Invoke-RestMethod -Uri "http://localhost:8001/api/conversations" -Method Post -Body "{}" -ContentType "application/json"
    Write-Host "Success! Created conversation:"
    Write-Host ($response | ConvertTo-Json -Depth 5)

}
catch {
    Write-Host "Error:"
    Write-Host $_.Exception.Message
}
finally {
    Write-Host "Stopping backend..."
    if ($backendProcess) {
        Stop-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue -Force
    }
}
