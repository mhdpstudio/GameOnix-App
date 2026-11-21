// Customer-facing detail rows for a notification.
// Notification details are stored as a JSON blob that also carries internal
// bookkeeping (game id, payment logo URL, wallet payment flag, gift card flag).
// Only the fields listed here are rendered, in this order, so internal keys can
// never leak into the UI and every notification type reads the same way.

const AMOUNT_FORMATTER = new Intl.NumberFormat("en-EG", {
  style: "currency",
  currency: "EGP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const LONG_KEYS = new Set(["description", "report", "reply"]);
const CURRENCY_KEYS = new Set(["amount", "currentBalance"]);

const STATUS_LABELS = {
  pending: "Pending",
  submitted: "Submitted",
  accepted: "Accepted",
  approved: "Approved",
  completed: "Completed",
  success: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

/**
 * Ordered allowlist. `key: "destination"` resolves to the player id or the gift
 * recipient, so the order carries a single delivery row.
 */
const DETAIL_FIELDS = [
  { key: "gameTitle", label: "Game" },
  { key: "gameName", label: "Game", skip: (details) => Boolean(details.gameTitle) },
  { key: "platform", label: "Platform" },
  { key: "publisher", label: "Publisher" },
  { key: "gameType", label: "Genre" },
  { key: "packageName", label: "Package" },
  { key: "quantity", label: "Quantity" },
  { key: "destination", label: "Delivery" },
  { key: "serverId", label: "Server" },
  { key: "isGift", label: "Sent as a gift" },
  { key: "paymentMethod", label: "Payment method" },
  { key: "mobileNumber", label: "Mobile" },
  { key: "whatsappNumber", label: "WhatsApp" },
  { key: "amount", label: "Amount" },
  { key: "currentBalance", label: "Wallet balance" },
  {
    key: "contactEmail",
    label: "Delivery email",
    skip: (details) => !details.email || details.email === details.contactEmail,
  },
  { key: "status", label: "Status" },
  { key: "version", label: "Version" },
  { key: "fileType", label: "Download type" },
  { key: "size", label: "Game size" },
  { key: "topicLabel", label: "Topic" },
  { key: "orderId", label: "Order ID" },
  { key: "description", label: "Reported issue" },
  { key: "report", label: "Reported issue" },
  { key: "reply", label: "Team reply" },
  { key: "requestId", label: "Request ID" },
];

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function formatValue(key, value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (key === "status") {
    const normalized = String(value).trim().toLowerCase();
    return STATUS_LABELS[normalized] || String(value);
  }

  if (CURRENCY_KEYS.has(key)) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return AMOUNT_FORMATTER.format(amount);
  }

  if (typeof value === "object") return JSON.stringify(value);

  return String(value).trim();
}

export function buildNotificationDetailRows(notification) {
  const details = notification?.details;

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return [];
  }

  const isGift = details.isGift === true;
  const rows = [];
  const seenLabels = new Set();

  for (const field of DETAIL_FIELDS) {
    if (field.skip?.(details)) continue;

    const isDestination = field.key === "destination";
    const rawValue = isDestination
      ? isGift
        ? details.recipient
        : details.playerId || details.accountId
      : details[field.key];

    if (!hasValue(rawValue)) continue;

    const label = isDestination
      ? isGift
        ? "Gift recipient"
        : "Player ID"
      : field.label;

    if (seenLabels.has(label)) continue;
    seenLabels.add(label);

    rows.push({
      label,
      value: formatValue(field.key, rawValue),
      long: LONG_KEYS.has(field.key),
    });
  }

  return rows;
}
