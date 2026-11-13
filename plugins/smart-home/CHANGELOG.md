# Changelog

Newest first.

## 2.0.0 - Oct 2026

Rebuilt to the current plugin instructions, under a new ID: `com.clarkyau.smarthome` (the first version was `dev.smarthome.tuya`).

- Setup key: the Access ID and Access Secret are entered only there, with the connection status and device count. Other keys say "Add the Setup key" or "Finish the Setup key" until it is done.
- Per-key "Shows" (Automatic by default) and "Join with neighbouring keys". Neighbouring keys of the same device join into one display; the main keys and the side screen never join. Only one key in a group shows the name.
- Display options (name, icon, colour, glow or flat) are saved per key, not globally.
- Key pictures are drawn as SVG and turned into PNG inside the plugin (resvg, bundled Barlow Semi Condensed fonts), so none of the Ajazz SVG quirks apply. Text stays inside one key; nothing under 19 px.
- Tuya local protocol 3.3, 3.4 and 3.5, with automatic version detection, UDP discovery and a network-scan fallback.
- Moving over from `dev.smarthome.tuya`: the installer renames the key IDs in the profile files (backup kept), a handover helper passes the saved account details to the new plugin, old key settings are upgraded, and the old folder is removed.
- Installer: install.bat and uninstall.bat (uninstall keeps settings). No secrets in the log.
- Test kit: protocol, cloud, end-to-end, migration and image checks, a fake Ajazz host, and Python simulators for devices and the cloud.

Found and fixed while building:
- Version auto-detect accepted 3.3 on any TCP connect. It now waits for a reply that decrypts.
- Cloud requests failed the signature check because the body was sent chunked. `Content-Length` is now set.
- A test simulator exited when its input closed. It now stays alive.
- Joined keys repeated the device name. Only one key in a group now shows it.
- Moved keys did not get their old look settings in time. They are now applied again when the handover arrives.

Found while installing (same version):
- The old plugin folder could not be deleted while the old plugin was running. The new plugin now removes it on a later start (the old folder carries a `MOVED.txt` marker).

## Before 2.0.0

Earlier version, ID `dev.smarthome.tuya`. Replaced by 2.0.0. Not kept in this repo.
