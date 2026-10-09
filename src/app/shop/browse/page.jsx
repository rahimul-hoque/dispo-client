"use client";

import { productImageUrl } from "@/lib/product-image";
import { useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Box, Magnifier, ShoppingCart, Server, ArrowLeft } from "@gravity-ui/icons";
import { toast } from "@heroui/react";
import { useCart } from "@/lib/cart-context";
import { useDeviceAvailability } from "@/lib/use-device-availability";
import { DeviceUnavailableBanner, unavailableLabel } from "@/components/device-unavailable-banner";

function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[1.5rem] bg-surface-container-low p-4 shadow-[8px_8px_20px_rgba(184,196,214,0.5),-8px_-8px_20px_rgba(255,255,255,0.9)]"
        >
          <div className="mb-3 aspect-square w-full rounded-2xl bg-surface-container" />
          <div className="mb-2 h-4 w-3/4 rounded-full bg-surface-container" />
          <div className="h-3 w-1/2 rounded-full bg-surface-container" />
        </div>
      ))}
    </div>
  );
}

function BrowsePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const deviceId = searchParams.get("device");

  const [query, setQuery] = useState("");

  const { addItem } = useCart();

  const productsUrl = deviceId ? `/api/proxy/products?deviceId=${deviceId}` : "/api/proxy/products";
  const { data: productsData, isLoading } = useSWR(productsUrl, fetcher, {
    refreshInterval: 15000, // keep stock counts fresh while browsing
    onError: () => toast.danger("Couldn't load the catalog", { description: "Check your connection and try again." }),
  });
  const products = useMemo(() => (Array.isArray(productsData) ? productsData : []), [productsData]);

  const { data: publicDevices } = useSWR(deviceId ? "/api/proxy/devices/public" : null, fetcher);
  const deviceName = useMemo(() => {
    if (!deviceId || !Array.isArray(publicDevices)) return null;
    const match = publicDevices.find((d) => d._id === deviceId);
    return match ? match.name : null;
  }, [deviceId, publicDevices]);

  const { available, code: unavailableCode, message: unavailableMessage } = useDeviceAvailability(deviceId);

  const filteredProducts = useMemo(() => {
    if (!query.trim()) return products;
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    );
  }, [products, query]);

  const onAddToCart = (product) => {
    if (!deviceId) {
      toast.danger("Pick a machine first", { description: "Scan a QR code or choose one manually." });
      router.push("/shop");
      return;
    }
    if (!available) {
      toast.danger(unavailableLabel(unavailableCode), { description: unavailableMessage });
      return;
    }
    addItem(product, deviceId);
    toast.success("Added to cart", { description: product.name });
  };

  return (
    <main className="w-full bg-surface min-h-screen py-10 px-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="mb-8 flex w-full flex-col items-center text-center">
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
            Browse Products
          </h1>
          {deviceId ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5" />
                {deviceName || "This machine"}
              </span>
              <button
                onClick={() => router.push("/shop")}
                className="flex items-center gap-1.5 rounded-full bg-surface-container-low px-3 py-1 font-label-sm text-label-sm text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] hover:text-primary-container transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3 w-3" />
                Change machine
              </button>
            </div>
          ) : (
            <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-md">
              No machine selected —{" "}
              <button onClick={() => router.push("/shop")} className="underline cursor-pointer">
                scan a QR code or pick one
              </button>{" "}
              to see what's actually available.
            </p>
          )}
        </div>

        {deviceId && !available && (
          <DeviceUnavailableBanner code={unavailableCode} message={unavailableMessage} className="mb-6 w-full max-w-md" />
        )}

        {/* ── Search ─────────────────────────────────────────── */}
        <div className="mb-8 w-full max-w-md">
          <div className="relative flex items-center rounded-full bg-surface-container-low shadow-[inset_3px_3px_6px_rgba(184,196,214,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.85)] px-5 py-3 focus-within:shadow-[inset_4px_4px_7px_rgba(184,196,214,0.6),inset_-4px_-4px_7px_rgba(255,255,255,0.95),0_0_0_2px_#ff5d00] transition-all">
            <Magnifier className="text-tertiary w-4 h-4 mr-3 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full bg-transparent font-body-md text-body-md text-on-surface placeholder:text-tertiary focus:outline-none"
            />
          </div>
        </div>

        {/* ── Grid ───────────────────────────────────────────── */}
        {isLoading ? (
          <ProductGridSkeleton />
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4),inset_-3px_-3px_8px_rgba(255,255,255,0.8)] w-full max-w-md">
            <Box className="h-8 w-8 text-tertiary mb-3" />
            <p className="font-headline-sm text-headline-sm text-on-surface">
              {query ? "No matches" : "Nothing here yet"}
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
              {query ? "Try a different search term." : "Check back once the owner adds items."}
            </p>
          </div>
        ) : (
          <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((product) => {
              const outOfStock = product.stock === 0;
              const lowStock = !outOfStock && product.stock < 5;

              return (
                <div
                  key={product._id}
                  className="flex flex-col rounded-[1.5rem] bg-surface-container-low p-4 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)] transition-transform hover:-translate-y-0.5"
                >
                  <Link href={`/shop/product/${product._id}`} className="block">
                    <div className="relative mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.5),inset_-2px_-2px_5px_rgba(255,255,255,0.9)]">
                      {productImageUrl(product) ? (
                        <img src={productImageUrl(product)} alt={product.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : (
                        <Box className="h-8 w-8 text-tertiary" />
                      )}
                      {outOfStock && (
                        <span className="absolute top-2 right-2 rounded-full bg-error-container px-2 py-0.5 font-label-sm text-label-sm text-on-error-container">
                          Out of stock
                        </span>
                      )}
                      {lowStock && (
                        <span className="absolute top-2 right-2 rounded-full bg-primary-fixed px-2 py-0.5 font-label-sm text-label-sm text-on-primary-fixed-variant">
                          Only {product.stock} left
                        </span>
                      )}
                    </div>

                    <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">
                      {product.name}
                    </h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 mt-0.5 min-h-[2.2em]">
                      {product.description || "No description"}
                    </p>
                  </Link>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 font-headline-sm text-headline-sm text-primary">
                      ৳{product.price}
                    </span>
                    <button
                      type="button"
                      onClick={() => onAddToCart(product)}
                      disabled={outOfStock || (!!deviceId && !available)}
                      aria-label={`Add ${product.name} to cart`}
                      title={deviceId && !available ? unavailableLabel(unavailableCode) : undefined}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-container text-on-primary shadow-[3px_4px_10px_rgba(255,93,0,0.35)] transition-transform hover:scale-105 active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:bg-surface-container disabled:text-tertiary"
                    >
                      <ShoppingCart className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

export default function BrowsePage() {
  return (
    <Suspense fallback={null}>
      <BrowsePageContent />
    </Suspense>
  );
}
