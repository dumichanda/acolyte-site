import { useCallback, useEffect, useState } from "react";

/**
 * A client's own databases, connected read-only (PostgreSQL, MySQL / MariaDB, SQL Server). The analyst queries them in
 * place: nothing is copied out. The client creates a read-only login for Acolyte; the password is stored encrypted and
 * never shown again. The client stays responsible for the data (the data-responsibility clauses); Acolyte is the operator.
 */
interface Conn { id: number; name: string; kind: string; host: string; port: number; database: string; username: string; ssl: boolean;
  schemas: string[]; status: string; error: string | null; tested_at: string | null; catalog: { schema: string; table: string; columns: unknown[] }[] }
type Call = (path: string, method?: string, body?: unknown) => Promise<any>;

const KIND: Record<string, [string, number]> = { postgres: ["PostgreSQL", 5432], mysql: ["MySQL / MariaDB", 3306], mssql: ["SQL Server", 1433] };
const GRANTS: Record<string, string> = {
  postgres: "CREATE ROLE acolyte_ro LOGIN PASSWORD '…';\nGRANT CONNECT ON DATABASE your_db TO acolyte_ro;\nGRANT USAGE ON SCHEMA your_schema TO acolyte_ro;\nGRANT SELECT ON ALL TABLES IN SCHEMA your_schema TO acolyte_ro;\nALTER ROLE acolyte_ro SET default_transaction_read_only = on;",
  mysql: "CREATE USER 'acolyte_ro'@'%' IDENTIFIED BY '…';\nGRANT SELECT ON your_db.* TO 'acolyte_ro'@'%';",
  mssql: "CREATE LOGIN acolyte_ro WITH PASSWORD = '…';\nUSE your_db;\nCREATE USER acolyte_ro FOR LOGIN acolyte_ro;\nALTER ROLE db_datareader ADD MEMBER acolyte_ro;",
};
const EMPTY = { name: "", kind: "postgres", host: "", port: "", database: "", username: "", password: "", ssl: true, schemas: "" };

export default function Databases({ account, call, onDone }: { account: { id: number; name: string }; call: Call; onDone: () => void }) {
  const [list, setList] = useState<Conn[] | null>(null);
  const [f, setF] = useState<typeof EMPTY>(EMPTY), [edit, setEdit] = useState<number | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [msg, setMsg] = useState("");
  const base = `/admin/accounts/${account.id}/connections`;
  const load = useCallback(() => call(base).then((d) => setList(d.connections)).catch((e) => setErr(e.message)), [call, base]);
  useEffect(() => { load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(""); setMsg(""); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); } };
  const save = () => run("save", async () => {
    const body = { ...f, port: f.port ? Number(f.port) : null, password: f.password || null, schemas: f.schemas.split(",").map((x) => x.trim()).filter(Boolean) };
    const d: Conn = await call(edit ? `${base}/${edit}` : base, edit ? "PUT" : "POST", body);
    setMsg(d.status === "ok" ? `Connected to ${d.name}: the analyst can see ${d.catalog.length} table(s).` : `Saved, but the test failed: ${d.error}`);
    if (d.status === "ok") { setF(EMPTY); setEdit(null); }
  });
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="branding dbs">
      <div className="b-head"><h3>Databases for {account.name}</h3><button className="link" onClick={onDone}>Close</button></div>
      <p className="desc">Connect the client's own database so their analyst can query it where it lives. Nothing is copied out. Ask the client
        for a <b>read-only</b> login (the commands are below) and to allow Acolyte's server through their firewall. The client stays responsible
        for the data and its lawful use; Acolyte acts as their operator.</p>
      {list && list.length > 0 && (
        <table><thead><tr><th>Name</th><th>Type</th><th>Host / database</th><th>Status</th><th /></tr></thead>
          <tbody>{list.map((c) => (
            <tr key={c.id}>
              <td><b>{c.name}</b></td><td>{KIND[c.kind]?.[0]}</td><td className="small">{c.host}:{c.port} / {c.database}{c.schemas.length ? ` (${c.schemas.join(", ")})` : ""}</td>
              <td className="small">{c.status === "ok" ? `Connected · ${c.catalog.length} tables` : c.status === "error" ? <span className="err-text">{c.error}</span> : "Not tested"}</td>
              <td className="small">
                <button className="link" disabled={!!busy} onClick={() => run(`t${c.id}`, async () => { const d: Conn = await call(`${base}/${c.id}/test`, "POST");
                  setMsg(d.status === "ok" ? `${d.name}: connected, ${d.catalog.length} table(s).` : `${d.name}: ${d.error}`); })}>{busy === `t${c.id}` ? "Testing…" : "Test"}</button>{" · "}
                <button className="link" onClick={() => { setEdit(c.id); setF({ name: c.name, kind: c.kind, host: c.host, port: String(c.port), database: c.database,
                  username: c.username, password: "", ssl: c.ssl, schemas: c.schemas.join(", ") }); }}>Edit</button>{" · "}
                <button className="link" onClick={() => confirm(`Disconnect ${c.name}? Dashboards built on it will stop refreshing.`) && run(`d${c.id}`, async () => { await call(`${base}/${c.id}`, "DELETE"); })}>Disconnect</button>
              </td>
            </tr>))}</tbody></table>)}
      {list && !list.length && <p className="muted small">No databases connected yet.</p>}
      <form className="b-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="b-form">
          <span className="lbl">{edit ? "Edit connection" : "Add a database"}</span>
          <label htmlFor="db-name">Name</label><input id="db-name" value={f.name} onChange={set("name")} placeholder="e.g. Sales warehouse" required />
          <label htmlFor="db-kind">Type</label>
          <select id="db-kind" value={f.kind} onChange={set("kind")}>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <label htmlFor="db-host">Host</label><input id="db-host" value={f.host} onChange={set("host")} placeholder="db.client.co.za" required />
          <label htmlFor="db-port">Port</label><input id="db-port" value={f.port} onChange={set("port")} placeholder={String(KIND[f.kind][1])} inputMode="numeric" />
          <label htmlFor="db-db">Database</label><input id="db-db" value={f.database} onChange={set("database")} required />
          <label htmlFor="db-user">Read-only username</label><input id="db-user" value={f.username} onChange={set("username")} autoComplete="off" required />
          <label htmlFor="db-pass">Password{edit ? " (blank = keep)" : ""}</label><input id="db-pass" type="password" value={f.password} onChange={set("password")} autoComplete="new-password" required={!edit} />
          <label htmlFor="db-sch">Only these schemas (optional, comma-separated)</label><input id="db-sch" value={f.schemas} onChange={set("schemas")} placeholder="sales, finance" />
          <label className="chk"><input type="checkbox" checked={f.ssl} onChange={(e) => setF({ ...f, ssl: e.target.checked })} /> Require an encrypted (SSL) connection</label>
          <div className="row">
            <button className="btn primary" disabled={!!busy}>{busy === "save" ? "Connecting…" : edit ? "Save and test" : "Connect and test"}</button>
            {edit && <button type="button" className="link" onClick={() => { setEdit(null); setF(EMPTY); }}>Cancel</button>}
          </div>
        </div>
        <div className="b-form">
          <span className="lbl">Send the client these commands to create Acolyte's read-only login ({KIND[f.kind][0]})</span>
          <pre className="grants">{GRANTS[f.kind]}</pre>
          <p className="small muted">The analyst only ever runs single SELECT statements with a 15-second limit, but the read-only login is the real guarantee.
            Addresses on private networks are refused: the database must be reachable from the internet, ideally only from Acolyte's server.</p>
        </div>
      </form>
      {msg && <div className="notice">{msg}</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
