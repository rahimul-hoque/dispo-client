"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [deviceId, setDeviceId] = useState(null);
  const [items, setItems] = useState([]); // [{ slotNumber, name, price, qty }]
  const [hydrated, setHydrated] = useState(false);

  // Load any saved cart once, on first mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dispo_cart");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Defensive: discard any saved item that doesn't match the current
        // schema (e.g. a stale cart from before slotNumber replaced
        // productId as the item key) rather than let it render with a
        // missing/duplicate React key.
        const validItems = Array.isArray(parsed.items)
          ? parsed.items.filter((i) => typeof i.slotNumber === "number")
          : [];
        setDeviceId(validItems.length > 0 ? parsed.deviceId || null : null);
        setItems(validItems);
      }
    } catch (error) {
      console.log(error);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist on every change, but not before the initial load above finishes
  // (otherwise we'd briefly overwrite a saved cart with empty defaults)
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("dispo_cart", JSON.stringify({ deviceId, items }));
  }, [deviceId, items, hydrated]);

  // A cart only ever belongs to one machine at a time — adding an item
  // from a different device clears whatever was there before. Items are
  // keyed by slotNumber (unique within one device's cart), not productId —
  // slotNumber is what the physical machine actually dispenses from.
  const addItem = useCallback((product, forDeviceId) => {
    setItems((prev) => {
      const isSwitchingDevice = deviceId && deviceId !== forDeviceId && prev.length > 0;
      const base = isSwitchingDevice ? [] : prev;
      const existing = base.find((i) => i.slotNumber === product.slotNumber);
      if (existing) {
        return base.map((i) =>
          i.slotNumber === product.slotNumber ? { ...i, qty: i.qty + 1 } : i
        );
      }
      return [...base, { slotNumber: product.slotNumber, name: product.name, price: product.price, qty: 1 }];
    });
    setDeviceId(forDeviceId);
  }, [deviceId]);

  const updateQty = useCallback((slotNumber, qty) => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((i) => i.slotNumber !== slotNumber));
      return;
    }
    setItems((prev) => prev.map((i) => (i.slotNumber === slotNumber ? { ...i, qty } : i)));
  }, []);

  const removeItem = useCallback((slotNumber) => {
    setItems((prev) => prev.filter((i) => i.slotNumber !== slotNumber));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setDeviceId(null);
  }, []);

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const count = items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <CartContext.Provider
      value={{ deviceId, items, addItem, updateQty, removeItem, clearCart, total, count }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
