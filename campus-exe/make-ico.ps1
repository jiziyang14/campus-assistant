Add-Type -AssemblyName System.Drawing

# Generate crisp icons from the vector logo sources:
#   icon.ico / favicon.ico  (16-48 from the bold small mark, 56+ from the full logo)
#   apple-touch-icon.png    (180px, brand blue background)
# Small frames are stored as 32-bit DIB (BMP) so Windows taskbar/title bar never has to
# decode PNG frames or upscale a single large frame; 128/256 stay PNG to keep size down.
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

# 覆盖 Windows 各缩放比例下任务栏实际使用的尺寸：24/30/36/42/48 等
$plan = @(
  @{ Size = 16; Svg = $smallSrc },
  @{ Size = 20; Svg = $smallSrc },
  @{ Size = 24; Svg = $smallSrc },
  @{ Size = 28; Svg = $smallSrc },
  @{ Size = 30; Svg = $smallSrc },
  @{ Size = 32; Svg = $smallSrc },
  @{ Size = 36; Svg = $smallSrc },
  @{ Size = 40; Svg = $smallSrc },
  @{ Size = 42; Svg = $smallSrc },
  @{ Size = 48; Svg = $smallSrc },
  @{ Size = 54; Svg = $smallSrc },
  @{ Size = 56; Svg = $logoSrc },
  @{ Size = 60; Svg = $logoSrc },
  @{ Size = 64; Svg = $logoSrc },
  @{ Size = 72; Svg = $logoSrc },
  @{ Size = 80; Svg = $logoSrc },
  @{ Size = 96; Svg = $logoSrc },
  @{ Size = 128; Svg = $logoSrc },
  @{ Size = 256; Svg = $logoSrc }
)

# 32bpp DIB：BITMAPINFOHEADER + 自下而上的 BGRA 像素 + AND 掩码（仅全透明像素置 1）
function ConvertTo-Dib {
  param([string]$PngPath)
  $image = [System.Drawing.Image]::FromFile($PngPath)
  $bmp = New-Object System.Drawing.Bitmap($image)
  $w = $bmp.Width
  $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $locked = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $row = New-Object byte[] ($w * 4)
  $xor = New-Object byte[] ($w * $h * 4)
  $maskRow = [int]([math]::Ceiling($w / 32.0) * 4)
  $mask = New-Object byte[] ($maskRow * $h)
  try {
    for ($y = 0; $y -lt $h; $y++) {
      [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($locked.Scan0.ToInt64() + $y * $locked.Stride), $row, 0, $w * 4)
      $destRow = $h - 1 - $y
      for ($x = 0; $x -lt $w; $x++) {
        $src = $x * 4
        $dest = ($destRow * $w + $x) * 4
        $alpha = $row[$src + 3]
        $xor[$dest] = $row[$src]
        $xor[$dest + 1] = $row[$src + 1]
        $xor[$dest + 2] = $row[$src + 2]
        $xor[$dest + 3] = $alpha
        if ($alpha -eq 0) {
          $maskIndex = $destRow * $maskRow + [math]::Floor($x / 8)
          $mask[$maskIndex] = $mask[$maskIndex] -bor (0x80 -shr ($x % 8))
        }
      }
    }
  } finally {
    $bmp.UnlockBits($locked)
    $bmp.Dispose()
    $image.Dispose()
  }
  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([UInt32]40)
  $writer.Write([Int32]$w)
  $writer.Write([Int32]($h * 2))
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]0)
  $writer.Write([UInt32]($xor.Length + $mask.Length))
  $writer.Write([Int32]0)
  $writer.Write([Int32]0)
  $writer.Write([UInt32]0)
  $writer.Write([UInt32]0)
  $writer.Write($xor)
  $writer.Write($mask)
  $writer.Flush()
  $bytes = $stream.ToArray()
  $writer.Close()
  $stream.Close()
  return $bytes
}

$sizes = New-Object System.Collections.ArrayList
$frames = New-Object System.Collections.ArrayList
$pngFrames = New-Object System.Collections.ArrayList
$pngBySize = @{}
foreach ($item in $plan) {
  $png = Join-Path $work ('icon-' + $item.Size + '.png')
  Render-SvgPng -SvgPath $item.Svg -Size $item.Size -OutPng $png
  $pngBytes = [System.IO.File]::ReadAllBytes($png)
  [void]$sizes.Add($item.Size)
  [void]$pngFrames.Add($pngBytes)
  $pngBySize[$item.Size] = $pngBytes
  if ($item.Size -le 96) {
    [void]$frames.Add([byte[]](ConvertTo-Dib -PngPath $png))
  } else {
    [void]$frames.Add($pngBytes)
  }
}

function Write-IconFile {
  param([string]$Path, [int[]]$SizeList, $FrameList)
  $fs = [System.IO.File]::Create($Path)
  $writer = New-Object System.IO.BinaryWriter($fs)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$SizeList.Count)
  $offset = 6 + 16 * $SizeList.Count
  for ($i = 0; $i -lt $SizeList.Count; $i++) {
    $size = $SizeList[$i]
    $data = $FrameList[$i]
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
  foreach ($data in $FrameList) {
    $writer.Write($data)
  }
  $writer.Close()
  $fs.Close()
}

$exeIco = Join-Path $root 'icon.ico'
Write-IconFile -Path $exeIco -SizeList $sizes -FrameList $frames
# PE 资源注入（ResEdit）对条目数量敏感，只放经典 10 个尺寸且全部用 PNG，避免生成的 exe 损坏
$resourceSizes = @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)
$resourceFrames = @()
foreach ($size in $resourceSizes) {
  $resourceFrames += , $pngBySize[$size]
}
$resourceIco = Join-Path $root 'icon-exe.ico'
Write-IconFile -Path $resourceIco -SizeList $resourceSizes -FrameList $resourceFrames
$webIco = Join-Path $assets 'favicon.ico'
Write-IconFile -Path $webIco -SizeList $sizes -FrameList $frames
Write-Output ('icon.ico / icon-exe.ico / favicon.ico written: ' + (Get-Item $exeIco).Length + ' / ' + (Get-Item $resourceIco).Length + ' bytes')

$iconSource = Join-Path $root 'icon-source.png'
Render-SvgPng -SvgPath $logoSrc -Size 512 -OutPng $iconSource
Write-Output ('icon-source.png written: ' + (Get-Item $iconSource).Length + ' bytes')

$touchPng = Join-Path $work 'touch.png'
Render-SvgPng -SvgPath $logoSrc -Size 180 -OutPng $touchPng -Background '#FFFFFF'
$touchPath = Join-Path $assets 'apple-touch-icon.png'
Copy-Item -LiteralPath $touchPng -Destination $touchPath -Force
Write-Output ('apple-touch-icon.png written: ' + (Get-Item $touchPath).Length + ' bytes')

cmd /c rmdir /s /q "$work"
