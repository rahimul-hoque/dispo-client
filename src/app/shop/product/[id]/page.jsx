"use client";

import { productImageUrl } from "@/lib/product-image";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Box, ArrowLeft, ShoppingCart } from "@gravity-ui/icons";
import { toast } from "@heroui/react";
import { useCart } from "@/lib/cart-context";
import { useDeviceAvailability } from "@/lib/use-device-availability";
import { DeviceUnavailableBanner, unavailableLabel } from "@/components/device-unavailable-banner";

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data, isLoading } = useSWR(id ? `/api/proxy/products/${id}` : null, fetcher);
  const product = data && !data.error ? data : null;
  const { addItem } = useCart();
  const { available, code: unavailableCode, message: unavailableMessage } = useDeviceAvailability(product?.deviceId);

  const onAddToCart = () => {
    if (!product || !available) return;
    addItem(product, product.deviceId);
    toast.success("Added to cart", { description: product.name });
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="animate-pulse space-y-4">
          <div className="aspect-square w-full rounded-[2rem] bg-surface-container-low" />
          <div className="h-6 w-1/2 rounded-full bg-surface-container-low" />
          <div className="h-4 w-full rounded-full bg-surface-container-low" />
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] flex-col items-center justify-center px-6 text-center">
        <Box className="h-8 w-8 text-tertiary mb-3" />
        <p className="font-headline-sm text-headline-sm text-on-surface">Product not found</p>
        <button
          onClick={() => router.push("/shop/browse")}
          className="mt-4 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary cursor-pointer"
        >
          Back to browsing
        </button>
      </main>
    );
  }

  const outOfStock = product.stock === 0;
  const lowStock = !outOfStock && product.stock < 5;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href={`/shop/browse?device=${product.deviceId}`}
        className="mb-4 inline-flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant hover:text-primary-container transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to browsing
      </Link>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[2rem] bg-surface-container-low shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4)]">
          {productImageUrl(product) ? (
            <img src={productImageUrl(product)} alt={product.name} decoding="async" className="h-full w-full object-cover" />
          ) : (
            <Box className="h-16 w-16 text-tertiary" />
          )}
        </div>

        <div className="flex flex-col">
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{product.name}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-2">
            {product.description || "No description provided."}
          </p>

          <div className="mt-4">
            {outOfStock ? (
              <span className="rounded-full bg-error-container px-3 py-1 font-label-sm text-label-sm text-on-error-container">
                Out of stock
              </span>
            ) : lowStock ? (
              <span className="rounded-full bg-primary-fixed px-3 py-1 font-label-sm text-label-sm text-on-primary-fixed-variant">
                Only {product.stock} left
              </span>
            ) : (
              <span className="rounded-full bg-surface-container px-3 py-1 font-label-sm text-label-sm text-on-surface-variant">
                {product.stock} in stock
              </span>
            )}
          </div>

          {!available && (
            <DeviceUnavailableBanner code={unavailableCode} message={unavailableMessage} className="mt-6" />
          )}

          <div className="mt-auto pt-6 flex items-center justify-between">
            <span className="font-headline-lg text-headline-lg text-primary">৳{product.price}</span>
            <button
              onClick={onAddToCart}
              disabled={outOfStock || !available}
              className="flex items-center gap-2 rounded-full bg-primary-container px-5 py-3 font-label-lg text-label-lg text-on-primary shadow-[4px_6px_14px_rgba(255,93,0,0.38)] transition-transform hover:scale-105 active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:bg-surface-container disabled:text-tertiary"
            >
              <ShoppingCart className="h-4 w-4" />
              {available ? "Add to cart" : unavailableLabel(unavailableCode)}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
