"use client";

import { useEffect, useMemo, useState } from "react";

const FALLBACK = ["UTC", "Europe/Istanbul", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];

/** IANA time zone picker grouped by region, built from the browser's own list (falls back to a short list during SSR). */
export function TimezoneSelect({ id = "timezone", name = "timezone", defaultValue, className = "" }: { id?: string; name?: string; defaultValue: string; className?: string }) {
  // The full list and the GMT offsets come from the browser; the server renders only the current
  // value so the markup matches on hydration (offsets differ between server and client clocks).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const zones = useMemo(() => {
    if (!mounted) return [[defaultValue.includes("/") ? defaultValue.split("/")[0]! : "Other", [defaultValue]] as [string, string[]]];
    let list: string[] = FALLBACK;
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
      if (all?.length) list = all;
    } catch {}
    if (!list.includes(defaultValue)) list = [defaultValue, ...list];
    const groups = new Map<string, string[]>();
    for (const z of list) {
      const region = z.includes("/") ? z.split("/")[0]! : "Other";
      groups.set(region, [...(groups.get(region) ?? []), z]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [defaultValue, mounted]);

  const offset = (z: string) => {
    try {
      const part = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
      return part && part !== "GMT" ? part : "GMT+0";
    } catch {
      return "";
    }
  };

  return (
    <select id={id} name={name} defaultValue={defaultValue} className={`input ${className}`}>
      {zones.map(([region, list]) => (
        <optgroup key={region} label={region}>
          {list.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
              {mounted ? ` (${offset(z)})` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
