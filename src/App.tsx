import { AppShell } from "./AppShell.js";
import { CapsuleWindow } from "./CapsuleWindow.js";
import { HealthProvider } from "./health/HealthContext.js";
import { AppProvider } from "./state/AppContext.js";
import "./styles.css";

export default function App() {
  if (window.location.hash === "#/capsule") {
    return <CapsuleWindow />;
  }
  return (
    <AppProvider>
      <HealthProvider>
        <AppShell />
      </HealthProvider>
    </AppProvider>
  );
}
