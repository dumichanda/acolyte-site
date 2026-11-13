import ReactECharts from "echarts-for-react";
import type { ComponentProps } from "react";
import { forwardRef } from "react";
import { themeName } from "./viz";

/** ECharts with the Acolyte theme applied (dark or light, following the page). */
const Chart = forwardRef<ReactECharts, ComponentProps<typeof ReactECharts>>((props, ref) => (
  <ReactECharts ref={ref} theme={themeName()} {...props} />
));
export default Chart;
