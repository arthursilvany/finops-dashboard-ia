"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

interface BandChartProps {
  categories: string[];
  actual: (number | null)[];
  forecast: number[];
  lowerBound: number[];
  upperBound: number[];
  height?: number;
}

export function BandChart({
  categories,
  actual,
  forecast,
  lowerBound,
  upperBound,
  height = 300,
}: BandChartProps) {
  const option = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#f1f5f9" },
    },
    legend: { textStyle: { color: "#94a3b8" }, bottom: 0 },
    grid: { left: 60, right: 20, top: 10, bottom: 40 },
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
        formatter: (v: number) => `$${(v / 1000).toFixed(0)}k`,
      },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
    },
    series: [
      {
        name: "Upper Bound",
        type: "line",
        data: upperBound,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        stack: "confidence",
        symbol: "none",
      },
      {
        name: "Confidence Band",
        type: "line",
        data: upperBound.map((u, i) => u - lowerBound[i]),
        lineStyle: { opacity: 0 },
        areaStyle: { color: "rgba(129,140,248,0.15)" },
        stack: "confidence",
        symbol: "none",
      },
      {
        name: "Forecast",
        type: "line",
        data: forecast,
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#818cf8", type: "dashed" },
      },
      {
        name: "Actual",
        type: "line",
        data: actual,
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#38bdf8" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(56,189,248,0.3)" },
            { offset: 1, color: "rgba(56,189,248,0.02)" },
          ]),
        },
      },
    ],
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
