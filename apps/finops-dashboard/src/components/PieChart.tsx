"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { PieChart as EPieChart } from "echarts/charts";
import { TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([EPieChart, TooltipComponent, LegendComponent, CanvasRenderer]);

interface PieChartProps {
  data: { name: string; value: number }[];
  height?: number;
  showLegend?: boolean;
  innerRadius?: string;
}

const palette = [
  "#38bdf8",
  "#818cf8",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#fb923c",
  "#2dd4bf",
  "#f472b6",
  "#94a3b8",
];

export function PieChart({
  data,
  height = 300,
  showLegend = true,
  innerRadius = "45%",
}: PieChartProps) {
  const option = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#1e293b",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#f1f5f9" },
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>$${p.value.toLocaleString()} (${p.percent}%)`,
    },
    legend: showLegend
      ? {
          orient: "vertical" as const,
          right: 10,
          top: "center",
          textStyle: { color: "#94a3b8", fontSize: 11 },
        }
      : undefined,
    series: [
      {
        type: "pie",
        radius: [innerRadius, "75%"],
        center: showLegend ? ["35%", "50%"] : ["50%", "50%"],
        data: data.map((d, i) => ({
          ...d,
          itemStyle: { color: palette[i % palette.length] },
        })),
        label: { show: false },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
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
