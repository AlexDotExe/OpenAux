import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenAux — Virtual DJ",
  description: "Virtual DJ powered by the crowd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
