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
        // Semantic tokens — same palette as Tailwind defaults but named
        // by intent so the app's components reference meaning, not hue.
        // Use these in chips, status dots, banners, focus rings.
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
        info: "#2563EB",
        // Legacy aliases (kept while files migrate)
        ok: "#16A34A",
        warn: "#D97706",
        err: "#DC2626",
      },
      fontFamily: {
        // --font-sans is injected by next/font/google in app/layout.tsx;
        // the rest of the chain is the system fallback during the font
        // load swap window.
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        // Elevation scale — pick by altitude, not by random shadow class.
        // sm  = inline UI (buttons, chips)
        // card = default surface (cards, panels) — pre-existing
        // md  = floating UI (dropdowns, popovers, sticky sub-panels)
        // lg  = overlays (modals, side sheets)
        card: "0 1px 2px rgba(15, 25, 41, 0.06), 0 4px 12px rgba(15, 25, 41, 0.04)",
        md: "0 4px 12px rgba(15, 25, 41, 0.08), 0 12px 28px rgba(15, 25, 41, 0.06)",
        lg: "0 8px 24px rgba(15, 25, 41, 0.10), 0 24px 56px rgba(15, 25, 41, 0.08)",
      },
      keyframes: {
        // Skeleton shimmer (used by `.skeleton`).
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
