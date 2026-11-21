import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faCheck,
  faCheckDouble,
  faChevronDown,
  faCircleCheck,
  faCopy,
  faGamepad,
  faMobileScreenButton,
  faRotateRight,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import {
  faPlaystation,
  faWindows,
  faXbox,
} from "@fortawesome/free-brands-svg-icons";

import { getCommunityApiToken } from "../api/session";
import { useAuth } from "../context/AuthContext";
import { buildNotificationDetailRows } from "../utils/notificationDetails";
import {
  PURCHASE_TRANSACTION_TYPE,
  WALLET_API_URL,
  parseOrderDetails,
} from "../utils/orders";
import "./../style/notifications-style.css";

const NOTIFICATIONS_URL =
  "https://gameonixfav.vercel.app/api/auth/wallet-notifications";
const NOTIFICATIONS_UPDATED_EVENT = "wallet-notifications-updated";

function notifyNotificationCountChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
}

function getNotificationIcon(platform) {
  const normalized = String(platform || "").toLowerCase();
  if (
    normalized === "ps" ||
    normalized.includes("playstation") ||
    /^ps(?:\s|[0-9])/.test(normalized)
  ) {
    return faPlaystation;
  }
  if (normalized.includes("xbox")) return faXbox;
  if (["pc", "windows", "computer"].includes(normalized)) return faWindows;
  if (normalized.includes("mobile") || normalized.includes("android")) {
    return faMobileScreenButton;
  }
  return faGamepad;
}


async function compressNotificationImage(file) {
  if (!file) return "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 10 MB.");
  }

  const image = await createImageBitmap(file);
  try {
    for (
      let maxDimension = 1200;
      maxDimension >= 300;
      maxDimension = Math.floor(maxDimension * 0.8)
    ) {
      const scale = Math.min(
        1,
        maxDimension / Math.max(image.width, image.height)
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Unable to process this image.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.82, 0.68, 0.54, 0.4, 0.28]) {
        const imageData = canvas.toDataURL("image/jpeg", quality);
        const base64 = imageData.split(",")[1];
        const byteLength = Math.floor((base64.length * 3) / 4);
        if (byteLength <= 30 * 1024) return imageData;
      }
    }
  } finally {
    image.close();
  }

  throw new Error("This image could not be compressed enough to send.");
}

function Notifications() {
  const { user, authLoading } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [supportReplyDrafts, setSupportReplyDrafts] = useState({});
  const [supportReplyBusy, setSupportReplyBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [codesByOrder, setCodesByOrder] = useState({});
  const [codesLoading, setCodesLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");
  const codesLoadedRef = useRef(false);
  const copyTimer = useRef(null);
  const inboxNotifications = useMemo(
    () => notifications.filter((notification) =>
      !["support_reply", "bug_report_reply", "support_message"].includes(notification.type)
    ),
    [notifications]
  );
  const unreadCount = useMemo(
    () => inboxNotifications.filter((notification) => !notification.readAt).length,
    [inboxNotifications]
  );
  const visibleNotifications = useMemo(
    () => filter === "unread"
      ? inboxNotifications.filter((notification) => !notification.readAt)
      : inboxNotifications,
    [filter, inboxNotifications]
  );

  const loadNotifications = useCallback(async ({ refresh = false } = {}) => {
    if (!user) return;
    if (refresh) {
      setLoading(true);
      setError("");
    }
    try {
      const token = await getCommunityApiToken();
      const response = await fetch(NOTIFICATIONS_URL, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.notifications)) {
        throw new Error(data.error || "Unable to load your notifications.");
      }
      setNotifications(data.notifications);
    } catch (loadError) {
      console.error("Notifications page load failed:", loadError);
      setError(loadError.message || "Unable to load your notifications.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;

    const initialLoad = window.setTimeout(loadNotifications, 0);
    const interval = window.setInterval(loadNotifications, 60_000);
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, loadNotifications);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      window.removeEventListener(
        NOTIFICATIONS_UPDATED_EVENT,
        loadNotifications
      );
    };
  }, [user, loadNotifications]);

  // Gift card orders are delivered as codes. They are stored with the order in
  // the wallet ledger; older notifications were saved without them, so the
  // codes are looked up once on demand.
  const needsGiftCardCodes = useMemo(() => {
    if (!expandedId) return false;
    const notification = notifications.find((item) => item.id === expandedId);
    const details = notification?.details || {};
    return (
      details.isGiftCard === true &&
      !(Array.isArray(details.giftCardCodes) && details.giftCardCodes.length > 0)
    );
  }, [expandedId, notifications]);

  useEffect(() => {
    if (!needsGiftCardCodes || codesLoadedRef.current) return undefined;

    codesLoadedRef.current = true;
    let active = true;

    async function loadGiftCardCodes() {
      setCodesLoading(true);
      try {
        const token = await getCommunityApiToken();
        const response = await fetch(WALLET_API_URL, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: "omit",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Unable to load gift card codes.");
        }

        const nextCodes = {};
        (Array.isArray(data.transactions) ? data.transactions : []).forEach(
          (transaction) => {
            if (transaction?.type !== PURCHASE_TRANSACTION_TYPE) return;
            const order = parseOrderDetails(transaction.description);
            const codes = Array.isArray(order.giftCardCodes)
              ? order.giftCardCodes.filter(
                  (code) => typeof code === "string" && code.trim()
                )
              : [];
            if (codes.length) nextCodes[transaction.id] = codes;
          }
        );
        if (active) setCodesByOrder(nextCodes);
      } catch (codesError) {
        console.error("Gift card code lookup failed:", codesError);
      } finally {
        if (active) setCodesLoading(false);
      }
    }

    void loadGiftCardCodes();
    return () => {
      active = false;
    };
  }, [needsGiftCardCodes]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    []
  );

  async function copyGiftCardCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedCode(""), 2000);
    } catch (copyError) {
      console.error("Copy failed:", copyError);
    }
  }

  async function updateNotifications(method, body) {
    setActionLoading(true);
    setError("");
    try {
      const token = await getCommunityApiToken();
      const response = await fetch(NOTIFICATIONS_URL, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Unable to update notifications.");
      }
      return data;
    } catch (updateError) {
      console.error("Notifications page update failed:", updateError);
      setError(updateError.message || "Unable to update notifications.");
      return null;
    } finally {
      setActionLoading(false);
    }
  }

  async function toggleNotification(notification) {
    if (expandedId === notification.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(notification.id);
    if (notification.readAt) return;

    const result = await updateNotifications("POST", {
      notificationId: notification.id,
    });
    if (result) {
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString() }
            : item
        )
      );
      notifyNotificationCountChanged();
    }
  }

  async function sendSupportMessage(reportId) {
    const message = String(supportReplyDrafts[reportId] || "").trim();
    if (!message || supportReplyBusy) return;
    setSupportReplyBusy(reportId);
    const result = await updateNotifications("POST", {
      action: "reply-support-thread",
      notificationId: reportId,
      message,
    });
    if (result) {
      setSupportReplyDrafts((current) => ({ ...current, [reportId]: "" }));
      await loadNotifications();
    }
    setSupportReplyBusy("");
  }

  async function markAllRead() {
    if (!unreadCount) return;
    const result = await updateNotifications("POST", { markAll: true });
    if (result) {
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) => ({ ...item, readAt: item.readAt || readAt }))
      );
      notifyNotificationCountChanged();
    }
  }

  async function deleteNotification(notificationId) {
    const result = await updateNotifications("DELETE", { notificationId });
    if (result) {
      setNotifications((current) =>
        current.filter((item) => item.id !== notificationId)
      );
      setExpandedId((current) => (current === notificationId ? null : current));
      notifyNotificationCountChanged();
    }
  }

  async function deleteAll() {
    if (
      !notifications.length ||
      !window.confirm("Delete all notifications? This cannot be undone.")
    ) {
      return;
    }
    const result = await updateNotifications("DELETE", { deleteAll: true });
    if (result) {
      setNotifications([]);
      setExpandedId(null);
      notifyNotificationCountChanged();
    }
  }

  if (authLoading) {
    return (
      <main className="notifications-page">
        <div className="notifications-state">Checking your account...</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="notifications-page">
        <section className="notifications-access-card">
          <span className="notifications-hero-icon">
            <FontAwesomeIcon icon={faBell} />
          </span>
          <h1>Notifications</h1>
          <p>Sign in to view your private GameOnix notifications.</p>
          <Link to="/login">Sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="notifications-page">
      <header className="notifications-header">
        <div>
          <span className="notifications-kicker">YOUR ACTIVITY</span>
          <h1>Notifications</h1>
          <p>
            Game updates, support replies, and account activity — all in one
            place.
          </p>
        </div>
        <div className="notifications-header-actions">
          <button
            type="button"
            onClick={markAllRead}
            disabled={actionLoading || unreadCount === 0}
          >
            <FontAwesomeIcon icon={faCheckDouble} />
            Mark all read
          </button>
          <button
            type="button"
            className="notifications-delete-all"
            onClick={deleteAll}
            disabled={actionLoading || notifications.length === 0}
          >
            <FontAwesomeIcon icon={faTrashCan} />
            Clear all
          </button>
        </div>
      </header>

      <section className="notifications-board" aria-label="Your notifications">
        <div className="notifications-toolbar">
          <div className="notifications-filters" aria-label="Filter notifications">
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              All <span>{notifications.length}</span>
            </button>
            <button
              type="button"
              className={filter === "unread" ? "active" : ""}
              onClick={() => setFilter("unread")}
            >
              Unread <span>{unreadCount}</span>
            </button>
          </div>
          <button
            className="notifications-refresh"
            type="button"
            onClick={() => loadNotifications({ refresh: true })}
            disabled={loading || actionLoading}
          >
            <FontAwesomeIcon icon={faRotateRight} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="notifications-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => loadNotifications({ refresh: true })}
            >
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="notifications-state">Loading notifications...</div>
        ) : visibleNotifications.length === 0 ? (
          <div className="notifications-empty">
            <span className="notifications-hero-icon">
              <FontAwesomeIcon icon={faBell} />
            </span>
            <strong>
              {filter === "unread" ? "You’re all caught up" : "No notifications yet"}
            </strong>
            <p>
              {filter === "unread"
                ? "There are no unread updates right now."
                : "Game reports, team replies, and account updates will appear here."}
            </p>
          </div>
        ) : (
          <div className="notifications-list">
            {visibleNotifications.map((notification) => {
              const details = notification.details || {};
              const expanded = expandedId === notification.id;
              const rows = buildNotificationDetailRows(notification);
              const storedCodes = Array.isArray(details.giftCardCodes)
                ? details.giftCardCodes.filter(
                    (code) => typeof code === "string" && code.trim()
                  )
                : [];
              const giftCardCodes =
                details.isGiftCard === true
                  ? storedCodes.length
                    ? storedCodes
                    : codesByOrder[details.requestId] || []
                  : [];
              return (
                <article
                  className={`notifications-card${notification.readAt ? "" : " unread"}${expanded ? " expanded" : ""}`}
                  key={notification.id}
                >
                  <button
                    type="button"
                    className="notifications-card-main"
                    aria-expanded={expanded}
                    onClick={() => toggleNotification(notification)}
                    disabled={actionLoading}
                  >
                    <span className="notifications-card-icon">
                      {details.imageData ? (
                        <img src={details.imageData} alt="" />
                      ) : details.gameIcon ? (
                        <img src={details.gameIcon} alt="" />
                      ) : (
                        <FontAwesomeIcon
                          icon={getNotificationIcon(details.platform)}
                        />
                      )}
                    </span>
                    <span className="notifications-card-copy">
                      <strong>{notification.title}</strong>
                      <span>{notification.message}</span>
                      <small>
                        {new Date(notification.createdAt).toLocaleString(
                          "en-EG",
                          { dateStyle: "medium", timeStyle: "short" }
                        )}
                      </small>
                    </span>
                    {!notification.readAt && (
                      <span
                        className="notifications-unread-indicator"
                        aria-label="Unread"
                      />
                    )}
                    <FontAwesomeIcon
                      className={`notifications-expand-icon${expanded ? " expanded" : ""}`}
                      icon={faChevronDown}
                    />
                  </button>
                  <button
                    type="button"
                    className="notifications-delete"
                    aria-label={`Delete ${notification.title}`}
                    onClick={() => deleteNotification(notification.id)}
                    disabled={actionLoading}
                  >
                    <FontAwesomeIcon icon={faTrashCan} />
                  </button>
                  {expanded && (
                    <div className="notifications-card-details">
                      {rows.map((row) => (
                        <div
                          className={`notifications-detail-row${row.long ? " long" : ""}`}
                          key={row.label}
                        >
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                      {["support_request", "bug_report"].includes(notification.type) && (
                        <section className="notification-conversation" aria-label="Support conversation">
                          <h3>Conversation</h3>
                          {(() => {
                            const messages = Array.isArray(details.messages) && details.messages.length
                              ? details.messages
                              : [{ id: notification.id, author: "user", username: user.username, message: String(details.message || details.description || ""), createdAt: notification.createdAt }];
                            return <div className="notification-conversation-messages">
                              {messages.map((item) => (
                                <article className={"notification-chat-message" + (item.author === "admin" ? " from-team" : "")} key={item.id}>
                                  <span>{item.author === "admin" ? "GameOnix team" : "You"} · {new Date(item.createdAt).toLocaleString()}</span>
                                  <p>{item.message}</p>
                                </article>
                              ))}
                            </div>;
                          })()}
                          <form onSubmit={(event) => { event.preventDefault(); void sendSupportMessage(notification.id); }}>
                            <textarea
                              rows={2}
                              maxLength={2000}
                              value={supportReplyDrafts[notification.id] || ""}
                              onChange={(event) => setSupportReplyDrafts((current) => ({ ...current, [notification.id]: event.target.value }))}
                              placeholder="Write a message to support..."
                              aria-label="Reply to support"
                            />
                            <button type="submit" disabled={supportReplyBusy === notification.id || !String(supportReplyDrafts[notification.id] || "").trim()}>
                              {supportReplyBusy === notification.id ? "Sending..." : "Send"}
                            </button>
                          </form>
                        </section>
                      )}
                      {giftCardCodes.length > 0 && (
                        <section className="notifications-codes">
                          <h3>
                            Gift card codes
                            <small>
                              {giftCardCodes.length === 1
                                ? "1 code"
                                : `${giftCardCodes.length} codes`}{" "}
                              · delivered with this order
                            </small>
                          </h3>
                          <ul>
                            {giftCardCodes.map((code, index) => (
                              <li key={`${code}-${index}`}>
                                <code>{code}</code>
                                <button
                                  type="button"
                                  className={`notifications-code-copy${copiedCode === code ? " is-copied" : ""}`}
                                  onClick={() => copyGiftCardCode(code)}
                                  title="Copy code"
                                  aria-label={`Copy gift card code ${index + 1}`}
                                >
                                  <FontAwesomeIcon
                                    icon={copiedCode === code ? faCheck : faCopy}
                                  />
                                  <span>
                                    {copiedCode === code ? "Copied" : "Copy"}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      {details.isGiftCard === true &&
                        giftCardCodes.length === 0 &&
                        codesLoading && (
                          <p
                            className="notifications-codes-loading"
                            role="status"
                          >
                            Loading gift card codes…
                          </p>
                        )}
                      {typeof details.imageData === "string" && (
                        <img
                          className="notifications-message-image"
                          src={details.imageData}
                          alt="Image attached to this notification"
                        />
                      )}
                      {details.slug && (
                        <Link
                          className="notifications-game-link"
                          to={`/game/${encodeURIComponent(details.slug)}`}
                        >
                          View game details
                        </Link>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export function AdminActions() {
  const { user, authLoading } = useAuth();
  const [adminAccess, setAdminAccess] = useState({
    username: "",
    allowed: false,
  });
  const canManage =
    adminAccess.username === user?.username && adminAccess.allowed;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notificationSuccess, setNotificationSuccess] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const [recipientUsername, setRecipientUsername] = useState("");
  const [notificationTitle, setNotificationTitle] = useState(
    "A message from GameOnix"
  );
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationImage, setNotificationImage] = useState(null);
  const [resetEmail, setResetEmail] = useState("");
  const notificationFormRef = useRef(null);

  const loadAdminAccess = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getCommunityApiToken();
      const response = await fetch(NOTIFICATIONS_URL, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.notifications)) {
        throw new Error(data.error || "Unable to verify admin access.");
      }

      setAdminAccess({
        username: user.username,
        allowed: data.canSend === true,
      });
      setError(
        data.canSend === true ? "" : "Admin access is required for this page."
      );
    } catch (accessError) {
      console.error("Admin actions access check failed:", accessError);
      setAdminAccess({ username: user.username, allowed: false });
      setError(accessError.message || "Unable to verify admin access.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(loadAdminAccess, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, user, loadAdminAccess]);

  async function sendAdminAction(body) {
    const token = await getCommunityApiToken();
    const response = await fetch(NOTIFICATIONS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "omit",
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Unable to complete this admin action.");
    }
    return data;
  }

  async function sendDirectMessage(event) {
    event.preventDefault();
    if (!canManage || busy) return;

    setBusy(true);
    setError("");
    setNotificationSuccess("");
    try {
      const imageData = await compressNotificationImage(notificationImage);
      await sendAdminAction({
        action: "send",
        username: recipientUsername.trim(),
        title: notificationTitle.trim(),
        message: notificationMessage.trim(),
        imageData,
      });

      setRecipientUsername("");
      setNotificationTitle("A message from GameOnix");
      setNotificationMessage("");
      setNotificationImage(null);
      notificationFormRef.current?.reset();
      setNotificationSuccess("The private notification was sent.");
      notifyNotificationCountChanged();
    } catch (sendError) {
      console.error("Direct notification send failed:", sendError);
      setError(sendError.message || "Unable to send this notification.");
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordResetLink(event) {
    event.preventDefault();
    if (!canManage || busy) return;

    setBusy(true);
    setError("");
    setResetSuccess("");
    try {
      const data = await sendAdminAction({
        action: "send-password-reset-link",
        email: resetEmail.trim(),
      });
      setResetEmail("");
      setResetSuccess(
        data.message || "If an account exists, a reset link was sent."
      );
    } catch (sendError) {
      console.error("Admin password reset link request failed:", sendError);
      setError(sendError.message || "Unable to send the reset link.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || (loading && user)) {
    return (
      <main className="notifications-page">
        <div className="notifications-state">Checking admin access...</div>
      </main>
    );
  }

  if (!user || !canManage) {
    return (
      <main className="notifications-page">
        <section className="notifications-access-card">
          <h1>Admin Actions</h1>
          <p>
            {!user
              ? "Sign in with an administrator account to continue."
              : error || "Admin access is required for this page."}
          </p>
          {!user && <Link to="/login">Sign in</Link>}
        </section>
      </main>
    );
  }

  return (
    <main className="notifications-page">
      <header className="notifications-header">
        <div>
          <span className="notifications-kicker">ADMIN TOOLS</span>
          <h1>Admin Actions</h1>
          <p>Send private account notifications and password reset links.</p>
        </div>
      </header>

      {error && (
        <div className="notifications-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <form
        ref={notificationFormRef}
        className="notifications-compose"
        onSubmit={sendDirectMessage}
      >
        <div className="notifications-compose-heading">
          <div>
            <span className="notifications-kicker">ACCOUNT MESSAGES</span>
            <h2>Send a private notification</h2>
          </div>
          <span>Only the selected account can view it.</span>
        </div>
        <div className="notifications-compose-fields">
          <label>
            Recipient username
            <input
              type="text"
              value={recipientUsername}
              onChange={(event) => setRecipientUsername(event.target.value)}
              maxLength={64}
              autoComplete="off"
              required
            />
          </label>
          <label>
            Title
            <input
              type="text"
              value={notificationTitle}
              onChange={(event) => setNotificationTitle(event.target.value)}
              maxLength={100}
              required
            />
          </label>
          <label className="notifications-compose-message">
            Message
            <textarea
              value={notificationMessage}
              onChange={(event) => setNotificationMessage(event.target.value)}
              maxLength={2000}
              rows={4}
              required
            />
          </label>
          <label className="notifications-compose-image">
            Image (optional)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) =>
                setNotificationImage(event.target.files?.[0] || null)
              }
            />
            <small>
              JPEG, PNG, or WebP; compressed to fit the private notification.
            </small>
          </label>
        </div>
        {notificationSuccess && (
          <p className="notifications-compose-success" role="status">
            {notificationSuccess}
          </p>
        )}
        <button
          className="notifications-compose-submit"
          type="submit"
          disabled={busy}
        >
          {busy ? "Sending..." : "Send notification"}
        </button>
      </form>

      <form className="notifications-compose" onSubmit={sendPasswordResetLink}>
        <div className="notifications-compose-heading">
          <div>
            <span className="notifications-kicker">ACCOUNT RECOVERY</span>
            <h2>Send a password reset link</h2>
          </div>
          <span>The link expires in 15 minutes and is single-use.</span>
        </div>
        <div className="notifications-compose-fields">
          <label>
            Account email
            <input
              type="email"
              value={resetEmail}
              onChange={(event) => setResetEmail(event.target.value)}
              maxLength={254}
              autoComplete="email"
              required
            />
          </label>
        </div>
        {resetSuccess && (
          <p className="notifications-compose-success" role="status">
            {resetSuccess}
          </p>
        )}
        <button
          className="notifications-compose-submit"
          type="submit"
          disabled={busy}
        >
          {busy ? "Sending..." : "Send reset link"}
        </button>
      </form>
    </main>
  );
}

export default Notifications;
