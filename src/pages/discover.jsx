import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMagnifyingGlass,
  faGamepad,
  faRotate,
  faSliders,
  faXmark,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";
import GameCard from "../components/GameCard";
import { useGameCatalog } from "../hooks/useGameCatalog";
import { HomeFeaturedHero } from "./home";

import "./../style/discover-style.css";
import { getGameCategories, gameHasCategory } from "../utils/game-categories";

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();

  if (["pc", "windows", "computer"].includes(platform)) return "pc";
  if (["ps", "playstation", "ps4", "ps5"].includes(platform)) return "ps";

  return platform;
}

function getPlatformLabel(platform) {
  if (platform === "pc") return "PC";
  if (platform === "ps") return "PlayStation";

  return platform.toUpperCase();
}

function getAddedAt(game) {
  const value = game?.createdAt;

  if (!value || typeof value !== "string") return null;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function Discover() {
  const { games, loading, error, refreshGames } = useGameCatalog();

  const [search, setSearch] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [selectedGenre, setSelectedGenre] = useState("all");
  const [sortBy, setSortBy] = useState("default");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);

  useEffect(() => {
    function closeSort(event) {
      if (event.key === "Escape") setSortOpen(false);
      if (event.type === "mousedown" && !sortRef.current?.contains(event.target)) setSortOpen(false);
    }
    document.addEventListener("mousedown", closeSort);
    document.addEventListener("keydown", closeSort);
    return () => {
      document.removeEventListener("mousedown", closeSort);
      document.removeEventListener("keydown", closeSort);
    };
  }, []);

  const platforms = useMemo(() => {
    const found = new Map();

    games.forEach((game) => {
      const platform = normalizePlatform(game.platform);

      if (platform && !found.has(platform)) {
        found.set(platform, getPlatformLabel(platform));
      }
    });

    return Array.from(found.entries()).map(([id, label]) => ({
      id,
      label,
    }));
  }, [games]);

  const genres = useMemo(() => {
    const found = new Set();

    games.forEach((game) => {
      getGameCategories(game).forEach((genre) => found.add(genre));
    });

    return Array.from(found);
  }, [games]);

  const filteredGames = useMemo(() => {
    let result = games.filter((game) => {
      const query = search.trim().toLowerCase();

      const matchesSearch =
        !query ||
        String(game.title || "").toLowerCase().includes(query) ||
        String(game.publisher || "").toLowerCase().includes(query) ||
        getGameCategories(game)
          .join(" ")
          .toLowerCase()
          .includes(query);

      const matchesPlatform =
        selectedPlatform === "all" ||
        normalizePlatform(game.platform) === selectedPlatform;

      const matchesGenre =
        selectedGenre === "all" || gameHasCategory(game, selectedGenre);

      return matchesSearch && matchesPlatform && matchesGenre;
    });

    if (sortBy === "name-asc") {
      result = [...result].sort((a, b) =>
        a.title.localeCompare(b.title)
      );
    } else if (sortBy === "name-desc") {
      result = [...result].sort((a, b) =>
        b.title.localeCompare(a.title)
      );
    } else if (sortBy === "recent") {
      result = [...result].sort((a, b) => {
        const dateA = getAddedAt(a) ?? 0;
        const dateB = getAddedAt(b) ?? 0;

        return dateB - dateA;
      });
    }

    return result;
  }, [games, search, selectedPlatform, selectedGenre, sortBy]);

  function clearFilters() {
    setSearch("");
    setSelectedPlatform("all");
    setSelectedGenre("all");
    setSortBy("default");
  }

  const hasActiveFilters =
    search.trim() !== "" ||
    selectedPlatform !== "all" ||
    selectedGenre !== "all" ||
    sortBy !== "default";

  return (
    <main className="discover-page">
      <HomeFeaturedHero showFallback={false} />
      <section className="discover-library">
        <div className="discover-section-heading">
          <div>
            <span className="discover-section-kicker">THE COLLECTION</span>
            <h2>Explore games</h2>
            <p>Find something new to play.</p>
          </div>

          <span className="discover-results-count">
            {filteredGames.length} results
          </span>
        </div>

        <div className="discover-toolbar">
          <label className="discover-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search games, publishers..."
              aria-label="Search games and publishers"
            />

            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </label>

          <div className={`discover-sort${sortOpen ? " is-open" : ""}`} ref={sortRef}>
            <FontAwesomeIcon icon={faSliders} />
            <button type="button" className="discover-sort-trigger" aria-label="Sort games" aria-haspopup="listbox" aria-expanded={sortOpen} onClick={() => setSortOpen((open) => !open)}>
              <span>{({ default: "Default order", recent: "Recently added", "name-asc": "Name: A to Z", "name-desc": "Name: Z to A" })[sortBy]}</span>
              <FontAwesomeIcon icon={faChevronDown} />
            </button>
            {sortOpen && <div className="discover-sort-menu" role="listbox" aria-label="Sort games">
              {[["default", "Default order"], ["recent", "Recently added"], ["name-asc", "Name: A to Z"], ["name-desc", "Name: Z to A"]].map(([value, label]) => (
                <button type="button" role="option" aria-selected={sortBy === value} className={sortBy === value ? "selected" : ""} key={value} onClick={() => { setSortBy(value); setSortOpen(false); }}>{label}</button>
              ))}
            </div>}
          </div>
        </div>

        <div className="discover-filters">
          <div className="discover-filter-group">
            <span className="discover-filter-label">PLATFORM</span>

            <div className="discover-filter-options">
              <button
                type="button"
                className={selectedPlatform === "all" ? "active" : ""}
                onClick={() => setSelectedPlatform("all")}
              >
                All platforms
              </button>

              {platforms.map((platform) => (
                <button
                  type="button"
                  key={platform.id}
                  className={
                    selectedPlatform === platform.id ? "active" : ""
                  }
                  onClick={() => setSelectedPlatform(platform.id)}
                >
                  {platform.label}
                </button>
              ))}
            </div>
          </div>

          <div className="discover-filter-group">
            <span className="discover-filter-label">GENRE</span>

            <div className="discover-filter-options">
              <button
                type="button"
                className={selectedGenre === "all" ? "active" : ""}
                onClick={() => setSelectedGenre("all")}
              >
                All genres
              </button>

              {genres.map((genre) => (
                <button
                  type="button"
                  key={genre}
                  className={selectedGenre === genre ? "active" : ""}
                  onClick={() => setSelectedGenre(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="discover-clear-filters"
              onClick={clearFilters}
            >
              <FontAwesomeIcon icon={faXmark} />
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div className="discover-state">
            <span className="discover-loader" />
            <p>Discovering games...</p>
          </div>
        ) : error ? (
          <div className="discover-state discover-state-error">
            <FontAwesomeIcon icon={faGamepad} />
            <h3>Something went wrong</h3>
            <p>{error}</p>

            <button
              type="button"
              onClick={() => void refreshGames()}
            >
              <FontAwesomeIcon icon={faRotate} />
              Try again
            </button>
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="discover-state">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <h3>No games found</h3>
            <p>Try another search or change your filters.</p>

            <button type="button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="discover-games-grid">
            {filteredGames.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default Discover;
