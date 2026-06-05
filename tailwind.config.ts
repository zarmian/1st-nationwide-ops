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
        // 1st Nationwide brand — blue primary + navy dark. Blue values
        // align with Tailwind's standard blue palette so they're familiar,
        // but namespaced under `brand.*` so we never accidentally pull in
        // a hue from outside the system.
        brand: {
          blue: "#3B82F6",        // primary accent (logo blue)
          "blue-dark": "#2563EB",
          "blue-light": "#DBEAFE",
          "blue-50":  "#EFF6FF",
          "blue-100": "#DBEAFE",
          "blue-200": "#BFDBFE",
          "blue-300": "#93C5FD",
          "blue-400": "#60A5FA",
          "blue-500": "#3B82F6",  // = brand.blue
          "blue-600": "#2563EB",  // = brand.blue-dark
          "blue-700": "#1D4ED8",
          "blue-800": "#1E40AF",
          "blue-900": "#1E3A8A",
          navy: "#0F1929",        // primary dark
          "navy-soft": "#1B2738",
          ink: "#0B1220",
          "navy-50":  "#F4F6F9",
          "navy-100": "#E4E8EF",
          "navy-200": "#C8D1DE",
          "navy-300": "#A0AEC2",
          "navy-400": "#6B7B95",
          "navy-500": "#3F5273",
          "navy-600": "#2A3A56",
          "navy-700": "#1B2738",
          "navy-800": "#0F1929",
          "navy-900": "#0B1220",
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
        "inner-highlight": "inset 0 1px 0 0 rgba(255, 255, 255, 0.20)",
        // Lifted CTA — primary button on hover, KPI card focus.
        lift: "0 6px 16px rgba(15, 25, 41, 0.08), 0 12px 32px rgba(59, 130, 246, 0.20)",
      },
      backgroundImage: {
        // Subtle ambient backdrop for the (app) shell — blue dust at the
        // top, fading into slate.
        "ambient":
          "radial-gradient(1200px 600px at 50% -200px, rgba(59, 130, 246, 0.10), transparent 70%), linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)",
        // Primary button gradient — brand blue with a vertical tone shift
        // so the surface has shape, not just colour.
        "btn-primary-grad":
          "linear-gradient(180deg, #60A5FA 0%, #2563EB 100%)",
        "btn-primary-grad-hover":
          "linear-gradient(180deg, #3B82F6 0%, #1E40AF 100%)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // Pulsing dot — for live status (currently in progress, on shift).
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(1.25)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        "pop-in": "pop-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
