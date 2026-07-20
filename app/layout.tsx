import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LingoMaster AI — Aprende chino mandarín",
  description: "Tutor interactivo de mandarín para hispanohablantes con pronunciación, escritura y práctica guiada.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
