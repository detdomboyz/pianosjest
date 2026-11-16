param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]] $Command
)
$ErrorActionPreference = 'Stop'
$storageRoot = 'D:\MelodiaJest-private\host-maintenance'
if (-not (Test-Path -LiteralPath $storageRoot -PathType Container)) {
    throw 'Create the private D: store and verify the artifact migration first.'
}
$checkoutRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach ($name in @('dist','tmp','.qa','web-app/.tooling','web-app/.next','web-app/out','web-app/node_modules','tools/__pycache__','service/__pycache__','deploy/shared-host/__pycache__','tests/__pycache__')) {
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $checkoutRoot $name))
    $targetPath = [IO.Path]::GetFullPath((Join-Path "$storageRoot\workspace-artifacts" $name))
    if (Test-Path -LiteralPath $sourcePath) {
        $item = Get-Item -LiteralPath $sourcePath
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -or $item.ResolveLinkTarget($true).FullName -ne $targetPath) {
            throw "Generated directory must first be migrated and verified: $sourcePath"
        }
    } else {
        [IO.Directory]::CreateDirectory($targetPath) | Out-Null
        New-Item -ItemType Junction -Path $sourcePath -Target $targetPath | Out-Null
    }
}
$paths = @{
    TEMP = "$storageRoot\tmp"
    TMP = "$storageRoot\tmp"
    TMPDIR = "$storageRoot\tmp"
    npm_config_cache = "$storageRoot\cache\npm"
    PIP_CACHE_DIR = "$storageRoot\cache\pip"
    UV_CACHE_DIR = "$storageRoot\cache\uv"
    PLAYWRIGHT_BROWSERS_PATH = "$storageRoot\toolchain\playwright"
    UV_PROJECT_ENVIRONMENT = "$storageRoot\toolchain\python-env"
    PYTHONPYCACHEPREFIX = "$storageRoot\cache\python"
}
foreach ($name in $paths.Keys) {
    [IO.Directory]::CreateDirectory($paths[$name]) | Out-Null
    [Environment]::SetEnvironmentVariable($name,$paths[$name],'Process')
}
if ($Command.Count -gt 0) {
    $program = $Command[0]
    $arguments = if ($Command.Count -gt 1) { $Command[1..($Command.Count-1)] } else { @() }
    & $program @arguments
    exit $LASTEXITCODE
}
$paths | ConvertTo-Json -Compress
