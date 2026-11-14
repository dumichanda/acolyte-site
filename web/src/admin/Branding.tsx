import { useEffect, useState } from "react";
import type { Brand } from "../analyst/deck";
import type { ReportArtifact } from "../analyst/chart";

const PRESETS: Record<string, [string, string, string]> = {
  acolyte: ["Acolyte", "C8F135", "0C0C0E"], ocean: ["Ocean", "38A3FF", "0B1A2B"], emerald: ["Emerald", "2ECC8F", "0B1F17"],
  royal: ["Royal", "8B7CFF", "14112B"], sunset: ["Sunset", "FF8A3D", "1F120B"], gold: ["Gold", "E8C15A", "141414"],
};

/** Read an image file, shrink it to fit maxW x maxH, and return a PNG/JPEG data URL with its aspect ratio. */
function loadImage(file: File, maxW: number, maxH: number, jpeg: boolean): Promise<{ data: string; aspect: number }> {
  return new Promise((res, rej) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) { rej(new Error("Use a PNG or JPG file.")); return; }
    const r = new FileReader();
    r.onerror = () => rej(new Error("Couldn't read that file."));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("That file isn't a readable image."));
      img.onload = () => {
        const k = Math.min(1, maxW / img.width, maxH / img.height);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        res({ data: jpeg ? c.toDataURL("image/jpeg", 0.82) : c.toDataURL("image/png"), aspect: img.width / img.height });
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
}

const SAMPLE = (name: string): ReportArtifact => ({
  kind: "report", id: "sample", title: `${name || "Client"}: sample monthly pack`, scope: "Sample layout, not real findings",
  summary: "", generated: new Date().toISOString(), questions: ["Where is demand heading?"],
  cover_kpis: [{ value: "190,220", label: "Homes for sale", context: "sample", tone: "brand" }],
  exec: { title: "Sample summary", takeaway: "This sample shows how your branded packs will look.", kpis: [
    { value: "190,220", label: "Homes for sale", context: "sample", tone: "brand" }, { value: "+12%", label: "Searches", context: "sample", tone: "positive" }],
    so_what: "Your colours, logo and cover appear on every slide.", catch: "Sample figures." },
  sections: [{ question: "Where is demand heading?", title: "Searches recovered 23% from the August low", heading: "", body: "",
    takeaway: "Sample takeaway.", chart_ids: ["c1"], kpis: [{ value: "53", label: "November", context: "sample", tone: "brand" }],
    so_what: "Sample so-what.", note: "Sample note.", bullets: [] }],
  charts: { c1: { kind: "chart", id: "c1", dataset_id: "d1", type: "line", x: "Month", y: ["Interest"], title: "Search interest (sample)",
    subtitle: "Sample data", value_format: "number", columns: ["Month", "Interest"], sql: "",
    rows: [["Jun", 56], ["Jul", 44], ["Aug", 43], ["Sep", 49], ["Oct", 46], ["Nov", 53]],
    annotations: [{ kind: "band", at: "Jul", to: "Aug", y: null, y_to: null, label: "Mid-year lull", tone: "neutral" }] } },
  conclusions: { findings: ["Sample finding"], actions: ["Sample action"], risks: ["Sample risk"] }, method: { steps: ["Sample"], limits: [] }, qa: [],
} as unknown as ReportArtifact);

export default function Branding({ account, call, onDone }: {
  account: { id: number; name: string }; call: (path: string, method?: string, body?: unknown) => Promise<any>; onDone: () => void;
}) {
  const [b, setB] = useState<Brand & { preset?: string }>({ name: account.name, accent: "C8F135", dark: "0C0C0E", preset: "acolyte", style: "alternate" });
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { call(`/admin/accounts/${account.id}/brand`).then((d) => d.brand && setB({ ...d.brand })).catch(() => {}); }, [account.id, call]);
  const up = (key: "logo" | "cover") => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const im = key === "logo" ? await loadImage(f, 600, 300, false) : await loadImage(f, 1400, 1400, true);
      setB((x) => ({ ...x, [key]: im.data, [key + "Aspect"]: im.aspect })); setMsg("");
    } catch (err) { setMsg((err as Error).message); }
  };
  const save = async (clear = false) => {
    setBusy(true); setMsg("");
    try { await call(`/admin/accounts/${account.id}/brand`, "PUT", { brand: clear ? null : b }); setMsg(clear ? "Branding removed." : "Saved. The client's next downloads use this branding."); if (clear) onDone(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const sample = async (pdf = false) => {
    setBusy(true);
    try {
      const ex = await import("../analyst/export");
      ex.setBrand({ ...b, name: b.name || account.name });
      const r = SAMPLE(b.name || account.name), style = (b.style as any) || "alternate";
      await (pdf ? ex.reportToPdf(r, "standard", style) : ex.reportToPptx(r, "standard", style));
    } finally { (await import("../analyst/export")).setBrand(null); setBusy(false); }
  };
  return (
    <div className="branding">
      <div className="b-head"><h3>Branding for {account.name}</h3><button className="link" onClick={onDone}>Close</button></div>
      <p className="desc">These replace Acolyte's colours and logo in this client's PowerPoint and PDF packs, briefs and dashboard exports.</p>
      <div className="b-grid">
        <div className="b-form">
          <label htmlFor="b-name">Name shown on the packs</label>
          <input id="b-name" value={b.name || ""} onChange={(e) => setB({ ...b, name: e.target.value })} />
          <span className="lbl">Theme</span>
          <div className="presets">{Object.entries(PRESETS).map(([k, [label, a, d]]) => (
            <button key={k} type="button" className={b.preset === k ? "on" : ""} onClick={() => setB({ ...b, preset: k, accent: a, dark: d })}>
              <i style={{ background: `linear-gradient(135deg, #${d} 55%, #${a} 55%)` }} />{label}</button>))}
          </div>
          <div className="colors">
            <label>Accent <input type="color" value={"#" + b.accent} onChange={(e) => setB({ ...b, preset: "custom", accent: e.target.value.slice(1).toUpperCase() })} /></label>
            <label>Dark <input type="color" value={"#" + b.dark} onChange={(e) => setB({ ...b, preset: "custom", dark: e.target.value.slice(1).toUpperCase() })} /></label>
          </div>
          <label htmlFor="b-logo">Logo (PNG with a transparent background works best)</label>
          <input id="b-logo" type="file" accept="image/png,image/jpeg" onChange={up("logo")} />
          {b.logo && <button type="button" className="link" onClick={() => setB({ ...b, logo: null })}>Remove logo</button>}
          <label htmlFor="b-cover">Cover image (optional, shown on the cover slide)</label>
          <input id="b-cover" type="file" accept="image/png,image/jpeg" onChange={up("cover")} />
          {b.cover && <button type="button" className="link" onClick={() => setB({ ...b, cover: null })}>Remove cover image</button>}
          <label htmlFor="b-style">Default slide style</label>
          <select id="b-style" value={b.style || "alternate"} onChange={(e) => setB({ ...b, style: e.target.value })}>
            <option value="alternate">Alternating dark and light</option><option value="dark">Dark</option><option value="light">Light</option>
          </select>
        </div>
        <div className="b-preview" style={{ background: "#" + b.dark }} aria-label="Cover preview">
          <div className="pv-left">
            {b.logo ? <img src={b.logo} alt="" className="pv-logo" /> : <b style={{ color: "#fff", letterSpacing: 3 }}>{(b.name || account.name).toUpperCase()}</b>}
            <span className="pv-rule" style={{ background: "#" + b.accent }} />
            <b className="pv-title">{b.name || account.name}: monthly pack</b>
            <span className="pv-kpi" style={{ color: "#" + b.accent }}>190,220</span>
          </div>
          <div className="pv-right" style={b.cover ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)), url(${b.cover})` } : { background: "rgba(255,255,255,.06)" }}>
            <span style={{ color: "#" + b.accent }}>QUESTIONS THIS PACK ANSWERS</span>
          </div>
        </div>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => save()}>Save branding</button>
        <button className="btn" disabled={busy} onClick={() => sample()}>{busy ? "Working…" : "Sample PowerPoint"}</button>
        <button className="btn" disabled={busy} onClick={() => sample(true)}>Sample PDF</button>
        <button className="btn" disabled={busy} onClick={() => save(true)}>Remove branding</button>
        {msg && <span className="small muted">{msg}</span>}
      </div>
    </div>
  );
}
