"use client";

import { productImageUrl } from "@/lib/product-image";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useForm } from "react-hook-form";
import {
  Box,
  Tag,
  TagDollar,
  Boxes3,
  Server,
  Pencil,
  TrashBin,
  ArrowRight,
  TriangleExclamation,
  Picture,
} from "@gravity-ui/icons";
import { Modal, toast, useOverlayState, Spinner } from "@heroui/react";
import Link from "next/link";

function ProductCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-[1.75rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)] animate-pulse">
      <div className="h-14 w-14 shrink-0 rounded-2xl bg-surface-container" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="h-4 w-2/5 rounded-full bg-surface-container" />
        <div className="h-3 w-3/5 rounded-full bg-surface-container" />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="h-4 w-10 rounded-full bg-surface-container" />
        <div className="h-9 w-9 rounded-full bg-surface-container" />
        <div className="h-9 w-9 rounded-full bg-surface-container" />
      </div>
    </div>
  );
}

function CatalogPageContent() {
  const searchParams = useSearchParams();
  const preselectedDeviceId = searchParams.get("device");

  const { data: devicesRaw = [], isLoading: isLoadingDevices } = useSWR("/api/proxy/devices", fetcher);
  const devices = useMemo(() => (Array.isArray(devicesRaw) ? devicesRaw : []), [devicesRaw]);

  // Only this account's own devices' products, fetched once the device
  // list is known — not the whole system's catalog filtered down here.
  const productsKey =
    devices.length > 0 ? `/api/proxy/products?deviceId=${devices.map((d) => d._id).join(",")}` : null;
  const {
    data: productsRaw = [],
    isLoading: isLoadingProducts,
    mutate: mutateProducts,
  } = useSWR(productsKey, fetcher, {
    onError: () => toast.danger("Couldn't load your catalog", { description: "Check your connection and try again." }),
  });
  const products = useMemo(() => (Array.isArray(productsRaw) ? productsRaw : []), [productsRaw]);
  const [deviceFilter, setDeviceFilter] = useState(""); // "" = show every device

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { isSubmitting },
  } = useForm({
    defaultValues: { name: "", description: "", price: "", stock: "", deviceId: "", slotNumber: "" },
  });

  const editModal = useOverlayState();
  const [editingProduct, setEditingProduct] = useState(null);
  const editForm = useForm({
    defaultValues: { name: "", description: "", price: "", stock: "", deviceId: "", slotNumber: "" },
  });

  const deleteModal = useOverlayState();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const deviceMap = useMemo(
    () => Object.fromEntries(devices.map((d) => [d._id, d.name])),
    [devices]
  );

  // Slot dropdown for the Add form: options depend on which device is
  // selected, and already-used slots on that device are shown but disabled.
  const addSelectedDeviceId = watch("deviceId");
  const addSelectedDevice = devices.find((d) => d._id === addSelectedDeviceId);
  const addTakenSlots = useMemo(
    () => new Set(products.filter((p) => p.deviceId === addSelectedDeviceId).map((p) => p.slotNumber)),
    [products, addSelectedDeviceId]
  );
  const addSlotOptions = addSelectedDevice
    ? Array.from({ length: addSelectedDevice.slotCount }, (_, i) => i + 1)
    : [];

  // Same idea for the Edit form, but excluding the product being edited
  // from its own "taken" set (it's allowed to keep its current slot).
  const editSelectedDeviceId = editForm.watch("deviceId");
  const editSelectedDevice = devices.find((d) => d._id === editSelectedDeviceId);
  const editTakenSlots = useMemo(
    () =>
      new Set(
        products
          .filter((p) => p.deviceId === editSelectedDeviceId && p._id !== editingProduct?._id)
          .map((p) => p.slotNumber)
      ),
    [products, editSelectedDeviceId, editingProduct]
  );
  const editSlotOptions = editSelectedDevice
    ? Array.from({ length: editSelectedDevice.slotCount }, (_, i) => i + 1)
    : [];

  const [addImagePreview, setAddImagePreview] = useState(null);
  const [addImageBase64, setAddImageBase64] = useState(null);

  const [editImagePreview, setEditImagePreview] = useState(null);
  // undefined = photo unchanged (not re-sent on save); a data URL replaces it.
  const [editImageBase64, setEditImageBase64] = useState(undefined);

  // Shared by both the Add and Edit forms — reads the chosen file, checks a
  // sane size limit (base64 inflates size ~33%, and we're storing this
  // directly in MongoDB, not dedicated image storage, so keeping originals
  // small matters), and converts it to a data URL for both preview + upload.
  const handleImageFile = (file, setPreview, setBase64) => {
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
      setPreview(reader.result);
      setBase64(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Products are already fetched for owned devices only (productsKey); this
  // just guards against a stale cache entry from before a device changed.
  const myProducts = useMemo(
    () => products.filter((p) => p.deviceId in deviceMap),
    [products, deviceMap]
  );

  // Further narrowed by whichever device the owner picked in the filter,
  // on top of the ownership scoping above.
  const visibleProducts = useMemo(
    () => (deviceFilter ? myProducts.filter((p) => p.deviceId === deviceFilter) : myProducts),
    [myProducts, deviceFilter]
  );

  // A device just claimed via /owner/devices/claim/[token] redirects here
  // with ?device=<id> so the owner can start stocking it immediately,
  // without hunting for it in the dropdown themselves.
  useEffect(() => {
    if (preselectedDeviceId && devices.some((d) => d._id === preselectedDeviceId)) {
      setValue("deviceId", preselectedDeviceId);
    }
  }, [preselectedDeviceId, devices, setValue]);

  const onSubmit = async (data) => {
    try {
      const res = await fetch("/api/proxy/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, image: addImageBase64 }),
      });
      const created = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't add product", { description: created.error || "Please try again." });
        return;
      }
      mutateProducts((current = []) => [...current, created], { revalidate: false });
      reset();
      setAddImagePreview(null);
      setAddImageBase64(null);
      toast.success("Product added", { description: `${created.name} is now in your catalog.` });
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't add product", { description: "Something went wrong." });
    }
  };

  const askDelete = (product) => {
    setDeleteTarget(product);
    deleteModal.open();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/proxy/products/${deleteTarget._id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't delete product", { description: result.error || "Please try again." });
        return;
      }
      mutateProducts((current = []) => current.filter((p) => p._id !== deleteTarget._id), { revalidate: false });
      toast.success("Product deleted", { description: `${deleteTarget.name} was removed.` });
      deleteModal.close();
      setDeleteTarget(null);
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't delete product", { description: "Something went wrong." });
    } finally {
      setIsDeleting(false);
    }
  };

  const onEdit = (product) => {
    setEditingProduct(product);
    editForm.reset({
      name: product.name,
      description: product.description || "",
      price: product.price,
      stock: product.stock,
      deviceId: product.deviceId || "",
      slotNumber: product.slotNumber,
    });
    setEditImagePreview(productImageUrl(product));
    setEditImageBase64(undefined);
    editModal.open();
  };

  const onEditSubmit = async (data) => {
    try {
      const res = await fetch(`/api/proxy/products/${editingProduct._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editImageBase64 === undefined ? data : { ...data, image: editImageBase64 }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't update product", { description: result.error || "Please try again." });
        return;
      }
      mutateProducts(
        (current = []) =>
          current.map((p) =>
            p._id === editingProduct._id
              ? { ...p, ...data, hasImage: result.hasImage, imageVersion: result.imageVersion }
              : p
          ),
        { revalidate: false }
      );
      toast.success("Product updated", { description: `${data.name} was saved.` });
      editModal.close();
      setEditingProduct(null);
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't update product", { description: "Something went wrong." });
    }
  };

  const noDevicesYet = !isLoadingDevices && devices.length === 0;

  return (
    <main className="w-full min-h-screen py-10 px-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">Catalog</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mb-8">
          Add, edit, and remove items across your devices.
        </p>

        <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">
          {/* Add product form */}
          <div className="h-fit rounded-[2rem] bg-surface-container-low p-6 shadow-[12px_12px_28px_rgba(184,196,214,0.65),-12px_-12px_28px_rgba(255,255,255,0.95)]">
            <h2 className="font-headline-sm text-headline-sm text-on-surface mb-5">Add a product</h2>

            {noDevicesYet ? (
              <div className="rounded-2xl bg-surface-container p-4 text-center">
                <p className="font-body-md text-body-md text-on-surface-variant mb-3">
                  You need at least one device before adding products.
                </p>
                <Link
                  href="/owner/devices"
                  className="inline-flex items-center gap-2 rounded-full bg-primary-container px-4 py-2 font-label-md text-label-md text-on-primary hover:opacity-90 transition-opacity"
                >
                  <Server className="h-4 w-4" />
                  Add a device
                </Link>
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
                <div className="space-y-1.5">
                  <label htmlFor="deviceId" className="block font-label-md text-label-md text-on-surface font-semibold">
                    Device
                  </label>
                  <div className="relative flex items-center rounded-full bg-surface-container shadow-[inset_3px_3px_6px_rgba(184,196,214,0.55),inset_-3px_-3px_6px_rgba(255,255,255,0.85)] px-4 py-3 focus-within:shadow-[inset_4px_4px_7px_rgba(184,196,214,0.65),inset_-4px_-4px_7px_rgba(255,255,255,0.95),0_0_0_2px_#ff5d00] transition-all">
                    <Server className="text-tertiary w-4 h-4 mr-2.5 shrink-0" />
                    <select
                      id="deviceId"
                      className="w-full bg-transparent font-body-md text-body-md text-on-surface focus:outline-none appearance-none"
                      defaultValue=""
                      {...register("deviceId", {
                        required: true,
                        onChange: () => setValue("slotNumber", ""),
                      })}
                    >
                      <option value="" disabled>Select a device…</option>
                      {devices.map((d) => (
                        <option key={d._id} value={d._id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="slotNumber" className="block font-label-md text-label-md text-on-surface font-semibold">
                    Slot
                  </label>
                  <div className="relative flex items-center rounded-full bg-surface-container shadow-[inset_3px_3px_6px_rgba(184,196,214,0.55),inset_-3px_-3px_6px_rgba(255,255,255,0.85)] px-4 py-3 focus-within:shadow-[inset_4px_4px_7px_rgba(184,196,214,0.65),inset_-4px_-4px_7px_rgba(255,255,255,0.95),0_0_0_2px_#ff5d00] transition-all">
                    <Boxes3 className="text-tertiary w-4 h-4 mr-2.5 shrink-0" />
                    <select
                      id="slotNumber"
                      disabled={!addSelectedDevice}
                      className="w-full bg-transparent font-body-md text-body-md text-on-surface focus:outline-none appearance-none disabled:opacity-50"
                      defaultValue=""
                      {...register("slotNumber", { required: true, valueAsNumber: true })}
                    >
                      <option value="" disabled>
                        {addSelectedDevice ? "Select a slot…" : "Pick a device first"}
                      </option>
                      {addSlotOptions.map((n) => (
                        <option key={n} value={n} disabled={addTakenSlots.has(n)}>
                          Slot {n}{addTakenSlots.has(n) ? " (taken)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-label-md text-label-md text-on-surface font-semibold">
                    Photo (optional)
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-container shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]">
                      {addImagePreview ? (
                        <img src={addImagePreview} alt="Preview" className="h-full w-full object-cover" />
                      ) : (
                        <Picture className="h-6 w-6 text-tertiary" />
                      )}
                    </div>
                    <label className="flex-1 cursor-pointer rounded-full bg-surface-container px-4 py-2.5 text-center font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors">
                      {addImagePreview ? "Change photo" : "Upload photo"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleImageFile(e.target.files?.[0], setAddImagePreview, setAddImageBase64)}
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="name" className="block font-label-md text-label-md text-on-surface font-semibold">
                    Name
                  </label>
                  <div className="relative flex items-center rounded-full bg-surface-container shadow-[inset_3px_3px_6px_rgba(184,196,214,0.55),inset_-3px_-3px_6px_rgba(255,255,255,0.85)] px-4 py-3 focus-within:shadow-[inset_4px_4px_7px_rgba(184,196,214,0.65),inset_-4px_-4px_7px_rgba(255,255,255,0.95),0_0_0_2px_#ff5d00] transition-all">
                    <Tag className="text-tertiary w-4 h-4 mr-2.5 shrink-0" />
                    <input
                      id="name"
                      type="text"
                      placeholder="Sparkling Water"
                      className="w-full bg-transparent font-body-md text-body-md text-on-surface placeholder:text-tertiary focus:outline-none"
                      {...register("name", { required: true })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="description" className="block font-label-md text-label-md text-on-surface font-semibold">
                    Description
                  </label>
                  <textarea
                    id="description"
                    rows={2}
                    placeholder="500ml, chilled"
                    className="w-full resize-none rounded-2xl bg-surface-container px-4 py-3 shadow-[inset_3px_3px_6px_rgba(184,196,214,0.55),inset_-3px_-3px_6px_rgba(255,255,255,0.85)] font-body-md text-body-md text-on-surface placeholder:text-tertiary focus:outline-none focus:shadow-[inset_4px_4px_7px_rgba(184,196,214,0.65),inset_-4px_-4px_7px_rgba(255,255,255,0.95),0_0_0_2px_#ff5d00] transition-all"
                    {...register("description")}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="price" className="block font-label-md text-label-md text-on-surface font-semibold">
                      Price
                    </label>
                    <div className="relative flex items-center rounded-full bg-surface-container shadow-[inset_3px_3px_6px_rgba(184,196,214,0.55),inset_-3px_-3px_6px_rgba(255,255,255,0.85)] px-4 py-3 focus-within:shadow-[inset_4px_4px_7px_rgba(184,196,214,0.65),inset_-4px_-4px_7px_rgba(255,255,255,0.95),0_0_0_2px_#ff5d00] transition-all">
                      <TagDollar className="text-tertiary w-4 h-4 mr-2 shrink-0" />
                      <input
                        id="price"
                        type="number"
                        step="0.01"
                        placeholder="45"
                        className="w-full bg-transparent font-body-md text-body-md text-on-surface placeholder:text-tertiary focus:outline-none"
                        {...register("price", { required: true, valueAsNumber: true })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="stock" className="block font-label-md text-label-md text-on-surface font-semibold">
                      Stock
                    </label>
                    <div className="relative flex items-center rounded-full bg-surface-container shadow-[inset_3px_3px_6px_rgba(184,196,214,0.55),inset_-3px_-3px_6px_rgba(255,255,255,0.85)] px-4 py-3 focus-within:shadow-[inset_4px_4px_7px_rgba(184,196,214,0.65),inset_-4px_-4px_7px_rgba(255,255,255,0.95),0_0_0_2px_#ff5d00] transition-all">
                      <Boxes3 className="text-tertiary w-4 h-4 mr-2 shrink-0" />
                      <input
                        id="stock"
                        type="number"
                        placeholder="32"
                        className="w-full bg-transparent font-body-md text-body-md text-on-surface placeholder:text-tertiary focus:outline-none"
                        {...register("stock", { valueAsNumber: true })}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="group mt-2 flex w-full items-center justify-between rounded-full bg-surface p-2 pl-6 shadow-[6px_6px_14px_rgba(184,196,214,0.6),-6px_-6px_14px_rgba(255,255,255,0.95)] transition-all hover:shadow-[8px_8px_18px_rgba(184,196,214,0.7),-8px_-8px_18px_rgba(255,255,255,1)] active:shadow-[inset_3px_3px_6px_rgba(184,196,214,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.8)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <span className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight group-hover:text-primary-container transition-colors">
                    {isSubmitting ? "Adding..." : "Add product"}
                  </span>
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-container text-on-primary shadow-[4px_6px_14px_rgba(255,93,0,0.38),-2px_-2px_6px_rgba(255,140,75,0.4)] transition-transform group-hover:scale-105 group-active:scale-95">
                    {isSubmitting ? <Spinner size="sm" color="current" /> : <ArrowRight className="h-5 w-5" />}
                  </div>
                </button>
              </form>
            )}
          </div>

          {/* Product list */}
          <div className="flex flex-col gap-4">
            {!isLoadingDevices && devices.length > 0 && (
              <div className="flex items-center gap-3 rounded-full bg-surface-container-low px-4 py-2 shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)] w-fit">
                <Server className="h-4 w-4 text-tertiary shrink-0" />
                <select
                  value={deviceFilter}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                  className="bg-transparent font-label-md text-label-md text-on-surface focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="">All devices</option>
                  {devices.map((d) => (
                    <option key={d._id} value={d._id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}

            {isLoadingProducts ? (
              <>
                <ProductCardSkeleton />
                <ProductCardSkeleton />
                <ProductCardSkeleton />
              </>
            ) : visibleProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4),inset_-3px_-3px_8px_rgba(255,255,255,0.8)]">
                <Box className="h-8 w-8 text-tertiary mb-3" />
                <p className="font-headline-sm text-headline-sm text-on-surface">
                  {deviceFilter ? "No products on this device" : "No products yet"}
                </p>
                <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs">
                  {deviceFilter
                    ? "Try a different device, or add one here."
                    : "Add your first item using the form to see it listed here."}
                </p>
              </div>
            ) : (
              visibleProducts.map((product) => (
                <div
                  key={product._id}
                  className="flex items-center gap-4 rounded-[1.75rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)]"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.5),inset_-2px_-2px_5px_rgba(255,255,255,0.9)]">
                    {productImageUrl(product) ? (
                      <img src={productImageUrl(product)} alt={product.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <Box className="h-6 w-6 text-tertiary" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">
                        {product.name}
                      </h3>
                      <span className="shrink-0 flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                        <Server className="h-3 w-3" />
                        {deviceMap[product.deviceId]} · Slot {product.slotNumber}
                      </span>
                      {product.stock === 0 ? (
                        <span className="shrink-0 rounded-full bg-error-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-error-container">
                          Out of stock
                        </span>
                      ) : product.stock < 5 ? (
                        <span className="shrink-0 rounded-full bg-primary-fixed px-2.5 py-0.5 font-label-sm text-label-sm text-on-primary-fixed-variant">
                          Low stock · {product.stock}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-surface-container px-2.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                          {product.stock} in stock
                        </span>
                      )}
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant truncate mt-0.5">
                      {product.description || "No description"}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-headline-sm text-headline-sm text-primary whitespace-nowrap">
                      ৳{product.price}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEdit(product)}
                      aria-label="Edit product"
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] transition-colors hover:text-primary-container cursor-pointer"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => askDelete(product)}
                      aria-label="Delete product"
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] transition-colors hover:text-error cursor-pointer"
                    >
                      <TrashBin className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal state={deleteModal}>
        <Modal.Trigger className="hidden" aria-hidden="true" tabIndex={-1} />
        <Modal.Backdrop>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Icon>
                  <TriangleExclamation className="h-5 w-5 text-error" />
                </Modal.Icon>
                <Modal.Heading>Delete this product?</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {deleteTarget
                    ? `"${deleteTarget.name}" will be permanently removed from your catalog. This can't be undone.`
                    : ""}
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

      {/* Edit product modal */}
      <Modal state={editModal}>
        <Modal.Trigger className="hidden" aria-hidden="true" tabIndex={-1} />
        <Modal.Backdrop>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Edit product</Modal.Heading>
              </Modal.Header>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)}>
                <Modal.Body>
                  <div className="flex flex-col gap-4">
                    <div className="space-y-1.5">
                      <label className="block font-label-md text-label-md text-on-surface font-semibold">
                        Photo
                      </label>
                      <div className="flex items-center gap-3">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.4)]">
                          {editImagePreview ? (
                            <img src={editImagePreview} alt="Preview" className="h-full w-full object-cover" />
                          ) : (
                            <Picture className="h-6 w-6 text-tertiary" />
                          )}
                        </div>
                        <label className="flex-1 cursor-pointer rounded-full bg-surface px-4 py-2.5 text-center font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors">
                          {editImagePreview ? "Change photo" : "Upload photo"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleImageFile(e.target.files?.[0], setEditImagePreview, setEditImageBase64)}
                          />
                        </label>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-label-md text-label-md text-on-surface font-semibold">
                        Device
                      </label>
                      <select
                        className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none appearance-none"
                        {...editForm.register("deviceId", {
                          required: true,
                          onChange: () => editForm.setValue("slotNumber", ""),
                        })}
                      >
                        {devices.map((d) => (
                          <option key={d._id} value={d._id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-label-md text-label-md text-on-surface font-semibold">
                        Slot
                      </label>
                      <select
                        disabled={!editSelectedDevice}
                        className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none appearance-none disabled:opacity-50"
                        {...editForm.register("slotNumber", { required: true, valueAsNumber: true })}
                      >
                        {editSlotOptions.map((n) => (
                          <option key={n} value={n} disabled={editTakenSlots.has(n)}>
                            Slot {n}{editTakenSlots.has(n) ? " (taken)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
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
                        Description
                      </label>
                      <textarea
                        rows={2}
                        className="w-full resize-none rounded-2xl bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none"
                        {...editForm.register("description")}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block font-label-md text-label-md text-on-surface font-semibold">
                          Price
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none"
                          {...editForm.register("price", { required: true, valueAsNumber: true })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block font-label-md text-label-md text-on-surface font-semibold">
                          Stock
                        </label>
                        <input
                          type="number"
                          className="w-full rounded-full bg-surface-container px-4 py-3 font-body-md text-body-md text-on-surface focus:outline-none"
                          {...editForm.register("stock", { valueAsNumber: true })}
                        />
                      </div>
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
                    {editForm.formState.isSubmitting ? "Saving..." : "Save changes"}
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

export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <CatalogPageContent />
    </Suspense>
  );
}
