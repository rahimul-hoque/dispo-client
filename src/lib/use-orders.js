"use client";

import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/fetcher";

const PAGE_SIZE = 20;

// Newest-first orders, 20 at a time, with status/device filters applied
// server-side. `loadMore` fetches the next page using the cursor the
// server returned with the previous one.
export function usePaginatedOrders({ status = "all", deviceId = "all", refreshInterval } = {}) {
  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextCursor) return null; // reached the end
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (status !== "all") params.set("status", status);
    if (deviceId !== "all") params.set("deviceId", deviceId);
    if (pageIndex > 0) params.set("before", previousPage.nextCursor);
    return `/api/proxy/orders?${params}`;
  };

  const { data, size, setSize, isLoading, isValidating, mutate } = useSWRInfinite(getKey, fetcher, {
    refreshInterval,
  });

  const pages = Array.isArray(data) ? data.filter((p) => Array.isArray(p?.orders)) : [];
  const orders = pages.flatMap((p) => p.orders);
  const lastPage = pages[pages.length - 1];
  const hasMore = !!lastPage?.nextCursor;
  const isLoadingMore = isValidating && size > pages.length;

  // Apply a change to one order across whichever page holds it.
  const updateOrder = (orderId, changes) =>
    mutate(
      (current) =>
        current?.map((page) => ({
          ...page,
          orders: page.orders.map((o) => (o._id === orderId ? { ...o, ...changes } : o)),
        })),
      { revalidate: false }
    );

  return { orders, isLoading, hasMore, isLoadingMore, loadMore: () => setSize(size + 1), updateOrder };
}

// Server-computed order totals (see GET /api/orders/stats).
export function statsKey() {
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return `/api/proxy/orders/stats?tz=${encodeURIComponent(tz)}`;
}
