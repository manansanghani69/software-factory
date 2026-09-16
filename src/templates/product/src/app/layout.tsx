import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "{{product}}",
  description: "A web app produced by the AI Software Factory",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}