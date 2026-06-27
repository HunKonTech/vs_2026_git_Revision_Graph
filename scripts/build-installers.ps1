<#
.SYNOPSIS
    Elkészíti a Git Revision Graph összes telepítőjét.

.DESCRIPTION
    Egyetlen szkript, amely az összes platformra előállítja a csomagokat:

      1. VS Code .vsix          (standard, VS Code 1.85+)
      2. VS Code .vsix VS 2026  (VS 2026 beépített kódjához, engine 1.96+)
      3. Visual Studio 2022 VSIX
      4. Visual Studio 2026 VSIX

    A közös web renderert (packages/graph-webview) egyszer buildeli, majd
    minden host becsomagolja a saját igényei szerint.

    A kimenet a dist\installers\ mappába kerül.

    Előfeltételek (Visual Studio VSIX-hez):
      - Windows 10/11
      - Visual Studio 2022 vagy 2026 az „Extension development" workload-dal
      - Node.js 18+ a PATH-on
      - Git a PATH-on

.PARAMETER Configuration
    MSBuild build-konfiguráció a VS projektekhez. Alap: Release.

.PARAMETER VSCodeOnly
    Csak a VS Code .vsix csomagokat állítja elő (átugorja a VS VSIX-eket).

.PARAMETER SkipVSCode
    Átugorja a VS Code csomagokat; csak a Visual Studio VSIX-eket gyártja.

.PARAMETER SkipVS2026Code
    Átugorja a külön VS 2026-célzott VS Code .vsix csomagot.

.EXAMPLE
    # Összes csomag egyszerre
    pwsh scripts\build-installers.ps1

    # Csak a VS Code variánsok (platformfüggetlen gépen is futtatható)
    pwsh scripts\build-installers.ps1 -VSCodeOnly

    # Csak Visual Studio VSIX (2022 + 2026)
    pwsh scripts\build-installers.ps1 -SkipVSCode
#>
[CmdletBinding()]
param(
    [string]$Configuration  = "Release",
    [switch]$VSCodeOnly,
    [switch]$SkipVSCode,
    [switch]$SkipVS2026Code
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    [OK]  $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    [--]  $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "    [!!]  $msg" -ForegroundColor Red; throw $msg }

$installers = Join-Path $root "dist\installers"
New-Item -ItemType Directory -Force -Path $installers | Out-Null

# ---------------------------------------------------------------------------
# 1. Közös alapok: npm + shared web renderer
# ---------------------------------------------------------------------------
Step "npm install"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install sikertelen." }

Step "Közös web renderer + asset másolás"
npm run build:core
npm run build:webview
npm run build:vscode    # VS Code extension bundle
npm run build:vs-assets # -> vs\webview\
if ($LASTEXITCODE -ne 0) { Fail "Build sikertelen." }

# ---------------------------------------------------------------------------
# 2. VS Code .vsix (standard, engine ^1.85)
# ---------------------------------------------------------------------------
if (-not $SkipVSCode) {
    Step "VS Code extension csomagolása (standard)"
    node scripts\package-vscode.mjs
    if ($LASTEXITCODE -ne 0) { Fail "VS Code csomag előállítása sikertelen." }
    $vsixFile = Get-ChildItem "$installers\git-revision-graph-*.vsix" |
                Where-Object { $_.Name -notmatch "vs2026" } |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Ok "VS Code (standard): $($vsixFile.Name)"
}

# ---------------------------------------------------------------------------
# 3. VS Code .vsix VS 2026-hoz (engine ^1.96)
# ---------------------------------------------------------------------------
if (-not $SkipVSCode -and -not $SkipVS2026Code) {
    Step "VS Code extension csomagolása VS 2026 célra (engine ^1.96)"
    node scripts\package-vscode-vs2026.mjs
    if ($LASTEXITCODE -ne 0) { Fail "VS 2026 VS Code csomag előállítása sikertelen." }
    $vsix26 = Get-ChildItem "$installers\git-revision-graph-vs2026-*.vsix" |
               Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Ok "VS Code (VS 2026 célzott): $($vsix26.Name)"
}

if ($VSCodeOnly) {
    Step "Kész — csak VS Code csomagok."
    Get-ChildItem $installers | Format-Table Name, @{L="Méret (KB)";E={[math]::Round($_.Length/1KB,1)}}
    return
}

# ---------------------------------------------------------------------------
# 4. Visual Studio VSIX (2022 + 2026) MSBuild-del
# ---------------------------------------------------------------------------
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    Warn "vswhere.exe nem található. VS VSIX fordítás kihagyva."
    Warn "Telepítsd a Visual Studio 2022/2026-ot 'Visual Studio extension development' workload-dal."
} else {
    $csproj = Join-Path $root "vs\RevisionGraph.csproj"

    function Build-VSIX {
        param(
            [string]$VersionRange,
            [string]$Label,
            [switch]$Prerelease
        )
        $vsArgs = @(
            "-version",  $VersionRange,
            "-latest",
            "-requires", "Microsoft.VisualStudio.Workload.VisualStudioExtension",
            "-property", "installationPath"
        )
        if ($Prerelease) { $vsArgs += "-prerelease" }

        $installPath = & $vswhere @vsArgs
        if (-not $installPath) {
            Warn "Visual Studio $Label ($VersionRange) nem található — kihagyva."
            return
        }

        $msbuild = Join-Path $installPath "MSBuild\Current\Bin\MSBuild.exe"
        if (-not (Test-Path $msbuild)) {
            Warn "MSBuild nem található $Label telepítőjénél: $msbuild"
            return
        }

        Step "Visual Studio $Label VSIX fordítása ($installPath)"
        & $msbuild $csproj /t:Restore,Rebuild `
            /p:Configuration=$Configuration `
            /p:Platform=AnyCPU `
            /p:DeployExtension=false `
            /v:minimal
        if ($LASTEXITCODE -ne 0) { Fail "MSBuild sikertelen ($Label, kilépési kód: $LASTEXITCODE)." }

        # Az MSBuild a bin\<Configuration>\ mappába rakja a .vsix fájlt.
        $built = Join-Path $root "vs\bin\$Configuration\RevisionGraph.vsix"
        if (-not (Test-Path $built)) {
            Warn "VSIX nem keletkezett $Label-hez: $built"
            return
        }

        $dest = Join-Path $installers "RevisionGraph-$Label.vsix"
        Copy-Item $built $dest -Force
        Ok "Visual Studio $Label VSIX: $($dest | Split-Path -Leaf)"
    }

    Build-VSIX -VersionRange "[17.0,18.0)" -Label "vs2022"
    Build-VSIX -VersionRange "[18.0,19.0)" -Label "vs2026" -Prerelease
}

# ---------------------------------------------------------------------------
# Összefoglaló
# ---------------------------------------------------------------------------
Step "Kész. Telepítők:"
Get-ChildItem $installers -Filter "*.vsix" |
    Sort-Object Name |
    Format-Table Name, @{L="Méret (KB)";E={[math]::Round($_.Length/1KB,1)}}
