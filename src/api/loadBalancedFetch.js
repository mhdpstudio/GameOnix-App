const API_ORIGINS = {
  auth: [
    "https://gameonix-backend.vercel.app",
    "https://gameonix-backend-2.vercel.app",
  ],
  fav: [
    "https://gameonixfav.vercel.app",
    "https://gameonix-fav-2.vercel.app",
  ],
};

const serviceByHost = new Map(
  Object.entries(API_ORIGINS).flatMap(([service, origins]) =>
    origins.map((origin) => [new URL(origin).hostname, service]),
  ),
);

const originalFetch = window.fetch.bind(window);
const selectionKeys = {
  auth: "gameonix_api_origin_auth",
  fav: "gameonix_api_origin_fav",
};

function readSelection(service) {
  try {
    const saved = localStorage.getItem(selectionKeys[service]);
    if (API_ORIGINS[service].includes(saved)) return saved;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }

  const origins = API_ORIGINS[service];
  return origins[Math.floor(Math.random() * origins.length)];
}

function saveSelection(service, origin) {
  try {
    localStorage.setItem(selectionKeys[service], origin);
  } catch {
    // Keep this request working when storage is unavailable.
  }
}

function hasSavedSession() {
  try {
    return Boolean(
      localStorage.getItem("gameonix_session_token") ||
        sessionStorage.getItem("gameonix_session_token"),
    );
  } catch {
    return false;
  }
}

export function getBalancedApiOrigin(service) {
  const origins = API_ORIGINS[service];
  if (!origins) throw new Error("Unknown GameOnix API service.");
  const selected = readSelection(service);
  saveSelection(service, selected);
  return selected;
}

function shouldRetry(response, method, service) {
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(method);
  return (safeMethod && response.status === 429) ||
    (service === "auth" && hasSavedSession() && response.status === 401) ||
    (safeMethod && response.status >= 500);
}

function makeRequestInput(input, isRequest, destination) {
  return isRequest ? new Request(destination, input.clone()) : destination;
}

window.fetch = async function gameonixBalancedFetch(input, init) {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const inputUrl = isRequest ? input.url : String(input);
  let parsedUrl;

  try {
    parsedUrl = new URL(inputUrl, window.location.href);
  } catch {
    return originalFetch(input, init);
  }

  const service = serviceByHost.get(parsedUrl.hostname.toLowerCase());
  if (!service) return originalFetch(input, init);

  const method = String(
    init?.method || (isRequest ? input.method : "GET"),
  ).toUpperCase();
  const isAvatarUpload =
    service === "auth" && parsedUrl.pathname.endsWith("/api/auth/upload-avatar");
  const origins = isAvatarUpload ? [API_ORIGINS.auth[0]] : API_ORIGINS[service];
  const selected = isAvatarUpload ? origins[0] : readSelection(service);
  const firstOrigin = origins.includes(selected) ? selected : origins[0];
  const secondOrigin = origins.find((origin) => origin !== firstOrigin);

  async function send(origin) {
    const destination = new URL(
      parsedUrl.pathname + parsedUrl.search,
      origin,
    ).href;
    return originalFetch(makeRequestInput(input, isRequest, destination), init);
  }

  let firstResponse;
  let firstError;
  try {
    firstResponse = await send(firstOrigin);
  } catch (error) {
    firstError = error;
    if (
      !secondOrigin ||
      !["GET", "HEAD", "OPTIONS"].includes(method) ||
      init?.signal?.aborted
    ) {
      throw error;
    }
  }

  if (firstResponse && !shouldRetry(firstResponse, method, service)) {
    if (!isAvatarUpload) saveSelection(service, firstOrigin);
    return firstResponse;
  }

  if (!secondOrigin) return firstResponse;

  let fallbackResponse;
  try {
    fallbackResponse = await send(secondOrigin);
  } catch (error) {
    if (firstResponse) return firstResponse;
    throw error || firstError;
  }

  if (
    service === "auth" &&
    hasSavedSession() &&
    fallbackResponse.status === 401 &&
    (firstError || (firstResponse && shouldRetry(firstResponse, method, service)))
  ) {
    return firstResponse || Promise.reject(firstError);
  }

  if (!shouldRetry(fallbackResponse, method, service) && !isAvatarUpload) {
    saveSelection(service, secondOrigin);
  }
  return fallbackResponse;
};
