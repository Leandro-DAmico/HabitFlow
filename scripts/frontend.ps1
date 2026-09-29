# Uses the project-local Node runtime when present, without replacing system Node.
# Example from repository root: .\scripts\frontend.ps1 run dev
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$portableNode = Join-Path $projectRoot '.tools\node_modules\node\bin\node.exe'
$nodeExecutable = if (Test-Path -LiteralPath $portableNode) { $portableNode } else { (Get-Command node -ErrorAction Stop).Source }
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$npmCli = Join-Path (Split-Path -Parent $npmCommand) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm CLI not found. Install Node.js 24 LTS with npm.' }
$nodeVersion = & $nodeExecutable --version
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'HabitFlow requires Node.js 24 LTS or newer.' }
$previousPath = $env:PATH
$env:PATH = (Split-Path -Parent $nodeExecutable) + ';' + $env:PATH
Push-Location (Join-Path $projectRoot 'frontend')
try {
    & $nodeExecutable $npmCli @args
    $resultCode = $LASTEXITCODE
} finally {
    Pop-Location
    $env:PATH = $previousPath
}
exit $resultCode
