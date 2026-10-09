"use client";

import { DeviceDeleteWarning } from "@/components/device-delete-warning";
import { useState } from "react";
import { useSWRList } from "@/lib/use-swr-list";
import { useForm } from "react-hook-form";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import {
  Server,
  Pencil,
  TrashBin,
  ArrowRight,
  TriangleExclamation,
  Printer,
  PlugConnection,
  CircleCheck,
  QrCode,
} from "@gravity-ui/icons";
import { Modal, toast, useOverlayState, Spinner } from "@heroui/react";

function DeviceCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[1.5rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.5),-8px_-8px_20px_rgba(255,255,255,0.9)]">
      <div className="mb-4 h-4 w-2/5 rounded-full bg-surface-container" />
      <div className="mx-auto h-32 w-32 rounded-xl bg-surface-container" />
    </div>
  );
}

export default function DevicesPage() {
  // Refreshes every 5s so the Online/Offline badge stays current (SWR
  // skips refreshes while the tab is hidden).
  const { list: devices, setList: setDevices, isLoading } = useSWRList("/api/proxy/devices", {
    refreshInterval: 5000,
    onError: () => toast.danger("Couldn't load devices", { description: "Check your connection and try again." }),
  });

  const editModal = useOverlayState();
  const [editingDevice, setEditingDevice] = useState(null);
  const editForm = useForm({ defaultValues: { name: "", slotCount: "", status: "active" } });

  const deleteModal = useOverlayState();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const openEdit = (device) => {
    setEditingDevice(device);
    editForm.reset({ name: device.name, slotCount: device.slotCount, status: device.status });
    editModal.open();
  };

  const onEditSubmit = async (data) => {
    try {
      const res = await fetch(`/api/proxy/devices/${editingDevice._id}`, {
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
      setDevices((prev) => prev.map((d) => (d._id === editingDevice._id ? { ...d, ...result } : d)));
      toast.success("Device updated");
      editModal.close();
      setEditingDevice(null);
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't update device", { description: "Something went wrong." });
    }
  };

  const askDelete = (device) => {
    setDeleteTarget(device);
    deleteModal.open();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      // Products on this device are deleted with it; the dialog listed them.
      const res = await fetch(`/api/proxy/devices/${deleteTarget._id}?deleteProducts=true`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't delete device", { description: result.error || "Please try again." });
        return;
      }
      setDevices((prev) => prev.filter((d) => d._id !== deleteTarget._id));
      toast.success("Device deleted", {
        description: result.productsDeleted ? `${result.productsDeleted} product(s) removed with it.` : undefined,
      });
      deleteModal.close();
      setDeleteTarget(null);
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't delete device", { description: "Something went wrong." });
    } finally {
      setIsDeleting(false);
    }
  };

  // QR now encodes just the raw token, not a full URL — our own in-app
  // scanners attach the /shop/scan or /owner/devices/claim path themselves
  // before navigating. A generic phone camera app will show plain text
  // rather than a tappable link for this sticker now.
  const qrValueFor = (device) => device.qrToken;

  // Prints ONLY this device's QR code, not the surrounding page — by
  // building a tiny standalone document in a new window and printing that,
  // rather than fighting the whole app's layout with print CSS.
  const handlePrintQr = (device) => {
    const container = document.getElementById(`qr-svg-${device._id}`);
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
          <title>${device.name} — QR Code</title>
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
            h2 { margin: 0 0 24px; font-size: 22px; }
            p { margin-top: 20px; color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <h2>${device.name}</h2>
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

  return (
    <main className="w-full min-h-screen py-10 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">Devices</h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-lg">
              Every device here started as a QR code the admin gave you. Scan a new one to add
              another machine to your fleet.
            </p>
          </div>
          <Link
            href="/owner/devices/claim"
            className="flex items-center gap-2 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary shadow-[4px_6px_14px_rgba(255,93,0,0.38)] transition-transform hover:scale-105 active:scale-95"
          >
            <QrCode className="h-4 w-4" />
            Claim a device
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <>
              <DeviceCardSkeleton />
              <DeviceCardSkeleton />
            </>
          ) : devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4),inset_-3px_-3px_8px_rgba(255,255,255,0.8)] sm:col-span-2 lg:col-span-3">
              <Server className="h-8 w-8 text-tertiary mb-3" />
              <p className="font-headline-sm text-headline-sm text-on-surface">No devices yet</p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
                Scan the QR code that came with your machine to claim it.
              </p>
            </div>
          ) : (
            devices.map((device) => (
              <div
                key={device._id}
                className="flex flex-col items-center rounded-[1.5rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)]"
              >
                <div className="mb-3 flex w-full items-center justify-between">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">
                    {device.name}
                  </h3>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(device)}
                      aria-label="Edit device"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] transition-colors hover:text-primary-container cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => askDelete(device)}
                      aria-label="Delete device"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] transition-colors hover:text-error cursor-pointer"
                    >
                      <TrashBin className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mb-3 flex w-full flex-wrap items-center justify-center gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-label-sm text-label-sm ${
                      device.status === "active"
                        ? "bg-surface-container text-on-surface-variant"
                        : "bg-error-container text-on-error-container"
                    }`}
                  >
                    {device.status === "active" ? "Active" : "Inactive"}
                  </span>
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
                  <span className="rounded-full bg-surface-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                    {device.slotCount} slots
                  </span>
                </div>

                {device.wifiConfiguredAt ? (
                  <div className="mb-3 flex w-full items-center gap-1.5 rounded-full bg-surface px-3 py-1.5">
                    <CircleCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="font-label-sm text-label-sm text-on-surface-variant truncate">
                      WiFi configured — {device.lastKnownIp}
                    </span>
                  </div>
                ) : (
                  <div className="mb-3 flex w-full items-center gap-1.5 rounded-full bg-surface px-3 py-1.5">
                    <TriangleExclamation className="h-3.5 w-3.5 text-tertiary shrink-0" />
                    <span className="font-label-sm text-label-sm text-on-surface-variant">
                      WiFi not set up yet
                    </span>
                  </div>
                )}

                <div className="rounded-xl bg-white p-3 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]" id={`qr-svg-${device._id}`}>
                  <QRCodeSVG value={qrValueFor(device)} size={128} level="M" marginSize={0} />
                </div>

                <div className="mt-4 flex w-full items-center gap-2">
                  <Link
                    href={`/owner/devices/${device._id}/wifi`}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-surface px-4 py-2 font-label-md text-label-md text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] hover:text-primary-container transition-colors"
                  >
                    <PlugConnection className="h-4 w-4" />
                    WiFi setup
                  </Link>
                  <button
                    type="button"
                    onClick={() => handlePrintQr(device)}
                    aria-label="Print QR code"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] hover:text-primary-container transition-colors cursor-pointer"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
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
                <DeviceDeleteWarning device={deleteTarget} />
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

      {/* Edit device modal — name, slot count, active/inactive */}
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
                        Can't go below whatever slot number your highest product is using.
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
                      <p className="font-body-sm text-body-sm text-on-surface-variant px-1">
                        Inactive devices are hidden from the customer "pick a machine" list.
                      </p>
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
