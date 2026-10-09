"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

// Whether a machine can take orders right now (active + online). Polled
// every 5s so the shop reacts quickly when a machine drops off or returns.
// `available` stays true until the first answer arrives, so pages don't
// flash a "machine offline" warning while loading.
export function useDeviceAvailability(deviceId) {
  const { data } = useSWR(deviceId ? `/api/proxy/devices/${deviceId}/availability` : null, fetcher, {
    refreshInterval: 5000,
  });
  const known = data && typeof data.available === "boolean";
  return {
    available: known ? data.available : true,
    code: known ? data.code : null,
    message: known ? data.message : null,
  };
}
