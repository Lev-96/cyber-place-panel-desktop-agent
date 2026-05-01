import AgentApp from "@/ui/AgentApp";
import "@/styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Renderer-side guards: kill keys that are NOT blocked by Electron kiosk mode
// out of the box (devtools shortcuts, refresh, drag-drop, context menu).
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("dragstart", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) e.preventDefault();
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "i") e.preventDefault();
  if (e.key === "F11" || e.key === "F12") e.preventDefault();
});

createRoot(root).render(
  <StrictMode>
    <AgentApp />
  </StrictMode>,
);
