import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PrintMadeEasy | Print Shop Management Made Simple",
    template: "%s | PrintMadeEasy",
  },
  description:
    "PrintMadeEasy helps print shops manage print orders, connect their shop computer, detect printers, and organize their daily printing workflow.",
  openGraph: {
    title: "PrintMadeEasy | Print Shop Management Made Simple",
    description:
      "PrintMadeEasy helps print shops manage print orders, connect their shop computer, detect printers, and organize their daily printing workflow.",
    url: "https://clauras.com",
    siteName: "PrintMadeEasy",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
