"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

// Body of the "Delete this device?" dialog: says exactly which products
// will be deleted along with the device, so nothing disappears unexpectedly.
export function DeviceDeleteWarning({ device }) {
  const { data, isLoading } = useSWR(device?._id ? `/api/proxy/products?deviceId=${device._id}` : null, fetcher);
  const products = Array.isArray(data) ? data : [];

  if (!device) return null;

  const intro = device.ownerId
    ? `"${device.name}" will be deleted and its QR code will stop working.`
    : "This device hasn't been claimed yet. Deleting it permanently invalidates its QR code.";

  return (
    <div className="flex flex-col gap-3 font-body-md text-body-md text-on-surface-variant">
      <p>{intro}</p>
      {isLoading ? (
        <p className="text-on-surface-variant">Checking assigned products…</p>
      ) : products.length === 0 ? (
        <p>No products are assigned to it.</p>
      ) : (
        <div className="rounded-2xl bg-error-container px-4 py-3 text-on-error-container">
          <p className="font-label-md text-label-md mb-1">
            {products.length === 1
              ? "This will also permanently delete 1 product:"
              : `This will also permanently delete ${products.length} products:`}
          </p>
          <ul className="list-disc pl-5 font-body-sm text-body-sm">
            {products.slice(0, 8).map((p) => (
              <li key={p._id}>
                {p.name} <span className="opacity-75">(slot {p.slotNumber})</span>
              </li>
            ))}
            {products.length > 8 && <li>and {products.length - 8} more</li>}
          </ul>
        </div>
      )}
      <p className="font-body-sm text-body-sm">Past orders are kept. This can&apos;t be undone.</p>
    </div>
  );
}
