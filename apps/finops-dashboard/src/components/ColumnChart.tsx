"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

interface ColumnChartProps {
  categories: string[];
  series: { name: string; data: number[]; color?: string }[];
  height?: number;
  horizontal?: boolean;
  showLegend?: boolean;
  stacked?: boolean;
  formatValue?: (v: number) => string;
}

const defaultColors = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#f87171"];

export function ColumnChart({
  categories,
  series,
  height = 300,
  horizontal = false,
  showLegend = true,
  stacked = false,
  formatValue,
}: ColumnChartProps) {
  const categoryAxis = {
    type: "category" as const,
    data: categories,
    axisLabel: { color: "#94a3b8", fontSize: 11 },
    axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
  };

  const valueAxis = {
    type: "value" as const,
    axisLabel: {
      color: "#94a3b8",
      fontSize: 11,
      formatter: formatValue ?? ((v: number) => `$${(v / 1000).toFixed(0)}k`),
    },
    splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
  };

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
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: series.map((s, i) => ({
      name: s.name,
      type: "bar",
      data: s.data,
      barMaxWidth: 32,
      ...(stacked ? { stack: "total" } : {}),
      itemStyle: {
        color: s.color ?? defaultColors[i % defaultColors.length],
        borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
      },
    })),
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
