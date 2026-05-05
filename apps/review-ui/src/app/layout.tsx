import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Sender Platform — Review",
  description:
    "Review and approve newsletter drafts before they ship. Multi-brand admin for the agentic content platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
