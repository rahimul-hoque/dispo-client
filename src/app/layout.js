import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import { Toast } from "@heroui/react";
import { CartProvider } from "@/lib/cart-context";
import { GlobalNavbar } from "@/components/global-navbar";
import { SplashHider } from "@/components/splash-hider";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "Dispo - Smart Vending Fleet & Inventory",
  description: "Manage your connected vending fleet and stock with ease.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-body-md text-on-surface bg-surface">
        <CartProvider>
          <GlobalNavbar />
          {children}
        </CartProvider>
        <Toast.Provider />
        <SplashHider />
      </body>
    </html>
  );
}
