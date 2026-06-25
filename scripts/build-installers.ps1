<#
.SYNOPSIS
    Builds the installers for the Git Revision Graph extension:
      - Visual Studio 2022 VSIX
      - Visual Studio 2026 VSIX
      - VS Code .vsix

.DESCRIPTION
    Builds the shared web renderer once, packages the VS Code extension, then
    locates each installed Visual Studio (via vswhere) and builds the VSIX
    against it. Outputs land in dist\installers\.

    Windows only — the Visual Studio VSIX build needs MSBuild + the VS SDK.

.PARAMETER Configuration
    MSBuild configuration for the VS builds. Default: Release.

.PARAMETER VSCodeOnly
    Build only the VS Code .vsix (skip the Visual Studio VSIX builds).

.PARAMETER SkipVSCode
    Skip the VS Code .vsix (build only the Visual Studio VSIX installers).

.EXAMPLE
    pwsh scripts\build-installers.ps1
    pwsh scripts\build-installers.ps1 -VSCodeOnly
#>
[CmdletBinding()]
param(
    [string]$Configuration = "Release",
    [switch]$VSCodeOnly,
    [switch]$SkipVSCode
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[skip] $msg" -ForegroundColor Yellow }

$installers = Join-Path $root "dist\installers"
New-Item -ItemType Directory -Force -Path $installers | Out-Null

# ---------------------------------------------------------------------------
# 1. Shared web renderer (needed by every host).
# ---------------------------------------------------------------------------
Step "Installing npm dependencies"
npm install

Step "Building shared web renderer + staging assets"
npm run build:core
npm run build:webview
npm run build:vs-assets

# ---------------------------------------------------------------------------
# 2. VS Code .vsix
# ---------------------------------------------------------------------------
if (-not $SkipVSCode) {
    Step "Packaging VS Code extension"
    node scripts\package-vscode.mjs
}
if ($VSCodeOnly) {
    Step "Done (VS Code only). Output in $installers"
    Get-ChildItem $installers | Format-Table Name, Length
    return
}

# ---------------------------------------------------------------------------
# 3. Visual Studio VSIX (2022 + 2026) via vswhere + MSBuild.
# ---------------------------------------------------------------------------
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "vswhere.exe not found. Install Visual Studio 2022/2026 with the 'Visual Studio extension development' workload."
}

$csproj = Join-Path $root "vs\RevisionGraph.csproj"

function Build-VSIX {
    param(
        [string]$VersionRange,  # e.g. "[17.0,18.0)"
        [string]$Label,         # e.g. "vs2022"
        [switch]$Prerelease
    )

    $vsArgs = @("-version", $VersionRange, "-latest",
                "-requires", "Microsoft.VisualStudio.Workload.VisualStudioExtension",
                "-property", "installationPath")
    if ($Prerelease) { $vsArgs += "-prerelease" }

    $install = & $vswhere @vsArgs
    if (-not $install) { Warn "Visual Studio $Label ($VersionRange) not found."; return }

    $msbuild = Join-Path $install "MSBuild\Current\Bin\MSBuild.exe"
    if (-not (Test-Path $msbuild)) { Warn "MSBuild not found for $Label at $msbuild"; return }

    Step "Building VSIX for $Label using $install"
    & $msbuild $csproj /t:Restore,Rebuild `
        /p:Configuration=$Configuration /p:Platform=AnyCPU /p:DeployExtension=false /v:minimal
    if ($LASTEXITCODE -ne 0) { throw "MSBuild failed for $Label (exit $LASTEXITCODE)." }

    $built = Join-Path $root "vs\bin\$Configuration\RevisionGraph.vsix"
    if (-not (Test-Path $built)) { Warn "VSIX not produced for $Label at $built"; return }

    $dest = Join-Path $installers "RevisionGraph-$Label.vsix"
    Copy-Item $built $dest -Force
    Write-Host "Visual Studio installer: $dest" -ForegroundColor Green
}

Build-VSIX -VersionRange "[17.0,18.0)" -Label "vs2022"
Build-VSIX -VersionRange "[18.0,19.0)" -Label "vs2026" -Prerelease

Step "Done. Installers in $installers"
Get-ChildItem $installers | Format-Table Name, Length
