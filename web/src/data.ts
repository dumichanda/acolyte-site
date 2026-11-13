import { useEffect, useState } from "react";
import type { Snapshot } from "./types";
import { url } from "./site";
import { readTheme, type Theme } from "./charts";

/** Loads the public snapshot produced by the daily pipeline. */
export function useSnapshot(): { s: Snapshot | null; err: string | null } {
  const [s, setS] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(url("/data/snapshot.json"))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setS)
      .catch((e) => setErr(String(e)));
  }, []);
  return { s, err };
}

export function useChartTheme(): Theme | null {
  const [t, setT] = useState<Theme | null>(null);
  useEffect(() => setT(readTheme()), []);
  return t;
}

export const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
