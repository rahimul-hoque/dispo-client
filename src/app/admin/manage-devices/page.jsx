"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Server, Magnifier, ArrowRight } from "@gravity-ui/icons";
import { toast } from "@heroui/react";
import { authClient } from "@/lib/auth-client";

function DeviceRowSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-surface-container-low p-4 space-y-2">
      <div className="h-4 w-1/3 rounded-full bg-surface-container" />
      <div className="h-3 w-1/2 rounded-full bg-surface-container" />
    </div>
  );
}

export default function ManageDevicesPage() {
  const { data: session } = authClient.useSession();
  const [devices, setDevices] = useState([]);
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all"); // "all" | "mine"
  const [onlineOnly, setOnlineOnly] = useState(false);

  const ownerNameById = useMemo(
    () => Object.fromEntries(users.map((u) => [u._id, u.name || u.email])),
    [users]
  );

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [devicesRes, usersRes] = await Promise.all([
          fetch("/api/proxy/devices"),
          fetch("/api/proxy/users"),
        ]);
        setDevices(await devicesRes.json());
        setUsers(await usersRes.json());
      } catch (error) {
        console.log(error);
        toast.danger("Couldn't load devices", { description: "Check your connection and try again." });
      } finally {
        setIsLoading(false);
      }
    };
    load();

    // Quiet refresh (no skeleton) so "online right now" stays current.
    const id = setInterval(async () => {
      if (document.hidden) return; // don't poll from a background tab
      try {
        const res = await fetch("/api/proxy/devices");
        const data = await res.json();
        if (Array.isArray(data)) setDevices(data);
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const onlineCount = useMemo(
    () => (Array.isArray(devices) ? devices.filter((d) => d.online).length : 0),
    [devices]
  );

  const visibleDevices = useMemo(() => {
    let list = Array.isArray(devices) ? devices : [];
    if (onlineOnly) list = list.filter((d) => d.online);
    if (ownerFilter === "mine" && session?.user?.id) {
      list = list.filter((d) => d.ownerId === session.user.id);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((d) => d.name?.toLowerCase().includes(q));
    }
    // Online devices always float to the top (stable: original order kept
    // within each group).
    return [...list].sort((a, b) => Number(!!b.online) - Number(!!a.online));
  }, [devices, ownerFilter, onlineOnly, query, session]);

  return (
    <main className="w-full min-h-screen py-10 px-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">Manage Devices</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mb-8 max-w-lg">
          Every device across every owner. Search by name, narrow it down to devices you
          personally own, or tick Online to see only devices that are online right now.
          {!isLoading && (
            <span className="ml-1 font-label-md text-label-md text-on-surface">
              {onlineCount} of {devices.length} online.
            </span>
          )}
        </p>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative flex flex-1 min-w-[220px] items-center rounded-full bg-surface-container-low px-4 py-2.5 shadow-[inset_3px_3px_6px_rgba(184,196,214,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.85)]">
            <Magnifier className="h-4 w-4 text-tertiary mr-2.5 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by device name…"
              className="w-full bg-transparent font-body-md text-body-md text-on-surface placeholder:text-tertiary focus:outline-none"
            />
          </div>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="rounded-full bg-surface-container-low px-4 py-2.5 font-label-md text-label-md text-on-surface shadow-[3px_3px_8px_rgba(184,196,214,0.5)] focus:outline-none appearance-none cursor-pointer"
          >
            <option value="all">All devices</option>
            <option value="mine">Only my devices</option>
          </select>
          <label className="flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2.5 font-label-md text-label-md text-on-surface shadow-[3px_3px_8px_rgba(184,196,214,0.5)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
              className="h-4 w-4 accent-primary-container cursor-pointer"
            />
            Online
          </label>
        </div>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <>
              <DeviceRowSkeleton />
              <DeviceRowSkeleton />
              <DeviceRowSkeleton />
            </>
          ) : visibleDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4)]">
              <Server className="h-8 w-8 text-tertiary mb-3" />
              <p className="font-headline-sm text-headline-sm text-on-surface">No devices found</p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
                Try a different search or filter.
              </p>
            </div>
          ) : (
            visibleDevices.map((device) => (
              <div
                key={device._id}
                className="flex flex-col gap-3 rounded-2xl bg-surface-container-low p-4 shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)] sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.5)]">
                    <Server className="h-4 w-4 text-tertiary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-label-lg text-label-lg text-on-surface truncate">
                      {device.name || "Not yet claimed"}
                    </p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                      {device.ownerId
                        ? `Owned by ${ownerNameById[device.ownerId] || "Unknown"}`
                        : "Unclaimed"}
                      {device.slotCount ? ` · ${device.slotCount} slots` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-label-sm text-label-sm ${
                        device.online
                          ? "bg-primary-fixed text-on-primary-fixed-variant"
                          : "bg-surface-container text-on-surface-variant"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${device.online ? "bg-primary" : "bg-outline"}`} />
                      {device.online ? "Online" : "Offline"}
                    </span>
                    {device.status && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-label-sm text-label-sm ${
                          device.status === "active"
                            ? "bg-surface-container text-on-surface-variant"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {device.status === "active" ? "Active" : "Inactive"}
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/admin/manage-devices/${device._id}`}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary-container px-4 py-2 font-label-md text-label-md text-on-primary hover:opacity-90 transition-opacity"
                  >
                    Manage
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
