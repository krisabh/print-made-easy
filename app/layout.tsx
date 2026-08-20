import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Print Made Easy",
  description: "Automate document printing for print shops, Xerox centers, and more.",
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
