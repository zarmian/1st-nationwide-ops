import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

// Self-host Inter via next/font so it renders on first paint (no FOUT,
// no fallback drift) and gets dropped into Tailwind via --font-sans.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "1st Nationwide Ops",
  description: "Operations platform for 1st Nationwide Security Services",
  applicationName: "1NW Ops",
  appleWebApp: {
    capable: true,
    title: "1NW Ops",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/logo.jpg", type: "image/jpeg" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/logo.jpg", type: "image/jpeg" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#2FCB80",
  width: "device-width",
  initialScale: 1,
  // Avoid the iOS keyboard scaling the page out from under the user.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
