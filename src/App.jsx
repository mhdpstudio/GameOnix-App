import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import MainLayout from "./widgets/layouts/main-layout";

import Home from "./pages/home";
import Discover from "./pages/discover";
import Library from "./pages/library";
import NotFound from "./pages/not-found";
import Login from "./pages/login";
import Profile from "./pages/profile";
import Games from "./pages/games";
import GameDetails from "./pages/game-details";
import Downloads from "./pages/downloads";
import SearchResults from "./pages/search-results";
import GameCards from "./pages/GameCards";
import Wallet from "./pages/Wallet";
import GameRequest from "./pages/game-request";
import Notifications, { AdminActions } from "./pages/Notifications";
import Orders from "./pages/Orders";
import Support from "./pages/Support";
import ReviewsPage from "./pages/reviews";

import PageTitle from "./components/PageTitle";
import Settings from "./pages/settings";
import { DialogProvider } from "./context/DialogContext";
import "./style/site-control.css";

const SITE_STATUS_URL =
  "https://gameonix-backend.vercel.app/api/auth/me?siteStatus=1";

const SITE_MODE_CONTENT = {
  maintenance: {
    eyebrow: "PLANNED MAINTENANCE",
    title: "GameOnix is getting a tune-up",
    description: "We paused the site while we work on improvements. Please check back soon.",
  },
  emergency: {
    eyebrow: "TEMPORARY SERVICE PAUSE",
    title: "GameOnix is temporarily unavailable",
    description: "We paused the site while we resolve an unexpected issue.",
  },
  upgrade: {
    eyebrow: "SITE UPDATE IN PROGRESS",
    title: "A new version is on its way",
    description: "GameOnix is offline while we install an update. Please check back shortly.",
  },
};

function SiteStatusGate({ children }) {
  const [siteControl, setSiteControl] = useState(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(SITE_STATUS_URL, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("Site status unavailable");
        const status = await response.json();
        if (!["online", ...Object.keys(SITE_MODE_CONTENT)].includes(status.mode)) {
          throw new Error("Invalid site status");
        }
        if (active) {
          setSiteControl(status);
        }
      } catch {
        // A status-store outage must not hide the whole application. The API
        // also fails open when it cannot read the site-control setting.
        if (active) {
          setSiteControl((current) => current || { mode: "online" });
        }
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const content = siteControl ? SITE_MODE_CONTENT[siteControl.mode] : null;
  if (!siteControl) {
    return <main className="site-control-screen is-checking" role="status" aria-live="polite">
      <section className="site-control-loading">
        <span className="site-control-loader" aria-hidden="true" />
        <span className="site-control-eyebrow">GAMEONIX DESKTOP</span>
        <h1>Getting things ready</h1>
        <p>Connecting to GameOnix. Your library will appear in a moment.</p>
      </section>
    </main>;
  }

  if (content) {
    return (
      <main className={`site-control-screen is-${siteControl?.mode || "checking"}`}>
        <section className="site-control-card" aria-live="polite">
          <div className="site-control-mark" aria-hidden="true">G</div>
          <span className="site-control-eyebrow">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{siteControl.message || content.description}</p>
          <div className="site-control-status"><span /> We’ll be back soon</div>
          <small>This page will update automatically.</small>
        </section>
      </main>
    );
  }

  return children;
}

function App() {
  return (
    <AuthProvider>
      <DialogProvider>
      <SiteStatusGate>
        <PageTitle />

        <Routes>
          <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/library" element={<Library />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/request-game" element={<GameRequest />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/admin-actions" element={<AdminActions />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/support" element={<Support />} />
          <Route path="/reviews" element={<ReviewsPage />} />

          <Route path="/games" element={<Games />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/game/:slug" element={<GameDetails />} />

          {/* Shopping */}
          <Route
            path="/shopping/game-cards"
            element={<GameCards />}
          />

          <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </SiteStatusGate>
      </DialogProvider>
    </AuthProvider>
  );
}

export default App;
