"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

// A cached, always-an-array list from an API route, plus a setState-style
// setter for optimistic local edits (add/update/remove) that doesn't
// trigger a refetch. Revisiting the page shows the cached list instantly
// while SWR revalidates in the background.
export function useSWRList(key, options) {
  const { data, isLoading, mutate } = useSWR(key, fetcher, options);
  const list = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const setList = useCallback(
    (update) =>
      mutate(
        (current) => {
          const prev = Array.isArray(current) ? current : [];
          return typeof update === "function" ? update(prev) : update;
        },
        { revalidate: false }
      ),
    [mutate]
  );
  return { list, setList, isLoading, mutate };
}
