import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 30px rgba(0, 240, 255, 0.16)",
      },
    },
  },
  plugins: [],
};
export default config;
