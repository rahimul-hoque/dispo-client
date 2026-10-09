"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { usePaginatedOrders } from "@/lib/use-orders";
import { LoadMoreButton } from "@/components/load-more-button";
import { Receipt, Server, CircleCheck, Hourglass, TriangleExclamation } from "@gravity-ui/icons";
import { toast, Spinner } from "@heroui/react";

function OrderRowSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-surface-container-low p-4 space-y-2">
      <div className="h-4 w-1/3 rounded-full bg-surface-container" />
      <div className="h-3 w-2/3 rounded-full bg-surface-container" />
    </div>
  );
}

export default function AdminOrdersPage() {
  const { orders, isLoading: ordersLoading, hasMore, isLoadingMore, loadMore, updateOrder } =
    usePaginatedOrders({ refreshInterval: 10000 });
  const { data: devicesData, isLoading: devicesLoading } = useSWR("/api/proxy/devices", fetcher);
  const { data: usersData, isLoading: usersLoading } = useSWR("/api/proxy/users", fetcher);
  const devices = useMemo(() => (Array.isArray(devicesData) ? devicesData : []), [devicesData]);
  const users = useMemo(() => (Array.isArray(usersData) ? usersData : []), [usersData]);
  const isLoading = ordersLoading || devicesLoading || usersLoading;
  const [completingId, setCompletingId] = useState(null);

  const deviceNameById = useMemo(
    () => Object.fromEntries(devices.map((d) => [d._id, d.name])),
    [devices]
  );
  const deviceOwnerById = useMemo(
    () => Object.fromEntries(devices.map((d) => [d._id, d.ownerId])),
    [devices]
  );
  const ownerNameById = useMemo(
    () => Object.fromEntries(users.map((u) => [u._id, u.name || u.email])),
    [users]
  );

  const markComplete = async (order) => {
    setCompletingId(order._id);
    try {
      const res = await fetch(`/api/proxy/orders/${order._id}/complete`, { method: "PATCH" });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't complete order", { description: result.error || "Please try again." });
        return;
      }
      updateOrder(order._id, { status: "completed" });
      toast.success("Order marked as dispensed");
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't complete order", { description: "Something went wrong." });
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <main className="w-full min-h-screen py-10 px-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">Orders</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mb-8 max-w-lg">
          Every order across every owner and every device, system-wide, newest first.
        </p>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <>
              <OrderRowSkeleton />
              <OrderRowSkeleton />
              <OrderRowSkeleton />
            </>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4)]">
              <Receipt className="h-8 w-8 text-tertiary mb-3" />
              <p className="font-headline-sm text-headline-sm text-on-surface">No orders yet</p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
                Orders placed through /shop/checkout will show up here.
              </p>
            </div>
          ) : (
            orders.map((order) => (
              <div
                key={order._id}
                className="rounded-2xl bg-surface-container-low p-4 shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-label-lg text-label-lg text-on-surface">
                      Order #{order._id.slice(-6)}
                    </p>
                    <span className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                      <Server className="h-3 w-3" />
                      {deviceNameById[order.deviceId] || "Unknown device"}
                    </span>
                    <span className="rounded-full bg-surface px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                      Owner: {ownerNameById[deviceOwnerById[order.deviceId]] || "Unknown"}
                    </span>
                    {order.status === "completed" ? (
                      <span className="flex items-center gap-1 rounded-full bg-primary-fixed px-2.5 py-0.5 font-label-sm text-label-sm text-on-primary-fixed-variant">
                        <CircleCheck className="h-3 w-3" />
                        Completed
                      </span>
                    ) : order.status === "dispensing" ? (
                      <span className="flex items-center gap-1 rounded-full bg-primary-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-primary">
                        <Spinner size="sm" color="current" />
                        Dispensing
                      </span>
                    ) : order.status === "failed" ? (
                      <span className="flex items-center gap-1 rounded-full bg-error-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-error-container">
                        <TriangleExclamation className="h-3 w-3" />
                        Failed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                        <Hourglass className="h-3 w-3" />
                        Pending
                      </span>
                    )}
                  </div>
                  <span className="font-headline-sm text-headline-sm text-primary">৳{order.total}</span>
                </div>

                <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
                  {new Date(order.createdAt).toLocaleString()}
                </p>

                <div className="flex flex-col gap-1 mb-3">
                  {(order.items || []).map((item, i) => (
                    <p key={i} className="font-body-sm text-body-sm text-on-surface">
                      Slot {item.slotNumber} — {item.qty} × {item.name}
                    </p>
                  ))}
                </div>

                {order.status === "pending" && (
                  <button
                    onClick={() => markComplete(order)}
                    disabled={completingId === order._id}
                    className="flex items-center gap-2 rounded-full bg-primary-container px-4 py-2 font-label-md text-label-md text-on-primary disabled:opacity-70 cursor-pointer"
                  >
                    {completingId === order._id && <Spinner size="sm" color="current" />}
                    {completingId === order._id ? "Marking..." : "Mark as dispensed"}
                  </button>
                )}
              </div>
            ))
          )}
          {!isLoading && <LoadMoreButton hasMore={hasMore} isLoadingMore={isLoadingMore} onClick={loadMore} />}
        </div>
      </div>
    </main>
  );
}
