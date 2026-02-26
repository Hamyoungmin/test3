import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/contexts/ThemeContext";
import ThemeToggle from "@/components/ThemeToggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Excel Manager | 엑셀 파일 관리",
  description: "엑셀 파일을 업로드하고 관리하세요",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta name="style-version" content="2" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("app-theme");if(t==="dark")document.documentElement.classList.add("dark");else if(t==="light")document.documentElement.classList.remove("dark");})();`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-white dark:bg-[#0F172A] text-gray-900 dark:text-gray-100`}>
        <ThemeProvider>
          {children}
          <ThemeToggle />
        </ThemeProvider>
      </body>
    </html>
  );
}
