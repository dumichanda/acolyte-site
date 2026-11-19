import { useMemo } from "react";
import LiveChart from "../LiveChart";
import { readTheme } from "../charts";
import { chartOption, fmt, type ChartArtifact } from "../analyst/chart";

/** One chart, table or big number from a report, drawn when it scrolls into view. */
export default function ChartBlock({ c, height = 300 }: { c: ChartArtifact; height?: number }) {
  const t = useMemo(() => readTheme(), []);
  if (c.type === "kpi") {
    const yi = c.columns.indexOf(c.y[0]);
    return <div className="rp-bigkpi"><b>{fmt(c.rows[0]?.[yi], c.value_format)}</b><span>{c.y[0]}</span></div>;
  }
  if (c.type === "table") {
    const idx = [c.columns.indexOf(c.x), ...c.y.map((y) => c.columns.indexOf(y))].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
    return (
      <div className="rp-table"><table>
        <thead><tr>{idx.map((i) => <th key={i}>{c.columns[i]}</th>)}</tr></thead>
        <tbody>{c.rows.slice(0, 15).map((r, k) => <tr key={k}>{idx.map((i) => (
          <td key={i} className={typeof r[i] === "number" ? "num" : ""}>
            {typeof r[i] === "number" ? fmt(r[i], c.y.includes(c.columns[i]) ? c.value_format : "number") : String(r[i] ?? "—")}</td>))}</tr>)}</tbody>
      </table></div>
    );
  }
  return <LiveChart style={{ height }} option={chartOption(c, t)} notMerge />;
}
