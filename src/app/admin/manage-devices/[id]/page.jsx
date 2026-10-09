"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import {
  Server,
  Box,
  ArrowLeft,
  CircleCheck,
  TriangleExclamation,
  PlugConnection,
  Pencil,
  TrashBin,
  Printer,
  Tag,
  TagDollar,
  Boxes3,
  Picture,
  ArrowRight,
  ArrowRotateLeft,
} from "@gravity-ui/icons";
import { Modal, toast, useOverlayState, Spinner } from "@heroui/react";
import { connectToBoard, isBluetoothSupported } from "@/lib/ble";

const DEVICE_TYPE_LABELS = {
  coffee_machine: "Coffee Machine",
  vending_machine: "Vending Machine",
  juice_machine: "Juice Machine",
};

export default function ManageDeviceDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [device, setDevice] = useState(null);
  const [ownerName, setOwnerName] = useState(null);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const editModal = useOverlayState();
  const editForm = useForm({ defaultValues: { name: "", slotCount: "", status: "active" } });

  const deleteModal = useOverlayState();
  const [isDeleting, setIsDeleting] = useState(false);

  // Re-provisioning: for when the physical board is lost, factory-reset,
  // or swapped out — this device's own record (owner, products, order
  // history, qrToken) never changes, we're just re-sending its existing
  // ID to whatever board is nearby over Bluetooth so it adopts this
  // device's identity again. Same BLE protocol as first-time provisioning
  // in /admin/devices, just targeting an existing device instead of a
  // freshly-created one.
  const [isReprovisionOpen, setIsReprovisionOpen] = useState(false);
  const [isBleSupported, setIsBleSupported] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSendingId, setIsSendingId] = useState(false);
  const [reprovisionStatus, setReprovisionStatus] = useState(null); // { tone, text }
  const boardRef = useRef(null);

  // Add-product form — scoped to just this device, no dropdown needed
  // since we already know which device we're on from the URL.
  const {
    register: registerProduct,
    handleSubmit: handleProductSubmit,
    reset: resetProductForm,
    formState: { isSubmitting: isAddingProduct },
  } = useForm({ defaultValues: { name: "", description: "", price: "", stock: "", slotNumber: "" } });
  const [addImagePreview, setAddImagePreview] = useState(null);
  const [addImageBase64, setAddImageBase64] = useState(null);

  const takenSlots = useMemo(() => new Set(products.map((p) => p.slotNumber)), [products]);
  const availableSlots = device?.slotCount
    ? Array.from({ length: device.slotCount }, (_, i) => i + 1)
    : [];

  const handleImageFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.danger("Not an image", { description: "Please choose an image file." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.danger("Image too large", { description: "Please choose an image under 2MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAddImagePreview(reader.result);
      setAddImageBase64(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const onAddProduct = async (data) => {
    try {
      const res = await fetch("/api/proxy/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, deviceId: device._id, image: addImageBase64 }),
      });
      const created = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't add product", { description: created.error || "Please try again." });
        return;
      }
      setProducts((prev) => [...prev, created]);
      resetProductForm();
      setAddImagePreview(null);
      setAddImageBase64(null);
      toast.success("Product added", { description: `${created.name} was added to ${device.name}.` });
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't add product", { description: "Something went wrong." });
    }
  };

  const load = async () => {
    setIsLoading(true);
    try {
      const [devicesRes, usersRes, productsRes] = await Promise.all([
        fetch("/api/proxy/devices"),
        fetch("/api/proxy/users"),
        fetch(`/api/proxy/products?deviceId=${id}`),
      ]);
      const devices = await devicesRes.json();
      const users = await usersRes.json();
      const foundDevice = Array.isArray(devices) ? devices.find((d) => d._id === id) : null;
      setDevice(foundDevice || null);
      if (foundDevice?.ownerId) {
        const owner = users.find((u) => u._id === foundDevice.ownerId);
        setOwnerName(owner?.name || owner?.email || "Unknown");
      }
      setProducts(await productsRes.json());
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't load device", { description: "Check your connection and try again." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  // Quiet refresh of just the device so the Connection badge stays live.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/proxy/devices");
        const devices = await res.json();
        const fresh = Array.isArray(devices) ? devices.find((d) => d._id === id) : null;
        if (fresh) setDevice((prev) => (prev ? { ...prev, online: fresh.online, lastSeen: fresh.lastSeen } : prev));
      } catch {}
    }, 5000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    setIsBleSupported(isBluetoothSupported());
  }, []);

  const openReprovision = () => {
    setIsReprovisionOpen(true);
    setIsConnected(false);
    setReprovisionStatus(null);
    boardRef.current = null;
  };

  const closeReprovision = () => {
    setIsReprovisionOpen(false);
    setIsConnected(false);
    setReprovisionStatus(null);
    boardRef.current = null;
  };

  const handleReprovisionNotify = (text) => {
    if (text === "DEVICEID_SET") {
      setReprovisionStatus({ tone: "ok", text: "Board confirmed — it's reconnected to this device." });
      confirmReprovision();
    } else if (text === "DEVICEID_FAILED") {
      setReprovisionStatus({ tone: "fault", text: "The board couldn't store this ID — try sending again." });
    }
  };

  const handleReprovisionConnect = async () => {
    setIsConnecting(true);
    try {
      const board = await connectToBoard({
        onNotify: handleReprovisionNotify,
        onDisconnect: () => {
          setIsConnected(false);
          boardRef.current = null;
          setReprovisionStatus({ tone: "fault", text: "Bluetooth connection lost" });
        },
      });
      boardRef.current = board;
      setIsConnected(true);
      toast.success("Connected to board");
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't connect", {
        description: error.message || "Make sure the board is powered on and nearby.",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const sendReprovisionId = async () => {
    if (!boardRef.current || !device) return;
    setIsSendingId(true);
    try {
      const command = `dvi_${device.qrToken}\n`;
      await boardRef.current.write(command);
      setReprovisionStatus({ tone: "wait", text: "Sent — waiting for the board to confirm…" });
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't send", {
        description: "The Bluetooth connection may have dropped — reconnect and try again.",
      });
    } finally {
      setIsSendingId(false);
    }
  };

  // Reuses the same provision-status endpoint first-time provisioning
  // uses — it just stamps confirmedAt, and doesn't care whether the
  // device was already claimed, so it works unchanged for a re-confirm.
  const confirmReprovision = async () => {
    if (!device) return;
    try {
      await fetch(`/api/proxy/devices/${device._id}/provision-status`, { method: "PATCH" });
      setDevice((prev) => (prev ? { ...prev, confirmedAt: new Date().toISOString() } : prev));
    } catch (error) {
      console.log(error);
    }
  };

  const openEdit = () => {
    editForm.reset({ name: device.name, slotCount: device.slotCount, status: device.status });
    editModal.open();
  };

  const onEditSubmit = async (data) => {
    try {
      const res = await fetch(`/api/proxy/devices/${device._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          slotCount: Number(data.slotCount),
          status: data.status,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't update device", { description: result.error || "Please try again." });
        return;
      }
      setDevice(result);
      toast.success("Device updated");
      editModal.close();
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't update device", { description: "Something went wrong." });
    }
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/proxy/devices/${device._id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't delete device", { description: result.error || "Please try again." });
        return;
      }
      toast.success("Device deleted");
      router.push("/admin/manage-devices");
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't delete device", { description: "Something went wrong." });
    } finally {
      setIsDeleting(false);
    }
  };

  // QR encodes just the raw token — our own in-app scanners attach the
  // right path themselves before navigating.
  const qrValueFor = (d) => d.qrToken;

  const handlePrintQr = () => {
    const container = document.getElementById(`admin-detail-qr-${device._id}`);
    const svgEl = container?.querySelector("svg");
    if (!svgEl) return;

    const bigSvg = svgEl.cloneNode(true);
    bigSvg.setAttribute("width", "320");
    bigSvg.setAttribute("height", "320");

    const printWindow = window.open("", "_blank", "width=500,height=650");
    if (!printWindow) {
      toast.danger("Couldn't open print window", { description: "Check your browser's popup blocker." });
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>${device.name || "Dispo Device"} — QR Code</title>
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
            h2 { margin: 0 0 24px; font-size: 22px; }
            p { margin-top: 20px; color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <h2>${device.name || "Dispo Device"}</h2>
          ${bigSvg.outerHTML}
          <p>Scan to shop this machine</p>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.onafterprint = () => printWindow.close();
  };

  if (isLoading) {
    return (
      <main className="w-full min-h-screen py-10 px-6">
        <p className="font-body-md text-body-md text-on-surface-variant text-center">Loading…</p>
      </main>
    );
  }

  if (!device) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <TriangleExclamation className="h-8 w-8 text-error mb-3" />
        <p className="font-headline-sm text-headline-sm text-on-surface">Device not found</p>
        <button
          onClick={() => router.push("/admin/manage-devices")}
          className="mt-4 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary cursor-pointer"
        >
          Back to Manage Devices
        </button>
      </main>
    );
  }

  return (
    <main className="w-full min-h-screen py-10 px-6">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/admin/manage-devices"
          className="mb-6 inline-flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant hover:text-primary-container transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Manage Devices
        </Link>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ── Left: device information + actions ──────────────── */}
          <div className="h-fit rounded-[2rem] bg-surface-container-low p-6 shadow-[12px_12px_28px_rgba(184,196,214,0.65),-12px_-12px_28px_rgba(255,255,255,0.95)]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.5)]">
                  <Server className="h-5 w-5 text-tertiary" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-headline-md text-headline-md text-on-surface truncate">
                    {device.name || "Not yet claimed"}
                  </h1>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {DEVICE_TYPE_LABELS[device.deviceType] || "Unknown type"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {device.ownerId && (
                  <button
                    type="button"
                    onClick={openEdit}
                    aria-label="Edit device"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5)] transition-colors hover:text-primary-container cursor-pointer"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteModal.open()}
                  aria-label="Delete device"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5)] transition-colors hover:text-error cursor-pointer"
                >
                  <TrashBin className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 mb-5">
              <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <span className="font-label-md text-label-md text-on-surface-variant">Connection</span>
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
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <span className="font-label-md text-label-md text-on-surface-variant">Status</span>
                {device.status ? (
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-label-sm text-label-sm ${
                      device.status === "active"
                        ? "bg-surface-container text-on-surface-variant"
                        : "bg-error-container text-on-error-container"
                    }`}
                  >
                    {device.status === "active" ? "Active" : "Inactive"}
                  </span>
                ) : (
                  <span className="font-label-sm text-label-sm text-on-surface-variant">Unclaimed</span>
                )}
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <span className="font-label-md text-label-md text-on-surface-variant">Slots</span>
                <span className="font-label-md text-label-md text-on-surface">{device.slotCount ?? "—"}</span>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <span className="font-label-md text-label-md text-on-surface-variant">Owner</span>
                <span className="font-label-md text-label-md text-on-surface truncate max-w-[60%]">
                  {ownerName || "Unclaimed"}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <span className="font-label-md text-label-md text-on-surface-variant">WiFi</span>
                {device.wifiConfiguredAt ? (
                  <span className="flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant">
                    <CircleCheck className="h-3.5 w-3.5 text-primary" />
                    {device.lastKnownIp}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant">
                    <PlugConnection className="h-3.5 w-3.5 text-tertiary" />
                    Not configured
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <span className="font-label-md text-label-md text-on-surface-variant">Provisioned</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  {device.createdAt ? new Date(device.createdAt).toLocaleDateString() : "—"}
                </span>
              </div>

              {device.claimedAt && (
                <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                  <span className="font-label-md text-label-md text-on-surface-variant">Claimed</span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">
                    {new Date(device.claimedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            {/* QR code + actions */}
            <div className="flex flex-col items-center rounded-2xl bg-surface p-5">
              <div
                className="rounded-xl bg-white p-3 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)] mb-4"
                id={`admin-detail-qr-${device._id}`}
              >
                <QRCodeSVG value={qrValueFor(device)} size={128} level="M" marginSize={0} />
              </div>
              <div className="flex w-full items-center gap-2">
                {device.ownerId && (
                  <Link
                    href={`/owner/devices/${device._id}/wifi`}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-surface-container-low px-4 py-2 font-label-md text-label-md text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5)] hover:text-primary-container transition-colors"
                  >
                    <PlugConnection className="h-4 w-4" />
                    WiFi setup
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handlePrintQr}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5)] hover:text-primary-container transition-colors cursor-pointer"
                >
                  <Printer className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Re-provision — board lost, reset, or swapped */}
            <div className="mt-4 rounded-2xl bg-surface p-5">
              {!isReprovisionOpen ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <ArrowRotateLeft className="h-4 w-4 text-tertiary shrink-0" />
                    <span className="font-label-md text-label-md text-on-surface font-semibold">
                      Board lost, reset, or swapped?
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
                    Reconnect a new or factory-reset board to this exact device — its name,
                    owner, products, and order history all stay exactly as they are. Nothing
                    changes except which physical board answers to this device&apos;s ID.
                  </p>
                  <button
                    type="button"
                    onClick={openReprovision}
                    className="flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2 font-label-md text-label-md text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5)] hover:text-primary-container transition-colors cursor-pointer"
                  >
                    <PlugConnection className="h-4 w-4" />
                    Re-provision to a board
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-label-md text-label-md text-on-surface font-semibold">
                      Connect to the board
                    </span>
                    <button
                      type="button"
                      onClick={closeReprovision}
                      className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary-container transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
                    Power on the board (or hold its setup button for 3 seconds), then connect
                    over Bluetooth to send it this device&apos;s ID.
                  </p>

                  {!isBleSupported ? (
                    <div className="flex items-center gap-2 rounded-2xl bg-error-container p-4">
                      <TriangleExclamation className="h-4 w-4 text-on-error-container shrink-0" />
                      <p className="font-body-sm text-body-sm text-on-error-container">
                        This browser can&apos;t do Bluetooth setup. Use Chrome or Edge.
                      </p>
                    </div>
                  ) : !isConnected ? (
                    <button
                      onClick={handleReprovisionConnect}
                      disabled={isConnecting}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-primary-container px-5 py-3 font-label-lg text-label-lg text-on-primary disabled:opacity-70 cursor-pointer"
                    >
                      {isConnecting ? <Spinner size="sm" color="current" /> : <PlugConnection className="h-4 w-4" />}
                      {isConnecting ? "Connecting…" : "Connect to board"}
                    </button>
                  ) : (
                    <button
                      onClick={sendReprovisionId}
                      disabled={isSendingId || reprovisionStatus?.tone === "ok"}
                      className={`flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-label-lg text-label-lg transition-colors cursor-pointer disabled:cursor-not-allowed ${
                        reprovisionStatus?.tone === "ok"
                          ? "bg-emerald-500 text-white disabled:opacity-100"
                          : "bg-primary-container text-on-primary disabled:opacity-70"
                      }`}
                    >
                      {reprovisionStatus?.tone === "ok" ? (
                        <CircleCheck className="h-4 w-4" />
                      ) : isSendingId ? (
                        <Spinner size="sm" color="current" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                      {reprovisionStatus?.tone === "ok" ? "Confirmed" : "Send device ID"}
                    </button>
                  )}

                  {reprovisionStatus && (
                    <div
                      className={`mt-3 rounded-2xl p-3 text-center font-body-sm text-body-sm ${
                        reprovisionStatus.tone === "ok"
                          ? "bg-primary-fixed text-on-primary-fixed-variant"
                          : reprovisionStatus.tone === "fault"
                          ? "bg-error-container text-on-error-container"
                          : "bg-surface-container text-on-surface-variant"
                      }`}
                    >
                      {reprovisionStatus.text}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Right: products in this device ─────────────────── */}
          <div>
            {device.ownerId && (
              <form
                onSubmit={handleProductSubmit(onAddProduct)}
                className="mb-6 flex flex-col gap-3 rounded-[1.5rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)]"
              >
                <h2 className="font-headline-sm text-headline-sm text-on-surface">Add a product</h2>

                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]">
                    {addImagePreview ? (
                      <img src={addImagePreview} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      <Picture className="h-5 w-5 text-tertiary" />
                    )}
                  </div>
                  <label className="flex-1 cursor-pointer rounded-full bg-surface px-4 py-2.5 text-center font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors">
                    {addImagePreview ? "Change photo" : "Upload photo (optional)"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleImageFile(e.target.files?.[0])}
                    />
                  </label>
                </div>

                <div className="relative flex items-center rounded-full bg-surface px-4 py-2.5 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]">
                  <Boxes3 className="text-tertiary w-4 h-4 mr-2.5 shrink-0" />
                  <select
                    className="w-full bg-transparent font-body-sm text-body-sm text-on-surface focus:outline-none appearance-none"
                    defaultValue=""
                    {...registerProduct("slotNumber", { required: true, valueAsNumber: true })}
                  >
                    <option value="" disabled>Select a slot…</option>
                    {availableSlots.map((n) => (
                      <option key={n} value={n} disabled={takenSlots.has(n)}>
                        Slot {n}{takenSlots.has(n) ? " (taken)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative flex items-center rounded-full bg-surface px-4 py-2.5 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]">
                  <Tag className="text-tertiary w-4 h-4 mr-2.5 shrink-0" />
                  <input
                    type="text"
                    placeholder="Name"
                    className="w-full bg-transparent font-body-sm text-body-sm text-on-surface placeholder:text-tertiary focus:outline-none"
                    {...registerProduct("name", { required: true })}
                  />
                </div>

                <textarea
                  rows={2}
                  placeholder="Description"
                  className="w-full resize-none rounded-2xl bg-surface px-4 py-2.5 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)] font-body-sm text-body-sm text-on-surface placeholder:text-tertiary focus:outline-none"
                  {...registerProduct("description")}
                />

                <div className="grid grid-cols-2 gap-2">
                  <div className="relative flex items-center rounded-full bg-surface px-4 py-2.5 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]">
                    <TagDollar className="text-tertiary w-4 h-4 mr-2 shrink-0" />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      className="w-full bg-transparent font-body-sm text-body-sm text-on-surface placeholder:text-tertiary focus:outline-none"
                      {...registerProduct("price", { required: true, valueAsNumber: true })}
                    />
                  </div>
                  <div className="relative flex items-center rounded-full bg-surface px-4 py-2.5 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]">
                    <Boxes3 className="text-tertiary w-4 h-4 mr-2 shrink-0" />
                    <input
                      type="number"
                      placeholder="Stock"
                      className="w-full bg-transparent font-body-sm text-body-sm text-on-surface placeholder:text-tertiary focus:outline-none"
                      {...registerProduct("stock", { valueAsNumber: true })}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isAddingProduct}
                  className="flex items-center justify-center gap-2 rounded-full bg-primary-container px-5 py-2.5 font-label-md text-label-md text-on-primary disabled:opacity-70 cursor-pointer"
                >
                  {isAddingProduct ? <Spinner size="sm" color="current" /> : <ArrowRight className="h-4 w-4" />}
                  {isAddingProduct ? "Adding..." : "Add product"}
                </button>
              </form>
            )}

            <h2 className="font-headline-sm text-headline-sm text-on-surface mb-4">
              Products ({products.length})
            </h2>
            {products.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4)]">
                <Box className="h-8 w-8 text-tertiary mb-3" />
                <p className="font-headline-sm text-headline-sm text-on-surface">No products yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {products.map((product) => (
                  <div
                    key={product._id}
                    className="rounded-2xl bg-surface-container-low p-3 shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)]"
                  >
                    <div className="mb-2 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-surface">
                      {product.image ? (
                        <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                      ) : (
                        <Box className="h-6 w-6 text-tertiary" />
                      )}
                    </div>
                    <p className="font-label-md text-label-md text-on-surface truncate">{product.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-body-sm text-body-sm text-on-surface-variant">
                        Slot {product.slotNumber}
                      </span>
                      <span className="font-label-sm text-label-sm text-primary">৳{product.price}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal state={deleteModal}>
        <Modal.Trigger className="hidden" aria-hidden="true" tabIndex={-1} />
        <Modal.Backdrop>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Icon>
                  <TriangleExclamation className="h-5 w-5 text-error" />
                </Modal.Icon>
                <Modal.Heading>Delete this device?</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {device.ownerId
                    ? `"${device.name}" and its QR code will stop working. Any products still assigned to it must be moved or deleted first.`
                    : "This device hasn't been claimed by anyone yet. Deleting it permanently invalidates its QR code — anyone holding the physical sticker will no longer be able to claim it."}
                </p>
              </Modal.Body>
              <Modal.Footer>
                <button
                  type="button"
                  onClick={() => deleteModal.close()}
                  disabled={isDeleting}
                  className="rounded-full px-5 py-2.5 font-label-lg text-label-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 rounded-full bg-error px-5 py-2.5 font-label-lg text-label-lg text-on-error transition-opacity hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isDeleting && <Spinner size="sm" color="current" />}
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Edit device modal */}
      <Modal state={editModal}>
        <Modal.Trigger className="hidden" aria-hidden="true" tabIndex={-1} />
        <Modal.Backdrop>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Edit device</Modal.Heading>
              </Modal.Header>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)}>
                <Modal.Body>
                  <div className="flex flex-col gap-4">
                    <div className="space-y-1.5">
                      <label className="block font-label-md text-label-md text-on-surface font-semibold">
                        Name
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none"
                        {...editForm.register("name", { required: true })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-label-md text-label-md text-on-surface font-semibold">
                        Number of slots
                      </label>
                      <input
                        type="number"
                        min={1}
                        className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none"
                        {...editForm.register("slotCount", { required: true, valueAsNumber: true, min: 1 })}
                      />
                      <p className="font-body-sm text-body-sm text-on-surface-variant px-1">
                        Can't go below whatever slot number the highest product is using.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-label-md text-label-md text-on-surface font-semibold">
                        Status
                      </label>
                      <select
                        className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none appearance-none"
                        {...editForm.register("status")}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <button
                    type="button"
                    onClick={() => editModal.close()}
                    className="rounded-full px-5 py-2.5 font-label-lg text-label-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editForm.formState.isSubmitting}
                    className="flex items-center gap-2 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary transition-opacity hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {editForm.formState.isSubmitting && <Spinner size="sm" color="current" />}
                    {editForm.formState.isSubmitting ? "Saving..." : "Save"}
                  </button>
                </Modal.Footer>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </main>
  );
}
