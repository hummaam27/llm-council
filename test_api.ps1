$ErrorActionPreference = "Stop"

try {
    $response = Invoke-RestMethod -Uri "http://localhost:8001/api/conversations" -Method Post -Body "{}" -ContentType "application/json"
    Write-Host "Success! Created conversation:"
    Write-Host ($response | ConvertTo-Json -Depth 5)
}
catch {
    Write-Host "Error creating conversation:"
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response Body:"
        Write-Host $reader.ReadToEnd()
    }
}
