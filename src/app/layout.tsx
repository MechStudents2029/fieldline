import type { Metadata, Viewport } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { RegisterPwa } from "@/components/register-pwa";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const heading = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "Fieldline",
  description: "CRM, estimates, and job margin for remodelers and specialty trades.",
  applicationName: "Fieldline",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Fieldline", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f4d3a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${heading.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <RegisterPwa />
      </body>
    </html>
  );
}
