"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { GaugeChart as EGaugeChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([EGaugeChart, CanvasRenderer]);

interface GaugeChartProps {
  value: number;
  max?: number;
  title?: string;
  suffix?: string;
  color?: string;
  height?: number;
}

export function GaugeChart({
  value,
  max = 100,
  title,
  suffix = "%",
  color = "#38bdf8",
  height = 200,
}: GaugeChartProps) {
  const option = {
    series: [
      {
        type: "gauge",
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max,
        progress: {
          show: true,
          width: 14,
          itemStyle: { color },
        },
        axisLine: {
          lineStyle: { width: 14, color: [[1, "rgba(255,255,255,0.08)"]] },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: {
          show: !!title,
          offsetCenter: [0, "70%"],
          fontSize: 12,
          color: "#94a3b8",
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "20%"],
          fontSize: 24,
          fontWeight: "bold",
          formatter: `{value}${suffix}`,
          color: "#f1f5f9",
        },
        data: [{ value: Math.round(value * 10) / 10, name: title ?? "" }],
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
