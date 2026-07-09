import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gov: {
          DEFAULT: "#1c4f8c",
          dark: "#123963",
          light: "#3a6fae",
        },
        tier: {
          green: "#1e8f4e",
          amber: "#c98a12",
          red: "#c4321f",
          legacy: "#7b3fa0",
        },
      },
    },
  },
  plugins: [],
};

export default config;
