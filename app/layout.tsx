import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAKA Price Lab",
  description: "Histórico y monitoreo de precios de Tiendas Daka"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
