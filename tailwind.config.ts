import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 1st Nationwide brand
        brand: {
          mint: "#2FCB80",        // primary accent (logo green)
          "mint-dark": "#27A86A",
          "mint-light": "#E8F8EF",
          navy: "#0F1929",        // primary dark (headers, body bg in dark mode)
          "navy-soft": "#1B2738",
          ink: "#0B1220",
        },
        ok: "#16A34A",
        warn: "#D97706",
        err: "#DC2626",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 25, 41, 0.06), 0 4px 12px rgba(15, 25, 41, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
