param(
  [switch]$SkipInstall,
  [switch]$Mesh
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent

function Get-LocalPath([string]$relative) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relative))
  if (-not $target.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path outside repository: $relative"
  }
  return $target
}

function Invoke-Checked([string]$executable, [string[]]$arguments) {
  & $executable @arguments
  if ($LASTEXITCODE -ne 0) { throw "$executable failed with exit code $LASTEXITCODE" }
}

$runtime = Get-LocalPath '.runtime'
foreach ($relative in @('.runtime/node', '.runtime/downloads', '.runtime/cache/npm', '.runtime/cache/pip', '.runtime/node_modules')) {
  New-Item -ItemType Directory -Force -Path (Get-LocalPath $relative) | Out-Null
}
$node = Get-LocalPath '.runtime/node/node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  Copy-Item -LiteralPath (Get-Command node -ErrorAction Stop).Source -Destination $node
}
Invoke-Checked $node @('-e', 'if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22+ required")')

$npm = Get-LocalPath '.runtime/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npm)) {
  $archive = Get-LocalPath '.runtime/downloads/npm-11.6.2.tgz'
  $unpack = Get-LocalPath '.runtime/downloads/npm-11.6.2'
  if (Test-Path -LiteralPath $unpack) { throw "Unpack directory exists; inspect it before retrying: $unpack" }
  Invoke-WebRequest -Uri 'https://registry.npmjs.org/npm/-/npm-11.6.2.tgz' -OutFile $archive
  New-Item -ItemType Directory -Path $unpack | Out-Null
  Invoke-Checked 'tar.exe' @('-xzf', $archive, '-C', $unpack)
  $npmDestination = Get-LocalPath '.runtime/npm'
  if (Test-Path -LiteralPath $npmDestination) { throw "Destination exists: $npmDestination" }
  Move-Item -LiteralPath (Join-Path $unpack 'package') -Destination $npmDestination
}

$modules = Get-LocalPath 'node_modules'
$moduleTarget = Get-LocalPath '.runtime/node_modules'
if (Test-Path -LiteralPath $modules) {
  $item = Get-Item -LiteralPath $modules -Force
  if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'node_modules is a physical directory. Migrate it before running setup; existing dependencies will not be overwritten.'
  }
  $resolved = [System.IO.Path]::GetFullPath($item.Target)
  if ($resolved -ne $moduleTarget) { throw "Unexpected node_modules link target: $resolved" }
} else {
  New-Item -ItemType Junction -Path $modules -Target $moduleTarget | Out-Null
}

$python = Get-LocalPath '.runtime/python/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  $basePython = if ($env:MAKE_ENGINE_PYTHON) { $env:MAKE_ENGINE_PYTHON } else { (Get-Command python -ErrorAction Stop).Source }
  Invoke-Checked $basePython @('-c', 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"')
  Invoke-Checked $basePython @('-m', 'venv', (Get-LocalPath '.runtime/python'))
}
if (-not $SkipInstall) {
  $env:PATH = (Get-LocalPath '.runtime/node') + [System.IO.Path]::PathSeparator + $env:PATH
  $env:npm_config_cache = Get-LocalPath '.runtime/cache/npm'
  $env:PIP_CACHE_DIR = Get-LocalPath '.runtime/cache/pip'
  Push-Location $repoRoot
  try {
    Invoke-Checked $node @($npm, 'ci')
    Invoke-Checked $python @('-m', 'pip', 'install', '-r', 'requirements.txt')
    if ($Mesh) { Invoke-Checked $python @('-m', 'pip', 'install', '-r', 'engine/requirements-mesh.txt') }
  } finally { Pop-Location }
}
Write-Output 'Runtime ready in .runtime. Use .\npm.cmd run dev and .\python.cmd -m engine.'
