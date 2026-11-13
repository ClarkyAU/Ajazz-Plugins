// iCUE Battery helper. Started by the plugin with Windows PowerShell 5.1 (built into Windows).
// Talks to Corsair's official iCUE SDK (iCUESDK.x64_2019.dll, next to this file) and prints one
// JSON line per change to stdout. It only READS from the devices; it never changes anything.
// Written in C# 5 on purpose: Windows PowerShell 5.1 compiles it with the old .NET Framework compiler.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace IcueBattery
{

    // Reads the HS80 MAX's battery (in tenths of a percent) and its charging flag straight from the USB
    // receiver (Corsair Slipstream, 1B1C:0A97, vendor HID collection FF42/0001). iCUE's own SDK does not
    // offer charging. Only "get" requests are sent. Method documented by chrisingram22/hs80-battery-widget
    // (confirmed there on an HS80 Max with iCUE running).
    public static class Receiver
    {
        [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
        [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(IntPtr h, out IntPtr p);
        [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr p);
        [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr p, byte[] caps);
        [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevsW(ref Guid g, IntPtr e, IntPtr w, uint f);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr h, IntPtr d, ref Guid g, int i, ref IFD x);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr h, ref IFD x, IntPtr det, int sz, out int req, IntPtr d);
        [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr h, byte[] b, int n, out int read, IntPtr o);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr h, byte[] b, int n, out int written, IntPtr o);
        [DllImport("kernel32.dll")] static extern bool CancelIoEx(IntPtr h, IntPtr o);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [StructLayout(LayoutKind.Sequential)] struct IFD { public int cbSize; public Guid G; public int Flags; public IntPtr R; }

        static readonly IntPtr INVALID = new IntPtr(-1);
        static readonly string[] Pids = new string[] { "0a97", "2a08", "2a02" }; // HS80 Max (confirmed), Void v2 / Virtuoso Max (same protocol, untested)

        public static volatile int PollSeconds = 10;
        public static volatile bool CheckNow = false;
        static bool trustNext = false;
        static volatile bool stop;
        static Thread worker;
        static readonly object snapLock = new object();
        static bool snapOk;
        static double snapBattery;
        static int snapCharge; // 1 charging, 2 on battery
        static long snapTime;
        static string snapNote = "starting";
        static string snapPid = "";
        static readonly HashSet<string> told = new HashSet<string>();

        // reader thread output
        static readonly Queue<byte[]> inbox = new Queue<byte[]>();
        static readonly AutoResetEvent inboxEvent = new AutoResetEvent(false);
        static volatile bool readerDead;

        public static void Start()
        {
            worker = new Thread(Loop);
            worker.IsBackground = true;
            worker.Start();
        }

        public static void Stop() { stop = true; }

        static void SetSnap(bool ok, double battery, int charge, string note, string pid)
        {
            lock (snapLock)
            {
                snapOk = ok; snapBattery = battery; snapCharge = charge; snapNote = note; snapPid = pid;
                snapTime = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds; // time of the last report, answering or not
            }
        }

        public static string Json()
        {
            lock (snapLock)
            {
                StringBuilder sb = new StringBuilder();
                sb.Append("{\"ok\":").Append(snapOk ? "true" : "false");
                if (snapOk)
                {
                    sb.Append(",\"battery\":").Append(snapBattery.ToString("0.0", CultureInfo.InvariantCulture));
                    sb.Append(",\"charging\":").Append(snapCharge == 1 ? "true" : "false");
                    sb.Append(",\"t\":").Append(snapTime);
                }
                sb.Append(",\"pid\":\"").Append(Helper.Esc(snapPid)).Append("\",\"note\":\"").Append(Helper.Esc(snapNote)).Append("\"}");
                return sb.ToString();
            }
        }

        static void Tell(string level, string msg)
        {
            if (told.Add(msg)) Helper.Log(level, msg); // each message once
        }

        static List<string> HidPaths()
        {
            List<string> res = new List<string>();
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

        // Opens the receiver's control collection (usage page FF42, usage 0001). Returns INVALID if not there.
        static IntPtr Open(out int inLen, out int outLen, out string pid)
        {
            inLen = 0; outLen = 0; pid = "";
            IntPtr best = INVALID; string bestPath = null; int bestRank = 99;
            foreach (string path in HidPaths())
            {
                string low = path.ToLowerInvariant();
                if (low.IndexOf("vid_1b1c") < 0) continue;
                IntPtr q = CreateFileW(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                if (q == INVALID) continue;
                int usage = 0, page = 0, il = 0, ol = 0;
                try
                {
                    IntPtr pp;
                    if (HidD_GetPreparsedData(q, out pp))
                    {
                        try
                        {
                            byte[] c = new byte[64];
                            if (HidP_GetCaps(pp, c) == 0x110000)
                            {
                                usage = BitConverter.ToUInt16(c, 0); page = BitConverter.ToUInt16(c, 2);
                                il = BitConverter.ToUInt16(c, 4); ol = BitConverter.ToUInt16(c, 6);
                            }
                        }
                        finally { HidD_FreePreparsedData(pp); }
                    }
                }
                finally { CloseHandle(q); }
                int at = low.IndexOf("pid_");
                string p = at >= 0 && low.Length >= at + 8 ? low.Substring(at + 4, 4) : "";
                Tell("info", "Corsair HID collection " + p + " usage " + page.ToString("x4") + "/" + usage.ToString("x4") + " in " + il + " out " + ol);
                int rank = Array.IndexOf(Pids, p);
                if (rank >= 0 && page == 0xFF42 && usage == 1 && ol > 0 && il > 0 && rank < bestRank)
                {
                    bestRank = rank; bestPath = path; pid = p; inLen = il; outLen = ol;
                }
            }
            if (bestPath == null) return INVALID;
            best = CreateFileW(bestPath, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (best == INVALID) Tell("warn", "Cannot open the receiver for reading and writing: error " + Marshal.GetLastWin32Error());
            return best;
        }

        static void ReaderLoop(object state)
        {
            IntPtr h = (IntPtr)state;
            int inLen = (int)readerLen;
            byte[] buf = new byte[inLen];
            while (!stop && !readerDead)
            {
                int n;
                if (!ReadFile(h, buf, inLen, out n, IntPtr.Zero)) break;
                if (n <= 0) continue;
                byte[] copy = new byte[n];
                Array.Copy(buf, copy, n);
                NoteFrame(copy);
                lock (inbox) { inbox.Enqueue(copy); if (inbox.Count > 64) inbox.Dequeue(); }
                inboxEvent.Set();
            }
            readerDead = true;
            inboxEvent.Set();
        }
        static int readerLen;

        // Every distinct input report the receiver sends (also the replies to iCUE's own requests) is logged once,
        // so the log shows how the headset reports charging.
        static readonly Dictionary<string, int> frames = new Dictionary<string, int>();
        static string Hex(byte[] b, int max)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < b.Length && i < max; i++) sb.Append(b[i].ToString("x2"));
            return sb.ToString();
        }
        static void NoteFrame(byte[] f)
        {
            string key = Hex(f, 12);
            lock (frames)
            {
                if (frames.ContainsKey(key)) { frames[key]++; return; }
                if (frames.Count >= 120) return;
                frames[key] = 1;
            }
            Helper.Log("info", "Receiver frame " + key);
        }

        // Sends "02 <route> 02 <cmd>" and waits for the matching reply (01 <route'> .. 00 <lo> <hi>).
        static bool Request(IntPtr h, int outLen, byte route, byte cmd, out byte[] reply)
        {
            reply = null;
            lock (inbox) inbox.Clear();
            inboxEvent.Reset();
            byte[] w = new byte[outLen];
            w[0] = 0x02; w[1] = route; w[2] = 0x02; w[3] = cmd;
            int written;
            if (!WriteFile(h, w, outLen, out written, IntPtr.Zero)) { readerDead = true; return false; }
            DateTime sent = DateTime.UtcNow;
            DateTime end = DateTime.UtcNow.AddMilliseconds(500);
            while (DateTime.UtcNow < end && !readerDead && !stop)
            {
                byte[] r = null;
                lock (inbox) { if (inbox.Count > 0) r = inbox.Dequeue(); }
                if (r == null) { inboxEvent.WaitOne(50); continue; }
                int wantRoute = route == 0x09 ? 1 : 0;
                if (r.Length >= 6 && r[0] == 0x01 && r[1] == wantRoute && r[2] == (cmd == 0x12 || cmd == 0x13 ? cmd : (byte)0x02) && r[3] == 0) { reply = r; if (cmd == 0x10) Helper.Log("info", "Charge request answered in " + (int)(DateTime.UtcNow - sent).TotalMilliseconds + " ms"); return true; }
            }
            return true; // sent fine, just no usable answer
        }

        // Diagnostic: reads every low property id once to find which ones answer, then re-reads the ones
        // that did and logs each change, so plugging the cable in shows which property carries "charging".
        static readonly Dictionary<int, string> probeSeen = new Dictionary<int, string>();
        static List<int> probeIds = null;
        static void ProbeProperties(IntPtr h, int outLen)
        {
            bool first = probeIds == null;
            List<int> ids = new List<int>();
            if (first) { probeIds = new List<int>(new int[] { 0x02, 0x03, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x3a, 0x46, 0x47, 0x48, 0x53 }); }
            ids = probeIds;
            foreach (int id in ids.ToArray())
            {
                if (stop || readerDead) return;
                byte[] r = null;
                lock (inbox) inbox.Clear();
                inboxEvent.Reset();
                byte[] w = new byte[outLen];
                w[0] = 0x02; w[1] = 0x09; w[2] = 0x02; w[3] = (byte)id;
                int written;
                if (!WriteFile(h, w, outLen, out written, IntPtr.Zero)) { readerDead = true; return; }
                DateTime end = DateTime.UtcNow.AddMilliseconds(first ? 200 : 400);
                while (DateTime.UtcNow < end && r == null)
                {
                    byte[] f = null;
                    lock (inbox) { if (inbox.Count > 0) f = inbox.Dequeue(); }
                    if (f == null) { inboxEvent.WaitOne(30); continue; }
                    if (f.Length >= 6 && f[0] == 0x01 && f[1] == 1 && f[2] == 0x02) r = f;
                }
                if (r == null) continue;
                string hex = Hex(r, 10);
                string old;
                if (!probeSeen.TryGetValue(id, out old) || old != hex)
                {
                    probeSeen[id] = hex;
                    Helper.Log("info", "Probe property " + id.ToString("x2") + (old == null ? ": " : " changed " + old + " -> ") + hex);
                }
            }
        }

        // The receiver also sends iCUE's own replies to us, and a reply does not say which property it answers.
        // So a value only counts when two requests in a row give the same answer.
        static double okBat = -1;
        static int okCharge = 0;
        static double ReadBatteryStable(IntPtr h, int outLen)
        {
            double a = ReadBattery(h, outLen);
            if (a < 0) return -1;
            if (okBat >= 0 && Math.Abs(a - okBat) <= 1.5) { okBat = a; return a; } // same as the last confirmed reading: one read is enough
            for (int i = 0; i < 3; i++)
            {
                double b = ReadBattery(h, outLen);
                if (b >= 0 && Math.Abs(a - b) <= 1.5) { okBat = b; return b; }
                if (b >= 0) a = b;
            }
            return -1;
        }

        static int ReadChargeStable(IntPtr h, int outLen, out byte[] lastReply, bool trust)
        {
            lastReply = null;
            int prev = 0;
            for (int i = 0; i < 5; i++)
            {
                byte[] r;
                Request(h, outLen, 0x09, 0x10, out r);
                if (r == null) continue;
                lastReply = r;
                int v = r[3] == 0 && r[5] == 0 ? r[4] : 0;
                if (v != 1 && v != 2) { prev = 0; continue; }
                if (trust) { okCharge = v; return v; } // iCUE's battery value just changed, which backs this answer up
                if (v == okCharge) return v; // same as the last confirmed answer: one read is enough
                if (prev == v) { okCharge = v; return v; } // a change must be seen twice
                prev = v;
            }
            return 0;
        }

        static double ReadBattery(IntPtr h, int outLen)
        {
            byte[] r;
            Request(h, outLen, 0x09, 0x0F, out r);
            if (r == null) return -1;
            int v = r[4] | (r[5] << 8);
            return v >= 1 && v <= 1000 ? v / 10.0 : -1;
        }

        // logs every Corsair HID collection once (also ones that appear later, e.g. when the headset is plugged in by cable)
        static void ScanDiagnostics()
        {
            foreach (string path in HidPaths())
            {
                string low = path.ToLowerInvariant();
                if (low.IndexOf("vid_1b1c") < 0) continue;
                IntPtr q = CreateFileW(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                if (q == INVALID) continue;
                int usage = 0, page = 0, il = 0, ol = 0;
                try
                {
                    IntPtr pp;
                    if (HidD_GetPreparsedData(q, out pp))
                    {
                        try
                        {
                            byte[] c = new byte[64];
                            if (HidP_GetCaps(pp, c) == 0x110000)
                            {
                                usage = BitConverter.ToUInt16(c, 0); page = BitConverter.ToUInt16(c, 2);
                                il = BitConverter.ToUInt16(c, 4); ol = BitConverter.ToUInt16(c, 6);
                            }
                        }
                        finally { HidD_FreePreparsedData(pp); }
                    }
                }
                finally { CloseHandle(q); }
                int at = low.IndexOf("pid_");
                string p = at >= 0 && low.Length >= at + 8 ? low.Substring(at + 4, 4) : "";
                Tell("info", "Corsair HID collection " + p + " usage " + page.ToString("x4") + "/" + usage.ToString("x4") + " in " + il + " out " + ol);
            }
        }

        static void Sleep(int ms)
        {
            DateTime end = DateTime.UtcNow.AddMilliseconds(ms);
            while (!stop && DateTime.UtcNow < end) Thread.Sleep(100);
        }

        static void Loop()
        {
            while (!stop)
            {
                int inLen, outLen; string pid;
                IntPtr h;
                try { h = Open(out inLen, out outLen, out pid); }
                catch (Exception ex) { SetSnap(false, 0, 0, "scan failed: " + ex.Message, ""); Sleep(10000); continue; }
                if (h == INVALID)
                {
                    SetSnap(false, 0, 0, "receiver not found", "");
                    Sleep(10000);
                    continue;
                }
                Tell("info", "Reading charging state from the receiver " + pid + " (input " + inLen + ", output " + outLen + ")");
                readerDead = false; readerLen = inLen;
                Thread rt = new Thread(ReaderLoop);
                rt.IsBackground = true;
                rt.Start(h);
                int lastCharge = 0; double lastBattery = -2; int sinceBat = 99;
                while (!stop && !readerDead)
                {
                    try
                    {
                        // The receiver answers about one request every 24 s, so every request costs time. Charge state first (it is what
                        // changes); the battery level only every 5th round, or when the charge state changed.
                        bool trust = trustNext; trustNext = false;
                        byte[] r2;
                        int charge = ReadChargeStable(h, outLen, out r2, trust);
                        double bat = -1;
                        if (charge != 0 && okBat >= 0 && charge == lastCharge && sinceBat < 4) { bat = okBat; sinceBat++; }
                        else
                        {
                            bat = ReadBatteryStable(h, outLen);
                            if (bat < 0)
                            {
                                // wake handshake (receiver firmware query, receiver and headset heartbeat), then ask again
                                byte[] ignore;
                                Request(h, outLen, 0x08, 0x13, out ignore);
                                Request(h, outLen, 0x08, 0x12, out ignore);
                                Request(h, outLen, 0x09, 0x12, out ignore);
                                bat = ReadBatteryStable(h, outLen);
                            }
                            sinceBat = 0;
                        }
                        if (bat < 0) SetSnap(false, 0, 0, "headset not answering (asleep or off)", pid);
                        else
                        {
                            if (r2 == null) Tell("warn", "No usable reply to the charge request (02 09 02 10); see the 'Receiver frame' lines");
                            SetSnap(true, bat, charge, "ok", pid);
                            if (charge != lastCharge || Math.Abs(bat - lastBattery) >= 0.5)
                            {
                                Helper.Log("info", "Receiver: battery " + bat.ToString("0.0", CultureInfo.InvariantCulture) + ", charge reply " + (r2 != null ? Hex(r2, 8) : "none") + ", charge flag " + charge + (charge == 1 ? " (charging)" : charge == 2 ? " (on battery)" : " (unknown)") + (trust ? " [trusted: battery value changed]" : ""));
                                lastCharge = charge; lastBattery = bat;
                            }
                        }
                    }
                    catch (Exception ex) { Helper.Log("warn", "Receiver read failed: " + ex.Message); readerDead = true; }
                    try { ScanDiagnostics(); } catch (Exception) { }
                    int wait = PollSeconds * 1000;
                    int waited = 0;
                    int before = PollSeconds;
                    while (!stop && !readerDead && !CheckNow && waited < wait && PollSeconds == before) { Thread.Sleep(100); waited += 100; }
                    if (CheckNow) trustNext = true;
                    CheckNow = false;
                }
                try { CancelIoEx(h, IntPtr.Zero); } catch (Exception) { }
                try { CloseHandle(h); } catch (Exception) { }
                if (!stop) { SetSnap(false, 0, 0, "receiver connection lost, retrying", pid); Sleep(3000); }
            }
        }
    }

    public static class Helper
    {
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        public delegate void StateCb(IntPtr context, IntPtr data);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        public delegate void EventCb(IntPtr context, IntPtr ev);
        static EventCb eventKeep;
        static bool subscribed = false;
        static readonly Dictionary<string, bool> connectedMap = new Dictionary<string, bool>();
        [DllImport("iCUESDK.x64_2019.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int CorsairSubscribeForEvents(EventCb cb, IntPtr context);

        // iCUE tells us when a device connects or disconnects (the headset going off or on). CorsairEvent: int id at 0,
        // data pointer at 8; id 1 = device connection changed, whose data is char deviceId[128] then bool isConnected.
        static void OnEvent(IntPtr context, IntPtr ev)
        {
            try
            {
                if (ev == IntPtr.Zero) return;
                int evId = Marshal.ReadInt32(ev, 0);
                if (evId != 1) { Log("info", "iCUE event " + evId + " (not a connection change)"); return; }
                Log("info", "iCUE event 1 (connection change)");
                IntPtr data = Marshal.ReadIntPtr(ev, 8);
                if (data == IntPtr.Zero) return;
                byte[] id = new byte[128];
                Marshal.Copy(data, id, 0, 128);
                string text = CString(id, 0);
                bool on = Marshal.ReadByte(data, 128) != 0;
                lock (connectedMap) connectedMap[text] = on;
                Log("info", "Device " + (on ? "connected: " : "disconnected: ") + text);
            }
            catch (Exception) { }
        }
        static void Subscribe()
        {
            if (subscribed) return;
            try
            {
                eventKeep = OnEvent;
                int e = CorsairSubscribeForEvents(eventKeep, IntPtr.Zero);
                if (e == 0) subscribed = true; else Log("warn", "CorsairSubscribeForEvents returned " + e);
            }
            catch (Exception ex) { Log("warn", "Cannot subscribe to device events: " + ex.Message); }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetDllDirectory(string path);
        [DllImport("iCUESDK.x64_2019.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int CorsairConnect(StateCb cb, IntPtr context);
        [DllImport("iCUESDK.x64_2019.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int CorsairDisconnect();
        [DllImport("iCUESDK.x64_2019.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int CorsairGetSessionDetails(IntPtr details);
        [DllImport("iCUESDK.x64_2019.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int CorsairGetDevices(IntPtr filter, int sizeMax, IntPtr devices, out int size);
        [DllImport("iCUESDK.x64_2019.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int CorsairReadDeviceProperty(byte[] deviceId, int propertyId, uint index, IntPtr property);
        [DllImport("iCUESDK.x64_2019.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int CorsairFreeProperty(IntPtr property);

        // CorsairDeviceInfo: int type, char id[128], char serial[128], char model[128], int ledCount, int channelCount
        const int DeviceSize = 396;
        const int MaxDevices = 32;

        // CorsairDevicePropertyId values we read
        const int PropPropertyArray = 1;
        const int PropMic = 2;
        const int PropBattery = 9;

        static StateCb keepAlive;
        static volatile int sessionState = 1;
        static volatile bool rescanRequested = false;
        static volatile bool stopRequested = false;
        static readonly object outLock = new object();

        static void Write(string line)
        {
            lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
        }

        public static string Esc(string s)
        {
            if (s == null) return "";
            StringBuilder b = new StringBuilder();
            foreach (char c in s)
            {
                if (c == '\\') b.Append("\\\\");
                else if (c == '"') b.Append("\\\"");
                else if (c < 32) b.Append(' ');
                else b.Append(c);
            }
            return b.ToString();
        }

        public static void Log(string level, string msg)
        {
            Write("{\"type\":\"log\",\"level\":\"" + level + "\",\"msg\":\"" + Esc(msg) + "\"}");
        }

        static string CString(byte[] b, int offset)
        {
            int n = 0;
            while (n < 128 && b[offset + n] != 0) n++;
            return Encoding.UTF8.GetString(b, offset, n);
        }

        static string Version(IntPtr p, int offset)
        {
            return Marshal.ReadInt32(p, offset) + "." + Marshal.ReadInt32(p, offset + 4) + "." + Marshal.ReadInt32(p, offset + 8);
        }

        // Reads one property. Returns null on error (errorCode set), otherwise "true"/"false"/number text.
        static string ReadProp(byte[] id, int prop, out int errorCode, List<int> arrayOut)
        {
            IntPtr p = Marshal.AllocHGlobal(64);
            try
            {
                for (int i = 0; i < 64; i++) Marshal.WriteByte(p, i, 0);
                errorCode = CorsairReadDeviceProperty(id, prop, 0, p);
                if (errorCode != 0) return null;
                int type = Marshal.ReadInt32(p, 0);
                string result = null;
                if (type == 0) result = Marshal.ReadByte(p, 8) != 0 ? "true" : "false";
                else if (type == 1) result = Marshal.ReadInt32(p, 8).ToString(CultureInfo.InvariantCulture);
                else if (type == 17 && arrayOut != null)
                {
                    IntPtr items = Marshal.ReadIntPtr(p, 8);
                    int count = (int)Marshal.ReadInt32(p, 16);
                    if (count > 64) count = 64;
                    for (int i = 0; i < count; i++) arrayOut.Add(Marshal.ReadInt32(items, i * 4));
                    result = "array";
                }
                else result = "unsupported-type-" + type;
                CorsairFreeProperty(p);
                return result;
            }
            finally { Marshal.FreeHGlobal(p); }
        }

        static void AddProp(StringBuilder props, ref bool first, string name, string value)
        {
            if (value == null) return;
            if (!first) props.Append(',');
            first = false;
            props.Append('"').Append(name).Append("\":").Append(value);
        }

        static string BuildState()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"type\":\"state\",\"session\":").Append(sessionState);
            string icue = "";
            string sdk = "";
            IntPtr det = Marshal.AllocHGlobal(36);
            try
            {
                for (int i = 0; i < 36; i++) Marshal.WriteByte(det, i, 0);
                if (CorsairGetSessionDetails(det) == 0)
                {
                    sdk = Version(det, 0);
                    icue = Version(det, 24);
                }
            }
            catch (Exception) { }
            finally { Marshal.FreeHGlobal(det); }
            sb.Append(",\"icue\":\"").Append(Esc(icue)).Append("\",\"sdk\":\"").Append(Esc(sdk)).Append("\",\"devices\":[");
            if (sessionState == 6)
            {
                IntPtr buf = Marshal.AllocHGlobal(DeviceSize * MaxDevices);
                IntPtr filter = Marshal.AllocHGlobal(4);
                try
                {
                    Marshal.WriteInt32(filter, -1);
                    int size;
                    int err = CorsairGetDevices(filter, MaxDevices, buf, out size);
                    if (err != 0) size = 0;
                    bool firstDev = true;
                    for (int d = 0; d < size; d++)
                    {
                        byte[] b = new byte[DeviceSize];
                        Marshal.Copy(IntPtr.Add(buf, d * DeviceSize), b, 0, DeviceSize);
                        int kind = BitConverter.ToInt32(b, 0);
                        string idText = CString(b, 4);
                        string model = CString(b, 4 + 256);
                        byte[] idBytes = new byte[128];
                        byte[] raw = Encoding.UTF8.GetBytes(idText);
                        Array.Copy(raw, idBytes, Math.Min(raw.Length, 127));
                        int e;
                        List<int> supported = new List<int>();
                        ReadProp(idBytes, PropPropertyArray, out e, supported);
                        StringBuilder props = new StringBuilder();
                        bool firstProp = true;
                        AddProp(props, ref firstProp, "battery", ReadProp(idBytes, PropBattery, out e, null));
                        AddProp(props, ref firstProp, "mic", ReadProp(idBytes, PropMic, out e, null));
                        if (!firstDev) sb.Append(',');
                        firstDev = false;
                        sb.Append("{\"id\":\"").Append(Esc(idText)).Append("\",\"model\":\"").Append(Esc(model));
                        sb.Append("\",\"kind\":").Append(kind).Append(",\"supported\":[");
                        for (int i = 0; i < supported.Count; i++)
                        {
                            if (i > 0) sb.Append(',');
                            sb.Append(supported[i]);
                        }
                        string conn = "";
                        lock (connectedMap) { bool cv; if (connectedMap.TryGetValue(idText, out cv)) conn = ",\"connected\":" + (cv ? "true" : "false"); }
                        sb.Append("],\"props\":{").Append(props.ToString()).Append("}").Append(conn).Append("}");
                    }
                }
                finally { Marshal.FreeHGlobal(buf); Marshal.FreeHGlobal(filter); }
            }
            sb.Append("],\"hid\":").Append(Receiver.Json()).Append(",\"tray\":").Append(TrayJson()).Append("}");
            return sb.ToString();
        }

        // The tray reader is compiled separately (helper.ps1), so it is looked up by name; no tray reader means an empty list.
        static System.Reflection.MethodInfo trayMethod = null;
        static bool trayLooked = false;
        static string TrayJson()
        {
            try
            {
                if (trayMethod == null && !trayLooked)
                {
                    foreach (System.Reflection.Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
                    {
                        Type t = null;
                        try { t = asm.GetType("IcueBattery.Tray", false); } catch (Exception) { }
                        if (t != null) { trayMethod = t.GetMethod("Json"); break; }
                    }
                    if (trayMethod == null) return "[]"; // may still be starting: look again next time
                    trayLooked = true;
                }
                if (trayMethod == null) return "[]";
                string r = trayMethod.Invoke(null, null) as string;
                return string.IsNullOrEmpty(r) ? "[]" : r;
            }
            catch (Exception) { return "[]"; }
        }

        static void StdinLoop()
        {
            try
            {
                StreamReader r = new StreamReader(Console.OpenStandardInput());
                string line;
                while ((line = r.ReadLine()) != null)
                {
                    string cmd = line.Trim();
                    if (cmd == "rescan") rescanRequested = true;
                    else if (cmd == "now") Receiver.CheckNow = true;
                    else if (cmd.StartsWith("poll "))
                    {
                        int sec;
                        if (int.TryParse(cmd.Substring(5), out sec) && sec >= 2 && sec <= 600) Receiver.PollSeconds = sec;
                    }
                }
            }
            catch (Exception) { }
            stopRequested = true; // the plugin closed our input: exit
        }

        static void Connect()
        {
            int e = CorsairConnect(keepAlive, IntPtr.Zero);
            if (e != 0) Log("warn", "CorsairConnect returned " + e);
        }

        public static void Run(string dllDir)
        {
            SetDllDirectory(dllDir);
            keepAlive = delegate(IntPtr context, IntPtr data)
            {
                try { sessionState = Marshal.ReadInt32(data); } catch (Exception) { }
            };
            Receiver.Start();
            Thread t = new Thread(StdinLoop);
            t.IsBackground = true;
            t.Start();
            Connect();
            string last = "";
            int sinceEmit = 0;
            int sinceConnect = 0;
            int lastState = -1;
            while (!stopRequested)
            {
                if (rescanRequested)
                {
                    rescanRequested = false;
                    try { CorsairDisconnect(); } catch (Exception) { }
                    sessionState = 1;
                    Thread.Sleep(300);
                    Connect();
                    sinceConnect = 0;
                    last = "";
                }
                string json;
                try { json = BuildState(); }
                catch (Exception ex) { Log("error", "Read failed: " + ex.Message); json = null; }
                if (json != null && (json != last || sinceEmit >= 15))
                {
                    Write(json);
                    last = json;
                    sinceEmit = 0;
                }
                if (sessionState != lastState) { Log("info", "iCUE session state " + sessionState); lastState = sessionState; }
                if (sessionState == 6) Subscribe(); else if (sessionState != 2) { subscribed = false; lock (connectedMap) connectedMap.Clear(); }
                // not connected for a while (iCUE closed, or SDK switched off): start the connection again
                if (sessionState != 6 && sessionState != 2) sinceConnect++; else sinceConnect = 0;
                if (sinceConnect >= 20)
                {
                    sinceConnect = 0;
                    try { CorsairDisconnect(); } catch (Exception) { }
                    Thread.Sleep(300);
                    Connect();
                }
                for (int i = 0; i < 10 && !stopRequested && !rescanRequested; i++) Thread.Sleep(100);
                sinceEmit++;
            }
            Receiver.Stop();
            try { CorsairDisconnect(); } catch (Exception) { }
        }
    }
}
