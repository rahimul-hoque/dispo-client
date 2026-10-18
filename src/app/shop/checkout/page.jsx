"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useCart } from "@/lib/cart-context";
import { toast, Spinner } from "@heroui/react";
import { useDeviceAvailability } from "@/lib/use-device-availability";
import { DeviceUnavailableBanner, unavailableLabel } from "@/components/device-unavailable-banner";
import { CircleCheck, Hourglass, TriangleExclamation, CreditCard, ShieldCheck } from "@gravity-ui/icons";

const STATUS_CONFIG = {
  payment_pending: { icon: Hourglass, label: "Waiting for payment…", color: "text-warning", spin: true },
  pending: { icon: Hourglass, label: "Waiting for the machine…", color: "text-on-surface-variant", spin: true },
  dispensing: { icon: Spinner, label: "Dispensing your order…", color: "text-primary", spin: true },
  completed: { icon: CircleCheck, label: "Order complete!", color: "text-primary", spin: false },
  failed: { icon: TriangleExclamation, label: "Something went wrong", color: "text-error", spin: false },
  cancelled: { icon: TriangleExclamation, label: "Order cancelled", color: "text-error", spin: false },
};

function OrderStatusTracker({ orderId, deviceId: propDeviceId }) {
  const router = useRouter();

  const { data: order } = useSWR(
    orderId ? `/api/proxy/orders/${orderId}` : null,
    fetcher,
    {
      refreshInterval: (latestData) => {
        if (!latestData) return 3000;
        return latestData.status === "completed" || latestData.status === "failed" || latestData.status === "cancelled"
          ? 0
          : 2500;
      },
    }
  );

  const status = order?.status || "pending";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const targetDevice = order?.deviceId || propDeviceId;

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

      {order?.payment?.status && (
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1 font-label-sm text-label-sm text-on-surface-variant">
          Payment: <strong className="uppercase text-primary">{order.payment.status}</strong>
          {order.payment.card_type && ` via ${order.payment.card_type}`}
        </span>
      )}

      {status === "pending" && (
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-2 max-w-xs">
          Payment confirmed! Your items will dispense automatically next.
        </p>
      )}

      {status === "dispensing" && totalUnits > 0 && (
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-2">
          {dispensedUnits} of {totalUnits} item{totalUnits !== 1 ? "s" : ""} dispensed
        </p>
      )}

      {(status === "failed" || status === "cancelled") && (
        <p className="font-body-sm text-body-sm text-error mt-2 max-w-xs">
          {order?.failureReason === "timeout"
            ? "The machine didn't respond in time. Any stock was restored."
            : order?.failureReason || "Order could not be fulfilled."}
        </p>
      )}

      {(status === "completed" || status === "failed" || status === "cancelled") && (
        <button
          onClick={() => router.push(targetDevice ? `/shop/browse?device=${targetDevice}` : "/shop")}
          className="mt-6 rounded-full bg-primary-container px-6 py-2.5 font-label-lg text-label-lg text-on-primary cursor-pointer hover:opacity-90 transition-opacity"
        >
          Continue browsing
        </button>
      )}
    </main>
  );
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderIdParam = searchParams.get("orderId");
  const paymentParam = searchParams.get("payment");

  const { items, total, deviceId, clearCart } = useCart();
  const [isPlacing, setIsPlacing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("sslcommerz"); // 'sslcommerz' or 'test'
  const [confirmedOrder, setConfirmedOrder] = useState(null);

  const activeOrderId = orderIdParam || confirmedOrder?._id;

  const { available, code: unavailableCode, message: unavailableMessage } = useDeviceAvailability(
    items.length > 0 && !activeOrderId ? deviceId : null
  );

  useEffect(() => {
    if (paymentParam === "failed") {
      toast.danger("Payment Failed", { description: "Your transaction was not completed. Please try again." });
    } else if (paymentParam === "cancelled") {
      toast.warning("Payment Cancelled", { description: "You cancelled the payment process." });
    } else if (paymentParam === "success") {
      toast.success("Payment Received!", { description: "Your order is being sent to the machine." });
      clearCart();
    }
  }, [paymentParam, clearCart]);

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
          paymentMethod,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't place order", { description: result.error || "Please try again." });
        return;
      }

      if (result.paymentUrl) {
        // Redirect to SSLCOMMERZ gateway (bKash / Nagad / Cards)
        clearCart();
        window.location.href = result.paymentUrl;
        return;
      }

      // Test checkout flow (immediate confirmation)
      setConfirmedOrder(result);
      clearCart();
    } catch (error) {
      console.error(error);
      toast.danger("Couldn't place order", { description: "Something went wrong." });
    } finally {
      setIsPlacing(false);
    }
  };

  if (activeOrderId) {
    return <OrderStatusTracker orderId={activeOrderId} deviceId={deviceId} />;
  }

  if (items.length === 0) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center px-6 text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">Your cart is empty.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-8">
      <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">Checkout</h1>
      
      {/* Items Summary */}
      <div className="flex flex-col gap-2.5 mb-6 rounded-2xl bg-surface-container-low p-4">
        {items.map((item) => (
          <div key={item.slotNumber} className="flex items-center justify-between font-body-md text-body-md text-on-surface">
            <span>{item.qty} × {item.name}</span>
            <span className="font-semibold">৳{item.price * item.qty}</span>
          </div>
        ))}

        <div className="flex items-center justify-between border-t border-surface-container-high pt-3 mt-1">
          <span className="font-headline-sm text-headline-sm text-on-surface">Total</span>
          <span className="font-headline-lg text-headline-lg text-primary">৳{total}</span>
        </div>
      </div>

      {/* Payment Method Selector */}
      <div className="mb-6">
        <label className="font-label-lg text-label-lg text-on-surface mb-3 block">
          Select Payment Method
        </label>
        
        <div className="flex flex-col gap-3">
          {/* SSLCOMMERZ (bKash, Nagad, Cards) */}
          <div
            onClick={() => setPaymentMethod("sslcommerz")}
            className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition-all ${
              paymentMethod === "sslcommerz"
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-surface-container-high bg-surface-container-lowest"
            }`}
          >
            <input
              type="radio"
              name="payment"
              checked={paymentMethod === "sslcommerz"}
              onChange={() => setPaymentMethod("sslcommerz")}
              className="mt-1 h-4 w-4 text-primary cursor-pointer"
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-body-md font-semibold text-on-surface">
                  Online Payment (Sandbox)
                </span>
                <span className="flex items-center gap-1 font-label-sm text-label-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="h-3.5 w-3.5" /> SSL Secured
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Pay with <strong>bKash</strong>, <strong>Nagad</strong>, <strong>Rocket</strong>, or <strong>Cards</strong> via SSLCOMMERZ test gateway.
              </p>
            </div>
          </div>

          {/* Test Checkout Option */}
          <div
            onClick={() => setPaymentMethod("test")}
            className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition-all ${
              paymentMethod === "test"
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-surface-container-high bg-surface-container-lowest"
            }`}
          >
            <input
              type="radio"
              name="payment"
              checked={paymentMethod === "test"}
              onChange={() => setPaymentMethod("test")}
              className="mt-1 h-4 w-4 text-primary cursor-pointer"
            />
            <div>
              <span className="font-body-md font-semibold text-on-surface">
                Instant Test Checkout (Bypass Payment)
              </span>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Direct dispense without opening gateway. For rapid hardware testing.
              </p>
            </div>
          </div>
        </div>
      </div>

      {!available && (
        <DeviceUnavailableBanner code={unavailableCode} message={unavailableMessage} className="mb-4" />
      )}

      <button
        onClick={placeOrder}
        disabled={isPlacing || !available}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-primary-container px-5 py-3.5 font-label-lg text-label-lg text-on-primary disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer hover:opacity-90 transition-opacity shadow-md"
      >
        {isPlacing ? (
          <>
            <Spinner size="sm" color="current" />
            <span>Processing…</span>
          </>
        ) : (
          <>
            <CreditCard className="h-5 w-5" />
            <span>
              {available
                ? paymentMethod === "sslcommerz"
                  ? `Pay ৳${total} & Dispense`
                  : `Test Dispense (৳${total})`
                : unavailableLabel(unavailableCode)}
            </span>
          </>
        )}
      </button>
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-73px)] items-center justify-center">
          <Spinner size="lg" color="primary" />
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
