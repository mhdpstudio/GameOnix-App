import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, useLocation } from "react-router-dom";

import "./constants/colors.css";
import "./constants/fonts.css";
import "./constants/times.css";
import "./style/index.css";
import "./style/main-layout.css";
import "./style/sidebar-style.css";

import "./api/loadBalancedFetch.js";
import App from "./App.jsx";
import DesktopTitleBar from "./components/DesktopTitleBar.jsx";
import UpdateRestartPrompt from "./components/UpdateRestartPrompt.jsx";

if (window.gameonixDesktop) document.documentElement.classList.add("gameonix-desktop");

function ScrollToTop() {
  const { key } = useLocation();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);

  return null;
}

const Router = window.gameonixDesktop ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Router>
      <DesktopTitleBar />
      <UpdateRestartPrompt />
      <ScrollToTop />
      <App />
    </Router>
  </StrictMode>,
);
