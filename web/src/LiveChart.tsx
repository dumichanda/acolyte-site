import { useEffect, useRef, useState, type ComponentProps } from "react";
import Chart from "./Chart";

/** An ECharts chart that draws itself when it scrolls into view, so its animation is seen (reports and dashboards). */
export default function LiveChart(props: ComponentProps<typeof Chart>) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "0px 0px -12% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const h = (props.style as { height?: number } | undefined)?.height ?? 300;
  return <div ref={box} style={{ minHeight: h }}>{seen ? <Chart {...props} /> : null}</div>;
}
