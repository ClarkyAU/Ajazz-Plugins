// Mouse Info listener (C# 5, compiled by Windows PowerShell 5.1 Add-Type).
// LISTENS ONLY: it never sends commands to any mouse.
//  - Glorious wireless mice (PixArt, VID 093A): opens the vendor input collection (usage page FF00,
//    usage FF00) for reading. Windows gives every open handle its own copy of each input report,
//    so this runs side by side with Glorious Core. Battery arrives as [06 FB level charging ...].
//    It also reads the consumer collection (000C / 0001), where the Model I 2 announces profile
//    switches as [04 F1 profile]; nothing else from that collection is passed on.
//  - Bluetooth devices: reads Windows' battery property (DEVPKEY_Bluetooth_Battery).
// Output: one JSON object per line on stdout. Input (stdin): "rescan", "bt", "quit".
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace MouseInfo
{
    public static class Listener
    {
        // ------------------------------------------------------------ native
        [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
        [DllImport("hid.dll")] static extern bool HidD_GetAttributes(IntPtr h, ref ATTR a);
        [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(IntPtr h, out IntPtr p);
        [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr p);
        [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr p, byte[] caps);
        [DllImport("hid.dll")] static extern bool HidD_GetProductString(IntPtr h, byte[] b, int l);
                [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevsW(ref Guid g, IntPtr e, IntPtr w, uint f);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevsW(IntPtr g, string e, IntPtr w, uint f);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr h, IntPtr d, ref Guid g, int i, ref IFD x);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr h, ref IFD x, IntPtr det, int sz, out int req, IntPtr d);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInfo(IntPtr h, int i, ref DINFO d);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiGetDevicePropertyW(IntPtr h, ref DINFO d, ref DPKEY k, out uint type, byte[] buf, int size, out int req, uint flags);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInstanceIdW(IntPtr h, ref DINFO d, StringBuilder sb, int size, out int req);
        [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr h, byte[] b, int n, out int read, IntPtr o);
        [DllImport("kernel32.dll")] static extern bool CancelIoEx(IntPtr h, IntPtr o);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential)] struct ATTR { public int Size; public ushort V; public ushort P; public ushort N; }
        [StructLayout(LayoutKind.Sequential)] struct IFD { public int cbSize; public Guid G; public int Flags; public IntPtr R; }
        [StructLayout(LayoutKind.Sequential)] struct DINFO { public int cbSize; public Guid ClassGuid; public int DevInst; public IntPtr R; }
        [StructLayout(LayoutKind.Sequential)] struct DPKEY { public Guid fmtid; public uint pid; }

        static readonly IntPtr INVALID = new IntPtr(-1);
        const int HIDP_OK = 0x00110000;

        // ------------------------------------------------------------ known mice
        // Glorious wireless mice that report battery as 06 FB (Glorious Core "MouseV2" family).
        // PID = family (3 hex digits) + connection digit: A = USB cable, D = 2.4 GHz receiver, B = Bluetooth.
        static string ModelName(string pid)
        {
            if (pid.Length != 4) return null;
            switch (pid.Substring(0, 3))
            {
                case "821": return "Model I 2";
                case "822": return "Model O 2";
                case "824": return "Model D 2";
                case "826": return "Model O 2 Mini";
            }
            return null;
        }
        static string ConnName(string pid)
        {
            switch (pid.Substring(3, 1)) { case "A": return "cable"; case "D": return "receiver"; case "B": return "bluetooth"; }
            return null;
        }

        class Dev
        {
            public string Path, Pid, Model, Conn, Product;
            public IntPtr H = INVALID;
            public int InLen;
            public bool Consumer;
            public volatile bool Stop;
            public Thread T;
        }

        static readonly object outLock = new object();
        static readonly object devLock = new object();
        static readonly Dictionary<string, Dev> devs = new Dictionary<string, Dev>();
        static readonly Dictionary<string, bool> failedPaths = new Dictionary<string, bool>();
        static volatile bool quit;
        static volatile bool wantScan = true, wantBt = true;
        static string lastDevJson = "", lastBtJson = "";

        // ------------------------------------------------------------ output
        public static string J(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') { sb.Append('\\'); sb.Append(c); }
                else if (c < 32) sb.Append("\\u" + ((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }
        static void Emit(string json)
        {
            lock (outLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
        }
        static void Log(string level, string msg) { Emit("{\"type\":\"log\",\"level\":" + J(level) + ",\"msg\":" + J(msg) + "}"); }
        static string Hex(byte[] b, int n)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < n && i < b.Length; i++) sb.Append(b[i].ToString("x2"));
            return sb.ToString();
        }

        // ------------------------------------------------------------ HID scan
        static List<string> HidPaths()
        {
            var res = new List<string>();
            Guid g; HidD_GetHidGuid(out g);
            IntPtr h = SetupDiGetClassDevsW(ref g, IntPtr.Zero, IntPtr.Zero, 0x12);
            if (h == INVALID) return res;
            try
            {
                for (int i = 0; ; i++)
                {
                    IFD x = new IFD(); x.cbSize = Marshal.SizeOf(typeof(IFD));
                    if (!SetupDiEnumDeviceInterfaces(h, IntPtr.Zero, ref g, i, ref x)) break;
                    int req; SetupDiGetDeviceInterfaceDetailW(h, ref x, IntPtr.Zero, 0, out req, IntPtr.Zero);
                    if (req <= 0) continue;
                    IntPtr det = Marshal.AllocHGlobal(req + 8);
                    try
                    {
                        Marshal.WriteInt32(det, IntPtr.Size == 8 ? 8 : 6);
                        if (SetupDiGetDeviceInterfaceDetailW(h, ref x, det, req, out req, IntPtr.Zero))
                            res.Add(Marshal.PtrToStringUni(new IntPtr(det.ToInt64() + 4)));
                    }
                    finally { Marshal.FreeHGlobal(det); }
                }
            }
            finally { SetupDiDestroyDeviceInfoList(h); }
            return res;
        }

        // Quick filter from the path text, so we only open Glorious interfaces.
        static string PidFromPath(string path)
        {
            string p = path.ToUpperInvariant();
            int v = p.IndexOf("VID_093A"); if (v < 0) v = p.IndexOf("VID&01093A"); if (v < 0) v = p.IndexOf("VID&02093A");
            if (v < 0) return null;
            int i = p.IndexOf("PID_"); int k = 4;
            if (i < 0) { i = p.IndexOf("PID&"); k = 4; }
            if (i < 0 || i + k + 4 > p.Length) return null;
            string pid = p.Substring(i + k, 4);
            return ModelName(pid) != null ? pid : null;
        }

        static void Scan()
        {
            var paths = HidPaths();
            var seen = new Dictionary<string, bool>();
            foreach (var path in paths)
            {
                string pid = PidFromPath(path);
                if (pid == null) continue;
                seen[path] = true;
                lock (devLock) { if (devs.ContainsKey(path)) continue; }
                if (failedPaths.ContainsKey(path)) continue;
                TryOpen(path, pid);
            }
            // Close interfaces that disappeared.
            var gone = new List<Dev>();
            lock (devLock)
            {
                foreach (var kv in devs) if (!seen.ContainsKey(kv.Key) || kv.Value.Stop) gone.Add(kv.Value);
                foreach (var d in gone) devs.Remove(d.Path);
            }
            foreach (var d in gone) Close(d, "removed");
            var fk = new List<string>(failedPaths.Keys);
            foreach (var p in fk) if (!seen.ContainsKey(p)) failedPaths.Remove(p);
            EmitDevices();
        }

        static void TryOpen(string path, string pid)
        {
            // Check it is the vendor input collection (FF00 / FF00) without needing read access.
            IntPtr q = CreateFileW(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (q == INVALID) return;
            int usagePage = 0, usage = 0, inLen = 0; string product = null;
            try
            {
                IntPtr pp;
                if (HidD_GetPreparsedData(q, out pp))
                {
                    try
                    {
                        byte[] c = new byte[64];
                        if (HidP_GetCaps(pp, c) == HIDP_OK)
                        {
                            usage = BitConverter.ToUInt16(c, 0); usagePage = BitConverter.ToUInt16(c, 2); inLen = BitConverter.ToUInt16(c, 4);
                        }
                    }
                    finally { HidD_FreePreparsedData(pp); }
                }
                byte[] sb = new byte[512];
                if (HidD_GetProductString(q, sb, sb.Length))
                {
                    string s = Encoding.Unicode.GetString(sb); int z = s.IndexOf('\0'); product = z >= 0 ? s.Substring(0, z) : s;
                }
            }
            finally { CloseHandle(q); }
            bool vendor = usagePage == 0xFF00 && usage == 0xFF00;
            bool consumer = usagePage == 0x000C && usage == 0x0001;
            if ((!vendor && !consumer) || inLen <= 0) { failedPaths[path] = true; return; }

            IntPtr h = CreateFileW(path, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (h == INVALID)
            {
                failedPaths[path] = true;
                Log("warn", "Cannot open " + ModelName(pid) + " (" + ConnName(pid) + ", " + (vendor ? "vendor" : "consumer") + ") for reading: error " + Marshal.GetLastWin32Error());
                return;
            }
            var d = new Dev { Path = path, Pid = pid, Model = ModelName(pid), Conn = ConnName(pid), Product = product, H = h, InLen = inLen, Consumer = consumer };
            lock (devLock) devs[path] = d;
            Log("info", "Listening to " + d.Model + " (" + d.Conn + ", " + pid + ", " + (consumer ? "consumer" : "vendor") + ", input " + inLen + " bytes)");
            d.T = new Thread(() => ReadLoop(d)); d.T.IsBackground = true; d.T.Start();
        }

        static void EmitReport(Dev d, byte[] b, int n, string src)
        {
            Emit("{\"type\":\"report\",\"pid\":" + J(d.Pid) + ",\"model\":" + J(d.Model) + ",\"conn\":" + J(d.Conn) + ",\"src\":" + J(src) + ",\"hex\":" + J(Hex(b, n)) + "}");
        }

        static void ReadLoop(Dev d)
        {
            byte[] buf = new byte[Math.Max(d.InLen, 8)];
            while (!d.Stop && !quit)
            {
                int n;
                if (!ReadFile(d.H, buf, d.InLen, out n, IntPtr.Zero))
                {
                    int err = Marshal.GetLastWin32Error();
                    if (!d.Stop) Log("info", d.Model + " (" + d.Conn + ") stopped reading: error " + err);
                    d.Stop = true; wantScan = true;
                    break;
                }
                if (n <= 0) continue;
                if (d.Consumer && !(n >= 3 && buf[0] == 4 && buf[1] == 0xF1)) continue;
                EmitReport(d, buf, n, d.Consumer ? "consumer" : "read");
            }
        }

        static void Close(Dev d, string why)
        {
            d.Stop = true;
            try { CancelIoEx(d.H, IntPtr.Zero); } catch { }
            try { CloseHandle(d.H); } catch { }
            Log("info", "Closed " + d.Model + " (" + d.Conn + "): " + why);
        }

        static void EmitDevices()
        {
            var parts = new List<string>();
            lock (devLock)
            {
                foreach (var d in devs.Values)
                    if (!d.Consumer) parts.Add("{\"pid\":" + J(d.Pid) + ",\"model\":" + J(d.Model) + ",\"conn\":" + J(d.Conn) + ",\"product\":" + J(d.Product) + "}");
            }
            parts.Sort(StringComparer.Ordinal);
            string json = "{\"type\":\"devices\",\"list\":[" + string.Join(",", parts.ToArray()) + "]}";
            if (json != lastDevJson) { lastDevJson = json; Emit(json); }
        }

        // ------------------------------------------------------------ Bluetooth battery
        static string PropString(IntPtr h, ref DINFO d, Guid g, uint pid)
        {
            var k = new DPKEY { fmtid = g, pid = pid };
            uint type; int req; byte[] buf = new byte[1024];
            if (!SetupDiGetDevicePropertyW(h, ref d, ref k, out type, buf, buf.Length, out req, 0)) return null;
            if (type != 0x12) return null; // DEVPROP_TYPE_STRING
            string s = Encoding.Unicode.GetString(buf, 0, Math.Max(0, req)); int z = s.IndexOf('\0');
            return z >= 0 ? s.Substring(0, z) : s;
        }

        static void PollBluetooth()
        {
            var parts = new List<string>();
            var battKey = new Guid("104EA319-6EE2-4701-BD47-8DDBF425BBE5");
            var nameKey = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
            foreach (string en in new string[] { "BTHLE", "BTHENUM" })
            {
                IntPtr h = SetupDiGetClassDevsW(IntPtr.Zero, en, IntPtr.Zero, 0x6); // PRESENT | ALLCLASSES
                if (h == INVALID) continue;
                try
                {
                    for (int i = 0; ; i++)
                    {
                        var d = new DINFO(); d.cbSize = Marshal.SizeOf(typeof(DINFO));
                        if (!SetupDiEnumDeviceInfo(h, i, ref d)) break;
                        var k = new DPKEY { fmtid = battKey, pid = 2 };
                        uint type; int req; byte[] b = new byte[8];
                        if (!SetupDiGetDevicePropertyW(h, ref d, ref k, out type, b, b.Length, out req, 0)) continue;
                        if (type != 3 || req < 1) continue; // DEVPROP_TYPE_BYTE
                        var sb = new StringBuilder(512); int r2;
                        string id = SetupDiGetDeviceInstanceIdW(h, ref d, sb, sb.Capacity, out r2) ? sb.ToString() : ("bt" + i);
                        string name = PropString(h, ref d, nameKey, 14) ?? PropString(h, ref d, nameKey, 2) ?? "Bluetooth device";
                        parts.Add("{\"id\":" + J(id) + ",\"name\":" + J(name) + ",\"level\":" + b[0] + "}");
                    }
                }
                finally { SetupDiDestroyDeviceInfoList(h); }
            }
            parts.Sort(StringComparer.Ordinal);
            string json = "{\"type\":\"bt\",\"list\":[" + string.Join(",", parts.ToArray()) + "]}";
            if (json != lastBtJson) { lastBtJson = json; Emit(json); }
        }

        // ------------------------------------------------------------ main loop
        static void StdinLoop()
        {
            try
            {
                var r = new System.IO.StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
                string line;
                while ((line = r.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line == "quit") break;
                    if (line == "rescan") { failedPaths.Clear(); lastDevJson = ""; lastBtJson = ""; wantScan = true; wantBt = true; }
                    else if (line == "bt") wantBt = true;
                }
            }
            catch { }
            quit = true;
        }

        public static void Run(int btSeconds)
        {
            var t = new Thread(StdinLoop); t.IsBackground = true; t.Start();
            Emit("{\"type\":\"ready\"}");
            DateTime nextScan = DateTime.MinValue, nextBt = DateTime.MinValue;
            while (!quit)
            {
                try
                {
                    if (wantScan || DateTime.UtcNow >= nextScan) { wantScan = false; Scan(); nextScan = DateTime.UtcNow.AddSeconds(3); }
                    if (wantBt || DateTime.UtcNow >= nextBt) { wantBt = false; PollBluetooth(); nextBt = DateTime.UtcNow.AddSeconds(btSeconds); }
                }
                catch (Exception e) { Log("error", "Loop: " + e.Message); }
                Thread.Sleep(200);
            }
            List<Dev> all; lock (devLock) { all = new List<Dev>(devs.Values); devs.Clear(); }
            foreach (var d in all) Close(d, "quit");
        }
    }
}
