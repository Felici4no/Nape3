import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource/anton/latin-400.css";
import "@fontsource-variable/inter/index.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
