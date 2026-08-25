import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy: {
          900: "#0a1929",
          800: "#0d2137",
          700: "#112a45",
          600: "#163353",
        },
        score: {
          good: "#22c55e",
          warning: "#f59e0b",
          alert: "#ef4444",
        },
        impact: {
          high: "#ef4444",
          medium: "#f59e0b",
          low: "#3b82f6",
        },
      },
    },
  },
  plugins: [],
};

export default config;
