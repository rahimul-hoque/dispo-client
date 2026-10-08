"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TriangleExclamation } from "@gravity-ui/icons";
import { authClient } from "@/lib/auth-client";

export default function ScanResolverPage() {
  const { token } = useParams();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isPending) return; // wait for session to resolve before deciding where to route

    const resolve = async () => {
      try {
        const res = await fetch(`/api/proxy/devices/by-token/${token}`);
        const data = await res.json();
        if (!res.ok) {
          setError(
            data.error === "Device not found"
              ? "Use a valid QR code — this device doesn't exist."
              : data.error || "Device not found"
          );
          return;
        }

        // Same physical QR sticker serves two purposes depending on who
        // scans it and whether it's been set up yet: an unclaimed device
        // (fresh from the factory) sends an owner/admin to claim it;
        // everyone else just isn't shown anything yet. A claimed device
        // behaves exactly like before — straight into browsing.
        if (!data.ownerId) {
          const role = session?.user?.role;
          if (role === "owner" || role === "admin") {
            router.replace(`/owner/devices/claim/${token}`);
          } else {
            setError("This machine isn't set up yet — check back soon.");
          }
          return;
        }

        if (data.status !== "active") {
          setError("This machine is currently inactive and isn't accepting orders.");
          return;
        }

        router.replace(`/shop/browse?device=${data._id}`);
      } catch (err) {
        console.log(err);
        setError("Something went wrong");
      }
    };
    resolve();
  }, [token, router, isPending, session]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 text-center">
        <TriangleExclamation className="h-8 w-8 text-error mb-3" />
        <p className="font-headline-sm text-headline-sm text-on-surface">{error}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <p className="font-body-md text-body-md text-on-surface-variant">Finding your machine…</p>
    </main>
  );
}
