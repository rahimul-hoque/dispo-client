"use client";

import { useState } from "react";
import { useSWRList } from "@/lib/use-swr-list";
import { useRouter } from "next/navigation";
import { Scanner } from "@yudiel/react-qr-scanner";
import { Server, QrCode } from "@gravity-ui/icons";
import { toast } from "@heroui/react";

export default function ShopEntryPage() {
  const router = useRouter();
  const [mode, setMode] = useState("scan"); // "scan" | "manual"
  const [isScanning, setIsScanning] = useState(false);
  // Same cache key as the browse page, so the list is often already loaded.
  const { list: devices } = useSWRList(mode === "manual" ? "/api/proxy/devices/public" : null, {
    onError: () => toast.danger("Couldn't load the device list"),
  });
  const [selected, setSelected] = useState("");

  // The QR now encodes just the raw device token (not a full URL), so a
  // scan just needs the path attached before navigating — same behavior
  // as manually typing a code into /shop/scan/[token].
  const handleScan = (result) => {
    const value = result?.[0]?.rawValue?.trim();
    if (!value) return;
    router.push(`/shop/scan/${value}`);
  };

  const goManual = () => {
    if (!selected) return;
    router.push(`/shop/browse?device=${selected}`);
  };

  return (
    <main className="flex min-h-[calc(100vh-73px)] flex-col items-center justify-center bg-surface px-6 py-10">
      <div className="w-full max-w-sm rounded-[2rem] bg-surface-container-low p-6 shadow-[12px_12px_28px_rgba(184,196,214,0.65),-12px_-12px_28px_rgba(255,255,255,0.95)]">
        <h1 className="font-headline-lg text-headline-lg text-on-surface text-center mb-1">
          Find your machine
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant text-center mb-6">
          Scan the QR code on the kiosk, or pick it manually.
        </p>

        <div className="flex gap-2 mb-6 rounded-full bg-surface-container p-1">
          <button
            onClick={() => {
              setMode("scan");
              setIsScanning(false); // always require a fresh button press, never resume silently
            }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2 font-label-md text-label-md transition-colors cursor-pointer ${
              mode === "scan" ? "bg-primary-container text-on-primary" : "text-on-surface-variant"
            }`}
          >
            <QrCode className="h-4 w-4" />
            Scan
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2 font-label-md text-label-md transition-colors cursor-pointer ${
              mode === "manual" ? "bg-primary-container text-on-primary" : "text-on-surface-variant"
            }`}
          >
            <Server className="h-4 w-4" />
            Pick manually
          </button>
        </div>

        {mode === "scan" ? (
          isScanning ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-2xl">
                <Scanner onScan={handleScan} />
              </div>
              <button
                onClick={() => setIsScanning(false)}
                className="rounded-full bg-surface-container px-5 py-2.5 font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsScanning(true)}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary-container px-5 py-4 font-label-lg text-label-lg text-on-primary shadow-[4px_6px_14px_rgba(255,93,0,0.38)] transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer"
            >
              <QrCode className="h-5 w-5" />
              Scan code
            </button>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none"
            >
              <option value="">Select a machine…</option>
              {devices.map((d) => (
                <option key={d._id} value={d._id}>{d.name}</option>
              ))}
            </select>
            <button
              onClick={goManual}
              disabled={!selected}
              className="rounded-full bg-primary-container px-5 py-3 font-label-lg text-label-lg text-on-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
