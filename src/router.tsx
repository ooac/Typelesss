import { useEffect, useState } from "react";

export type RouteId = "realtime" | "history" | "providers" | "hotkey" | "permissions";

const ROUTE_HASHES: Record<RouteId, string> = {
  realtime: "#/realtime",
  history: "#/history",
  providers: "#/providers",
  hotkey: "#/hotkey",
  permissions: "#/permissions",
};

const HASH_TO_ROUTE: Record<string, RouteId> = Object.entries(ROUTE_HASHES).reduce(
  (acc, [route, hash]) => {
    acc[hash] = route as RouteId;
    return acc;
  },
  {} as Record<string, RouteId>,
);

const DEFAULT_ROUTE: RouteId = "realtime";

export function currentRouteFromHash(hash: string = window.location.hash): RouteId {
  return HASH_TO_ROUTE[hash] ?? DEFAULT_ROUTE;
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(() => currentRouteFromHash());
  useEffect(() => {
    const handle = () => setRoute(currentRouteFromHash());
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  return route;
}

export function navigate(route: RouteId) {
  if (currentRouteFromHash() === route) return;
  window.location.hash = ROUTE_HASHES[route];
}
