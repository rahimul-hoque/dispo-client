"use client";

import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { useDeviceAvailability } from "@/lib/use-device-availability";
import { DeviceUnavailableBanner, unavailableLabel } from "@/components/device-unavailable-banner";
import { TrashBin, Box, ArrowRight } from "@gravity-ui/icons";

export default function CartPage() {
  const router = useRouter();
  const { items, updateQty, removeItem, total, deviceId } = useCart();
  const { available, code: unavailableCode, message: unavailableMessage } = useDeviceAvailability(
    items.length > 0 ? deviceId : null
  );

  if (items.length === 0) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] flex-col items-center justify-center px-6 text-center">
        <Box className="h-8 w-8 text-tertiary mb-3" />
        <p className="font-headline-sm text-headline-sm text-on-surface">Your cart is empty</p>
        <button
          onClick={() => router.push("/shop")}
          className="mt-4 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary cursor-pointer"
        >
          Find a machine
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-headline-lg text-headline-lg text-on-surface mb-6">Your cart</h1>

      <div className="flex flex-col gap-3 mb-6">
        {items.map((item) => (
          <div
            key={item.slotNumber}
            className="flex items-center gap-4 rounded-2xl bg-surface-container-low p-4 shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)]"
          >
            <div className="min-w-0 flex-1">
              <p className="font-label-lg text-label-lg text-on-surface truncate">{item.name}</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant">৳{item.price} each</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateQty(item.slotNumber, item.qty - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container font-label-md text-label-md cursor-pointer"
              >
                −
              </button>
              <span className="w-6 text-center font-label-md text-label-md text-on-surface">{item.qty}</span>
              <button
                onClick={() => updateQty(item.slotNumber, item.qty + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container font-label-md text-label-md cursor-pointer"
              >
                +
              </button>
            </div>
            <button
              onClick={() => removeItem(item.slotNumber)}
              aria-label={`Remove ${item.name}`}
              className="text-tertiary hover:text-error transition-colors cursor-pointer"
            >
              <TrashBin className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-6">
        <span className="font-headline-sm text-headline-sm text-on-surface">Total</span>
        <span className="font-headline-lg text-headline-lg text-primary">৳{total}</span>
      </div>

      {!available && (
        <DeviceUnavailableBanner code={unavailableCode} message={unavailableMessage} className="mb-4" />
      )}

      <button
        onClick={() => router.push("/shop/checkout")}
        disabled={!available}
        className="disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none group flex w-full items-center justify-between rounded-full bg-surface p-2 pl-6 shadow-[6px_6px_14px_rgba(184,196,214,0.6),-6px_-6px_14px_rgba(255,255,255,0.95)] hover:shadow-[8px_8px_18px_rgba(184,196,214,0.7),-8px_-8px_18px_rgba(255,255,255,1)] transition-all cursor-pointer"
      >
        <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
          {available ? "Checkout" : unavailableLabel(unavailableCode)}
        </span>
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-container text-on-primary shadow-[4px_6px_14px_rgba(255,93,0,0.38),-2px_-2px_6px_rgba(255,140,75,0.4)] transition-transform group-hover:scale-105 group-active:scale-95">
          <ArrowRight className="h-5 w-5" />
        </div>
      </button>
    </main>
  );
}
