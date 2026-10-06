<#
.SYNOPSIS
  Local MySQL 8 for development on Windows, with all of its data on the project drive (DEC-013).

.DESCRIPTION
  Reuses the MySQL binaries from Laragon (or $env:MYSQL_BIN) but keeps the data directory, the
  config and the logs under <repo>/.data/mysql, so nothing is written to C:. It listens only on
  127.0.0.1, on port 3310 by default ($env:MYSQL_DEV_PORT) to avoid clashing with Laragon.
  The root user has no password: this instance is for local development only.

.EXAMPLE
  pnpm mysql:start   # initializes the data directory the first time, then starts the server
  pnpm mysql:status
  pnpm mysql:stop
#>
param(
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$binDir = if ($env:MYSQL_BIN) { $env:MYSQL_BIN } else { 'C:\laragon\bin\mysql\mysql-8.0.30-winx64\bin' }
$port = if ($env:MYSQL_DEV_PORT) { [int]$env:MYSQL_DEV_PORT } else { 3310 }
$baseDir = Join-Path $repoRoot '.data\mysql'
$dataDir = Join-Path $baseDir 'data'
$configFile = Join-Path $baseDir 'my.ini'
$logFile = Join-Path $baseDir 'mysqld.log'

function Test-Listening {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Write-Config {
  New-Item -ItemType Directory -Force $baseDir | Out-Null
  # MySQL option files want forward slashes; ASCII avoids the BOM that PowerShell 5 adds to UTF-8.
  @"
[mysqld]
port=$port
bind-address=127.0.0.1
datadir="$($dataDir.Replace('\', '/'))"
log-error="$($logFile.Replace('\', '/'))"
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-time-zone=+00:00
mysqlx=0
"@ | Set-Content -Encoding ascii -Path $configFile
}

switch ($Action) {
  'start' {
    if (Test-Listening) {
      "MySQL is already listening on 127.0.0.1:$port"
      return
    }
    $mysqld = Join-Path $binDir 'mysqld.exe'
    if (-not (Test-Path $mysqld)) {
      throw "mysqld.exe not found in $binDir. Set MYSQL_BIN to the folder that contains mysqld.exe."
    }
    Write-Config
    if (-not (Test-Path $dataDir)) {
      "Initializing a new data directory in $dataDir ..."
      & $mysqld "--defaults-file=$configFile" --initialize-insecure
      if ($LASTEXITCODE -ne 0) { throw "mysqld --initialize-insecure failed; see $logFile" }
    }
    Start-Process -FilePath $mysqld -ArgumentList "--defaults-file=`"$configFile`"" -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (Test-Listening); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Listening)) { throw "MySQL did not start; see $logFile" }
    "MySQL listening on 127.0.0.1:$port (data in $dataDir)"
  }
  'stop' {
    if (-not (Test-Listening)) {
      "MySQL is not running on port $port"
      return
    }
    & (Join-Path $binDir 'mysqladmin.exe') -u root -h 127.0.0.1 -P $port shutdown
    for ($i = 0; $i -lt 30 -and (Test-Listening); $i++) { Start-Sleep -Seconds 1 }
    "MySQL on port $port stopped"
  }
  'status' {
    if (Test-Listening) { "running on 127.0.0.1:$port (data in $dataDir)" } else { "stopped (port $port)" }
  }
}
