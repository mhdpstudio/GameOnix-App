import { authFetch } from "./session";

const API_URL = "https://gameonix-backend.vercel.app/api/auth/favorites";

async function request(method, body, query = "") {
  const response = await authFetch(`${API_URL}${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Game library request failed.");
  return data;
}

export function getFollows() { return request("GET", null, "?collection=follows"); }
export function addFollow(slug, addonCount = 0) { return request("POST", { collection: "follows", slug, addonCount }); }
export function removeFollow(slug) { return request("POST", { collection: "follows", operation: "remove", slug }); }
export function getGameAnalytics() { return request("GET", null, "?analytics=1"); }
export function recordGameActivity(slug, event) {
  const activityUrl = `${API_URL}?event=${encodeURIComponent(event)}&slug=${encodeURIComponent(slug)}`;
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const queued = navigator.sendBeacon(activityUrl);
    if (queued) return Promise.resolve({ recorded: true });
  }

  return fetch(activityUrl, {
    method: "POST",
    keepalive: true,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Game activity could not be recorded.");
    return data;
  });
}
