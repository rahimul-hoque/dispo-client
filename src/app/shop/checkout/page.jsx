"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useCart } from "@/lib/cart-context";
import { toast, Spinner } from "@heroui/react";
import { useDeviceAvailability } from "@/lib/use-device-availability";
import { DeviceUnavailableBanner, unavailableLabel } from "@/components/device-unavailable-banner";
import { CircleCheck, Hourglass, TriangleExclamation } from "@gravity-ui/icons";

const STATUS_CONFIG = {
  // Orders stay pending until the machine claims them: a moment when it's
  // free, longer if another order is still dispensing ahead of this one.
  pending: { icon: Hourglass, label: "Waiting for the machine…", color: "text-on-surface-variant", spin: true },
  dispensing: { icon: Spinner, label: "Dispensing your order…", color: "text-primary", spin: true },
  completed: { icon: CircleCheck, label: "Order complete!", color: "text-primary", spin: false },
  failed: { icon: TriangleExclamation, label: "Something went wrong", color: "text-error", spin: false },
};

function OrderStatusTracker({ orderId, deviceId }) {
  const router = useRouter();

  // Poll every 3s while the order is still in progress; stop once it
  // reaches a terminal state so we're not burning requests forever.
  const { data: order } = useSWR(
    orderId ? `/api/proxy/orders/${orderId}` : null,
    fetcher,
    {
      refreshInterval: (latestData) => {
        if (!latestData) return 3000;
        return latestData.status === "completed" || latestData.status === "failed" ? 0 : 3000;
      },
    }
  );

  const status = order?.status || "pending";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  // Show per-item dispense progress when available
  const items = order?.items || [];
  const totalUnits = items.reduce((s, i) => s + (i.qty || 0), 0);
  const dispensedUnits = items.reduce((s, i) => s + (i.dispensedQty || 0), 0);

  return (
    <main className="flex min-h-[calc(100vh-73px)] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4">
        {cfg.spin ? (
          <Spinner size="lg" color="primary" />
        ) : (
          <Icon className={`h-10 w-10 ${cfg.color}`} />
        )}
      </div>

      <h1 className="font-headline-lg text-headline-lg text-on-surface">{cfg.label}</h1>

      <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
        Order #{orderId.slice(-6)} — ৳{order?.total ?? "…"}
      </p>

      {status === "pending" && (
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-2 max-w-xs">
          The machine is serving an earlier order. Your items will dispense automatically next!
        </p>
      )}

      {status === "dispensing" && totalUnits > 0 && (
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-2">
          {dispensedUnits} of {totalUnits} item{totalUnits !== 1 ? "s" : ""} dispensed
        </p>
      )}

      {status === "failed" && order?.failureReason && (
        <p className="font-body-sm text-body-sm text-error mt-2">
          Reason: {order.failureReason === "timeout" ? "The machine didn't respond in time." : order.failureReason}
        </p>
      )}

      {(status === "completed" || status === "failed") && (
        <button
          onClick={() => router.push(`/shop/browse?device=${deviceId}`)}
          className="mt-6 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary cursor-pointer"
        >
          Continue browsing
        </button>
      )}
    </main>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, total, deviceId, clearCart } = useCart();
  const [isPlacing, setIsPlacing] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const { available, code: unavailableCode, message: unavailableMessage } = useDeviceAvailability(
    items.length > 0 && !confirmedOrder ? deviceId : null
  );

  const placeOrder = async () => {
    if (!available) return;
    setIsPlacing(true);
    try {
      const res = await fetch("/api/proxy/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          items: items.map((i) => ({ slotNumber: i.slotNumber, qty: i.qty })),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't place order", { description: result.error || "Please try again." });
        return;
      }
      setConfirmedOrder(result);
      clearCart();
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't place order", { description: "Something went wrong." });
    } finally {
      setIsPlacing(false);
    }
  };

  if (confirmedOrder) {
    return <OrderStatusTracker orderId={confirmedOrder._id} deviceId={confirmedOrder.deviceId} />;
  }

  if (items.length === 0) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center px-6 text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">Your cart is empty.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">Checkout</h1>
      <p className="font-body-sm text-body-sm text-on-surface-variant mb-6 rounded-xl bg-surface-container-low p-3">
        This is a test checkout — no real payment is processed yet. Placing this order will
        record a real sale and reduce real stock.
      </p>

      <div className="flex flex-col gap-2 mb-6">
        {items.map((item) => (
          <div key={item.slotNumber} className="flex items-center justify-between font-body-md text-body-md text-on-surface">
            <span>{item.qty} × {item.name}</span>
            <span>৳{item.price * item.qty}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-6 border-t border-surface-container-high pt-4">
        <span className="font-headline-sm text-headline-sm text-on-surface">Total</span>
        <span className="font-headline-lg text-headline-lg text-primary">৳{total}</span>
      </div>

      {!available && (
        <DeviceUnavailableBanner code={unavailableCode} message={unavailableMessage} className="mb-4" />
      )}

      <button
        onClick={placeOrder}
        disabled={isPlacing || !available}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-primary-container px-5 py-3.5 font-label-lg text-label-lg text-on-primary disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
      >
        {isPlacing && <Spinner size="sm" color="current" />}
        {isPlacing ? "Placing order..." : available ? "Place order" : unavailableLabel(unavailableCode)}
      </button>
    </main>
  );
}

