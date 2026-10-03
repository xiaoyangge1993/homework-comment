import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "跟读预批改",
  description: "按句预批英语跟读作业",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
