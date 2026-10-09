"use client";

import { DeviceDeleteWarning } from "@/components/device-delete-warning";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSWRList } from "@/lib/use-swr-list";
import { QRCodeSVG } from "qrcode.react";
import {
  Server,
  Printer,
  CirclePlus,
  CircleCheck,
  PlugConnection,
  TriangleExclamation,
  ArrowRight,
  TrashBin,
} from "@gravity-ui/icons";
import { Modal, toast, Spinner, useOverlayState } from "@heroui/react";
import { connectToBoard, isBluetoothSupported } from "@/lib/ble";

const DEVICE_TYPES = [
  { value: "coffee_machine", label: "Coffee Machine" },
  { value: "vending_machine", label: "Vending Machine" },
  { value: "juice_machine", label: "Juice Machine" },
];

function DeviceCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[1.5rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.5),-8px_-8px_20px_rgba(255,255,255,0.9)]">
      <div className="mb-4 h-4 w-2/5 rounded-full bg-surface-container" />
      <div className="mx-auto h-32 w-32 rounded-xl bg-surface-container" />
    </div>
  );
}

export default function AdminDevicesPage() {
  const onLoadError = () =>
    toast.danger("Couldn't load devices", { description: "Check your connection and try again." });
  const { list: devices, setList: setDevices, isLoading: devicesLoading } = useSWRList("/api/proxy/devices", {
    onError: onLoadError,
  });
  const { list: users, isLoading: usersLoading } = useSWRList("/api/proxy/users", { onError: onLoadError });
  const isLoading = devicesLoading || usersLoading;

  // Wizard state: "closed" | "form" | "ble"
  const [wizardStep, setWizardStep] = useState("closed");
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const [deviceType, setDeviceType] = useState("");
  const [slotCount, setSlotCount] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [pendingDevice, setPendingDevice] = useState(null); // the just-created, unconfirmed device

  // BLE state, reused for both a fresh device and re-opening an
  // already-provisioned-but-unconfirmed one from the grid.
  const [isSupported, setIsSupported] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState(null); // { tone, text }
  const boardRef = useRef(null); // { write, disconnect } handle from connectToBoard()

  const deleteModal = useOverlayState();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const ownerNameById = useMemo(
    () => Object.fromEntries(users.map((u) => [u._id, u.name || u.email])),
    [users]
  );

  useEffect(() => {
    setIsSupported(isBluetoothSupported());
  }, []);

  const resetWizard = () => {
    setWizardStep("closed");
    setDeviceType("");
    setSlotCount("");
    setCustomToken("");
    setPendingDevice(null);
    setIsConnected(false);
    setStatus(null);
    boardRef.current = null;
  };

  const submitProvisionForm = async (e) => {
    e.preventDefault();
    if (!deviceType) {
      toast.danger("Pick a device type");
      return;
    }
    const parsedSlots = Number(slotCount);
    if (!Number.isInteger(parsedSlots) || parsedSlots < 1) {
      toast.danger("Enter a valid slot count");
      return;
    }

    setIsSubmittingForm(true);
    try {
      const res = await fetch("/api/proxy/devices/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceType,
          slotCount: parsedSlots,
          ...(customToken.trim() ? { token: customToken.trim() } : {}),
        }),
      });
      const created = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't provision device", { description: created.error || "Please try again." });
        return;
      }
      setDevices((prev) => [created, ...prev]);

      if (created.confirmedAt) {
        // Custom-token path — hardware presumably already has this ID, so
        // there's nothing to configure over Bluetooth. Done immediately.
        toast.success("Device registered", { description: "Print its QR code and hand it to an owner." });
        resetWizard();
      } else {
        // Freshly generated token — needs to actually be sent to the board.
        setPendingDevice(created);
        setWizardStep("ble");
      }
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't provision device", { description: "Something went wrong." });
    } finally {
      setIsSubmittingForm(false);
    }
  };

  // Re-opens the BLE step for a device that was already provisioned but
  // never got confirmed (e.g. the admin closed the page mid-setup).
  const resumeConfirmation = (device) => {
    setPendingDevice(device);
    setWizardStep("ble");
    setIsConnected(false);
    setStatus(null);
    boardRef.current = null;
  };

  // NOTE: this "dvi_<token>" command and the DEVICEID_SET/DEVICEID_FAILED
  // responses are a designed protocol, not yet verified against real
  // firmware — unlike the WiFi-setup BLE flow, which was tested on actual
  // hardware. Worth confirming the exact wire format once ESP firmware for
  // this specific command exists.
  const handleNotify = (text) => {
    if (text === "SETTING") {
      setStatus({ tone: "wait", text: "Setting device ID…" });
    } else if (text === "DEVICEID_SET") {
      setStatus({ tone: "ok", text: "Device ID confirmed by the board!" });
      confirmProvisioning();
    } else if (text === "DEVICEID_FAILED") {
      setStatus({ tone: "fault", text: "The board couldn't store this ID — try sending again." });
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const board = await connectToBoard({
        onNotify: handleNotify,
        onDisconnect: () => {
          setIsConnected(false);
          boardRef.current = null;
          setStatus({ tone: "fault", text: "Bluetooth connection lost" });
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

  const sendDeviceId = async () => {
    if (!boardRef.current || !pendingDevice) return;
    setIsSending(true);
    try {
      const command = `dvi_${pendingDevice.qrToken}\n`;
      await boardRef.current.write(command);
      setStatus({ tone: "wait", text: "Sent — waiting for the board to confirm…" });
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't send", {
        description: "The Bluetooth connection may have dropped — reconnect and try again.",
      });
    } finally {
      setIsSending(false);
    }
  };

  const confirmProvisioning = async () => {
    if (!pendingDevice) return;
    try {
      await fetch(`/api/proxy/devices/${pendingDevice._id}/provision-status`, { method: "PATCH" });
      setDevices((prev) =>
        prev.map((d) => (d._id === pendingDevice._id ? { ...d, confirmedAt: new Date().toISOString() } : d))
      );
    } catch (error) {
      console.log(error);
    }
  };

  // Admin can delete any device, claimed or not — e.g. cleaning up a
  // mis-provisioned stub that never got confirmed, or removing an
  // owner's device on request.
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

  const qrValueFor = (device) => device.qrToken;

  const handlePrintQr = (device) => {
    const container = document.getElementById(`admin-qr-${device._id}`);
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
          <title>Dispo Device — QR Code</title>
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
            h2 { margin: 0 0 24px; font-size: 22px; }
            p { margin-top: 20px; color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <h2>${device.name || "New Dispo Device"}</h2>
          ${bigSvg.outerHTML}
          <p>Scan to set up or shop this machine</p>
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
              Provision a device, connect to it over Bluetooth to set its ID, then print its QR
              code and hand it to an owner.
            </p>
          </div>
          {wizardStep === "closed" && (
            <button
              onClick={() => setWizardStep("form")}
              className="flex items-center gap-2 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary shadow-[4px_6px_14px_rgba(255,93,0,0.38)] cursor-pointer"
            >
              <CirclePlus className="h-4 w-4" />
              Provision new device
            </button>
          )}
        </div>

        {/* ── Step 1: type + slots (+ optional custom token) ─────────── */}
        {wizardStep === "form" && (
          <form
            onSubmit={submitProvisionForm}
            className="mb-8 flex flex-col gap-4 rounded-[2rem] bg-surface-container-low p-6 shadow-[12px_12px_28px_rgba(184,196,214,0.65),-12px_-12px_28px_rgba(255,255,255,0.95)] max-w-md"
          >
            <h2 className="font-headline-sm text-headline-sm text-on-surface">New device</h2>

            <div className="space-y-1.5">
              <label className="block font-label-md text-label-md text-on-surface font-semibold">
                Device type
              </label>
              <select
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
                className="w-full rounded-full bg-surface px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none appearance-none"
              >
                <option value="" disabled>Select a type…</option>
                {DEVICE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block font-label-md text-label-md text-on-surface font-semibold">
                Number of slots
              </label>
              <input
                type="number"
                min={1}
                value={slotCount}
                onChange={(e) => setSlotCount(e.target.value)}
                placeholder="12"
                className="w-full rounded-full bg-surface px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-label-md text-label-md text-on-surface font-semibold">
                Existing token (optional)
              </label>
              <input
                type="text"
                value={customToken}
                onChange={(e) => setCustomToken(e.target.value)}
                placeholder="Leave blank to generate one and configure it over Bluetooth"
                className="w-full rounded-full bg-surface px-4 py-3 font-body-sm text-body-sm text-on-surface focus:outline-none"
              />
              <p className="font-body-sm text-body-sm text-on-surface-variant px-1">
                Only fill this in if the board already has its ID burned in some other way.
              </p>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={resetWizard}
                className="rounded-full px-5 py-2.5 font-label-lg text-label-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingForm}
                className="flex items-center gap-2 rounded-full bg-primary-container px-5 py-2.5 font-label-lg text-label-lg text-on-primary disabled:opacity-70 cursor-pointer"
              >
                {isSubmittingForm ? <Spinner size="sm" color="current" /> : <ArrowRight className="h-4 w-4" />}
                Continue
              </button>
            </div>
          </form>
        )}

        {/* ── Step 2: connect to the board over Bluetooth ────────────── */}
        {wizardStep === "ble" && pendingDevice && (
          <div className="mb-8 flex flex-col gap-4 rounded-[2rem] bg-surface-container-low p-6 shadow-[12px_12px_28px_rgba(184,196,214,0.65),-12px_-12px_28px_rgba(255,255,255,0.95)] max-w-md">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              Connect to the board
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Power on the machine (or hold the setup button on the board for 3 seconds), then connect over Bluetooth to give it its device ID.
            </p>

            {!isSupported ? (
              <div className="flex items-center gap-2 rounded-2xl bg-error-container p-4">
                <TriangleExclamation className="h-4 w-4 text-on-error-container shrink-0" />
                <p className="font-body-sm text-body-sm text-on-error-container">
                  This browser can't do Bluetooth setup. Use Chrome or Edge.
                </p>
              </div>
            ) : !isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="flex items-center justify-center gap-2 rounded-full bg-primary-container px-5 py-3.5 font-label-lg text-label-lg text-on-primary disabled:opacity-70 cursor-pointer"
              >
                {isConnecting ? <Spinner size="sm" color="current" /> : <PlugConnection className="h-4 w-4" />}
                {isConnecting ? "Connecting…" : "Connect to board"}
              </button>
            ) : (
              <button
                onClick={sendDeviceId}
                disabled={isSending || status?.tone === "ok"}
                className={`flex items-center justify-center gap-2 rounded-full px-5 py-3.5 font-label-lg text-label-lg transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  status?.tone === "ok"
                    ? "bg-emerald-500 text-white disabled:opacity-100"
                    : "bg-primary-container text-on-primary disabled:opacity-70"
                }`}
              >
                {status?.tone === "ok" ? (
                  <CircleCheck className="h-4 w-4" />
                ) : isSending ? (
                  <Spinner size="sm" color="current" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {status?.tone === "ok" ? "Confirmed" : "Send device ID"}
              </button>
            )}

            {status && (
              <div
                className={`rounded-2xl p-3 text-center font-body-sm text-body-sm ${
                  status.tone === "ok"
                    ? "bg-primary-fixed text-on-primary-fixed-variant"
                    : status.tone === "fault"
                    ? "bg-error-container text-on-error-container"
                    : "bg-surface-container text-on-surface-variant"
                }`}
              >
                {status.text}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={resetWizard}
                className="rounded-full px-5 py-2.5 font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
              >
                {status?.tone === "ok" ? "Done" : "Do this later"}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <>
              <DeviceCardSkeleton />
              <DeviceCardSkeleton />
              <DeviceCardSkeleton />
            </>
          ) : devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4)] sm:col-span-2 lg:col-span-3">
              <Server className="h-8 w-8 text-tertiary mb-3" />
              <p className="font-headline-sm text-headline-sm text-on-surface">No devices yet</p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
                Provision your first device to get a printable QR code.
              </p>
            </div>
          ) : (
            devices.map((device) => (
              <div
                key={device._id}
                className="relative flex flex-col items-center rounded-[1.5rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)]"
              >
                <button
                  type="button"
                  onClick={() => askDelete(device)}
                  aria-label="Delete device"
                  className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5)] transition-colors hover:text-error cursor-pointer"
                >
                  <TrashBin className="h-3.5 w-3.5" />
                </button>

                <div className="mb-3 w-full text-center">
                  {device.ownerId ? (
                    <>
                      <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">
                        {device.name}
                      </h3>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                        Owned by {ownerNameById[device.ownerId] || "Unknown"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-0.5 font-label-sm text-label-sm ${
                            device.status === "active"
                              ? "bg-surface-container text-on-surface-variant"
                              : "bg-error-container text-on-error-container"
                          }`}
                        >
                          {device.status === "active" ? "Active" : "Inactive"}
                        </span>
                        <span className="rounded-full bg-surface-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                          {device.slotCount} slots
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="rounded-full bg-surface px-3 py-1.5 font-label-sm text-label-sm text-on-surface-variant">
                        Not yet claimed
                      </span>
                      <span className="rounded-full bg-surface-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                        {device.slotCount} slots
                      </span>
                    </div>
                  )}
                </div>

                {device.confirmedAt ? (
                  <>
                    <div
                      className="rounded-xl bg-white p-3 shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]"
                      id={`admin-qr-${device._id}`}
                    >
                      <QRCodeSVG value={qrValueFor(device)} size={128} level="M" marginSize={0} />
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePrintQr(device)}
                      className="mt-4 flex items-center gap-2 rounded-full bg-surface px-4 py-2 font-label-md text-label-md text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] hover:text-primary-container transition-colors cursor-pointer"
                    >
                      <Printer className="h-4 w-4" />
                      Print
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <TriangleExclamation className="h-6 w-6 text-tertiary" />
                    <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
                      Not yet confirmed by the board
                    </p>
                    <button
                      onClick={() => resumeConfirmation(device)}
                      className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 font-label-md text-label-md text-on-surface-variant shadow-[3px_3px_8px_rgba(184,196,214,0.5)] hover:text-primary-container transition-colors cursor-pointer"
                    >
                      <PlugConnection className="h-4 w-4" />
                      Configure now
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete confirmation — admin can remove any device, claimed or not */}
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
    </main>
  );
}
