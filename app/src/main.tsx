import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled (Latin, woff2 only) so OpenChurn makes no network requests.
import "./fonts.css";
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
