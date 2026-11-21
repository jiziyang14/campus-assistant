Add-Type -AssemblyName System.Drawing

# Generate crisp icons from the vector logo sources:
#   icon.ico / favicon.ico  (16-48 from the bold small mark, 64+ from the full logo)
#   apple-touch-icon.png    (180px, brand blue background)
# Usage: run from this folder (campus-exe): powershell -ExecutionPolicy Bypass -File .\make-ico.ps1
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$assets = Join-Path $root '..\campus-src\src\assets'
$logoSrc = Join-Path $assets 'logo.svg'
$smallSrc = Join-Path $assets 'logo-small.svg'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $logoSrc) -or -not (Test-Path $smallSrc)) {
  throw 'logo.svg / logo-small.svg not found in campus-src/src/assets'
}

$work = Join-Path $env:TEMP 'logo-ico-build'
if (Test-Path $work) { cmd /c rmdir /s /q "$work" }
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Render-SvgPng {
  param([string]$SvgPath, [int]$Size, [string]$OutPng, [string]$Background = 'transparent')
  $svgName = 'src-logo.svg'
  Copy-Item -LiteralPath $SvgPath -Destination (Join-Path $work $svgName) -Force
  $html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:' + $Background + ';overflow:hidden}' +
    'img{display:block;width:' + $Size + 'px;height:' + $Size + 'px}' +
    '</style></head><body><img src="' + $svgName + '"/></body></html>'
  $pageFile = Join-Path $work 'render.html'
  Set-Content -Path $pageFile -Value $html -Encoding utf8
  $url = 'file:///' + ($work -replace '\\', '/') + '/render.html'
  & $edge --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=$Size,$Size "--screenshot=$OutPng" $url 2>&1 | Out-Null
  if (-not (Test-Path $OutPng)) { throw ('render failed: ' + $SvgPath + ' @ ' + $Size) }
}

$plan = @(
  @{ Size = 16; Svg = $smallSrc },
  @{ Size = 20; Svg = $smallSrc },
  @{ Size = 24; Svg = $smallSrc },
  @{ Size = 32; Svg = $smallSrc },
  @{ Size = 40; Svg = $smallSrc },
  @{ Size = 48; Svg = $smallSrc },
  @{ Size = 64; Svg = $logoSrc },
  @{ Size = 96; Svg = $logoSrc },
  @{ Size = 128; Svg = $logoSrc },
  @{ Size = 256; Svg = $logoSrc }
)

$sizes = New-Object System.Collections.ArrayList
$pngs = New-Object System.Collections.ArrayList
foreach ($item in $plan) {
  $png = Join-Path $work ('icon-' + $item.Size + '.png')
  Render-SvgPng -SvgPath $item.Svg -Size $item.Size -OutPng $png
  [void]$sizes.Add($item.Size)
  [void]$pngs.Add([System.IO.File]::ReadAllBytes($png))
}

function Write-IconFile {
  param([string]$Path, [int[]]$SizeList, $PngList)
  $fs = [System.IO.File]::Create($Path)
  $writer = New-Object System.IO.BinaryWriter($fs)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$SizeList.Count)
  $offset = 6 + 16 * $SizeList.Count
  for ($i = 0; $i -lt $SizeList.Count; $i++) {
    $size = $SizeList[$i]
    $data = $PngList[$i]
    $dim = 256
    if ($size -lt 256) { $dim = $size }
    if ($size -ge 256) { $dim = 0 }
    $writer.Write([byte]$dim)
    $writer.Write([byte]$dim)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$data.Length)
    $writer.Write([UInt32]$offset)
    $offset += $data.Length
  }
  foreach ($data in $PngList) {
    $writer.Write($data)
  }
  $writer.Close()
  $fs.Close()
}

$exeIco = Join-Path $root 'icon.ico'
Write-IconFile -Path $exeIco -SizeList $sizes -PngList $pngs
$webIco = Join-Path $assets 'favicon.ico'
Write-IconFile -Path $webIco -SizeList $sizes -PngList $pngs
Write-Output ('icon.ico / favicon.ico written: ' + (Get-Item $exeIco).Length + ' bytes')

$iconSource = Join-Path $root 'icon-source.png'
Render-SvgPng -SvgPath $logoSrc -Size 512 -OutPng $iconSource
Write-Output ('icon-source.png written: ' + (Get-Item $iconSource).Length + ' bytes')

$touchPng = Join-Path $work 'touch.png'
Render-SvgPng -SvgPath $logoSrc -Size 180 -OutPng $touchPng -Background '#FFFFFF'
$touchPath = Join-Path $assets 'apple-touch-icon.png'
Copy-Item -LiteralPath $touchPng -Destination $touchPath -Force
Write-Output ('apple-touch-icon.png written: ' + (Get-Item $touchPath).Length + ' bytes')

cmd /c rmdir /s /q "$work"
