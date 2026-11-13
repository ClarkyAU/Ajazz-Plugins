# TrueNAS plugin (com.clarkyau.truenas) — decisions & findings

_Copy of the Project note `claude/truenas-plugin.md`, taken 2026-11-13. The Project note is the live one._

Status 2026-10-18: v1.2.0 installed and working on the user's deck (log: imported settings, connected, 14 keys on the "Truenas" page). User: "This is perfect".
Workspace source: /home/claude/truenas (npm run build / npm test / npm run package).

## What it does
Live TrueNAS 25.04+ (Community Edition) stats on the AKP153E. Keys: Setup, System, Network, Storage pool, Alerts, App.
- Talks JSON-RPC 2.0 over wss://<host>/api/current: auth.login_with_api_key, core.subscribe reporting.realtime (collection_update events: cpu, memory, interfaces, zfs), system.info, pool.query, alert.list, app.query, app.start/app.stop.
- API key only over wss (TrueNAS revokes keys used over plain ws). "Allow self-signed certificate" on by default.
- Method names/fields taken from the TrueNAS middleware source (stable/fangtooth = 25.04, stable/goldeye = 25.10), not guessed.

## Decisions (from the user)
- One Setup key holds address + API key (global settings). No other key shows them. Press = open web UI / retry.
- Each key's panel shows only its own options: Network = Shows, Port, Speed units; System = Shows, °C/°F; Storage = Shows, Pool; Alerts = Shows; App = App.
- Every key has "Shows" (Automatic default) so the user picks what each key in a joined group shows. Network row Automatic = Download | Upload | graph (no port; user didn't want the port name).
- Neighbouring "graph" keys share one graph. 28 px gap between keys allowed for.
- App key: press = start; press twice within 3 s = stop ("Stop?"); hold 0.7 s = open its web page. Tile colour from the app icon.
- Big text (numbers ~52, labels 22, min 19) after the first build was too small on the real keys.

## Fixed along the way
- v1.0: System/Storage keys blank on hardware: "%" in the SVG data URL. Now drawn as shapes.
- v1.0: text 13-17 px unreadable on the keys.
- v1.2: ID renamed com.homelab.truenas -> com.clarkyau.truenas. Keys moved by text-replacing UUIDs in the page manifest (backup manifest.json.before-rename). Address + API key moved by a one-off helper in the old folder (tools/migrate-from-homelab/helper.js) writing import-settings.json; the new plugin imports and deletes it. Confirmed on hardware 2026-10-18. Old folder later removed.

## Known gaps / needs hardware
- App icon pictures (PNG inside SVG) not explicitly confirmed on the keys.
- Key images are SVG data URLs (made before the PNG-via-resvg rule); works on hardware but differs from the template.
- Only tested against a fake TrueNAS and the user's NAS; other versions (25.10+) only checked against the source.
