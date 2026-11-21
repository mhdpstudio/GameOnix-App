import { useEffect, useSyncExternalStore } from "react";

const GAMES_DATA_URL =
  "https://raw.githubusercontent.com/mhdpstudio/GameOnix-Data-Content/main/games-data.json";
const REFRESH_INTERVAL = 15_000;
const CATALOG_TRACKING_KEY = "gameonix_catalog_tracking_v1";

let snapshot = { games: [], homeSections: [], comingSoon: [], loading: true, error: "" };
let refreshTimer;
let activeRequest;
const listeners = new Set();

function trackNewGames(games) {
  try {
    const stored = JSON.parse(localStorage.getItem(CATALOG_TRACKING_KEY) || "null");
    const knownSlugs = new Set(Array.isArray(stored?.knownSlugs) ? stored.knownSlugs : []);
    const discoveredAt = stored?.discoveredAt && typeof stored.discoveredAt === "object"
      ? stored.discoveredAt
      : {};

    // The first visit establishes the current catalog as the baseline.
    if (!stored || !Array.isArray(stored.knownSlugs)) {
      localStorage.setItem(CATALOG_TRACKING_KEY, JSON.stringify({
        knownSlugs: games.map((game) => game.slug),
        discoveredAt,
      }));
      return games;
    }

    const now = new Date().toISOString();
    for (const game of games) {
      if (!knownSlugs.has(game.slug)) discoveredAt[game.slug] ||= now;
    }

    const currentSlugs = games.map((game) => game.slug);
    const activeSlugs = new Set(currentSlugs);
    const recentDiscoveries = Object.fromEntries(
      Object.entries(discoveredAt)
        .filter(([slug]) => activeSlugs.has(slug))
        .slice(-500)
    );
    localStorage.setItem(CATALOG_TRACKING_KEY, JSON.stringify({
      knownSlugs: currentSlugs,
      discoveredAt: recentDiscoveries,
    }));

    return games.map((game) => game.createdAt || !recentDiscoveries[game.slug]
      ? game
      : { ...game, createdAt: recentDiscoveries[game.slug] }
    );
  } catch {
    return games;
  }
}

function publish(nextSnapshot) {
  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

async function refreshGames() {
  if (activeRequest) return activeRequest;

  activeRequest = (async () => {
    try {
      const url = new URL(GAMES_DATA_URL);
      url.searchParams.set("_", String(Date.now()));
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch games data");

      const data = await response.json();
      const games = (Array.isArray(data) ? data : data?.games || []).filter(
        (game) => game?.slug && game?.title
      );
      if (!games.length && snapshot.games.length) {
        throw new Error("The games catalog returned no entries");
      }
      publish({
        games: trackNewGames(games),
        homeSections: Array.isArray(data?.homeSections) ? data.homeSections : [],
        comingSoon: Array.isArray(data?.comingSoon) ? data.comingSoon : [],
        loading: false,
        error: "",
      });
    } catch {
      publish({
        ...snapshot,
        loading: false,
        error: snapshot.games.length ? "" : "Couldn't load games right now. Please try again.",
      });
    } finally {
      activeRequest = null;
    }
  })();

  return activeRequest;
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshGames();
    refreshTimer = window.setInterval(() => void refreshGames(), REFRESH_INTERVAL);
    window.addEventListener("focus", refreshGames);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshGames);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") void refreshGames();
}

export function useGameCatalog() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return { ...state, refreshGames };
}
