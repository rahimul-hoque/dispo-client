"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Box, Server, TagDollar, ChartLine, SealPercent } from "@gravity-ui/icons";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function StatCard({ icon: Icon, label, value, loading }) {
  return (
    <div className="flex items-center gap-4 rounded-[1.5rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.5),inset_-2px_-2px_5px_rgba(255,255,255,0.9)]">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="font-body-sm text-body-sm text-on-surface-variant">{label}</p>
        <p className="font-headline-lg text-headline-lg text-on-surface">
          {loading ? "…" : value}
        </p>
      </div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="rounded-[1.5rem] bg-surface-container-low p-5 shadow-[8px_8px_20px_rgba(184,196,214,0.55),-8px_-8px_20px_rgba(255,255,255,0.9)]">
      <h3 className="font-headline-sm text-headline-sm text-on-surface mb-4">{title}</h3>
      {children}
    </div>
  );
}

function EmptyChartState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-6 w-6 text-tertiary mb-2" />
      <p className="font-body-sm text-body-sm text-on-surface-variant">{message}</p>
    </div>
  );
}

export default function OwnerDashboardPage() {
  const { data: devices = [], isLoading: devicesLoading } = useSWR("/api/proxy/devices", fetcher, { refreshInterval: 30000 });

  // Scope the products query to just this owner's own devices (and drop
  // the base64 `image` field, which dashboards never render) — fetching
  // the whole system's product photos just to show a few counts is what
  // made this page slow. Key is null (no fetch) until devices resolves.
  const deviceIds = useMemo(() => (Array.isArray(devices) ? devices.map((d) => d._id) : []), [devices]);
  const productsKey =
    deviceIds.length > 0 ? `/api/proxy/products?deviceId=${deviceIds.join(",")}` : null;
  const { data: products = [], isLoading: productsLoading } = useSWR(productsKey, fetcher, { refreshInterval: 30000 });

  // Revenue/top-seller numbers are computed server-side — fetching every
  // order just to sum them got slower with every sale.
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const { data: stats, isLoading: ordersLoading } = useSWR(
    `/api/proxy/orders/stats?tz=${encodeURIComponent(tz)}`,
    fetcher,
    { refreshInterval: 15000 }
  );

  const loading = devicesLoading || productsLoading || ordersLoading;

  // Products are already scoped to this owner's devices by the query
  // above — this just guards against a malformed response shape.
  const myProducts = useMemo(() => {
    if (!Array.isArray(products) || !Array.isArray(devices)) return [];
    const ownedDeviceIds = new Set(devices.map((d) => d._id));
    return products.filter((p) => ownedDeviceIds.has(p.deviceId));
  }, [products, devices]);

  const totalStock = useMemo(
    () => myProducts.reduce((sum, p) => sum + (p.stock || 0), 0),
    [myProducts]
  );

  const totalRevenue = stats?.totalRevenue || 0;

  const stockByProduct = useMemo(
    () => myProducts.map((p) => ({ name: p.name, stock: p.stock || 0 })).slice(0, 12),
    [myProducts]
  );

  const productsByDevice = useMemo(() => {
    if (!Array.isArray(devices)) return [];
    const deviceNameById = Object.fromEntries(devices.map((d) => [d._id, d.name]));
    const counts = {};
    myProducts.forEach((p) => {
      const name = deviceNameById[p.deviceId];
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [myProducts, devices]);

  const revenueOverTime = Array.isArray(stats?.revenueByDay) ? stats.revenueByDay : [];

  const topSelling = Array.isArray(stats?.topSelling) ? stats.topSelling : [];

  return (
    <main className="w-full min-h-screen py-10 px-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">Dashboard</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mb-8">
          A quick look at your kiosk business.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mb-8">
          <StatCard icon={Server} label="Devices" value={devices.length} loading={loading} />
          <StatCard icon={Box} label="Products" value={myProducts.length} loading={loading} />
          <StatCard icon={TagDollar} label="Units in stock" value={totalStock} loading={loading} />
          <StatCard icon={ChartLine} label="Revenue" value={`৳${totalRevenue}`} loading={loading} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Stock by product">
            {loading ? (
              <div className="h-64 animate-pulse rounded-xl bg-surface-container" />
            ) : stockByProduct.length === 0 ? (
              <EmptyChartState icon={Box} message="Add products to see this chart." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stockByProduct} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e8" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip />
                  <Bar dataKey="stock" fill="#ff5d00" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Products by device">
            {loading ? (
              <div className="h-64 animate-pulse rounded-xl bg-surface-container" />
            ) : productsByDevice.length === 0 ? (
              <EmptyChartState icon={Server} message="Add devices and products to see this chart." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={productsByDevice} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e8" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#595f68" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Revenue over time">
            {loading ? (
              <div className="h-64 animate-pulse rounded-xl bg-surface-container" />
            ) : revenueOverTime.length === 0 ? (
              <EmptyChartState icon={ChartLine} message="No sales yet — this fills in as orders come through /shop/checkout." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={revenueOverTime} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e8" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="revenue" stroke="#ff5d00" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Top-selling products">
            {loading ? (
              <div className="h-64 animate-pulse rounded-xl bg-surface-container" />
            ) : topSelling.length === 0 ? (
              <EmptyChartState icon={SealPercent} message="No sales yet — this fills in as orders come through /shop/checkout." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topSelling} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e8" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="qty" fill="#ff5d00" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </main>
  );
}
