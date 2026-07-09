# run-dev.ps1 - NovaTube PC Development Starter Script

# 1. Add Cargo and standard compiler paths to Path if gcc is missing
$hasGcc = Get-Command gcc -ErrorAction SilentlyContinue
if (-not $hasGcc) {
    $devCppPath = "C:\Program Files (x86)\Embarcadero\Dev-Cpp\TDM-GCC-64\bin"
    if (Test-Path $devCppPath) {
        $env:PATH = "$env:USERPROFILE\.cargo\bin;$devCppPath;$env:PATH"
    } else {
        Write-Host "[!] Warning: 'gcc' was not found in PATH and default Dev-Cpp directory is missing. Rust compilation may fail." -ForegroundColor Yellow
        $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    }
} else {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
}

# 2. Ensure Junction directory exists and is up to date (dynamically resolved)
$projectPath = $PSScriptRoot
$driveRoot = $projectPath.Substring(0, 3)
$junctionPath = Join-Path $driveRoot "novatube_temp"

if (Test-Path $junctionPath) {
    # Remove existing junction safely without deleting target contents
    $cmd = "cmd /c rmdir `"$junctionPath`""
    Invoke-Expression $cmd
}

# Create new junction
New-Item -ItemType Junction -Path $junctionPath -Value $projectPath | Out-Null
Write-Host "Created build junction at $junctionPath" -ForegroundColor Green

# 3. Start the Cloud Relay Server concurrently with the Tauri Dev Server
try {
    Write-Host "Starting Cloud Relay Server on port 3000..." -ForegroundColor Cyan
    $relayProcess = Start-Process -FilePath "node" -ArgumentList "index.js" -WorkingDirectory "$projectPath\relay-server" -PassThru -NoNewWindow
    
    # Give the relay server a moment to spin up
    Start-Sleep -Seconds 2

    Write-Host "Starting Tauri Dev Server..." -ForegroundColor Cyan
    cd $junctionPath
    npm run tauri dev
} finally {
    if ($relayProcess) {
        Write-Host "Stopping Cloud Relay Server..." -ForegroundColor Yellow
        Stop-Process -Id $relayProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
