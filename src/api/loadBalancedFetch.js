const API_ORIGINS = {
  auth: [
    "https://gameonix-backend-2.vercel.app",
    "https://gameonix-backend.vercel.app",
  ],
  fav: [
    "https://gameonix-fav-2.vercel.app",
    "https://gameonixfav.vercel.app",
  ],
};

const serviceByHost = new Map(
  Object.entries(API_ORIGINS).flatMap(([service, origins]) =>
    origins.map((origin) => [new URL(origin).hostname, service]),
  ),
);

const originalFetch = window.fetch.bind(window);
function readSelection(service) {
  return API_ORIGINS[service][0];
}

export function getBalancedApiOrigin(service) {
  const origins = API_ORIGINS[service];
  if (!origins) throw new Error("Unknown GameOnix API service.");
  return readSelection(service);
}

function shouldRetry(response, method) {
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(method);
  return response.status === 402 ||
    (safeMethod && response.status === 429) ||
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

  if (firstResponse && !shouldRetry(firstResponse, method)) {
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

  return fallbackResponse;
};
