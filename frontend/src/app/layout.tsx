import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Rajdhani } from "next/font/google";
import { Toaster } from "sonner";
import { QueryProvider } from "@/providers/QueryProvider";
import "./globals.css";

// Clever Cloud brand typography: Plus Jakarta Sans (primary) + Rajdhani
// (secondary, used for over-titles/headings via .font-overtitle).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});
const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

export const metadata: Metadata = {
  title: "myprettycloud",
  description: "Your Clever Cloud infrastructure as a living 3D city.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${rajdhani.variable}`}>
      <body>
        <QueryProvider>
          {children}
          <Toaster theme="dark" position="bottom-right" richColors />
        </QueryProvider>
      </body>
    </html>
  );
}
