import { TriangleExclamation, PlugConnection } from "@gravity-ui/icons";

export function DeviceUnavailableBanner({ code, message, className = "" }) {
  if (!message) return null;
  const Icon = code === "DEVICE_OFFLINE" ? PlugConnection : TriangleExclamation;
  return (
    <div
      className={`flex items-start gap-2 rounded-2xl bg-error-container px-4 py-3 text-on-error-container ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-body-md text-body-md">{message}</p>
    </div>
  );
}

// Short label for a disabled order button.
export function unavailableLabel(code) {
  return code === "DEVICE_OFFLINE" ? "Machine offline" : "Machine inactive";
}
