"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { RadarChart as ERadarChart } from "echarts/charts";
import {
  RadarComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  ERadarChart,
  RadarComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export interface RadarIndicator {
  name: string;
  max: number;
}

export interface RadarSeries {
  name: string;
  values: number[];
  color?: string;
}

interface RadarChartProps {
  indicators: RadarIndicator[];
  series: RadarSeries[];
  height?: number;
  showLegend?: boolean;
}

const defaultColors = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24"];

export function RadarChart({
  indicators,
  series,
  height = 300,
  showLegend = true,
}: RadarChartProps) {
  const option = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#1e293b",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
    },
    legend: showLegend
      ? {
          data: series.map((s) => s.name),
          textStyle: { color: "#94a3b8", fontSize: 11 },
          bottom: 4,
          itemGap: 16,
        }
      : undefined,
    radar: {
      indicator: indicators,
      radius: "60%",
      center: ["50%", "48%"],
      axisName: {
        color: "#94a3b8",
        fontSize: 11,
        formatter: (name: string) =>
          name.length > 10 ? name.replace(/\s+/g, "\n") : name,
      },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      splitArea: {
        areaStyle: {
          color: ["rgba(255,255,255,0.02)", "rgba(255,255,255,0.04)"],
        },
      },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
    },
    series: [
      {
        type: "radar",
        data: series.map((s, i) => ({
          name: s.name,
          value: s.values,
          areaStyle: {
            color: (s.color ?? defaultColors[i % defaultColors.length]) + "33",
          },
          lineStyle: {
            color: s.color ?? defaultColors[i % defaultColors.length],
          },
          itemStyle: {
            color: s.color ?? defaultColors[i % defaultColors.length],
          },
        })),
      },
    ],
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
