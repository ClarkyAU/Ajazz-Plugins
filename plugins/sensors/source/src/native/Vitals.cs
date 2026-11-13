// System Vitals collector for the Ajazz / Stream Dock plugin.
//
// Compiled at runtime by Windows PowerShell 5.1 (Add-Type), so this file must
// stay within C# 5 and only use mscorlib + System.dll (no LINQ).
//
// Every source is optional and wrapped in try/catch: a PC without an NVIDIA
// or AMD card, without a battery, or with counters disabled still gets every
// other reading. Output is one JSON object per line.
//
// Sources (all built into Windows or the graphics driver, nothing installed):
//   PDH performance counters (English names, so any Windows language works)
//   D3DKMT (the same GPU data Task Manager shows, incl. temperature on WDDM 2.9+)
//   NVIDIA NVML (nvml.dll ships with the NVIDIA driver)
//   AMD ADL (atiadlxx.dll ships with the AMD driver)
//   HWiNFO shared memory, if the user runs HWiNFO with shared memory enabled
//   LibreHardwareMonitor / OpenHardwareMonitor WMI (read by the PowerShell side)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace SysVitals
{
    // ------------------------------------------------------------------ JSON
    public class Json
    {
        private readonly StringBuilder b = new StringBuilder(4096);
        private readonly Stack<bool> first = new Stack<bool>();
        private bool afterKey;

        private void Sep()
        {
            if (afterKey) { afterKey = false; return; }
            if (first.Count == 0) return;
            if (first.Peek()) { first.Pop(); first.Push(false); }
            else b.Append(',');
        }
        private readonly Stack<char> closers = new Stack<char>();
        public Json O() { Sep(); b.Append('{'); first.Push(true); closers.Push('}'); return this; }
        public Json A() { Sep(); b.Append('['); first.Push(true); closers.Push(']'); return this; }
        public Json End() { b.Append(closers.Pop()); first.Pop(); return this; }
        // Appends ready-made JSON text as one value.
        public Json Raw(string json) { Sep(); b.Append(json); return this; }
        public Json K(string k) { Sep(); Esc(k); b.Append(':'); afterKey = true; return this; }
        public Json S(string s) { Sep(); if (s == null) b.Append("null"); else Esc(s); return this; }
        public Json N(double v)
        {
            Sep();
            if (double.IsNaN(v) || double.IsInfinity(v)) b.Append("null");
            else b.Append(v.ToString("0.###", CultureInfo.InvariantCulture));
            return this;
        }
        public Json B(bool v) { Sep(); b.Append(v ? "true" : "false"); return this; }
        public Json Null() { Sep(); b.Append("null"); return this; }
        public Json P(string k, string v) { return K(k).S(v); }
        public Json P(string k, double v) { return K(k).N(v); }
        public Json P(string k, bool v) { return K(k).B(v); }
        private void Esc(string s)
        {
            b.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': b.Append("\\\""); break;
                    case '\\': b.Append("\\\\"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default:
                        if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4"));
                        else b.Append(c);
                        break;
                }
            }
            b.Append('"');
        }
        public override string ToString() { return b.ToString(); }
    }

    // ------------------------------------------------------------------ Native helpers
    internal static class Native
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr LoadLibraryW(string path);
        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        public static extern IntPtr GetProcAddress(IntPtr module, string name);
        [DllImport("kernel32.dll")]
        public static extern ulong GetTickCount64();
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);
        [DllImport("kernel32.dll")]
        public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr OpenFileMappingW(uint access, bool inherit, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr MapViewOfFile(IntPtr h, uint access, uint offHigh, uint offLow, UIntPtr bytes);
        [DllImport("kernel32.dll")]
        public static extern bool UnmapViewOfFile(IntPtr p);
        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential)]
        public struct MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SYSTEM_POWER_STATUS
        {
            public byte ACLineStatus;
            public byte BatteryFlag;
            public byte BatteryLifePercent;
            public byte SystemStatusFlag;
            public int BatteryLifeTime;
            public int BatteryFullLifeTime;
        }

        public static T Fn<T>(IntPtr module, string name) where T : class
        {
            if (module == IntPtr.Zero) return null;
            IntPtr p = GetProcAddress(module, name);
            if (p == IntPtr.Zero) return null;
            return Marshal.GetDelegateForFunctionPointer(p, typeof(T)) as T;
        }

        public static IntPtr Alloc(int size)
        {
            IntPtr p = Marshal.AllocHGlobal(size);
            for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
            return p;
        }
    }

    // ------------------------------------------------------------------ PDH (performance counters)
    internal class Pdh
    {
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
        static extern uint PdhOpenQueryW(string source, IntPtr user, out IntPtr query);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
        static extern uint PdhAddEnglishCounterW(IntPtr query, string path, IntPtr user, out IntPtr counter);
        [DllImport("pdh.dll")]
        static extern uint PdhCollectQueryData(IntPtr query);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
        static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint bufferSize, out uint itemCount, IntPtr buffer);
        [DllImport("pdh.dll")]
        static extern uint PdhCloseQuery(IntPtr query);

        const uint FMT = 0x200 | 0x8000; // PDH_FMT_DOUBLE | PDH_FMT_NOCAP100
        const uint PDH_MORE_DATA = 0x800007D2;

        private IntPtr query = IntPtr.Zero;
        private readonly Dictionary<string, IntPtr> counters = new Dictionary<string, IntPtr>();
        public readonly List<string> Failed = new List<string>();
        public int Collections;
        public readonly DateTime Created = DateTime.UtcNow;

        public Pdh(string[] defs)
        {
            uint st = PdhOpenQueryW(null, IntPtr.Zero, out query);
            if (st != 0) { query = IntPtr.Zero; throw new Exception("PdhOpenQuery failed 0x" + st.ToString("X8")); }
            for (int i = 0; i + 1 < defs.Length; i += 2)
            {
                IntPtr c;
                st = PdhAddEnglishCounterW(query, defs[i + 1], IntPtr.Zero, out c);
                if (st == 0) counters[defs[i]] = c;
                else Failed.Add(defs[i] + " 0x" + st.ToString("X8"));
            }
        }

        public bool Has(string name) { return counters.ContainsKey(name); }
        public int Count { get { return counters.Count; } }

        public void Collect()
        {
            if (query == IntPtr.Zero) return;
            PdhCollectQueryData(query);
            Collections++;
        }

        // Rate counters need two collections before they hold a value.
        public bool Warm { get { return Collections >= 2; } }

        public List<KeyValuePair<string, double>> Values(string name)
        {
            List<KeyValuePair<string, double>> list = new List<KeyValuePair<string, double>>();
            IntPtr c;
            if (query == IntPtr.Zero || !counters.TryGetValue(name, out c)) return list;
            uint size = 0, count = 0;
            uint st = PdhGetFormattedCounterArrayW(c, FMT, ref size, out count, IntPtr.Zero);
            if (st != PDH_MORE_DATA || size == 0) return list;
            IntPtr buf = Marshal.AllocHGlobal((int)size);
            try
            {
                st = PdhGetFormattedCounterArrayW(c, FMT, ref size, out count, buf);
                if (st != 0) return list;
                int ps = IntPtr.Size;
                int item = ps == 8 ? 24 : 16;
                int vOff = ps == 8 ? 16 : 8;
                for (int i = 0; i < count; i++)
                {
                    int off = i * item;
                    IntPtr namePtr = Marshal.ReadIntPtr(buf, off);
                    int cs = Marshal.ReadInt32(buf, off + ps);
                    if (cs != 0 && cs != 1) continue; // PDH_CSTATUS_VALID_DATA / NEW_DATA
                    double v = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(buf, off + vOff));
                    string n = namePtr == IntPtr.Zero ? "" : Marshal.PtrToStringUni(namePtr);
                    list.Add(new KeyValuePair<string, double>(n ?? "", v));
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            return list;
        }

        public double Single(string name)
        {
            List<KeyValuePair<string, double>> l = Values(name);
            return l.Count > 0 ? l[0].Value : double.NaN;
        }

        public void Close()
        {
            if (query != IntPtr.Zero) PdhCloseQuery(query);
            query = IntPtr.Zero;
            counters.Clear();
        }
    }

    // ------------------------------------------------------------------ Data holders
    public class GpuInfo
    {
        public string Id;          // LUID "HIGH_LOW" in hex, matches the counter instance names
        public string Name = "";
        public string Vendor = "";  // nvidia / amd / intel / other
        public int Bus = -1;
        public bool Integrated;
        public double DedTotal = double.NaN;
        public double ShrTotal = double.NaN;
        public uint Handle;         // D3DKMT adapter handle (kept open while enumerated)
        public bool PerfOk = true;

        // latest readings
        public double Util = double.NaN, Ded = double.NaN, Shr = double.NaN;
        public double Temp = double.NaN, Hot = double.NaN, MemTemp = double.NaN;
        public double Power = double.NaN, PowerLimit = double.NaN, PowerPct = double.NaN;
        public double Fan = double.NaN, FanPct = double.NaN, Clock = double.NaN, MemClock = double.NaN;
        public string TempSrc = "";
        public void ClearSensors()
        {
            Temp = Hot = MemTemp = Power = PowerLimit = PowerPct = Fan = FanPct = Clock = MemClock = double.NaN;
            TempSrc = "";
        }
    }

    public class NetState
    {
        public string Id, Name, Desc, Kind;
        public bool Up, Virt, Gw;
        public double Speed;
        public string Ip = "";
        public long LastRx = -1, LastTx = -1;
        public double Rx = double.NaN, Tx = double.NaN;
        public bool Seen;
    }

    public class SensorReading
    {
        public string Id, Hw, Name, Type, Unit;
        public double Value;
    }

    // ------------------------------------------------------------------ Collector
    public class Collector
    {
        private Pdh main, gpuQ, procQ;
        private readonly List<string> outLines = new List<string>();
        private readonly HashSet<string> loggedOnce = new HashSet<string>();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private long tick;

        // demand flags (set by the plugin from what the keys show)
        public bool NeedGpu = true, NeedTop, NeedSensors;
        public bool UseHwinfo = true, UseWmi = true; // which sensor apps to read (from the Setup key)
        public int IntervalMs = 1000;

        // static info
        private string cpuName = "", cpuVendor = "";
        private double baseMhz = double.NaN;
        private int threads = Environment.ProcessorCount;
        private bool useUtility = true;

        private readonly List<GpuInfo> gpus = new List<GpuInfo>();
        private DateTime gpuEnumAt = DateTime.MinValue;
        private bool kmtOk = true;
        private readonly Dictionary<string, NetState> nets = new Dictionary<string, NetState>();
        private long netLastMs = -1;
        private DateTime netPropsAt = DateTime.MinValue;
        private List<string[]> vols = new List<string[]>();
        private DateTime volsAt = DateTime.MinValue;
        private bool infoDirty = true;

        private readonly Dictionary<string, double> lastTop = new Dictionary<string, double>();
        private string topJson = null;
        private string sensorsJson = null;
        private DateTime sensorsAt = DateTime.MinValue;

        public Collector()
        {
            ReadCpuInfo();
        }

        // ---------------- logging
        private void Log(string level, string msg)
        {
            Json j = new Json();
            j.O().P("type", "log").P("level", level).P("msg", msg).End();
            outLines.Add(j.ToString());
        }
        private void LogOnce(string key, string level, string msg)
        {
            if (loggedOnce.Contains(key)) return;
            loggedOnce.Add(key);
            Log(level, msg);
        }
        public static string LogLine(string level, string msg)
        {
            Json j = new Json();
            j.O().P("type", "log").P("level", level).P("msg", msg).End();
            return j.ToString();
        }

        // ---------------- commands from the plugin, e.g. "need gpu=1 top=0 sensors=1"
        public void Command(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            string[] parts = line.Trim().Split(' ');
            if (parts.Length == 0) return;
            if (parts[0] == "need")
            {
                for (int i = 1; i < parts.Length; i++)
                {
                    string[] kv = parts[i].Split('=');
                    if (kv.Length != 2) continue;
                    bool on = kv[1] == "1" || kv[1] == "true";
                    if (kv[0] == "gpu") NeedGpu = on;
                    else if (kv[0] == "top") NeedTop = on;
                    else if (kv[0] == "sensors") NeedSensors = on;
                    else if (kv[0] == "hwinfo") UseHwinfo = on;
                    else if (kv[0] == "wmi") UseWmi = on;
                }
                if (!NeedTop) { if (procQ != null) procQ.Close(); if (procNext != null) procNext.Close(); procQ = null; procNext = null; topJson = null; }
                if (!NeedSensors || !UseHwinfo) CloseHwinfo();
                if (!NeedSensors) sensorsJson = null;
            }
            else if (parts[0] == "interval" && parts.Length > 1)
            {
                int ms;
                if (int.TryParse(parts[1], out ms)) IntervalMs = Math.Max(250, Math.Min(10000, ms));
            }
        }

        // ---------------- CPU static info
        private void ReadCpuInfo()
        {
            try
            {
                using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0"))
                {
                    if (k != null)
                    {
                        object n = k.GetValue("ProcessorNameString");
                        if (n != null) cpuName = Regex.Replace(n.ToString().Trim(), @"\s+", " ");
                        object m = k.GetValue("~MHz");
                        if (m != null) baseMhz = Convert.ToDouble(m, CultureInfo.InvariantCulture);
                        object v = k.GetValue("VendorIdentifier");
                        string vs = v == null ? "" : v.ToString();
                        if (vs.IndexOf("AMD", StringComparison.OrdinalIgnoreCase) >= 0) cpuVendor = "amd";
                        else if (vs.IndexOf("Intel", StringComparison.OrdinalIgnoreCase) >= 0) cpuVendor = "intel";
                        else if (vs.Length > 0) cpuVendor = vs.ToLowerInvariant();
                    }
                }
            }
            catch (Exception e) { Log("warn", "CPU info: " + e.Message); }
            if (cpuVendor == "" && cpuName.IndexOf("Snapdragon", StringComparison.OrdinalIgnoreCase) >= 0) cpuVendor = "qualcomm";
        }

        // ---------------- PDH queries
        private void OpenMain()
        {
            if (main != null) main.Close();
            main = null;
            try
            {
                main = new Pdh(new string[] {
                    "util", @"\Processor Information(*)\% Processor Utility",
                    "perf", @"\Processor Information(_Total)\% Processor Performance",
                    "ptime", @"\Processor(*)\% Processor Time",
                    "didle", @"\PhysicalDisk(*)\% Idle Time",
                    "drd", @"\PhysicalDisk(*)\Disk Read Bytes/sec",
                    "dwr", @"\PhysicalDisk(*)\Disk Write Bytes/sec",
                    "procs", @"\System\Processes",
                    "threads", @"\System\Threads",
                    "therm", @"\Thermal Zone Information(*)\Temperature"
                });
                useUtility = main.Has("util");
                if (main.Failed.Count > 0) LogOnce("pdhmain:" + string.Join(",", main.Failed.ToArray()), "info", "Counters not available on this PC: " + string.Join(", ", main.Failed.ToArray()));
                main.Collect();
            }
            catch (Exception e) { LogOnce("pdhmain", "error", "Performance counters failed: " + e.Message); main = null; }
        }

        private void OpenGpuQuery()
        {
            if (gpuQ != null) gpuQ.Close();
            gpuQ = null;
            try
            {
                gpuQ = new Pdh(new string[] {
                    "eng", @"\GPU Engine(*)\Utilization Percentage",
                    "ded", @"\GPU Adapter Memory(*)\Dedicated Usage",
                    "shr", @"\GPU Adapter Memory(*)\Shared Usage"
                });
                if (gpuQ.Failed.Count > 0) LogOnce("pdhgpu", "info", "GPU counters not available: " + string.Join(", ", gpuQ.Failed.ToArray()));
                gpuQ.Collect();
            }
            catch (Exception e) { LogOnce("pdhgpu2", "warn", "GPU counters failed: " + e.Message); gpuQ = null; }
        }

        private void OpenProcQuery()
        {
            if (procQ != null) procQ.Close();
            procQ = null;
            try
            {
                procQ = new Pdh(new string[] {
                    "cpu", @"\Process(*)\% Processor Time",
                    "mem", @"\Process(*)\Working Set - Private"
                });
                procQ.Collect();
            }
            catch (Exception e) { LogOnce("pdhproc", "warn", "Process counters failed: " + e.Message); procQ = null; }
        }

        // ---------------- main entry: one sample
        public string[] Tick()
        {
            tick++;
            try
            {
                if (main == null || (DateTime.UtcNow - main.Created).TotalMinutes > 30) OpenMain();
                else main.Collect();
            }
            catch (Exception e) { LogOnce("collect", "warn", "Collect failed: " + e.Message); }

            if (NeedGpu)
            {
                try
                {
                    // The GPU engine list changes as apps start and stop; rebuilding the
                    // query now and then keeps new apps counted.
                    if (gpuQ == null || (DateTime.UtcNow - gpuQ.Created).TotalSeconds > 30) { GpuQueryFlip(); }
                    else gpuQ.Collect();
                }
                catch (Exception e) { LogOnce("gpuq", "warn", "GPU counters: " + e.Message); }
                if (gpus.Count == 0 || (DateTime.UtcNow - gpuEnumAt).TotalMinutes > 5) EnumGpus();
            }
            else if (gpus.Count == 0 && gpuEnumAt == DateTime.MinValue) EnumGpus();

            if (NeedTop)
            {
                try
                {
                    if (procQ == null || (DateTime.UtcNow - procQ.Created).TotalSeconds > 30) ProcQueryFlip();
                    else procQ.Collect();
                }
                catch (Exception e) { LogOnce("procq", "warn", "Process counters: " + e.Message); }
            }

            if (infoDirty) { outLines.Add(InfoJson()); infoDirty = false; }

            Json j = new Json();
            j.O().P("type", "sample").P("ms", (double)clock.ElapsedMilliseconds);
            Safe(j, "cpu", WriteCpu);
            Safe(j, "mem", WriteMem);
            if (NeedGpu) Safe(j, "gpu", WriteGpus);
            Safe(j, "disk", WriteDisks);
            Safe(j, "vol", WriteVols);
            Safe(j, "net", WriteNets);
            Safe(j, "sys", WriteSys);
            Safe(j, "bat", WriteBattery);
            if (NeedTop) Safe(j, "top", WriteTop);
            if (NeedSensors) Safe(j, "sensors", WriteSensors);
            if (NeedSensors) Safe(j, "apps", WriteApps);
            j.End();
            outLines.Add(j.ToString());

            string[] res = outLines.ToArray();
            outLines.Clear();
            return res;
        }

        // A rebuilt query needs a second collection before rates exist; keep the old
        // query running until the new one is warm.
        private Pdh gpuNext, procNext;
        private void GpuQueryFlip()
        {
            if (gpuQ == null) { OpenGpuQuery(); return; }
            gpuQ.Collect();
            if (gpuNext == null)
            {
                Pdh keep = gpuQ; gpuQ = null; OpenGpuQuery(); gpuNext = gpuQ; gpuQ = keep;
                return;
            }
            gpuNext.Collect();
            if (gpuNext.Warm) { gpuQ.Close(); gpuQ = gpuNext; gpuNext = null; }
        }
        private void ProcQueryFlip()
        {
            if (procQ == null) { OpenProcQuery(); return; }
            procQ.Collect();
            if (procNext == null)
            {
                Pdh keep = procQ; procQ = null; OpenProcQuery(); procNext = procQ; procQ = keep;
                return;
            }
            procNext.Collect();
            if (procNext.Warm) { procQ.Close(); procQ = procNext; procNext = null; }
        }

        // Each section writes into its own buffer so a failure halfway through
        // cannot leave broken JSON behind.
        private delegate void Part(Json j);
        private void Safe(Json parent, string name, Part s)
        {
            try
            {
                Json part = new Json();
                s(part);
                string text = part.ToString();
                if (text.Length > 0) parent.Raw(text);
            }
            catch (Exception e) { LogOnce("sec:" + name + ":" + e.GetType().Name, "warn", "Reading " + name + " failed: " + e.GetType().Name + ": " + e.Message); }
        }

        // ---------------- info
        private string InfoJson()
        {
            Json j = new Json();
            j.O().P("type", "info");
            j.K("cpu").O().P("name", cpuName).P("vendor", cpuVendor).P("threads", threads).P("baseMhz", baseMhz).End();
            j.K("gpus").A();
            foreach (GpuInfo g in gpus)
            {
                j.O().P("id", g.Id).P("name", g.Name).P("vendor", g.Vendor).P("bus", g.Bus).P("integrated", g.Integrated)
                    .P("dedTotal", g.DedTotal).P("shrTotal", g.ShrTotal).End();
            }
            j.End();
            Native.MEMORYSTATUSEX m = new Native.MEMORYSTATUSEX();
            m.dwLength = (uint)Marshal.SizeOf(typeof(Native.MEMORYSTATUSEX));
            double total = double.NaN;
            try { if (Native.GlobalMemoryStatusEx(ref m)) total = m.ullTotalPhys; } catch { }
            j.P("memTotal", total);
            j.K("sources").O().P("pdh", main != null).P("kmt", kmtOk).P("nvml", nvmlState).P("adl", adlState).End();
            j.P("os", Environment.OSVersion.VersionString).P("x64", IntPtr.Size == 8);
            j.End();
            return j.ToString();
        }

        // ---------------- CPU
        private void WriteCpu(Json j)
        {
            j.K("cpu").O();
            if (main != null && main.Warm)
            {
                List<KeyValuePair<string, double>> vals = main.Values(useUtility ? "util" : "ptime");
                if (vals.Count == 0 && useUtility) { vals = main.Values("ptime"); }
                double total = double.NaN;
                List<long> keys = new List<long>();
                Dictionary<long, double> cores = new Dictionary<long, double>();
                foreach (KeyValuePair<string, double> kv in vals)
                {
                    string n = kv.Key;
                    if (n == "_Total") { total = kv.Value; continue; }
                    if (n.IndexOf("_Total", StringComparison.Ordinal) >= 0) continue;
                    long key;
                    int comma = n.IndexOf(',');
                    if (comma > 0)
                    {
                        int g, i;
                        if (!int.TryParse(n.Substring(0, comma), out g) || !int.TryParse(n.Substring(comma + 1), out i)) continue;
                        key = (long)g * 65536L + i;
                    }
                    else
                    {
                        int i;
                        if (!int.TryParse(n, out i)) continue;
                        key = i;
                    }
                    if (!cores.ContainsKey(key)) keys.Add(key);
                    cores[key] = kv.Value;
                }
                keys.Sort();
                if (keys.Count > 0 && keys.Count != threads) { threads = keys.Count; infoDirty = true; }
                j.P("load", Clamp100(total));
                j.K("cores").A();
                foreach (long k in keys) j.N(Math.Round(Clamp100(cores[k]), 1));
                j.End();
                double perf = main.Single("perf");
                j.P("perf", perf);
                if (!double.IsNaN(perf) && !double.IsNaN(baseMhz)) j.P("mhz", Math.Round(baseMhz * perf / 100.0));
            }
            j.End();
        }

        private static double Clamp100(double v)
        {
            if (double.IsNaN(v)) return v;
            return Math.Max(0, Math.Min(100, v));
        }

        // ---------------- memory
        private void WriteMem(Json j)
        {
            Native.MEMORYSTATUSEX m = new Native.MEMORYSTATUSEX();
            m.dwLength = (uint)Marshal.SizeOf(typeof(Native.MEMORYSTATUSEX));
            if (!Native.GlobalMemoryStatusEx(ref m)) return;
            j.K("mem").O()
                .P("total", (double)m.ullTotalPhys)
                .P("avail", (double)m.ullAvailPhys)
                .P("commitLimit", (double)m.ullTotalPageFile)
                .P("commit", (double)(m.ullTotalPageFile - m.ullAvailPageFile))
                .End();
        }

        // ---------------- GPUs: D3DKMT enumeration (names, LUIDs, memory size, temperature)
        [StructLayout(LayoutKind.Sequential)]
        struct LUID { public uint Low; public int High; }
        [StructLayout(LayoutKind.Sequential)]
        struct D3DKMT_ENUMADAPTERS2 { public uint NumAdapters; public IntPtr pAdapters; }
        [StructLayout(LayoutKind.Sequential)]
        struct D3DKMT_QUERYADAPTERINFO { public uint hAdapter; public int Type; public IntPtr pData; public uint DataSize; }
        [StructLayout(LayoutKind.Sequential)]
        struct D3DKMT_CLOSEADAPTER { public uint hAdapter; }

        [DllImport("gdi32.dll")] static extern int D3DKMTEnumAdapters2(ref D3DKMT_ENUMADAPTERS2 p);
        [DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref D3DKMT_QUERYADAPTERINFO p);
        [DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref D3DKMT_CLOSEADAPTER p);

        const int KMTQAITYPE_GETSEGMENTSIZE = 3, KMTQAITYPE_ADAPTERADDRESS = 6, KMTQAITYPE_ADAPTERREGISTRYINFO = 8,
            KMTQAITYPE_ADAPTERTYPE = 15, KMTQAITYPE_PHYSICALADAPTERDEVICEIDS = 31, KMTQAITYPE_ADAPTERPERFDATA = 62;

        private static int KmtQuery(uint h, int type, IntPtr buf, int size)
        {
            D3DKMT_QUERYADAPTERINFO q = new D3DKMT_QUERYADAPTERINFO();
            q.hAdapter = h; q.Type = type; q.pData = buf; q.DataSize = (uint)size;
            return D3DKMTQueryAdapterInfo(ref q);
        }

        private void CloseGpuHandles()
        {
            foreach (GpuInfo g in gpus)
            {
                if (g.Handle == 0) continue;
                try { D3DKMT_CLOSEADAPTER c = new D3DKMT_CLOSEADAPTER(); c.hAdapter = g.Handle; D3DKMTCloseAdapter(ref c); } catch { }
                g.Handle = 0;
            }
        }

        private void EnumGpus()
        {
            gpuEnumAt = DateTime.UtcNow;
            Dictionary<string, GpuInfo> old = new Dictionary<string, GpuInfo>();
            foreach (GpuInfo g in gpus) old[g.Id] = g;
            string before = GpuSignature();
            CloseGpuHandles();
            gpus.Clear();
            try
            {
                D3DKMT_ENUMADAPTERS2 e = new D3DKMT_ENUMADAPTERS2();
                int st = D3DKMTEnumAdapters2(ref e);
                if (st != 0 || e.NumAdapters == 0) { LogOnce("kmtenum" + st, "info", "Graphics adapter list unavailable (status 0x" + st.ToString("X8") + ")"); kmtOk = false; return; }
                int itemSize = 20;
                IntPtr arr = Native.Alloc(itemSize * (int)e.NumAdapters);
                try
                {
                    e.pAdapters = arr;
                    st = D3DKMTEnumAdapters2(ref e);
                    if (st != 0) { LogOnce("kmtenum2" + st, "info", "Graphics adapter list failed (0x" + st.ToString("X8") + ")"); kmtOk = false; return; }
                    for (int i = 0; i < e.NumAdapters; i++)
                    {
                        int off = i * itemSize;
                        uint h = (uint)Marshal.ReadInt32(arr, off);
                        uint low = (uint)Marshal.ReadInt32(arr, off + 4);
                        int high = Marshal.ReadInt32(arr, off + 8);
                        GpuInfo g = ReadAdapter(h, ((uint)high).ToString("X8") + "_" + low.ToString("X8"));
                        if (g == null)
                        {
                            D3DKMT_CLOSEADAPTER c = new D3DKMT_CLOSEADAPTER(); c.hAdapter = h; D3DKMTCloseAdapter(ref c);
                            continue;
                        }
                        GpuInfo prev;
                        if (old.TryGetValue(g.Id, out prev)) { g.PerfOk = prev.PerfOk; }
                        gpus.Add(g);
                    }
                }
                finally { Marshal.FreeHGlobal(arr); }
                kmtOk = true;
            }
            catch (EntryPointNotFoundException) { kmtOk = false; LogOnce("kmtep", "info", "This Windows version has no D3DKMTEnumAdapters2"); }
            catch (DllNotFoundException) { kmtOk = false; LogOnce("kmtdll", "info", "gdi32 not available"); }
            catch (Exception ex) { kmtOk = false; LogOnce("kmtex", "warn", "Graphics adapter list: " + ex.Message); }

            // Fall back to the counters' adapter list (names unknown) when D3DKMT is missing.
            if (gpus.Count == 0 && gpuQ != null)
            {
                foreach (KeyValuePair<string, double> kv in gpuQ.Values("ded"))
                {
                    string id = LuidFromInstance(kv.Key);
                    if (id == null) continue;
                    bool dup = false;
                    foreach (GpuInfo x in gpus) if (x.Id == id) dup = true;
                    if (dup) continue;
                    GpuInfo g = new GpuInfo(); g.Id = id; g.Name = "GPU " + (gpus.Count + 1); g.Vendor = "other";
                    gpus.Add(g);
                }
            }
            if (GpuSignature() != before)
            {
                infoDirty = true;
                foreach (GpuInfo g in gpus)
                    Log("info", "GPU found: " + g.Name + " (" + g.Vendor + (g.Integrated ? ", integrated" : "") + ", bus " + g.Bus + ", " + Math.Round(g.DedTotal / 1048576.0) + " MB)");
            }
        }

        private string GpuSignature()
        {
            StringBuilder sb = new StringBuilder();
            foreach (GpuInfo g in gpus) sb.Append(g.Id).Append('|').Append(g.Name).Append(';');
            return sb.ToString();
        }

        private GpuInfo ReadAdapter(uint h, string id)
        {
            GpuInfo g = new GpuInfo();
            g.Id = id;
            g.Handle = h;
            IntPtr buf = Native.Alloc(2200);
            try
            {
                uint flags = 0;
                if (KmtQuery(h, KMTQAITYPE_ADAPTERTYPE, buf, 4) == 0) flags = (uint)Marshal.ReadInt32(buf);
                bool render = (flags & 1) != 0, software = (flags & 4) != 0, indirect = (flags & 64) != 0;
                if (flags != 0 && (!render || software || indirect)) return null;
                g.Integrated = (flags & 32) != 0; // HybridIntegrated

                if (KmtQuery(h, KMTQAITYPE_ADAPTERREGISTRYINFO, buf, 2080) == 0)
                    g.Name = (Marshal.PtrToStringUni(buf) ?? "").Trim();
                if (g.Name.IndexOf("Microsoft Basic", StringComparison.OrdinalIgnoreCase) >= 0) return null;
                if (g.Name.IndexOf("Remote Display", StringComparison.OrdinalIgnoreCase) >= 0) return null;

                for (int i = 0; i < 32; i++) Marshal.WriteByte(buf, i, 0);
                if (KmtQuery(h, KMTQAITYPE_ADAPTERADDRESS, buf, 12) == 0) g.Bus = Marshal.ReadInt32(buf);

                for (int i = 0; i < 32; i++) Marshal.WriteByte(buf, i, 0);
                if (KmtQuery(h, KMTQAITYPE_GETSEGMENTSIZE, buf, 24) == 0)
                {
                    g.DedTotal = (double)(ulong)Marshal.ReadInt64(buf, 0);
                    g.ShrTotal = (double)(ulong)Marshal.ReadInt64(buf, 16);
                }

                int vendorId = 0;
                for (int i = 0; i < 32; i++) Marshal.WriteByte(buf, i, 0);
                if (KmtQuery(h, KMTQAITYPE_PHYSICALADAPTERDEVICEIDS, buf, 28) == 0) vendorId = Marshal.ReadInt32(buf, 4);
                string n = g.Name;
                if (vendorId == 0x10DE || n.IndexOf("NVIDIA", StringComparison.OrdinalIgnoreCase) >= 0) g.Vendor = "nvidia";
                else if (vendorId == 0x1002 || vendorId == 0x1022 || Regex.IsMatch(n, @"\b(AMD|Radeon|ATI)\b", RegexOptions.IgnoreCase)) g.Vendor = "amd";
                else if (vendorId == 0x8086 || n.IndexOf("Intel", StringComparison.OrdinalIgnoreCase) >= 0) g.Vendor = "intel";
                else if (n.IndexOf("Qualcomm", StringComparison.OrdinalIgnoreCase) >= 0 || n.IndexOf("Adreno", StringComparison.OrdinalIgnoreCase) >= 0) g.Vendor = "qualcomm";
                else g.Vendor = "other";
                if (vendorId == 0x1414) return null; // Microsoft software / virtual adapters

                if (!g.Integrated && !double.IsNaN(g.DedTotal) && g.DedTotal < 1.1 * 1073741824.0 && g.Vendor != "nvidia") g.Integrated = true;
                if (g.Name == "") g.Name = "GPU";
            }
            finally { Marshal.FreeHGlobal(buf); }
            return g;
        }

        private static string LuidFromInstance(string inst)
        {
            Match m = Regex.Match(inst, @"luid_0x([0-9A-Fa-f]{8})_0x([0-9A-Fa-f]{8})");
            if (!m.Success) return null;
            return m.Groups[1].Value.ToUpperInvariant() + "_" + m.Groups[2].Value.ToUpperInvariant();
        }

        private static readonly Regex EngRx = new Regex(@"luid_0x([0-9A-Fa-f]{8})_0x([0-9A-Fa-f]{8})_phys_(\d+)_eng_(\d+)", RegexOptions.Compiled);

        private void WriteGpus(Json j)
        {
            // utilisation: sum each engine over all processes, then take the busiest engine (like Task Manager)
            Dictionary<string, double> engines = new Dictionary<string, double>();
            Dictionary<string, double> ded = new Dictionary<string, double>();
            Dictionary<string, double> shr = new Dictionary<string, double>();
            bool haveCounters = gpuQ != null && gpuQ.Warm;
            if (haveCounters)
            {
                foreach (KeyValuePair<string, double> kv in gpuQ.Values("eng"))
                {
                    Match m = EngRx.Match(kv.Key);
                    if (!m.Success) continue;
                    string key = m.Groups[1].Value.ToUpperInvariant() + "_" + m.Groups[2].Value.ToUpperInvariant() + "|" + m.Groups[3].Value + "|" + m.Groups[4].Value;
                    double cur;
                    engines.TryGetValue(key, out cur);
                    engines[key] = cur + kv.Value;
                }
                foreach (KeyValuePair<string, double> kv in gpuQ.Values("ded"))
                {
                    string id = LuidFromInstance(kv.Key); if (id == null) continue;
                    double cur; ded.TryGetValue(id, out cur); ded[id] = cur + kv.Value;
                }
                foreach (KeyValuePair<string, double> kv in gpuQ.Values("shr"))
                {
                    string id = LuidFromInstance(kv.Key); if (id == null) continue;
                    double cur; shr.TryGetValue(id, out cur); shr[id] = cur + kv.Value;
                }
            }

            foreach (GpuInfo g in gpus)
            {
                if (haveCounters)
                {
                    double best = 0; bool any = false;
                    foreach (KeyValuePair<string, double> kv in engines)
                    {
                        if (!kv.Key.StartsWith(g.Id + "|", StringComparison.Ordinal)) continue;
                        any = true;
                        if (kv.Value > best) best = kv.Value;
                    }
                    g.Util = any ? Clamp100(best) : (ded.ContainsKey(g.Id) ? 0 : double.NaN);
                    double v;
                    g.Ded = ded.TryGetValue(g.Id, out v) ? v : double.NaN;
                    g.Shr = shr.TryGetValue(g.Id, out v) ? v : double.NaN;
                }
                g.ClearSensors();
            }

            ReadNvml();
            ReadAdl();
            ReadKmtPerf();

            j.K("gpus").A();
            foreach (GpuInfo g in gpus)
            {
                j.O().P("id", g.Id).P("util", g.Util).P("ded", g.Ded).P("shr", g.Shr)
                    .P("temp", g.Temp).P("hot", g.Hot).P("memTemp", g.MemTemp)
                    .P("power", g.Power).P("powerLimit", g.PowerLimit).P("powerPct", g.PowerPct)
                    .P("fan", g.Fan).P("fanPct", g.FanPct).P("clock", g.Clock).P("memClock", g.MemClock)
                    .P("src", g.TempSrc).End();
            }
            j.End();
        }

        private void ReadKmtPerf()
        {
            if (!kmtOk) return;
            IntPtr buf = Native.Alloc(64);
            try
            {
                foreach (GpuInfo g in gpus)
                {
                    if (g.Handle == 0 || !g.PerfOk) continue;
                    if (!double.IsNaN(g.Temp) && !double.IsNaN(g.Fan)) continue; // the driver library already gave us everything
                    for (int i = 0; i < 64; i++) Marshal.WriteByte(buf, i, 0);
                    int st = KmtQuery(g.Handle, KMTQAITYPE_ADAPTERPERFDATA, buf, 64);
                    if (st != 0)
                    {
                        g.PerfOk = false;
                        LogOnce("kmtperf:" + g.Id, "info", "Windows has no temperature for " + g.Name + " (driver too old or not supported, 0x" + st.ToString("X8") + ")");
                        continue;
                    }
                    uint fan = (uint)Marshal.ReadInt32(buf, 48);
                    uint power = (uint)Marshal.ReadInt32(buf, 52);
                    uint temp = (uint)Marshal.ReadInt32(buf, 56);
                    if (double.IsNaN(g.Temp) && temp > 0 && temp < 1500) { g.Temp = temp / 10.0; g.TempSrc = "windows"; }
                    if (double.IsNaN(g.Fan) && fan > 0 && fan < 20000) g.Fan = fan;
                    if (double.IsNaN(g.PowerPct) && power > 0 && power <= 2000) g.PowerPct = power / 10.0;
                    ulong memHz = (ulong)Marshal.ReadInt64(buf, 8);
                    if (double.IsNaN(g.MemClock) && memHz > 0) g.MemClock = memHz / 1000000.0;
                }
            }
            catch (Exception e) { LogOnce("kmtperfex", "warn", "GPU temperature (Windows): " + e.Message); }
            finally { Marshal.FreeHGlobal(buf); }
        }

        // ---------------- NVIDIA NVML
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvVoid();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvOutU(out uint v);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvHandle(uint index, out IntPtr dev);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvDevU(IntPtr dev, out uint v);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvDevArgU(IntPtr dev, int arg, out uint v);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvDevBuf(IntPtr dev, IntPtr buf);

        private string nvmlState = "not tried";
        private bool nvmlTried;
        private NvDevU nvPower, nvFan, nvLimit;
        private NvDevArgU nvTemp, nvClock;
        private NvDevBuf nvPci;
        private readonly List<KeyValuePair<IntPtr, int>> nvDevices = new List<KeyValuePair<IntPtr, int>>(); // handle, bus

        private bool HasVendor(string v)
        {
            foreach (GpuInfo g in gpus) if (g.Vendor == v) return true;
            return false;
        }

        private void InitNvml()
        {
            nvmlTried = true;
            IntPtr mod = Native.LoadLibraryW("nvml.dll");
            if (mod == IntPtr.Zero)
            {
                string pf = Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                string p = Path.Combine(pf, @"NVIDIA Corporation\NVSMI\nvml.dll");
                if (File.Exists(p)) mod = Native.LoadLibraryW(p);
            }
            if (mod == IntPtr.Zero)
            {
                try
                {
                    string repo = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"DriverStore\FileRepository");
                    foreach (string d in Directory.GetDirectories(repo, "nv*"))
                    {
                        string p = Path.Combine(d, "nvml.dll");
                        if (File.Exists(p)) { mod = Native.LoadLibraryW(p); if (mod != IntPtr.Zero) break; }
                    }
                }
                catch { }
            }
            if (mod == IntPtr.Zero) { nvmlState = "missing"; Log("info", "NVIDIA driver library (nvml.dll) not found"); return; }
            NvVoid init = Native.Fn<NvVoid>(mod, "nvmlInit_v2") ?? Native.Fn<NvVoid>(mod, "nvmlInit");
            NvOutU count = Native.Fn<NvOutU>(mod, "nvmlDeviceGetCount_v2") ?? Native.Fn<NvOutU>(mod, "nvmlDeviceGetCount");
            NvHandle byIndex = Native.Fn<NvHandle>(mod, "nvmlDeviceGetHandleByIndex_v2") ?? Native.Fn<NvHandle>(mod, "nvmlDeviceGetHandleByIndex");
            nvTemp = Native.Fn<NvDevArgU>(mod, "nvmlDeviceGetTemperature");
            nvClock = Native.Fn<NvDevArgU>(mod, "nvmlDeviceGetClockInfo");
            nvPower = Native.Fn<NvDevU>(mod, "nvmlDeviceGetPowerUsage");
            nvLimit = Native.Fn<NvDevU>(mod, "nvmlDeviceGetEnforcedPowerLimit");
            nvFan = Native.Fn<NvDevU>(mod, "nvmlDeviceGetFanSpeed");
            nvPci = Native.Fn<NvDevBuf>(mod, "nvmlDeviceGetPciInfo_v3") ?? Native.Fn<NvDevBuf>(mod, "nvmlDeviceGetPciInfo_v2") ?? Native.Fn<NvDevBuf>(mod, "nvmlDeviceGetPciInfo");
            if (init == null || count == null || byIndex == null) { nvmlState = "error"; Log("warn", "NVIDIA driver library is missing functions"); return; }
            int st = init();
            if (st != 0) { nvmlState = "error"; Log("warn", "NVIDIA driver library did not start (code " + st + ")"); return; }
            uint n;
            if (count(out n) != 0) n = 0;
            IntPtr pci = Native.Alloc(128);
            try
            {
                for (uint i = 0; i < n; i++)
                {
                    IntPtr dev;
                    if (byIndex(i, out dev) != 0) continue;
                    int bus = -1;
                    if (nvPci != null)
                    {
                        for (int b = 0; b < 128; b++) Marshal.WriteByte(pci, b, 0);
                        if (nvPci(dev, pci) == 0) bus = Marshal.ReadInt32(pci, 20);
                    }
                    nvDevices.Add(new KeyValuePair<IntPtr, int>(dev, bus));
                }
            }
            finally { Marshal.FreeHGlobal(pci); }
            nvmlState = "ok";
            infoDirty = true;
            Log("info", "NVIDIA driver library ready: " + nvDevices.Count + " GPU(s)");
        }

        private void ReadNvml()
        {
            if (!HasVendor("nvidia")) return;
            if (!nvmlTried) { try { InitNvml(); } catch (Exception e) { nvmlState = "error"; Log("warn", "NVIDIA driver library: " + e.Message); } }
            if (nvmlState != "ok") return;
            int idx = 0;
            foreach (GpuInfo g in gpus)
            {
                if (g.Vendor != "nvidia") continue;
                IntPtr dev = IntPtr.Zero;
                foreach (KeyValuePair<IntPtr, int> d in nvDevices) if (d.Value >= 0 && d.Value == g.Bus) dev = d.Key;
                if (dev == IntPtr.Zero && idx < nvDevices.Count) dev = nvDevices[idx].Key;
                idx++;
                if (dev == IntPtr.Zero) continue;
                uint v;
                try
                {
                    if (nvTemp != null && nvTemp(dev, 0, out v) == 0 && v > 0 && v < 150) { g.Temp = v; g.TempSrc = "nvidia"; }
                    if (nvPower != null && nvPower(dev, out v) == 0) g.Power = v / 1000.0;
                    if (nvLimit != null && nvLimit(dev, out v) == 0 && v > 0) g.PowerLimit = v / 1000.0;
                    if (nvFan != null && nvFan(dev, out v) == 0 && v <= 100) g.FanPct = v;
                    if (nvClock != null && nvClock(dev, 0, out v) == 0 && v > 0) g.Clock = v;
                    if (nvClock != null && nvClock(dev, 2, out v) == 0 && v > 0) g.MemClock = v;
                    if (!double.IsNaN(g.Power) && !double.IsNaN(g.PowerLimit) && g.PowerLimit > 0) g.PowerPct = g.Power / g.PowerLimit * 100;
                }
                catch (Exception e) { LogOnce("nvread", "warn", "NVIDIA reading: " + e.Message); }
            }
        }

        // ---------------- AMD ADL
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate IntPtr AdlAllocCb(int size);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AdlCreate(AdlAllocCb cb, int connectedOnly, out IntPtr ctx);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AdlCtxOut(IntPtr ctx, out int v);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AdlCtxBuf(IntPtr ctx, IntPtr buf, int size);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AdlCaps(IntPtr ctx, int idx, out int supported, out int enabled, out int version);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AdlIdxBuf(IntPtr ctx, int idx, IntPtr buf);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AdlIdxArgOut(IntPtr ctx, int idx, int arg, out int v);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AdlIdxArgBuf(IntPtr ctx, int idx, int arg, IntPtr buf);

        private static AdlAllocCb adlAlloc; // kept alive for the lifetime of the process
        private static IntPtr AdlAllocImpl(int size) { return Marshal.AllocCoTaskMem(size); }
        private string adlState = "not tried";
        private bool adlTried;
        private IntPtr adlCtx;
        private AdlIdxBuf adlPmLog;
        private AdlIdxArgOut adlOdnTemp;
        private AdlIdxArgBuf adlOd5Temp;
        private class AdlGpu { public int Index; public int Bus; public int OdVersion; public bool PmOk = true; public bool Listed; }
        // CPU readings the AMD driver may offer (documented for Ryzen chips with built-in graphics)
        private double adlCpuTemp = double.NaN, adlCpuPower = double.NaN, adlCpuClock = double.NaN;
        private long adlReadTick = -1;
        private static readonly string[] PmNames = {
            "", "GFX clock", "Mem clock", "SoC clock", "UVD1 clock", "UVD2 clock", "VCE clock", "VCN clock",
            "Edge temp", "Mem temp", "VDDC VR temp", "MVDD VR temp", "Liquid temp", "PLX temp", "Fan RPM", "Fan %",
            "SoC volt", "SoC power", "SoC current", "GFX activity", "Mem activity", "GFX volt", "Mem volt", "ASIC power",
            "SoC VR temp", "MVDD0 VR temp", "MVDD1 VR temp", "Hotspot temp", "GFX temp", "SoC temp", "GFX power", "GFX current",
            "CPU temp", "CPU power", "CPU clock" };
        private readonly List<AdlGpu> adlGpus = new List<AdlGpu>();

        private void InitAdl()
        {
            adlTried = true;
            IntPtr mod = Native.LoadLibraryW(IntPtr.Size == 8 ? "atiadlxx.dll" : "atiadlxy.dll");
            if (mod == IntPtr.Zero) mod = Native.LoadLibraryW("atiadlxx.dll");
            if (mod == IntPtr.Zero) { adlState = "missing"; Log("info", "AMD driver library (atiadlxx.dll) not found"); return; }
            AdlCreate create = Native.Fn<AdlCreate>(mod, "ADL2_Main_Control_Create");
            AdlCtxOut numAdapters = Native.Fn<AdlCtxOut>(mod, "ADL2_Adapter_NumberOfAdapters_Get");
            AdlCtxBuf adapterInfo = Native.Fn<AdlCtxBuf>(mod, "ADL2_Adapter_AdapterInfo_Get");
            AdlCaps caps = Native.Fn<AdlCaps>(mod, "ADL2_Overdrive_Caps");
            adlPmLog = Native.Fn<AdlIdxBuf>(mod, "ADL2_New_QueryPMLogData_Get");
            adlOdnTemp = Native.Fn<AdlIdxArgOut>(mod, "ADL2_OverdriveN_Temperature_Get");
            adlOd5Temp = Native.Fn<AdlIdxArgBuf>(mod, "ADL2_Overdrive5_Temperature_Get");
            if (create == null || numAdapters == null || adapterInfo == null) { adlState = "error"; Log("warn", "AMD driver library is missing functions"); return; }
            adlAlloc = new AdlAllocCb(AdlAllocImpl);
            int st = create(adlAlloc, 1, out adlCtx);
            if (st != 0) { adlState = "error"; Log("warn", "AMD driver library did not start (code " + st + ")"); return; }
            int n;
            if (numAdapters(adlCtx, out n) != 0 || n <= 0) { adlState = "error"; Log("info", "AMD driver library found no adapters"); return; }
            const int infoSize = 1572;
            IntPtr buf = Native.Alloc(infoSize * n);
            try
            {
                for (int i = 0; i < n; i++) Marshal.WriteInt32(buf, i * infoSize, infoSize);
                st = adapterInfo(adlCtx, buf, infoSize * n);
                if (st != 0) { adlState = "error"; Log("warn", "AMD adapter info failed (code " + st + ")"); return; }
                HashSet<int> buses = new HashSet<int>();
                for (int i = 0; i < n; i++)
                {
                    int off = i * infoSize;
                    int index = Marshal.ReadInt32(buf, off + 4);
                    int bus = Marshal.ReadInt32(buf, off + 264);
                    int vendor = Marshal.ReadInt32(buf, off + 276);
                    int present = Marshal.ReadInt32(buf, off + 792);
                    if (vendor != 1002 && vendor != 0x1002) continue;
                    if (present == 0 || buses.Contains(bus)) continue;
                    buses.Add(bus);
                    AdlGpu a = new AdlGpu(); a.Index = index; a.Bus = bus;
                    if (caps != null)
                    {
                        int sup, en, ver;
                        if (caps(adlCtx, index, out sup, out en, out ver) == 0) a.OdVersion = ver;
                    }
                    adlGpus.Add(a);
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            adlState = adlGpus.Count > 0 ? "ok" : "error";
            infoDirty = true;
            Log("info", "AMD driver library ready: " + adlGpus.Count + " GPU(s)");
        }

        private void ReadAdl()
        {
            if (!HasVendor("amd")) return;
            if (!adlTried) { try { InitAdl(); } catch (Exception e) { adlState = "error"; Log("warn", "AMD driver library: " + e.Message); } }
            if (adlState != "ok") return;
            if (adlReadTick == tick) return;
            adlReadTick = tick;
            adlCpuTemp = adlCpuPower = adlCpuClock = double.NaN;
            const int pmSize = 4 + 256 * 8;
            IntPtr buf = Native.Alloc(pmSize);
            try
            {
                int idx = 0;
                foreach (GpuInfo g in gpus)
                {
                    if (g.Vendor != "amd") continue;
                    AdlGpu a = null;
                    foreach (AdlGpu x in adlGpus) if (g.Bus >= 0 && x.Bus == g.Bus) a = x;
                    if (a == null && idx < adlGpus.Count) a = adlGpus[idx];
                    idx++;
                    if (a == null) continue;

                    bool got = false;
                    if (adlPmLog != null && a.PmOk)
                    {
                        for (int i = 0; i < pmSize; i++) Marshal.WriteByte(buf, i, 0);
                        Marshal.WriteInt32(buf, 0, pmSize);
                        if (adlPmLog(adlCtx, a.Index, buf) == 0)
                        {
                            got = true;
                            if (!a.Listed) { a.Listed = true; ListPmSensors(g, buf); }
                            double ct = Sensor(buf, 32); if (Ok(ct, 1, 125)) adlCpuTemp = ct;
                            double cp = Sensor(buf, 33); if (Ok(cp, 0.1, 1000)) adlCpuPower = cp;
                            double cc = Sensor(buf, 34); if (Ok(cc, 100, 10000)) adlCpuClock = cc;
                            double t = Sensor(buf, 8); if (double.IsNaN(t)) t = Sensor(buf, 28); if (double.IsNaN(t)) t = Sensor(buf, 50);
                            if (Ok(t, 1, 150)) { g.Temp = t; g.TempSrc = "amd"; }
                            double hot = Sensor(buf, 27); if (double.IsNaN(hot)) hot = Sensor(buf, 50);
                            if (Ok(hot, 1, 150)) g.Hot = hot;
                            double mt = Sensor(buf, 9); if (Ok(mt, 1, 150)) g.MemTemp = mt;
                            double p = Sensor(buf, 73); if (double.IsNaN(p) || p <= 0) p = Sensor(buf, 23); if (double.IsNaN(p) || p <= 0) p = Sensor(buf, 30); if (double.IsNaN(p) || p <= 0) p = Sensor(buf, 17);
                            if (Ok(p, 0, 2000)) g.Power = p;
                            double rpm = Sensor(buf, 14); if (Ok(rpm, 0, 20000)) g.Fan = rpm;
                            double fp = Sensor(buf, 15); if (Ok(fp, 0, 100)) g.FanPct = fp;
                            double c = Sensor(buf, 1); if (Ok(c, 1, 10000)) g.Clock = c;
                            double mc = Sensor(buf, 2); if (Ok(mc, 1, 30000)) g.MemClock = mc;
                        }
                        else a.PmOk = false;
                    }
                    if (!got)
                    {
                        int v;
                        if (adlOdnTemp != null && adlOdnTemp(adlCtx, a.Index, 1, out v) == 0 && v > 0)
                        {
                            double t = v > 1000 ? v / 1000.0 : v;
                            if (Ok(t, 1, 150)) { g.Temp = t; g.TempSrc = "amd"; }
                        }
                        else if (adlOd5Temp != null)
                        {
                            for (int i = 0; i < 8; i++) Marshal.WriteByte(buf, i, 0);
                            Marshal.WriteInt32(buf, 0, 8);
                            if (adlOd5Temp(adlCtx, a.Index, 0, buf) == 0)
                            {
                                double t = Marshal.ReadInt32(buf, 4) / 1000.0;
                                if (Ok(t, 1, 150)) { g.Temp = t; g.TempSrc = "amd"; }
                            }
                        }
                    }
                }
            }
            catch (Exception e) { LogOnce("adlread", "warn", "AMD reading: " + e.Message); }
            finally { Marshal.FreeHGlobal(buf); }
        }

        private static double Sensor(IntPtr buf, int index)
        {
            int off = 4 + index * 8;
            if (Marshal.ReadInt32(buf, off) == 0) return double.NaN;
            return Marshal.ReadInt32(buf, off + 4);
        }
        private static bool Ok(double v, double lo, double hi) { return !double.IsNaN(v) && v >= lo && v <= hi; }

        // Writes every reading the AMD driver offers for this card to the log (once).
        private void ListPmSensors(GpuInfo g, IntPtr buf)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 1; i < 256; i++)
            {
                double v = Sensor(buf, i);
                if (double.IsNaN(v)) continue;
                if (sb.Length > 0) sb.Append(", ");
                sb.Append(i).Append(i < PmNames.Length && PmNames[i] != "" ? " " + PmNames[i] : "").Append('=').Append(v.ToString(CultureInfo.InvariantCulture));
            }
            Log("info", "AMD driver readings for " + g.Name + ": " + (sb.Length > 0 ? sb.ToString() : "none"));
            bool cpu = !double.IsNaN(Sensor(buf, 32)) || !double.IsNaN(Sensor(buf, 33));
            Log("info", cpu ? "AMD driver offers CPU readings" : "AMD driver offers no CPU temperature or power on this PC");
        }

        // ---------------- disks
        private void WriteDisks(Json j)
        {
            if (main == null || !main.Warm) return;
            Dictionary<string, double[]> d = new Dictionary<string, double[]>();
            List<string> order = new List<string>();
            string[] names = { "didle", "drd", "dwr" };
            for (int c = 0; c < 3; c++)
            {
                foreach (KeyValuePair<string, double> kv in main.Values(names[c]))
                {
                    double[] a;
                    if (!d.TryGetValue(kv.Key, out a)) { a = new double[] { double.NaN, double.NaN, double.NaN }; d[kv.Key] = a; order.Add(kv.Key); }
                    a[c] = kv.Value;
                }
            }
            j.K("disks").A();
            foreach (string n in order)
            {
                double[] a = d[n];
                j.O().P("id", n).P("act", double.IsNaN(a[0]) ? double.NaN : Clamp100(100 - a[0])).P("rd", a[1]).P("wr", a[2]).End();
            }
            j.End();
        }

        private void WriteVols(Json j)
        {
            if ((DateTime.UtcNow - volsAt).TotalSeconds >= 10)
            {
                volsAt = DateTime.UtcNow;
                List<string[]> list = new List<string[]>();
                foreach (DriveInfo di in DriveInfo.GetDrives())
                {
                    try
                    {
                        if (di.DriveType != DriveType.Fixed && di.DriveType != DriveType.Removable) continue;
                        if (!di.IsReady) continue;
                        string id = di.Name.TrimEnd('\\');
                        list.Add(new string[] {
                            id, di.VolumeLabel ?? "", di.DriveType.ToString(),
                            di.TotalSize.ToString(CultureInfo.InvariantCulture),
                            di.AvailableFreeSpace.ToString(CultureInfo.InvariantCulture) });
                    }
                    catch { }
                }
                vols = list;
            }
            j.K("vols").A();
            foreach (string[] v in vols)
                j.O().P("id", v[0]).P("label", v[1]).P("kind", v[2]).P("total", double.Parse(v[3], CultureInfo.InvariantCulture)).P("free", double.Parse(v[4], CultureInfo.InvariantCulture)).End();
            j.End();
        }

        // ---------------- network
        private static readonly Regex VirtRx = new Regex(@"Hyper-V|vEthernet|VirtualBox|VMware|Virtual|Loopback|TAP-|TAP\b|Npcap|WireGuard|Tailscale|ZeroTier|OpenVPN|Wintun|WAN Miniport|Bluetooth|Teredo|isatap|Pseudo|Kernel Debug|VPN|Docker|WSL", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private void WriteNets(Json j)
        {
            long now = clock.ElapsedMilliseconds;
            double dt = netLastMs < 0 ? 0 : (now - netLastMs) / 1000.0;
            netLastMs = now;
            bool props = (DateTime.UtcNow - netPropsAt).TotalSeconds >= 10;
            if (props) netPropsAt = DateTime.UtcNow;
            foreach (NetState s in nets.Values) s.Seen = false;
            foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                NetworkInterfaceType t = ni.NetworkInterfaceType;
                if (t == NetworkInterfaceType.Loopback || t == NetworkInterfaceType.Tunnel) continue;
                NetState s;
                if (!nets.TryGetValue(ni.Id, out s)) { s = new NetState(); s.Id = ni.Id; nets[ni.Id] = s; props = true; }
                s.Seen = true;
                s.Name = ni.Name; s.Desc = ni.Description; s.Kind = t.ToString();
                s.Up = ni.OperationalStatus == OperationalStatus.Up;
                s.Virt = VirtRx.IsMatch(ni.Description + " " + ni.Name);
                try { s.Speed = ni.Speed; } catch { s.Speed = -1; }
                long rx = -1, tx = -1;
                try
                {
                    IPInterfaceStatistics st = ni.GetIPStatistics();
                    rx = st.BytesReceived; tx = st.BytesSent;
                }
                catch
                {
                    try { IPv4InterfaceStatistics st4 = ni.GetIPv4Statistics(); rx = st4.BytesReceived; tx = st4.BytesSent; } catch { }
                }
                if (rx >= 0 && s.LastRx >= 0 && dt > 0.05)
                {
                    s.Rx = Math.Max(0, (rx - s.LastRx) / dt);
                    s.Tx = Math.Max(0, (tx - s.LastTx) / dt);
                }
                else if (!s.Up) { s.Rx = 0; s.Tx = 0; }
                s.LastRx = rx; s.LastTx = tx;
                if (props)
                {
                    try
                    {
                        IPInterfaceProperties p = ni.GetIPProperties();
                        string ip = "";
                        foreach (UnicastIPAddressInformation a in p.UnicastAddresses)
                        {
                            if (a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork) { ip = a.Address.ToString(); break; }
                        }
                        s.Ip = ip;
                        bool gw = false;
                        foreach (GatewayIPAddressInformation g in p.GatewayAddresses)
                        {
                            string gs = g.Address.ToString();
                            if (gs != "0.0.0.0" && gs != "::") gw = true;
                        }
                        s.Gw = gw;
                    }
                    catch { }
                }
            }
            j.K("nets").A();
            foreach (NetState s in nets.Values)
            {
                if (!s.Seen) continue;
                j.O().P("id", s.Id).P("name", s.Name).P("desc", s.Desc).P("kind", s.Kind).P("up", s.Up)
                    .P("speed", s.Speed).P("rx", s.Rx).P("tx", s.Tx).P("ip", s.Ip).P("gw", s.Gw).P("virt", s.Virt).End();
            }
            j.End();
        }

        // ---------------- system
        private readonly Dictionary<string, double> thermFirst = new Dictionary<string, double>();
        private void WriteSys(Json j)
        {
            j.K("sys").O().P("up", Native.GetTickCount64() / 1000.0);
            if (main != null && main.Warm)
            {
                j.P("procs", main.Single("procs")).P("threads", main.Single("threads"));
                // ACPI thermal zones: many desktops report a fixed fake value, so a zone
                // is only offered after its reading has changed at least once.
                j.K("therm").A();
                foreach (KeyValuePair<string, double> kv in main.Values("therm"))
                {
                    double c = kv.Value - 273.15;
                    if (c < 5 || c > 125) continue;
                    double f;
                    if (!thermFirst.TryGetValue(kv.Key, out f)) { thermFirst[kv.Key] = c; f = c; }
                    bool live = Math.Abs(f - c) > 0.01 || double.IsNaN(f);
                    if (live) thermFirst[kv.Key] = double.NaN;
                    j.O().P("id", kv.Key).P("c", Math.Round(c, 1)).P("live", live).End();
                }
                j.End();
            }
            j.End();
        }

        private void WriteBattery(Json j)
        {
            Native.SYSTEM_POWER_STATUS s;
            if (!Native.GetSystemPowerStatus(out s)) return;
            if (s.BatteryFlag == 128 || s.BatteryFlag == 255 || s.BatteryLifePercent > 100) { j.K("bat").Null(); return; }
            j.K("bat").O().P("pct", (double)s.BatteryLifePercent).P("ac", s.ACLineStatus == 1)
                .P("charging", (s.BatteryFlag & 8) != 0).P("secs", s.BatteryLifeTime >= 0 ? (double)s.BatteryLifeTime : double.NaN).End();
        }

        // ---------------- busiest apps
        private void WriteTop(Json j)
        {
            if (procQ == null || !procQ.Warm) { if (topJson != null) { j.K("top"); RawAppend(j, topJson); } return; }
            Dictionary<string, double> cpu = new Dictionary<string, double>();
            Dictionary<string, double> mem = new Dictionary<string, double>();
            foreach (KeyValuePair<string, double> kv in procQ.Values("cpu"))
            {
                string n = BaseName(kv.Key);
                if (n == "_Total" || n == "Idle" || n == "") continue;
                double c; cpu.TryGetValue(n, out c); cpu[n] = c + kv.Value;
            }
            foreach (KeyValuePair<string, double> kv in procQ.Values("mem"))
            {
                string n = BaseName(kv.Key);
                if (n == "_Total" || n == "Idle" || n == "") continue;
                double c; mem.TryGetValue(n, out c); mem[n] = c + kv.Value;
            }
            int th = Math.Max(1, threads);
            Json t = new Json();
            t.O();
            t.K("cpu").A();
            foreach (KeyValuePair<string, double> kv in Top(cpu, 5)) t.A().S(kv.Key).N(Math.Round(Clamp100(kv.Value / th), 1)).End();
            t.End();
            t.K("mem").A();
            foreach (KeyValuePair<string, double> kv in Top(mem, 5)) t.A().S(kv.Key).N(kv.Value).End();
            t.End();
            t.End();
            topJson = t.ToString();
            j.K("top"); RawAppend(j, topJson);
        }

        private static string BaseName(string n)
        {
            int h = n.LastIndexOf('#');
            if (h > 0) n = n.Substring(0, h);
            return n;
        }

        private static List<KeyValuePair<string, double>> Top(Dictionary<string, double> d, int n)
        {
            List<KeyValuePair<string, double>> l = new List<KeyValuePair<string, double>>(d);
            l.Sort(delegate (KeyValuePair<string, double> a, KeyValuePair<string, double> b) { return b.Value.CompareTo(a.Value); });
            if (l.Count > n) l.RemoveRange(n, l.Count - n);
            return l;
        }

        private static void RawAppend(Json j, string raw) { j.Raw(raw); }

        // ---------------- external sensors (HWiNFO shared memory, LHM/OHM via PowerShell)
        private readonly List<SensorReading> external = new List<SensorReading>();
        private readonly List<SensorReading> externalNext = new List<SensorReading>();
        private readonly Dictionary<string, string> externalHw = new Dictionary<string, string>();
        private string externalSource = "";
        public bool WantExternal { get { return NeedSensors && UseWmi; } }

        public void BeginExternal(string source) { externalNext.Clear(); externalHw.Clear(); externalSource = source; }
        public void AddExternalHardware(string id, string name) { if (id != null) externalHw[id] = name ?? ""; }
        public void AddExternalSensor(string id, string parent, string name, string type, double value)
        {
            if (id == null || double.IsNaN(value)) return;
            SensorReading r = new SensorReading();
            string hw;
            if (parent == null || !externalHw.TryGetValue(parent, out hw)) hw = parent ?? "";
            r.Id = (externalSource.IndexOf("Libre", StringComparison.OrdinalIgnoreCase) >= 0 ? "lhm:" : "ohm:") + id;
            r.Hw = hw; r.Name = name ?? ""; r.Type = MapLhmType(type); r.Unit = UnitFor(r.Type, type); r.Value = value;
            externalNext.Add(r);
        }
        public void EndExternal()
        {
            external.Clear(); external.AddRange(externalNext); externalNext.Clear();
            LogOnce("ext:" + externalSource, "info", "Reading sensors from " + externalSource + " (" + external.Count + " readings)");
        }
        public void ClearExternal() { external.Clear(); }

        private static string MapLhmType(string t)
        {
            switch (t)
            {
                case "Temperature": return "temp";
                case "Fan": return "fan";
                case "Voltage": return "volt";
                case "Power": return "power";
                case "Clock": return "clock";
                case "Load": return "usage";
                case "Control": return "usage";
                case "Level": return "usage";
                case "Current": return "current";
                case "Frequency": return "clock";
                case "Throughput": return "rate";
                case "Data": return "data";
                case "SmallData": return "smalldata";
                default: return "other";
            }
        }
        private static string UnitFor(string type, string orig)
        {
            switch (type)
            {
                case "temp": return "\u00B0C";
                case "fan": return "RPM";
                case "volt": return "V";
                case "power": return "W";
                case "clock": return "MHz";
                case "usage": return "%";
                case "current": return "A";
                case "rate": return "B/s";
                case "data": return "GB";
                case "smalldata": return "MB";
                default: return "";
            }
        }

        // HWiNFO: "Shared Memory Support" must be ticked in HWiNFO's settings.
        private IntPtr hwMap = IntPtr.Zero, hwView = IntPtr.Zero;
        private DateTime hwRetryAt = DateTime.MinValue;
        private bool hwLogged;

        private void CloseHwinfo()
        {
            if (hwView != IntPtr.Zero) Native.UnmapViewOfFile(hwView);
            if (hwMap != IntPtr.Zero) Native.CloseHandle(hwMap);
            hwView = IntPtr.Zero; hwMap = IntPtr.Zero;
        }

        private List<SensorReading> ReadHwinfo()
        {
            List<SensorReading> list = new List<SensorReading>();
            if (hwView == IntPtr.Zero)
            {
                if (DateTime.UtcNow < hwRetryAt) return list;
                hwRetryAt = DateTime.UtcNow.AddSeconds(10);
                hwMap = Native.OpenFileMappingW(4, false, "Global\\HWiNFO_SENS_SM2");
                if (hwMap == IntPtr.Zero) hwMap = Native.OpenFileMappingW(4, false, "HWiNFO_SENS_SM2");
                if (hwMap == IntPtr.Zero) return list;
                hwView = Native.MapViewOfFile(hwMap, 4, 0, 0, UIntPtr.Zero);
                if (hwView == IntPtr.Zero) { CloseHwinfo(); return list; }
            }
            uint sig = (uint)Marshal.ReadInt32(hwView, 0);
            if (sig != 0x53695748) // "HWiS"; HWiNFO writes "DEAD" when it closes
            {
                CloseHwinfo();
                if (hwLogged) { Log("info", "HWiNFO stopped sharing sensors"); hwLogged = false; }
                return list;
            }
            int sOff = Marshal.ReadInt32(hwView, 20), sSize = Marshal.ReadInt32(hwView, 24), sNum = Marshal.ReadInt32(hwView, 28);
            int rOff = Marshal.ReadInt32(hwView, 32), rSize = Marshal.ReadInt32(hwView, 36), rNum = Marshal.ReadInt32(hwView, 40);
            if (sNum < 0 || sNum > 4096 || rNum < 0 || rNum > 65536 || sSize < 264 || rSize < 316) return list;
            string[] sensorNames = new string[sNum];
            uint[] sensorIds = new uint[sNum];
            uint[] sensorInst = new uint[sNum];
            for (int i = 0; i < sNum; i++)
            {
                IntPtr p = new IntPtr(hwView.ToInt64() + sOff + (long)i * sSize);
                sensorIds[i] = (uint)Marshal.ReadInt32(p, 0);
                sensorInst[i] = (uint)Marshal.ReadInt32(p, 4);
                string user = Marshal.PtrToStringAnsi(new IntPtr(p.ToInt64() + 136));
                string orig = Marshal.PtrToStringAnsi(new IntPtr(p.ToInt64() + 8));
                sensorNames[i] = string.IsNullOrEmpty(user) ? (orig ?? "") : user;
            }
            for (int i = 0; i < rNum; i++)
            {
                IntPtr p = new IntPtr(hwView.ToInt64() + rOff + (long)i * rSize);
                int type = Marshal.ReadInt32(p, 0);
                int sIdx = Marshal.ReadInt32(p, 4);
                uint rid = (uint)Marshal.ReadInt32(p, 8);
                string label = Marshal.PtrToStringAnsi(new IntPtr(p.ToInt64() + 140));
                if (string.IsNullOrEmpty(label)) label = Marshal.PtrToStringAnsi(new IntPtr(p.ToInt64() + 12));
                string unit = Marshal.PtrToStringAnsi(new IntPtr(p.ToInt64() + 268)) ?? "";
                double v = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(p, 284));
                if (sIdx < 0 || sIdx >= sNum || double.IsNaN(v)) continue;
                SensorReading r = new SensorReading();
                r.Id = "hwi:" + sensorIds[sIdx].ToString("X") + "-" + sensorInst[sIdx] + "-" + rid.ToString("X");
                r.Hw = sensorNames[sIdx];
                r.Name = label ?? "";
                string[] types = { "other", "temp", "volt", "fan", "current", "power", "clock", "usage", "other" };
                r.Type = type >= 0 && type < types.Length ? types[type] : "other";
                r.Unit = unit.Replace("\u00C2", "");
                r.Value = v;
                list.Add(r);
            }
            if (!hwLogged) { Log("info", "Reading sensors from HWiNFO (" + list.Count + " readings)"); hwLogged = true; }
            return list;
        }

        // Which sensor apps are running (checked every 5 seconds).
        private string appsJson;
        private DateTime appsAt = DateTime.MinValue;
        private void WriteApps(Json j)
        {
            if (appsJson == null || (DateTime.UtcNow - appsAt).TotalSeconds >= 5)
            {
                appsAt = DateTime.UtcNow;
                Json a = new Json();
                a.O().P("lhm", Running("LibreHardwareMonitor")).P("hwinfo", Running("HWiNFO64") || Running("HWiNFO32") || Running("HWiNFO") || Running("HWiNFO_ARM64"))
                    .P("ohm", Running("OpenHardwareMonitor")).End();
                appsJson = a.ToString();
            }
            j.K("apps").Raw(appsJson);
        }
        private static bool Running(string name)
        {
            Process[] p = Process.GetProcessesByName(name);
            bool any = p.Length > 0;
            foreach (Process x in p) x.Dispose();
            return any;
        }

        private void AddAmdCpu(List<SensorReading> list, string type, string name, string unit, double v)
        {
            if (double.IsNaN(v)) return;
            SensorReading r = new SensorReading();
            r.Id = "amd:cpu-" + type; r.Hw = "CPU (AMD driver)"; r.Name = name; r.Type = type; r.Unit = unit; r.Value = v;
            list.Add(r);
        }

        private void WriteSensors(Json j)
        {
            if (sensorsJson != null && (DateTime.UtcNow - sensorsAt).TotalMilliseconds < 1900) { j.K("sensors"); j.Raw(sensorsJson); return; }
            sensorsAt = DateTime.UtcNow;
            List<SensorReading> all = new List<SensorReading>();
            if (UseHwinfo)
            {
                try { all.AddRange(ReadHwinfo()); } catch (Exception e) { LogOnce("hwinfo", "warn", "HWiNFO: " + e.Message); CloseHwinfo(); }
            }
            if (UseWmi) all.AddRange(external);
            // CPU readings from the AMD graphics driver, when it has them
            if (HasVendor("amd"))
            {
                try { ReadAdl(); } catch (Exception e) { LogOnce("adlcpu", "warn", "AMD CPU readings: " + e.Message); }
                AddAmdCpu(all, "temp", "CPU Temperature", "\u00B0C", adlCpuTemp);
                AddAmdCpu(all, "power", "CPU Power", "W", adlCpuPower);
                AddAmdCpu(all, "clock", "CPU Clock", "MHz", adlCpuClock);
            }
            Json s = new Json();
            s.A();
            foreach (SensorReading r in all)
                s.O().P("id", r.Id).P("hw", r.Hw).P("name", r.Name).P("type", r.Type).P("unit", r.Unit).P("v", r.Value).End();
            s.End();
            sensorsJson = s.ToString();
            j.K("sensors"); j.Raw(sensorsJson);
        }

        // ---------------- parent watch
        public static bool ProcessAlive(int pid)
        {
            if (pid <= 0) return true;
            try { Process p = Process.GetProcessById(pid); return !p.HasExited; }
            catch (ArgumentException) { return false; }
            catch { return true; }
        }
    }
}
