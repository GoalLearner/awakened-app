# Simple HTTP server for the habit tracker
$port = if ($env:PORT) { [int]$env:PORT } else { 8080 }
$root = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\Users\richm\Documents\repos\awakened-app" }

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving http://localhost:$port/"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

try {
  while ($listener.IsListening) {
    $ctx = $null
    try { $ctx = $listener.GetContext() } catch { continue }
    $req = $ctx.Request
    $res = $ctx.Response

    try {
      $path = $req.Url.LocalPath
      if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
      $file = Join-Path $root ($path.TrimStart('/').Replace('/', '\'))

      if (Test-Path $file -PathType Leaf) {
        $ext   = [System.IO.Path]::GetExtension($file)
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $res.ContentType     = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
        $res.ContentLength64 = $bytes.Length
        $res.Headers.Add("Cache-Control", "no-store")
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
        $res.ContentLength64 = 0
      }
    } catch {
      try { $res.StatusCode = 500; $res.ContentLength64 = 0 } catch {}
    } finally {
      try { $res.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
