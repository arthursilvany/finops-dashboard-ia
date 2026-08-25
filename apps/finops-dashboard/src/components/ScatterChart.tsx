"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { ScatterChart as EScatterChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  EScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export interface ScatterPoint {
  name: string;
  x: number;
  y: number;
  z?: number;
}

interface ScatterSeries {
  name: string;
  data: ScatterPoint[];
  color?: string;
}

interface ScatterChartProps {
  series: ScatterSeries[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  showLegend?: boolean;
}

const defaultColors = ["#38bdf8", "#34d399", "#fbbf24", "#f87171", "#818cf8"];

export function ScatterChart({
  series,
  height = 300,
  xLabel,
  yLabel,
  formatX,
  formatY,
  showLegend = true,
}: ScatterChartProps) {
  const option = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#1e293b",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
      formatter: (p: {
        seriesName: string;
        data: { name: string; value: [number, number] };
      }) => {
        const { seriesName, data } = p;
        const xVal = formatX ? formatX(data.value[0]) : data.value[0];
        const yVal = formatY ? formatY(data.value[1]) : data.value[1];
        return `<b>${data.name}</b><br/>${xLabel ?? "X"}: ${xVal}<br/>${yLabel ?? "Y"}: ${yVal}<br/>Service: ${seriesName}`;
      },
    },
    legend: showLegend
      ? { textStyle: { color: "#94a3b8" }, bottom: 0 }
      : undefined,
    grid: { left: 64, right: 20, top: 16, bottom: showLegend ? 44 : 24 },
    xAxis: {
      name: xLabel,
      nameTextStyle: { color: "#94a3b8", fontSize: 11 },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
        formatter: formatX ?? ((v: number) => String(v)),
      },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
    },
    yAxis: {
      name: yLabel,
      nameTextStyle: { color: "#94a3b8", fontSize: 11 },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
        formatter: formatY ?? ((v: number) => String(v)),
      },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
    },
    series: series.map((s, i) => ({
      name: s.name,
      type: "scatter",
      symbolSize: (d: [number, number, number?]) => {
        const z = d[2];
        if (z == null) return 8;
        return Math.max(6, Math.min(28, Math.sqrt(z / 1000) * 4));
      },
      data: s.data.map((pt) => ({
        name: pt.name,
        value: [pt.x, pt.y, pt.z ?? 0],
      })),
      itemStyle: {
        color: s.color ?? defaultColors[i % defaultColors.length],
        opacity: 0.8,
      },
    })),
  };

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height }}
      notMerge
    />
  );
}
