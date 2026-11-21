export const RELEASE_BADGE_DURATION = 24 * 60 * 60 * 1000;

export function isUpdatedGame(game) {
  return String(game?.releaseType || "").trim().toLowerCase() === "update";
}

export function getGameReleaseTimestamp(game) {
  const values = isUpdatedGame(game)
    ? [game?.updatedAt, game?.updateAt, game?.lastUpdatedAt, game?.lastUpdated, game?.createdAt]
    : [game?.createdAt];

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  return null;
}

export function getGameBadgeType(game, now = Date.now()) {
  const timestamp = getGameReleaseTimestamp(game);
  if (timestamp === null || timestamp > now || now - timestamp >= RELEASE_BADGE_DURATION) {
    return "";
  }

  return isUpdatedGame(game) ? "UPDATE" : "NEW";
}
