
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronLeft,
  faGamepad,
  faRotate,
  faSearch,
  faFilter,
  faArrowDownWideShort,
} from "@fortawesome/free-solid-svg-icons";
import GameCard from "../components/GameCard";
import { useGameCatalog } from "../hooks/useGameCatalog";
import { getGameAnalytics } from "../api/follows";
import {
  getGameBadgeType,
  getGameReleaseTimestamp,
  isUpdatedGame,
} from "../utils/game-release";

import "./../style/games-style.css";
import { gameHasCategory, getGameCategories } from "../utils/game-categories";

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();

  if (["pc", "windows", "computer"].includes(platform)) return "pc";
  if (["ps", "playstation", "ps4", "ps5"].includes(platform)) return "ps";

  return platform;
}

function Games() {
  const [searchParams] = useSearchParams();

  const platform = normalizePlatform(searchParams.get("platform"));
  const type = searchParams.get("type") || "";
  const sort = searchParams.get("sort") || "";
  const [now, setNow] = useState(() => Date.now());

  const { games, loading, error, refreshGames } = useGameCatalog();
  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [order, setOrder] = useState("recent");
  const [gameAnalytics, setGameAnalytics] = useState([]);

  useEffect(() => {
    let active = true;
    getGameAnalytics().then((data) => { if (active && Array.isArray(data.games)) setGameAnalytics(data.games); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredGames = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const matchingGames = games.filter((game) => {
      const matchesPlatform =
        !platform || normalizePlatform(game.platform) === platform;
      const matchesType =
        !type || gameHasCategory(game, type.trim());
      const releaseTimestamp = getGameReleaseTimestamp(game);
      const matchesRelease =
        sort === "recent"
          ? !isUpdatedGame(game) && releaseTimestamp !== null
          : sort === "updated"
            ? isUpdatedGame(game) && releaseTimestamp !== null
            : true;
      const matchesAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "available"
          ? game.availability !== false
          : game.availability === false);
      const searchableText = [
        game.title,
        game.publisher,
        game.platform,
        ...getGameCategories(game),
        game.gameType,
      ].join(" ").toLocaleLowerCase();
      const matchesSearch = !needle || searchableText.includes(needle);
      return matchesPlatform && matchesType && matchesRelease && matchesAvailability && matchesSearch;
    });

    matchingGames.sort((first, second) => {
      if (["downloads", "views", "favorites", "follows"].includes(order)) {
        const firstCount = gameAnalytics.find((item) => item.slug === first.slug)?.[order] || 0;
        const secondCount = gameAnalytics.find((item) => item.slug === second.slug)?.[order] || 0;
        return secondCount - firstCount || String(first.title || "").localeCompare(String(second.title || ""));
      }
      if (order === "title") return String(first.title || "").localeCompare(String(second.title || ""));
      const firstDate = getGameReleaseTimestamp(first);
      const secondDate = getGameReleaseTimestamp(second);
      return firstDate !== null && secondDate !== null
        ? secondDate - firstDate
        : Number(second.id || 0) - Number(first.id || 0);
    });
    return matchingGames;
  }, [availabilityFilter, gameAnalytics, games, order, platform, search, sort, type]);

  const analyticsBySlug = new Map(gameAnalytics.map((item) => [item.slug, item]));

  const platformTitle =
    platform === "pc"
      ? "PC Games"
      : platform === "ps"
        ? "PlayStation Games"
        : "All Games";

  const pageTitle = sort === "updated"
    ? "Recently Updated Games"
    : sort === "recent"
      ? "Recently Added Games"
      : type ? `${type} Games` : platformTitle;

  if (loading) {
    return (
      <main className="games-page">
        <div className="games-status">
          <span className="games-loader" />
          <p>Loading games...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="games-page">
        <div className="games-status">
          <p>{error}</p>

          <button
            type="button"
            className="games-retry-button"
            onClick={() => void refreshGames()}
          >
            <FontAwesomeIcon icon={faRotate} />
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="games-page">
      <header className="games-page-header">
        <Link to="/" className="games-back-link">
          <FontAwesomeIcon icon={faChevronLeft} />
          Home
        </Link>

        <span className="games-platform-label">{platformTitle}</span>

        <h1>{pageTitle}</h1>

        <p>
          Explore {filteredGames.length}{" "}
          {filteredGames.length === 1 ? "game" : "games"}.
        </p>
      </header>

      <div className="games-toolbar" role="search">
        <label className="games-search">
          <FontAwesomeIcon icon={faSearch} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search games, publishers, platforms..."
            aria-label="Search games"
          />
        </label>
        <label className="games-filter-control">
          <span><FontAwesomeIcon icon={faFilter} aria-hidden="true" /> Availability</span>
          <select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)} aria-label="Filter by availability">
            <option value="all">All games</option>
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label className="games-filter-control">
          <span><FontAwesomeIcon icon={faArrowDownWideShort} aria-hidden="true" /> Sort</span>
          <select value={order} onChange={(event) => setOrder(event.target.value)} aria-label="Sort games">
            <option value="recent">Recently added</option>
            <option value="title">Name A–Z</option>
            <option value="downloads">Most downloaded</option>
            <option value="views">Most viewed</option>
            <option value="favorites">Most favorited</option>
            <option value="follows">Most followed</option>
          </select>
        </label>
      </div>

      {filteredGames.length === 0 ? (
        <div className="games-empty">
          <FontAwesomeIcon icon={faGamepad} />
          <h2>{search || availabilityFilter !== "all" ? "No matching games" : "No games found"}</h2>
          <p>{search || availabilityFilter !== "all" ? "Try changing your search or filters." : "There are no games matching this category yet."}</p>
          <Link to="/">Back to Home</Link>
        </div>
      ) : (
        <div className="games-grid">
          {filteredGames.map((game) => (
            <GameCard
              key={game.slug}
              game={game}
              badgeType={getGameBadgeType(game, now)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

export default Games;
