# LOCAL ONLY: use installed dependencies, synthetic fixtures and disposable storage.
# No pnpm download, application server or developer/hosted database connection.
$ErrorActionPreference = 'Stop'
$demoVerbose = $false
foreach ($demoArgument in $args) {
    if ($demoArgument -eq '--verbose') { $demoVerbose = $true }
    else { throw "Unknown option '$demoArgument'. Usage: demo-backend-queries.ps1 [--verbose]" }
}
$demoRoot = Split-Path -Parent $PSScriptRoot
$demoVitest = Join-Path $demoRoot 'node_modules/vitest/vitest.mjs'
if (-not (Test-Path -LiteralPath $demoVitest)) {
    throw 'Install the repository dependencies before running this local demonstration.'
}
$previousDemoFlag = [Environment]::GetEnvironmentVariable('FINGENCE_QUERY_DEMO_VERBOSE', 'Process')
$previousPresentationFlag = [Environment]::GetEnvironmentVariable('FINGENCE_QUERY_DEMO_PRESENTATION', 'Process')
Push-Location -LiteralPath $demoRoot
try {
    $env:FINGENCE_QUERY_DEMO_VERBOSE = if ($demoVerbose) { '1' } else { '0' }
    $env:FINGENCE_QUERY_DEMO_PRESENTATION = if ($demoVerbose) { '0' } else { '1' }
    if ($demoVerbose) {
        & node $demoVitest run tests/demo/backend-queries.demo.test.ts --reporter=verbose --disableConsoleIntercept
        if ($LASTEXITCODE -ne 0) { throw 'The local backend query demonstration failed its assertions.' }
    }
    else {
        # Keep framework/technical logs off the presentation; retain them on failure.
        $demoOutput = & node $demoVitest run tests/demo/backend-queries.demo.test.ts --reporter=verbose --disableConsoleIntercept 2>&1
        if ($LASTEXITCODE -ne 0) {
            $demoOutput | ForEach-Object { Write-Output $_ }
            throw 'The local backend query demonstration failed its assertions.'
        }
        $demoOutput | ForEach-Object {
            $demoLine = [string]$_
            if ($demoLine.StartsWith('FINGENCE_DEMO> ')) { Write-Output $demoLine.Substring(15) }
        }
        Write-Output 'PASS: all original demo assertions passed.'
    }
}
finally {
    [Environment]::SetEnvironmentVariable('FINGENCE_QUERY_DEMO_VERBOSE', $previousDemoFlag, 'Process')
    [Environment]::SetEnvironmentVariable('FINGENCE_QUERY_DEMO_PRESENTATION', $previousPresentationFlag, 'Process')
    Pop-Location
}
