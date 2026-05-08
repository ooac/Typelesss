import {
  Activity,
  History as HistoryIcon,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import { BottomStrip } from "./components/BottomStrip.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { Topbar } from "./components/Topbar.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { HotkeyPage } from "./pages/HotkeyPage.js";
import { PermissionsPage } from "./pages/PermissionsPage.js";
import { ProvidersPage } from "./pages/ProvidersPage.js";
import { RealtimePage } from "./pages/RealtimePage.js";
import { navigate, useRoute, type RouteId } from "./router.js";

const RAIL_ITEMS: Array<{ id: RouteId; label: string; icon: ReactNode }> = [
  { id: "realtime", label: "实时", icon: <Activity size={20} /> },
  { id: "history", label: "历史", icon: <HistoryIcon size={20} /> },
  { id: "providers", label: "服务商", icon: <SlidersHorizontal size={20} /> },
  { id: "hotkey", label: "快捷键", icon: <KeyRound size={20} /> },
  { id: "permissions", label: "权限", icon: <ShieldCheck size={20} /> },
];

const PAGE_BY_ROUTE: Record<RouteId, () => ReactNode> = {
  realtime: () => <RealtimePage />,
  history: () => <HistoryPage />,
  providers: () => <ProvidersPage />,
  hotkey: () => <HotkeyPage />,
  permissions: () => <PermissionsPage />,
};

export function AppShell() {
  const route = useRoute();
  const Page = PAGE_BY_ROUTE[route];
  return (
    <main className="shell">
      <aside className="app-rail" aria-label="主导航">
        <div className="rail-mark">T</div>
        {RAIL_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rail-item ${route === item.id ? "active" : ""}`}
            aria-label={item.label}
            aria-current={route === item.id ? "page" : undefined}
            onClick={() => navigate(item.id)}
          >
            {item.icon}
          </button>
        ))}
        <div className="rail-version">v0.1.0</div>
      </aside>

      <section className="app-frame">
        <Topbar />
        <ErrorBanner />
        {Page()}
        <BottomStrip />
      </section>
    </main>
  );
}
