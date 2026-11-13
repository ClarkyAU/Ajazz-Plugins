# Changelog

Newest first. All versions were built, tested and installed on 21 Oct 2026.

## 1.3.0 - 2026-10-21

- Back to listen-only: the plugin never sends the mouse anything.
- On the USB cable the battery key now shows **Charging / On cable** instead of an old number, because the mouse reports nothing over the cable.

## 1.2.0 - 2026-10-21 (test build)

- Tried asking the mouse for its battery while on the cable, using the request Glorious Core sends to its other products. The mouse accepted the request but never answered (Windows error 121, timeout), so it was removed again in 1.3.0.

## 1.1.0 - 2026-10-21

- Trimmed to the basics the user wanted: the Mouse key shows **Battery**, **Connection** or **Profile**. Removed the battery history graph, time left and mouse picture.
- New Profile key: profile number, framed in that DPI setting's colour, with DPI or polling rate underneath. Read from Glorious Core's saved settings.
- On the cable: shows Charging (the mouse does not report it, so it is worked out from the connection).
- "Receiver" is now called "Wireless".

## 1.0.0 - 2026-10-21

First full version. Battery (confirmed on hardware: 21 percent on the receiver), time left, battery graph across keys, connection and mouse picture keys, Setup key, Bluetooth battery through Windows. Listens to the mouse alongside Glorious Core.

## 0.1.0 - 2026-10-21 (probe)

Read-only diagnostic build: listed how the mouse appears to Windows and copied Glorious Core's code into the plugin folder so the battery message could be found. Later versions delete those files on start.
