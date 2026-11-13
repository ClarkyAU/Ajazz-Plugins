# Changelog

Newest first.

## 0.5.0 - 2026-10-23 (released)

- **Follows the cockpit plug.** Plug on: Pit House closed if open, base set to Work, Pit House started. Plug off: Pit House closed, base set to Standby, Pit House left closed.
- Reads the plug locally (Tuya protocol 3.3, read-only) using the details the Smart Home plugin has already saved. Checks every 3 seconds, acts after 3 matching readings, ignores flickers and an unreachable plug, and treats the first reading as a starting point.
- New settings panel: current mode, "Follow the cockpit plug" tickbox, plug name, live plug state. Settings are saved by the plugin and apply live.
- The key now shows Work, Standby, Working, Error, or "Moza R5 / press" when the mode isn't known yet. The Pit House link check from 0.1 was removed.
- Tests rewritten around a fake plug and fake serial layer. Installed on the author's PC and confirmed working.

## 0.4.0 - 2026-10-23 (development build)

- **First version that switches the mode.** Key press closes Pit House, reads the mode, writes the opposite (0 = Work, 1 = Standby), reads it back, and starts Pit House again. Fixed Pit House being relaunched from its worker program instead of the main one.

## 0.3.0 - 2026-10-23 (development build)

- Read-only serial test: close Pit House, ask the base for its mode, reopen Pit House. Used in Work and in Standby to learn the real values (0 and 1).

## 0.2.0 - 2026-10-23 (development build)

- Tried writing `SetMotorRunState` through Pit House's private local CoAP service. The base accepted it but it is not Work/Standby (it only changed an internal run state and made the wheel lights blink faster), so this route was dropped.

## 0.1.0 - 2026-10-22 (development build)

- Read-only probe of Pit House's local CoAP service (finds its port, lists its resources, reads a few values). Showed that route could not switch the mode.

Only 0.5.0 was released as a zip; 0.1 to 0.4 were development builds installed on the author's PC while the way to switch the mode was being found out.
