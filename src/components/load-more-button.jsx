"use client";

import { Spinner } from "@heroui/react";

export function LoadMoreButton({ hasMore, isLoadingMore, onClick }) {
  if (!hasMore) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoadingMore}
      className="mx-auto mt-2 flex items-center gap-2 rounded-full bg-surface-container-low px-5 py-2.5 font-label-md text-label-md text-on-surface shadow-[3px_3px_8px_rgba(184,196,214,0.5)] disabled:opacity-70 cursor-pointer"
    >
      {isLoadingMore && <Spinner size="sm" color="current" />}
      {isLoadingMore ? "Loading…" : "Load more"}
    </button>
  );
}
