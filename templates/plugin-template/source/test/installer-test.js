'use strict';
// Runs the real install.ps1 under PowerShell 7 (Linux) against a temporary plugins folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

function findPwsh() {
  if (process.env.PWSH) return process.env.PWSH;
  const mine = '/home/claude/tools/pwsh/pwsh';
  return fs.existsSync(mine) ? mine : 'pwsh';
}

async function run(o) {
  const pwsh = findPwsh();
  const script = path.join(o.pkgDir, 'install.ps1');
  const bytes = fs.readFileSync(script);
  assert.ok(!bytes.some((b) => b > 127), 'install.ps1 must be plain ASCII');
  assert.ok(/\r\n/.test(bytes.toString('latin1')) && !/[^\r]\n/.test(bytes.toString('latin1')), 'install.ps1 must use CRLF');
  assert.ok(/\r\n/.test(fs.readFileSync(path.join(o.pkgDir, 'install.bat'), 'latin1')), 'install.bat must use CRLF');

  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  const target = path.join(plugins, o.id + '.sdPlugin');
  const env = Object.assign({}, process.env, { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' });
  const ps = (args) => { const r = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', script].concat(args), { env, encoding: 'utf8' }); if (r.status !== 0) throw new Error('install.ps1 failed (' + r.status + '):\n' + r.stdout + r.stderr); return r.stdout; };
  try {
    // old folder name is removed, new install lands
    fs.mkdirSync(path.join(plugins, 'com.clarkyau.oldname.sdPlugin'));
    let out = ps(['-PluginsDir', plugins, '-NoRestart', '-Yes']);
    assert.ok(fs.existsSync(path.join(target, 'plugin', 'index.js')), 'index.js installed');
    assert.ok(fs.existsSync(path.join(target, 'manifest.json')) && fs.existsSync(path.join(target, 'pi', 'index.html')));
    assert.ok(!/restart/i.test(out), '-NoRestart hides the restart reminder');
    // update: saved data and the log stay, files that no longer exist are removed, changed files are replaced
    fs.mkdirSync(path.join(target, 'data')); fs.writeFileSync(path.join(target, 'data', 'last.json'), '{"keep":true}');
    fs.writeFileSync(path.join(target, 'plugin.log'), 'log');
    fs.writeFileSync(path.join(target, 'plugin', 'stale.js'), 'old');
    fs.writeFileSync(path.join(target, 'plugin', 'index.js'), 'broken');
    out = ps(['-PluginsDir', plugins, '-Yes']);
    assert.ok(/restart/i.test(out), 'restart reminder shown');
    assert.ok(!fs.existsSync(path.join(target, 'plugin', 'stale.js')), 'stale file removed');
    assert.ok(fs.statSync(path.join(target, 'plugin', 'index.js')).size > 1e6, 'index.js replaced');
    assert.strictEqual(fs.readFileSync(path.join(target, 'data', 'last.json'), 'utf8'), '{"keep":true}', 'data kept on update');
    assert.strictEqual(fs.readFileSync(path.join(target, 'plugin.log'), 'utf8'), 'log', 'log kept on update');
    // uninstall keeps settings
    ps(['-PluginsDir', plugins, '-Yes', '-Uninstall', '-NoRestart']);
    assert.ok(!fs.existsSync(path.join(target, 'plugin')) && !fs.existsSync(path.join(target, 'manifest.json')), 'plugin files removed');
    assert.strictEqual(fs.readFileSync(path.join(target, 'data', 'last.json'), 'utf8'), '{"keep":true}', 'data kept on uninstall');
    // uninstall when not installed is harmless
    fs.rmSync(target, { recursive: true, force: true });
    ps(['-PluginsDir', plugins, '-Yes', '-Uninstall']);
  } finally {
    fs.rmSync(plugins, { recursive: true, force: true });
  }
}

module.exports = { run };
