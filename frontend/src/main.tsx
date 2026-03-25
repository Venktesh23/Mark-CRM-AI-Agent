import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logError } from "@/core/errors/error-logger";
import { clearLegacyLocalDataOnce } from "@/core/app/clear-legacy-local-data";

clearLegacyLocalDataOnce();

window.addEventListener("unhandledrejection", (event) => {
  logError("ui.unhandled-rejection", event.reason);
});

window.addEventListener("error", (event) => {
  logError("ui.window-error", event.error ?? event.message);
});

createRoot(document.getElementById("root")!).render(<App />);
