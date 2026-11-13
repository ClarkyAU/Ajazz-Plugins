"use strict";
// A fake LibreHardwareMonitor web server: serves /data.json in the same tree format
// (Text, SensorId, Type, Value, RawValue, HardwareId, Children).
const http = require("http");

function tree() {
  const t = Date.now() / 1000;
  const w = (p, lo, hi) => lo + ((Math.sin((t / p) * 2 * Math.PI) + 1) / 2) * (hi - lo);
  let id = 0;
  const sensor = (Text, SensorId, Type, v, unit) => ({ id: id++, Text, Min: "", Value: `${v.toFixed(1)} ${unit}`, Max: "", SensorId, Type, RawMin: v, RawValue: v, RawMax: v, ImageURL: "images/transparent.png", Children: [] });
  const group = (Text, children) => ({ id: id++, Text, Min: "", Value: "", Max: "", ImageURL: "images_icon/temperature.png", Children: children });
  const hw = (Text, HardwareId, children) => ({ id: id++, Text, Min: "", Value: "", Max: "", HardwareId, ImageURL: "images_icon/cpu.png", Children: children });
  return {
    id: id++, Text: "Sensor", Min: "Min", Value: "Value", Max: "Max", ImageURL: "",
    Children: [{
      id: id++, Text: "DESKTOP-TEST", Min: "", Value: "", Max: "", ImageURL: "images_icon/computer.png",
      Children: [
        hw("AMD Ryzen 7 5700X", "/amdcpu/0", [
          group("Temperatures", [sensor("Core (Tctl/Tdie)", "/amdcpu/0/temperature/2", "Temperature", w(20, 44, 71), "°C"), sensor("CCD1 (Tdie)", "/amdcpu/0/temperature/3", "Temperature", w(20, 42, 69), "°C")]),
          group("Powers", [sensor("Package", "/amdcpu/0/power/0", "Power", w(13, 28, 76), "W")]),
          group("Clocks", [sensor("Core #1", "/amdcpu/0/clock/1", "Clock", w(7, 3400, 4650), "MHz")]),
        ]),
        hw("ASUS TUF GAMING B550-PLUS", "/motherboard", [
          hw("Nuvoton NCT6798D", "/lpc/nct6798d/0", [
            group("Fans", [sensor("Fan #2", "/lpc/nct6798d/0/fan/1", "Fan", w(25, 820, 1180), "RPM")]),
            group("Voltages", [sensor("Vcore", "/lpc/nct6798d/0/voltage/0", "Voltage", w(9, 0.95, 1.38), "V")]),
          ]),
        ]),
      ],
    }],
  };
}

function startFakeLhm(port = 0) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      if (req.url === "/data.json") {
        resp.writeHead(200, { "Content-Type": "application/json" });
        resp.end(JSON.stringify(tree()));
      } else {
        resp.writeHead(404);
        resp.end();
      }
    });
    srv.listen(port, "127.0.0.1", () => res(srv));
  });
}

module.exports = { startFakeLhm, tree };
