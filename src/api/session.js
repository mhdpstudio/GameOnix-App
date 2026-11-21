const SESSION_TOKEN_KEY = "gameonix_session_token";
const COMMUNITY_AUTH_ME_URL =
  "https://gameonix-backend.vercel.app/api/auth/me";
// Reviews are served by the community endpoint (`?reviews=public`) because the
// Vercel Hobby plan limits a deployment to 12 serverless functions.
const REVIEWS_API_URL =
  import.meta.env.VITE_REVIEWS_API_URL ||
  "https://gameonix-backend.vercel.app/api/auth/comments";

export async function getCommunityApiToken() {
  // The frontend and API use separate domains, so browsers may block the
  // API's session cookie as a third-party cookie. Send the persisted bearer
  // token as well; /auth/me accepts either authentication method.
  const response = await authFetch(`${COMMUNITY_AUTH_ME_URL}?token=true`, {
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || typeof data.token !== "string") {
    throw new Error(data.error || "Your session expired. Sign in again.");
  }

  return data.token;
}

export async function getReviews({ target, gameSlug } = {}) {
  const url = new URL(REVIEWS_API_URL);
  if (target) url.searchParams.set("target", target);
  if (gameSlug) url.searchParams.set("gameSlug", gameSlug);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !Array.isArray(data.reviews)) {
    throw new Error(data.error || "Unable to load reviews. Please try again.");
  }

  return data.reviews;
}

export async function saveReview(review) {
  const token = await getCommunityApiToken();
  const response = await fetch(REVIEWS_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(review),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.review) {
    throw new Error(data.error || "Unable to save your review.");
  }

  return data.review;
}

export async function saveReviewReply(reviewId, reply) {
  const token = await getCommunityApiToken();
  const response = await fetch(REVIEWS_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ action: "reply", reviewId, reply }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.review) {
    throw new Error(data.error || "Unable to post your reply.");
  }
  return data;
}

export function getSessionToken() {
  return (
    localStorage.getItem(SESSION_TOKEN_KEY) ||
    sessionStorage.getItem(SESSION_TOKEN_KEY)
  );
}

async function getPersistentSessionToken() {
  const desktopSession = window.gameonixDesktop?.authSession;
  if (desktopSession) {
    try {
      const token = await desktopSession.get();
      if (token) {
        localStorage.setItem(SESSION_TOKEN_KEY, token);
        return token;
      }
    } catch (error) {
      console.warn("Could not read the encrypted desktop session:", error);
    }
  }

  const token = getSessionToken();
  if (token && desktopSession) {
    void desktopSession.set(token).catch((error) => {
      console.warn("Could not migrate the desktop session:", error);
    });
  }
  return token;
}

export function storeSessionToken(token, rememberMe = true) {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);

  if (rememberMe) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  }
  if (window.gameonixDesktop?.authSession) {
    void window.gameonixDesktop.authSession.set(token).catch((error) => {
      console.warn("Could not save the encrypted desktop session:", error);
    });
  }
}

export function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  if (window.gameonixDesktop?.authSession) {
    void window.gameonixDesktop.authSession.clear().catch((error) => {
      console.warn("Could not clear the encrypted desktop session:", error);
    });
  }
}

export async function authFetch(input, options = {}) {
  const headers = new Headers(options.headers);
  const token = await getPersistentSessionToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, {
    ...options,
    credentials: "include",
    headers,
  });
}
