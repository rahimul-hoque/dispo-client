"use client";

import { useState } from "react";
import { useSWRList } from "@/lib/use-swr-list";
import { authClient } from "@/lib/auth-client";
import { Person, Envelope, Handset, Receipt } from "@gravity-ui/icons";

export default function ProfilePage() {
  const { data: session, isPending } = authClient.useSession();
  const { list: orders, isLoading: loadingOrders } = useSWRList("/api/proxy/orders/mine");
  const [imgError, setImgError] = useState(false);

  if (isPending) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center">
        <p className="font-body-md text-body-md text-on-surface-variant">Loading…</p>
      </main>
    );
  }

  const user = session?.user;
  // Failed orders were never dispensed (stock refunded), so they don't count.
  const totalSpent = orders.reduce((sum, o) => (o.status === "failed" ? sum : sum + (o.total || 0)), 0);

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      {/* Profile card */}
      <div className="flex flex-col items-center rounded-[2rem] bg-surface-container-low p-8 shadow-[12px_12px_28px_rgba(184,196,214,0.65),-12px_-12px_28px_rgba(255,255,255,0.95)] mb-6">
        <div className="mb-4 h-20 w-20 overflow-hidden rounded-full bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.5),inset_-2px_-2px_5px_rgba(255,255,255,0.9)]">
          {user?.image && !imgError ? (
            <img
              src={user.image}
              alt={user.name}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Person className="h-8 w-8 text-tertiary" />
            </div>
          )}
        </div>
        <h1 className="font-headline-lg text-headline-lg text-on-surface text-center">
          {user?.name?.split(" ")[0]}
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1.5 mt-1">
          <Envelope className="h-3.5 w-3.5" />
          {user?.email}
        </p>
        <p className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1.5 mt-1">
          <Handset className="h-3.5 w-3.5" />
          {user?.phone || "No phone number on file"}
        </p>
        <span className="mt-3 rounded-full bg-surface-container px-3 py-1 font-label-sm text-label-sm text-on-surface-variant capitalize">
          {user?.role || "customer"}
        </span>
      </div>

      {/* Quick stats — real, from actual order history */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-2xl bg-surface-container-low p-4 text-center shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)]">
          <p className="font-headline-lg text-headline-lg text-on-surface">
            {loadingOrders ? "…" : orders.length}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Orders placed</p>
        </div>
        <div className="rounded-2xl bg-surface-container-low p-4 text-center shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)]">
          <p className="font-headline-lg text-headline-lg text-on-surface">
            {loadingOrders ? "…" : `৳${totalSpent}`}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Total spent</p>
        </div>
      </div>

      {/* Order history */}
      <h2 className="font-headline-sm text-headline-sm text-on-surface mb-3">Order history</h2>
      {loadingOrders ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded-2xl bg-surface-container-low" />
          <div className="h-16 animate-pulse rounded-2xl bg-surface-container-low" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low py-10 text-center">
          <Receipt className="h-6 w-6 text-tertiary mb-2" />
          <p className="font-body-sm text-body-sm text-on-surface-variant">No orders yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((order) => (
            <div
              key={order._id}
              className="flex items-center justify-between rounded-2xl bg-surface-container-low p-4 shadow-[4px_4px_12px_rgba(184,196,214,0.4),-4px_-4px_12px_rgba(255,255,255,0.85)]"
            >
              <div>
                <p className="font-label-lg text-label-lg text-on-surface">
                  Order #{order._id.slice(-6)}
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {new Date(order.createdAt).toLocaleDateString()} · {order.items?.length || 0} item(s)
                </p>
              </div>
              <span className="font-headline-sm text-headline-sm text-primary">৳{order.total}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
