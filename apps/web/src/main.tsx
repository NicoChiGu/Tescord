import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import { App } from "./App.js";
import { AuthWindowApp } from "./AuthWindowApp.js";
import "./index.css";
import "./i18n/index.js";

function getIsAuthWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("window") === "auth") return true;
    if (window.location.hash.includes("auth")) return true;
  } catch {}
  return false;
}

const isAuthWindow = getIsAuthWindow();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAuthWindow ? <AuthWindowApp /> : <App />}
  </React.StrictMode>,
);
