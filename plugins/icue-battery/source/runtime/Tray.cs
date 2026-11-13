// Reads the text of the iCUE icon in the Windows notification area (read only). Experimental: it only LOGS what it sees.
// Compiled separately from Helper.cs, so if it fails the rest of the helper still works.
using System;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Automation;

namespace IcueBattery
{
    public static class Tray
    {
        static readonly Dictionary<string, int> seen = new Dictionary<string, int>();
        static string json = "[]";
        static readonly object lk = new object();

        // JSON array of every taskbar/tray text that contains "Battery Status" (read by Helper through reflection)
        public static string Json() { lock (lk) return json; }
        static volatile bool stop = false;

        static void Say(string level, string msg)
        {
            string m = msg.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
            Console.Out.WriteLine("{\"type\":\"log\",\"level\":\"" + level + "\",\"msg\":\"" + m + "\"}");
            Console.Out.Flush();
        }

        public static void Start()
        {
            Thread t = new Thread(Loop);
            t.IsBackground = true;
            t.Start();
        }

        // tooltips contain line breaks and other control characters: turn them into single spaces so the JSON stays valid
        static string Clean(string text)
        {
            System.Text.StringBuilder sb = new System.Text.StringBuilder();
            bool space = false;
            foreach (char ch in text)
            {
                if (ch < ' ' || ch == '\u00a0' || ch == ' ') { space = true; continue; }
                if (space && sb.Length > 0) sb.Append(' ');
                space = false;
                if (ch == '"' || ch == '\\') sb.Append('\'');
                else sb.Append(ch);
            }
            return sb.ToString();
        }

        static bool Wanted(string name)
        {
            string n = name.ToLowerInvariant();
            return n.IndexOf("hs80") >= 0 || n.IndexOf("icue") >= 0 || n.IndexOf("corsair") >= 0 || n.IndexOf("charg") >= 0 || n.IndexOf("battery") >= 0;
        }

        static void Loop()
        {
            Say("info", "Tray reader started");
            int scans = 0;
            while (!stop)
            {
                try
                {
                    AutomationElement root = AutomationElement.RootElement;
                    Condition c = new OrCondition(
                        new PropertyCondition(AutomationElement.ClassNameProperty, "Shell_TrayWnd"),
                        new PropertyCondition(AutomationElement.ClassNameProperty, "NotifyIconOverflowWindow"),
                        new PropertyCondition(AutomationElement.ClassNameProperty, "TopLevelWindowForOverflowXamlIsland"));
                    AutomationElementCollection wins = root.FindAll(TreeScope.Children, c);
                    int count = 0;
                    List<string> found = new List<string>();
                    foreach (AutomationElement w in wins)
                    {
                        AutomationElementCollection all = w.FindAll(TreeScope.Descendants, Condition.TrueCondition);
                        foreach (AutomationElement e in all)
                        {
                            count++;
                            string name = "";
                            try { name = e.Current.Name; } catch (Exception) { }
                            if (string.IsNullOrEmpty(name) || !Wanted(name)) continue;
                            if (name.IndexOf("Battery Status", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                string clean = Clean(name);
                                if (!found.Contains(clean)) found.Add(clean);
                            }
                            if (seen.ContainsKey(name) || seen.Count >= 200) continue;
                            seen[name] = 1;
                            Say("info", "Tray text: " + name);
                        }
                    }
                    System.Text.StringBuilder sb = new System.Text.StringBuilder("[");
                    for (int i = 0; i < found.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        sb.Append('"').Append(found[i].Replace("\\", "\\\\").Replace("\"", "\\\"")).Append('"');
                    }
                    sb.Append(']');
                    string now = sb.ToString();
                    lock (lk)
                    {
                        if (now != json) { json = now; Say("info", "Tray battery text now: " + now); }
                    }
                    scans++;
                    if (scans == 1) Say("info", "Tray scan 1: " + wins.Count + " taskbar windows, " + count + " items");
                }
                catch (Exception ex) { Say("warn", "Tray scan failed: " + ex.Message); Thread.Sleep(5000); }
                Thread.Sleep(1000);
            }
        }
    }
}
