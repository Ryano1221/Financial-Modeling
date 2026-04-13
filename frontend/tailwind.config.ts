import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-dm-mono)"],
        mono: ["var(--font-dm-mono)"],
        display: ["var(--font-syne)"],
      },
    },
  },
  plugins: [],
};
export default config;
