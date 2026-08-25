"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

interface AreaChartSeries {
  name: string;
  data: number[];
  color?: string;
  areaOpacity?: number;
  lineStyle?: "solid" | "dashed";
}

interface AreaChartProps {
  categories: string[];
  series: AreaChartSeries[];
  height?: number;
  showLegend?: boolean;
  stacked?: boolean;
  markLines?: { label: string; value: number; color?: string }[];
  formatValue?: (v: number) => string;
}

const defaultColors = [
  "#38bdf8",
  "#818cf8",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
];

export function AreaChart({
  categories,
  series,
  height = 300,
  showLegend = true,
  stacked = false,
  markLines,
  formatValue,
}: AreaChartProps) {
  const option = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#f1f5f9" },
    },
    legend: showLegend
      ? { textStyle: { color: "#94a3b8" }, bottom: 0 }
      : undefined,
    grid: { left: 60, right: 20, top: 10, bottom: showLegend ? 40 : 20 },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: "#94a3b8", fontSize: 11 },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
        formatter: formatValue ?? ((v: number) => `$${(v / 1000).toFixed(0)}k`),
      },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
    },
    series: series.map((s, i) => {
      const color = s.color ?? defaultColors[i % defaultColors.length];
      return {
        name: s.name,
        type: "line",
        data: s.data,
        smooth: true,
        symbol: "none",
        ...(stacked ? { stack: "total" } : {}),
        lineStyle: {
          color,
          type: s.lineStyle ?? "solid",
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + "40" },
            { offset: 1, color: color + "05" },
          ]),
          opacity: s.areaOpacity ?? 0.7,
        },
        markLine:
          i === 0 && markLines
            ? {
                silent: true,
                data: markLines.map((ml) => ({
                  yAxis: ml.value,
                  label: {
                    formatter: ml.label,
                    color: ml.color ?? "#fbbf24",
                    fontSize: 11,
                  },
                  lineStyle: { color: ml.color ?? "#fbbf24", type: "dashed" },
                })),
              }
            : undefined,
      };
    }),
  };

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height }}
      opts={{ renderer: "canvas" }}
      notMerge
    />
  );
}
