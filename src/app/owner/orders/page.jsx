"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { usePaginatedOrders, statsKey } from "@/lib/use-orders";
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

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default function OwnerOrdersPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const {
    orders,
    isLoading: ordersLoading,
    hasMore,
    isLoadingMore,
    loadMore,
    updateOrder,
  } = usePaginatedOrders({
    status: statusFilter,
    deviceId: deviceFilter,
    refreshInterval: 10000, // new orders and status changes arrive within 10s
  });
  const { data: stats } = useSWR(statsKey(), fetcher, { refreshInterval: 10000 });
  const { data: devices = [], isLoading: devicesLoading } = useSWR("/api/proxy/devices", fetcher);
  const isLoading = ordersLoading || devicesLoading;
  const [completingId, setCompletingId] = useState(null);

  const counts = {
    completed: stats?.counts?.completed ?? 0,
    failed: stats?.counts?.failed ?? 0,
    active: (stats?.counts?.pending ?? 0) + (stats?.counts?.dispensing ?? 0),
  };
  const filtered = orders;

  const deviceNameById = useMemo(
    () => Object.fromEntries((Array.isArray(devices) ? devices : []).map((d) => [d._id, d.name])),
    [devices]
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
        <p className="font-body-md text-body-md text-on-surface-variant mb-6 max-w-lg">
          Dispense history across your machines: what was ordered, how much actually came out,
          how long it took, and why anything failed.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            ["Completed", counts.completed],
            ["Failed", counts.failed],
            ["In progress", counts.active],
          ].map(([label, n]) => (
            <div key={label} className="rounded-2xl bg-surface-container-low px-4 py-3 text-center">
              <p className="font-headline-sm text-headline-sm text-on-surface">{n}</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-full bg-surface-container-low px-4 py-2 font-label-md text-label-md text-on-surface"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="dispensing">Dispensing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            className="rounded-full bg-surface-container-low px-4 py-2 font-label-md text-label-md text-on-surface"
          >
            <option value="all">All devices</option>
            {(Array.isArray(devices) ? devices : []).map((d) => (
              <option key={d._id} value={d._id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <>
              <OrderRowSkeleton />
              <OrderRowSkeleton />
              <OrderRowSkeleton />
            </>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4)]">
              <Receipt className="h-8 w-8 text-tertiary mb-3" />
              <p className="font-headline-sm text-headline-sm text-on-surface">No orders yet</p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
                {statusFilter === "all" && deviceFilter === "all"
                  ? "Orders placed through /shop/checkout will show up here."
                  : "No orders match these filters."}
              </p>
            </div>
          ) : (
            filtered.map((order) => (
              <div
                key={order._id}
                className="rounded-2xl bg-surface-container-low p-4 shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <p className="font-label-lg text-label-lg text-on-surface">
                      Order #{order._id.slice(-6)}
                    </p>
                    <span className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                      <Server className="h-3 w-3" />
                      {deviceNameById[order.deviceId] || "Unknown device"}
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
                      {order.status !== "pending" && (
                        <span className="text-on-surface-variant">
                          {" "}
                          · {item.dispensedQty || 0}/{item.qty} dispensed
                        </span>
                      )}
                    </p>
                  ))}
                </div>

                {order.status === "completed" && order.completedAt && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
                    Completed {new Date(order.completedAt).toLocaleTimeString()} · took{" "}
                    {formatDuration(new Date(order.completedAt) - new Date(order.createdAt))}
                  </p>
                )}
                {order.status === "failed" && (
                  <p className="font-body-sm text-body-sm text-error mb-3">
                    {order.failureReason || "Failed"}
                    {order.failedAt && ` · ${new Date(order.failedAt).toLocaleTimeString()}`}
                    {order.stockRestored && " · stock restored"}
                  </p>
                )}

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
