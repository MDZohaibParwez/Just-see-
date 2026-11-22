import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ClientBoot } from "@/components/ClientBoot";

export const metadata: Metadata = {
  title: "Just See — video editor",
  description: "Edit video like a pro, right in your phone browser.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Just See", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0d10",
};

// Applied before paint so the saved theme never flashes.
const themeScript = `try{var t=localStorage.getItem("js.theme");if(t)document.documentElement.dataset.theme=t;var l=localStorage.getItem("js.locale");if(l)document.documentElement.lang=l;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ClientBoot />
        {children}
      </body>
    </html>
  );
}
