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
        // 1st Nationwide brand — full mint + navy scales so components
        // can reach for an exact shade without inventing one. The brand
        // hub colours stay where they were so existing references
        // (brand.mint, brand.navy, brand.mint-light, etc.) keep working.
        brand: {
          mint: "#2FCB80",        // primary accent (logo green)
          "mint-dark": "#27A86A",
          "mint-light": "#E8F8EF",
          // Mint scale — for backgrounds, tints, hover layers, active
          // states. Tuned to read against white surfaces.
          "mint-50":  "#F0FBF5",
          "mint-100": "#D4F5E2",
          "mint-200": "#A8EAC4",
          "mint-300": "#7DDFA6",
          "mint-400": "#52D588",
          "mint-500": "#2FCB80",  // = brand.mint
          "mint-600": "#27A86A",  // = brand.mint-dark
          "mint-700": "#1F8855",
          "mint-800": "#176540",
          "mint-900": "#0E4329",
          navy: "#0F1929",        // primary dark
          "navy-soft": "#1B2738",
          ink: "#0B1220",
          // Navy scale for text + neutral surfaces with brand warmth.
          "navy-50":  "#F4F6F9",
          "navy-100": "#E4E8EF",
          "navy-200": "#C8D1DE",
          "navy-300": "#A0AEC2",
          "navy-400": "#6B7B95",
          "navy-500": "#3F5273",
          "navy-600": "#2A3A56",
          "navy-700": "#1B2738",  // = brand.navy-soft
          "navy-800": "#0F1929",  // = brand.navy
          "navy-900": "#0B1220",  // = brand.ink
        },
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
        info: "#2563EB",
        ok: "#16A34A",
        warn: "#D97706",
        err: "#DC2626",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 25, 41, 0.06), 0 4px 12px rgba(15, 25, 41, 0.04)",
        md: "0 4px 12px rgba(15, 25, 41, 0.08), 0 12px 28px rgba(15, 25, 41, 0.06)",
        lg: "0 8px 24px rgba(15, 25, 41, 0.10), 0 24px 56px rgba(15, 25, 41, 0.08)",
        // Inner highlight to sit on top of the mint primary — gives the
        // button surface a subtle bevelled feel without going skeuomorphic.
        "inner-highlight":
          "inset 0 1px 0 0 rgba(255, 255, 255, 0.20)",
        // Lifted CTA — primary button on hover, KPI card focus.
        lift: "0 6px 16px rgba(15, 25, 41, 0.08), 0 12px 32px rgba(47, 203, 128, 0.18)",
      },
      backgroundImage: {
        // Subtle ambient backdrop for the (app) shell — mint dust at the
        // top, fading into slate. Less flat than a single bg-slate-50.
        "ambient":
          "radial-gradient(1200px 600px at 50% -200px, rgba(47, 203, 128, 0.10), transparent 70%), linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)",
        // Primary button gradient — same brand mint with a subtle vertical
        // gradient so the button has shape, not just colour.
        "btn-primary-grad":
          "linear-gradient(180deg, #36D389 0%, #27A86A 100%)",
        "btn-primary-grad-hover":
          "linear-gradient(180deg, #2FCB80 0%, #1F8855 100%)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        // Subtle pop for entry/CTA reinforcement.
        "pop-in": {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        "pop-in": "pop-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
