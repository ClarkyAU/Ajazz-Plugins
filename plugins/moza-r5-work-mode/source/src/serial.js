'use strict';
// Closes Pit House, talks to the base over its USB serial port, and starts Pit House again.
// Uses built-in Windows PowerShell only. The serial port is exclusive, so Pit House must be closed first.
const { execFile } = require('child_process');

const PS = `
$ErrorActionPreference = 'Stop'
$cfg = $env:MOZA_CFG | ConvertFrom-Json
$result = [ordered]@{ ok = $false }
$exe = $null
try {
  $procs = @(Get-Process | Where-Object { $_.ProcessName -match 'MOZA|Pit ?House' })
  foreach ($p in $procs) { if (-not $exe -and $p.Path -and $p.Path -match 'MOZA Pit House\\.exe$' -and $p.Path -notmatch '\\\\bin\\\\') { $exe = $p.Path } }
  if (-not $exe) { $exe = 'C:\\Program Files (x86)\\MOZA Pit House\\MOZA Pit House.exe' }
  $result.exe = $exe
  $result.stopped = $procs.Count
  if ($procs.Count -gt 0) {
    $procs | Stop-Process -Force
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; if (-not (Get-Process | Where-Object { $_.ProcessName -match 'MOZA|Pit ?House' })) { break } }
    Start-Sleep -Milliseconds 800
  }
  $dev = Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_346E' -and $_.Name -match '\\(COM\\d+\\)' } | Select-Object -First 1
  if (-not $dev) { throw 'No Moza serial port found' }
  $com = [regex]::Match($dev.Name, 'COM\\d+').Value
  $result.port = $com
  $sp = New-Object System.IO.Ports.SerialPort $com, 115200, 'None', 8, 'One'
  $sp.ReadTimeout = 100; $sp.WriteTimeout = 1000; $sp.DtrEnable = $true; $sp.RtsEnable = $true
  $sp.Open()
  $replies = @()
  try {
    $sp.DiscardInBuffer()
    if ($cfg.toggle) {
      function Send-Frame($hex) {
        $b = [byte[]]($hex -split '(?<=\\G..)' | Where-Object { $_ } | ForEach-Object { [Convert]::ToByte($_, 16) })
        $sp.Write($b, 0, $b.Length)
        Start-Sleep -Milliseconds $cfg.waitMs
        $n = $sp.BytesToRead
        $buf = New-Object byte[] $n
        if ($n -gt 0) { [void]$sp.Read($buf, 0, $n) }
        return ([BitConverter]::ToString($buf) -replace '-', '')
      }
      $r1 = Send-Frame $cfg.toggle.get
      $m = [regex]::Match($r1, '7E029F2134([0-9A-F]{2})')
      $result.before = if ($m.Success) { [Convert]::ToInt32($m.Groups[1].Value, 16) } else { $null }
      $replies += $r1
      if ($m.Success) {
        $to1 = ($result.before -eq 0)
        if ($cfg.toggle.target -ne $null) { $to1 = ([int]$cfg.toggle.target -eq 1) }
        $set = if ($to1) { $cfg.toggle.setTo1 } else { $cfg.toggle.setTo0 }
        $replies += (Send-Frame $set)
        Start-Sleep -Milliseconds 300
        $r3 = Send-Frame $cfg.toggle.get
        $replies += $r3
        $m3 = [regex]::Match($r3, '7E029F2134([0-9A-F]{2})')
        $result.after = if ($m3.Success) { [Convert]::ToInt32($m3.Groups[1].Value, 16) } else { $null }
      } else { throw 'Base did not answer the mode read' }
    }
    foreach ($hex in $cfg.frames) {
      $b = [byte[]]($hex -split '(?<=\\G..)' | Where-Object { $_ } | ForEach-Object { [Convert]::ToByte($_, 16) })
      $sp.Write($b, 0, $b.Length)
      Start-Sleep -Milliseconds $cfg.waitMs
      $n = $sp.BytesToRead
      $buf = New-Object byte[] $n
      if ($n -gt 0) { [void]$sp.Read($buf, 0, $n) }
      $replies += ([BitConverter]::ToString($buf) -replace '-', '')
    }
  } finally { $sp.Close() }
  $result.replies = $replies
  $result.ok = $true
} catch {
  $result.error = $_.Exception.Message
} finally {
  if ($cfg.relaunch -and $exe -and (Test-Path $exe)) { Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) }
}
$result | ConvertTo-Json -Compress -Depth 4
`;

function run(frames, { waitMs = 400, relaunch = true, toggle = null, target = null } = {}) {
  if (process.env.MOZA_TEST_SERIAL) {
    if (process.env.MOZA_TEST_SERIAL_LOG) { try { require('fs').appendFileSync(process.env.MOZA_TEST_SERIAL_LOG, JSON.stringify({ relaunch, target }) + '\n'); } catch (_) { /* ignore */ } }
    const base = JSON.parse(process.env.MOZA_TEST_SERIAL);
    if (target !== null && base.ok) { base.after = target; }
    return Promise.resolve(base);
  }
  const cfg = JSON.stringify({ frames: frames.map((f) => f.toString('hex')), waitMs, relaunch, toggle: toggle ? { get: toggle.get.toString('hex'), setTo0: toggle.setTo0.toString('hex'), setTo1: toggle.setTo1.toString('hex'), target } : null });
  const enc = Buffer.from(PS, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, timeout: 60000, env: { ...process.env, MOZA_CFG: cfg }, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) return resolve({ ok: false, error: err.message + (stderr ? ' ' + String(stderr).slice(0, 300) : '') });
        try { resolve(JSON.parse(String(stdout).trim().split(/\r?\n/).pop())); } catch (e) { resolve({ ok: false, error: 'bad output: ' + String(stdout).slice(0, 300) }); }
      });
  });
}
module.exports = { run };
