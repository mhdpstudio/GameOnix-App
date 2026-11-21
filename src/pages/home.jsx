import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronLeft,
  faChevronRight,
  faGamepad,
  faClock,
  faLock,
  faMobileScreenButton,
  faRotate,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  faPlaystation,
  faWindows,
  faXbox,
} from "@fortawesome/free-brands-svg-icons";
import GameCard from "../components/GameCard";
import { useGameCatalog } from "../hooks/useGameCatalog";
import { getGameCategories } from "../utils/game-categories";
import {
  getGameBadgeType,
  getGameReleaseTimestamp,
  isUpdatedGame,
} from "../utils/game-release";

import "./../style/home-style.css";

const GAMES_PER_SECTION = 20;
const DIGITAL_CODES_URL =
  "https://raw.githubusercontent.com/mhdpstudio/GameOnix-Data-Content/main/recharge.json";
const DIGITAL_CODE_ASSET_BASE =
  "https://raw.githubusercontent.com/mhdpstudio/GameOnix-Data-Content/main/";

function getDigitalCodeImageUrl(value) {
  const image = String(value || "").trim();
  if (!image) return "";
  if (/^https?:\/\//i.test(image)) return image;
  return DIGITAL_CODE_ASSET_BASE + image.replace(/^\.\.\//, "").replace(/^\/+/, "");
}

function getDigitalCodePlatform(product) {
  const platform = String(product?.platform || "").trim().toLowerCase();
  if (platform === "playstation") {
    return String(product?.platformVersion || "ps5").trim().toUpperCase();
  }
  if (platform === "pc") return "PC";
  if (platform === "xbox") return "XBOX";
  if (platform === "nintendo-switch") return "NINTENDO SWITCH";
  return platform === "other" ? "OTHER PLATFORM" : "DIGITAL CODE";
}

function formatDigitalCodePrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Price unavailable";
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function HomeFeaturedHero({ showFallback = true } = {}) {
  const [products, setProducts] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(DIGITAL_CODES_URL, { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("Digital code catalog unavailable");
        return response.json();
      })
      .then((catalog) => {
        if (active && Array.isArray(catalog)) {
          setProducts(catalog.filter((item) => item && item.able !== false));
        }
      })
      .catch(() => {});

    return () => { active = false; };
  }, []);

  const isDigitalCode = (item) => String(item?.kind || "").trim().toLowerCase() === "digital-code";
  const groupKey = (item) => isDigitalCode(item)
    ? String(item?.digitalCodeGroup || item?.id || "").trim().toLowerCase()
    : String(item?.id || "").trim().toLowerCase();
  const selectedFeaturedProducts = products.filter((item) => item.featuredOnHome);
  const legacyDefault = products.some((item) => typeof item.featuredOnHome === "boolean")
    ? []
    : products.filter(isDigitalCode).slice(0, 1);
  const catalogPositions = new Map(products.map((item, index) => [item.id, index]));
  const slideSeeds = (selectedFeaturedProducts.length ? selectedFeaturedProducts : legacyDefault)
    .filter((item, index, items) => items.findIndex((candidate) => groupKey(candidate) === groupKey(item)) === index)
    .sort((first, second) => {
      const firstOrder = Number(first.homeHeroOrder);
      const secondOrder = Number(second.homeHeroOrder);
      const firstHasOrder = first.homeHeroOrder !== undefined && first.homeHeroOrder !== null && Number.isFinite(firstOrder);
      const secondHasOrder = second.homeHeroOrder !== undefined && second.homeHeroOrder !== null && Number.isFinite(secondOrder);
      if (firstHasOrder && secondHasOrder && firstOrder !== secondOrder) return firstOrder - secondOrder;
      if (firstHasOrder !== secondHasOrder) return firstHasOrder ? 1 : -1;
      if (isDigitalCode(first) !== isDigitalCode(second)) return isDigitalCode(first) ? -1 : 1;
      return (catalogPositions.get(first.id) || 0) - (catalogPositions.get(second.id) || 0);
    });
  const slides = slideSeeds.map((seed) => isDigitalCode(seed)
    ? products.filter((item) => isDigitalCode(item) && groupKey(item) === groupKey(seed))
    : [seed]
  );
  useEffect(() => setActiveIndex(0), [slides.length]);
  useEffect(() => {
    if (slides.length < 2) return undefined;
    const timer = window.setTimeout(() => setActiveIndex((index) => (index + 1) % slides.length), 7000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, slides.length]);

  const heroVariants = slides[activeIndex] || slides[0] || [];
  const product = heroVariants.find((item) => item.featuredOnHome)
    || heroVariants[0];
  const productIsDigitalCode = product ? isDigitalCode(product) : false;
  if (!product) {
    if (!showFallback) return null;
    return (
      <section className="home-welcome">
        <div className="home-welcome-copy">
          <span className="home-eyebrow"><FontAwesomeIcon icon={faGamepad} />YOUR GAMING DESTINATION</span>
          <h1>Find your next<span> adventure.</span></h1>
          <p>Explore your library, discover new worlds, and find your next favorite game.</p>
        </div>
        <div className="home-welcome-art" aria-hidden="true"><FontAwesomeIcon icon={faGamepad} /></div>
      </section>
    );
  }

  const packages = (product.packs || []).filter((pack, index) =>
    pack?.able !== false && (!Array.isArray(product.homeHeroPackages) || product.homeHeroPackages.includes(index))
  );
  const prices = packages.map((pack) => Number(pack?.price)).filter((price) => Number.isFinite(price) && price >= 0);
  const startingPrice = prices.length ? Math.min(...prices) : null;
  const heroImageProduct = heroVariants.find((item) => item.homeHeroImage);
  const heroImage = getDigitalCodeImageUrl(product.homeHeroImage || heroImageProduct?.homeHeroImage);
  const heroLogo = product.homeHeroLogo || heroVariants.find((item) => item.homeHeroLogo)?.homeHeroLogo;
  const heroTitle = String(product.homeHeroTitle || product.name || "").trim();
  const heroTags = [...new Set(heroVariants.flatMap((item) => Array.isArray(item.homeHeroTags) ? item.homeHeroTags.filter(Boolean) : []))];
  const firstPackageIndex = (product.packs || []).findIndex(
    (pack) => pack?.able !== false && pack?.stock !== false
  );

  return (
    <section className={`home-digital-hero${heroImage ? " has-custom-image" : ""}${heroLogo ? " has-custom-logo" : ""}`} aria-label={`Featured item: ${heroTitle}`}>
      {heroImage && <div className="home-digital-hero-background" key={heroImage}><img src={heroImage} alt="" /></div>}
      {slides.length > 1 && <div className="home-digital-hero-nav" aria-label="Featured item navigation">
        <button type="button" onClick={() => setActiveIndex((index) => (index - 1 + slides.length) % slides.length)} aria-label="Previous featured item" title="Previous featured item">
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
        <button type="button" onClick={() => setActiveIndex((index) => (index + 1) % slides.length)} aria-label="Next featured item" title="Next featured item">
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>}
      <div className="home-digital-hero-copy">
        <div className="home-digital-hero-slide" key={groupKey(product)}>
          <span className="home-digital-hero-kicker">{product.homeHeroEyebrow || `FEATURED ${product.type || (productIsDigitalCode ? "DIGITAL CODE" : "GAMEONIX PICK")}`}</span>
          <h1>{heroTitle}</h1>
          <div className="home-digital-hero-meta">
            {product.publisher && <span>{product.publisher}</span>}
            {productIsDigitalCode ? heroVariants.map((variant) => <span className="home-digital-platform-tag" key={variant.id} title={getDigitalCodePlatform(variant)}>
              <FontAwesomeIcon icon={variant.platform === "playstation" ? faPlaystation : variant.platform === "xbox" ? faXbox : variant.platform === "pc" ? faWindows : faGamepad} />
              <i aria-hidden="true">|</i><span>{getDigitalCodePlatform(variant)}</span>
            </span>) : <span className="home-digital-platform-tag">{product.type || product.kind || "Featured"}</span>}
          </div>
          <div className="home-digital-hero-tags">{heroTags.slice(0, 4).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
          <p className="home-digital-hero-description">{product.homeHeroDescription || " "}</p>
          <p className="home-digital-starting-price">{startingPrice !== null ? `Starting from ${formatDigitalCodePrice(startingPrice)}` : "Explore this featured product"}</p>
          <div className="home-digital-packages" aria-label="Available editions and prices">
            {packages.length ? packages.map((pack, index) => (
              <div className={`home-digital-package${pack.stock === false ? " is-out-of-stock" : ""}`} key={`${pack.title}-${index}`}>
                <span>{[pack.title, pack.type].filter(Boolean).join(" ")}</span>
                <strong>{formatDigitalCodePrice(pack.price)}</strong>
                {pack.oldPrice && <del>{formatDigitalCodePrice(pack.oldPrice)}</del>}
              </div>
            )) : <p>No packages available yet.</p>}
          </div>
          <Link className="home-digital-hero-cta" to={`/shopping/game-cards?featuredProduct=${encodeURIComponent(product.id)}${firstPackageIndex >= 0 ? `&packIndex=${firstPackageIndex}` : ""}#gc-store`}>
            <span>{productIsDigitalCode ? "Explore this game" : "Shop this item"}</span><i><FontAwesomeIcon icon={faChevronRight} /></i>
          </Link>
        </div>
      </div>
      {slides.length > 1 && <div className="home-digital-hero-controls" aria-label="Choose a featured item">
        <div className="home-digital-hero-control-dots">
          {slides.map((variants, index) => <button type="button" key={groupKey(variants[0])} onClick={() => setActiveIndex(index)} aria-label={`Show ${variants[0].name}`} aria-pressed={index === activeIndex} />)}
        </div>
        <span className="home-digital-hero-progress" key={activeIndex} aria-hidden="true"><i /></span>
      </div>}
      {heroLogo && <div className="home-digital-hero-logo" key={heroLogo} aria-hidden="true"><img src={getDigitalCodeImageUrl(heroLogo)} alt="" /></div>}
      {!heroImage && !heroLogo && product.image && <div className="home-digital-hero-art" key={product.id}><img src={getDigitalCodeImageUrl(product.image)} alt={heroTitle} /></div>}
      <div className="home-digital-hero-glow" aria-hidden="true" />
    </section>
  );
}

function getAddedAt(game) {
  const value = game?.createdAt;

  if (!value || typeof value !== "string") return null;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareGameIdsDescending(first, second) {
  const firstId = Number(first?.id);
  const secondId = Number(second?.id);
  const firstHasId = Number.isFinite(firstId);
  const secondHasId = Number.isFinite(secondId);

  if (firstHasId && secondHasId) return secondId - firstId;
  if (firstHasId) return -1;
  if (secondHasId) return 1;
  return 0;
}

function compareAddedAtDescending(first, second) {
  return (getAddedAt(second) || 0) - (getAddedAt(first) || 0);
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();

  if (["pc", "windows", "computer"].includes(platform)) {
    return "pc";
  }

  if (["ps", "playstation", "ps4", "ps5"].includes(platform)) {
    return "ps";
  }

  return platform;
}

function getPlatformInfo(platformId) {
  if (platformId === "pc") {
    return {
      title: "PC Games",
      icon: faWindows,
      description: "Discover games for your PC",
      kicker: "PC GAMING",
    };
  }

  if (platformId === "ps") {
    return {
      title: "PlayStation Games",
      icon: faPlaystation,
      description: "Explore games for PlayStation",
      kicker: "CONSOLE GAMING",
    };
  }

  if (platformId === "xbox") {
    return {
      title: "Xbox Games",
      icon: faXbox,
      description: "Explore games for Xbox",
      kicker: "CONSOLE GAMING",
    };
  }

  if (platformId === "mobile") {
    return {
      title: "Mobile Games",
      icon: faMobileScreenButton,
      description: "Explore games for mobile",
      kicker: "MOBILE GAMING",
    };
  }

  return {
    title: `${platformId.toUpperCase()} Games`,
    icon: faGamepad,
    description: `Explore games for ${platformId.toUpperCase()}`,
    kicker: `${platformId.toUpperCase()} GAMING`,
  };
}

function GamesCarousel({ games, platform, category, now }) {
  const rowRef = useRef(null);

  const visibleGames = games.slice(0, GAMES_PER_SECTION);
  const hasMore = games.length > GAMES_PER_SECTION;
  const isRecentlyAdded = category.id === "recently-added";
  const isRecentlyUpdated = category.id === "recently-updated";
  const isReleaseSection = isRecentlyAdded || isRecentlyUpdated;

  const categoryUrl = isReleaseSection
    ? `/games?sort=${isRecentlyUpdated ? "updated" : "recent"}`
    : `/games?platform=${encodeURIComponent(
        platform.id
      )}&type=${encodeURIComponent(category.type)}`;

  const title = isRecentlyAdded
    ? "Recently Added"
    : isRecentlyUpdated
      ? "Recently Updated"
    : category.type;

  function scrollRow(direction) {
    if (!rowRef.current) return;

    rowRef.current.scrollBy({
      left:
        direction *
        Math.max(rowRef.current.clientWidth * 0.8, 250),
      behavior: "smooth",
    });
  }

  return (
    <section
      className={
        isReleaseSection
          ? "home-category home-recently-added"
          : "home-category"
      }
    >
      <header className="home-category-heading">
        {isReleaseSection ? (
          <div className="home-category-title home-category-title-static">
            <span className="home-category-accent" />
            <span>{title}</span>
          </div>
        ) : (
          <Link
            className="home-category-title"
            to={categoryUrl}
            aria-label={`View all ${category.type} games on ${platform.title}`}
          >
            <span className="home-category-accent" />
            <span>{title}</span>

            <span className="home-category-chevron">
              <FontAwesomeIcon icon={faChevronRight} />
            </span>
          </Link>
        )}

        <div className="home-category-actions">
          <Link
            className="home-category-more"
            to={categoryUrl}
          >
            {isReleaseSection ? "View all" : "More"}
            <FontAwesomeIcon icon={faChevronRight} />
          </Link>

          <button
            type="button"
            className="home-scroll-button"
            onClick={() => scrollRow(-1)}
            aria-label={`Scroll ${title} games left`}
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>

          <button
            type="button"
            className="home-scroll-button"
            onClick={() => scrollRow(1)}
            aria-label={`Scroll ${title} games right`}
          >
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        </div>
      </header>

      <div className="home-games-row" ref={rowRef}>
        {visibleGames.map((game) => (
          <GameCard
            key={`${category.id}-${game.id ?? game.slug}`}
            game={game}
            badgeType={getGameBadgeType(game, now)}
            className="home-game-card"
          />
        ))}

        {hasMore && (
          <Link
            className="home-more-card"
            to={categoryUrl}
          >
            <span className="home-more-icon">
              <FontAwesomeIcon icon={faChevronRight} />
            </span>

            <strong>More Games</strong>
            <span>View all {games.length} games</span>
          </Link>
        )}
      </div>
    </section>
  );
}

function HomeDiscovery({ games }) {
  const featuredGames = games.filter((game) => game.featuredOnHome).slice().sort((left, right) =>
    (Number(left.homeFeatureOrder) || 0) - (Number(right.homeFeatureOrder) || 0)
  );
  const picks = (featuredGames.length ? featuredGames : games).slice(0, 7);
  if (!picks.length) return null;
  const [featured, ...more] = picks;

  return (
    <section className="home-discovery" aria-label="Discover games">
      <Link className="home-discovery-feature" to={`/game/${encodeURIComponent(featured.slug)}`}>
        {(featured.homeFeatureImage || featured.poster || featured.game_poster) && <img src={featured.homeFeatureImage || featured.poster || featured.game_poster} alt="" loading="lazy" />}
        <span className="home-discovery-shade" />
        <span className="home-discovery-copy">
          <small>DISCOVER SOMETHING NEW</small>
          <strong>{featured.title}</strong>
          <span>Explore game</span>
        </span>
      </Link>
      <div className="home-discovery-list">
        <header><span>Handpicked for you</span><Link to="/games">View all <FontAwesomeIcon icon={faChevronRight} /></Link></header>
        {more.map((game) => <Link className="home-discovery-item" to={`/game/${encodeURIComponent(game.slug)}`} key={game.id ?? game.slug}>
          {game.homeFeatureImage || game.poster || game.game_poster ? <img src={game.homeFeatureImage || game.poster || game.game_poster} alt="" loading="lazy" /> : <span className="home-discovery-thumb"><FontAwesomeIcon icon={faGamepad} /></span>}
          <span><strong>{game.title}</strong><small>{[game.publisher, getGameCategories(game)[0]].filter(Boolean).join(" / ") || "Explore game details"}</small></span>
          <FontAwesomeIcon className="home-discovery-arrow" icon={faChevronRight} />
        </Link>)}
      </div>
    </section>
  );
}

function HomeEditorialSection({ section, games }) {
  const picks = (section.gameSlugs || []).map((slug) => games.find((game) => game.slug === slug))
    .filter((game) => game && game.availability !== false).slice(0, 8);
  if (!picks.length) return null;
  if (section.layout === "feature") {
    const [lead, ...rest] = picks;
    const image = lead.homeFeatureImage || lead.poster || lead.game_poster;
    return <section className="home-editorial home-editorial-feature">
      <header className="home-editorial-heading"><span>GAMEONIX COLLECTION</span><h2>{section.title || "Featured collection"}</h2>{section.subtitle && <p>{section.subtitle}</p>}</header>
      <div className="home-editorial-feature-layout">
        <Link className="home-editorial-lead" to={`/game/${encodeURIComponent(lead.slug)}`}>
          {image && <img src={image} alt="" loading="lazy" />}<span className="home-editorial-lead-shade" />
          <span className="home-editorial-lead-copy"><small>EDITOR'S PICK</small><strong>{lead.title}</strong><span>Explore game <FontAwesomeIcon icon={faChevronRight} /></span></span>
        </Link>
        <div className="home-editorial-feature-cards">{rest.slice(0, 4).map((game) => <GameCard key={game.slug} game={game} className="home-game-card" />)}</div>
      </div>
    </section>;
  }
  return <section className="home-editorial home-editorial-shelf">
    <header className="home-editorial-heading"><div><span>CURATED FOR YOU</span><h2>{section.title || "Game collection"}</h2>{section.subtitle && <p>{section.subtitle}</p>}</div><Link to="/games">Explore all <FontAwesomeIcon icon={faChevronRight} /></Link></header>
    <div className="home-editorial-shelf-row">{picks.map((game) => <GameCard key={game.slug} game={game} className="home-game-card" />)}</div>
  </section>;
}

function HomeComingSoon({ items }) {
  const [selected, setSelected] = useState(null);
  const visibleItems = (items || []).filter((item) => item.title);
  if (!visibleItems.length) return null;
  return <>
    <section className="home-coming-soon">
      <header className="home-editorial-heading"><div><span><FontAwesomeIcon icon={faClock} /> NEXT UP</span><h2>Coming Soon</h2><p>New worlds are on the way.</p></div><span className="home-coming-soon-badge">COMING SOON</span></header>
      <div className="home-coming-soon-grid">{visibleItems.map((item) => <button type="button" className="home-coming-soon-card" key={item.id} disabled={!item.clickable} onClick={() => setSelected(item)} aria-label={item.clickable ? `View ${item.title} preview` : `${item.title}, coming soon`}>
        <span className="home-coming-soon-art">{item.image ? <img src={item.image} alt="" loading="lazy" /> : <FontAwesomeIcon icon={faGamepad} />}</span>
        <span className="home-coming-soon-copy"><small><FontAwesomeIcon icon={faClock} /> Coming Soon</small><strong>{item.title}</strong>{item.description && <span>{item.description}</span>}</span>
        <span className="home-coming-soon-lock" aria-hidden="true"><FontAwesomeIcon icon={item.clickable ? faChevronRight : faLock} /></span>
      </button>)}</div>
    </section>
    {selected && <div className="home-coming-soon-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="home-coming-soon-dialog" role="dialog" aria-modal="true" aria-labelledby="coming-soon-title">
      <button type="button" className="home-coming-soon-close" onClick={() => setSelected(null)} aria-label="Close preview"><FontAwesomeIcon icon={faXmark} /></button>
      {selected.image && <img className="home-coming-soon-dialog-art" src={selected.image} alt="" />}
      <div className="home-coming-soon-dialog-copy"><span><FontAwesomeIcon icon={faClock} /> COMING SOON</span><h2 id="coming-soon-title">{selected.title}</h2><p>{selected.description || "This game is on its way. Check back soon for updates."}</p><small><FontAwesomeIcon icon={faLock} /> Downloads unlock when the game is released.</small></div>
    </section></div>}
  </>;
}

function Home() {
  const { games, homeSections, comingSoon, loading, error, refreshGames } = useGameCatalog();
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  const recentlyAddedGames = useMemo(() => {
    return games
      .filter((game) => !isUpdatedGame(game) && getAddedAt(game) !== null)
      .slice()
      .sort(compareAddedAtDescending);
  }, [games]);

  const recentlyUpdatedGames = useMemo(() => {
    return games
      .filter(
        (game) => isUpdatedGame(game) && getGameReleaseTimestamp(game) !== null
      )
      .slice()
      .sort((first, second) =>
        (getGameReleaseTimestamp(second) || 0) -
        (getGameReleaseTimestamp(first) || 0)
      );
  }, [games]);

  const sections = useMemo(() => {
    const platformMap = new Map();

    games.forEach((game) => {
      const platformId = normalizePlatform(game.platform);

      if (!platformId) return;

      if (!platformMap.has(platformId)) {
        platformMap.set(platformId, {
          id: platformId,
          ...getPlatformInfo(platformId),
          categories: new Map(),
        });
      }

      const platformSection = platformMap.get(platformId);
      const types = getGameCategories(game);
      (types.length ? types : ["Other"]).forEach((type) => {
        if (!platformSection.categories.has(type)) {
          platformSection.categories.set(type, []);
        }

        platformSection.categories.get(type).push(game);
      });
    });

    return Array.from(platformMap.values()).map((platformSection) => ({
      ...platformSection,
      categories: Array.from(
        platformSection.categories.entries()
      ).map(([type, items]) => ({
        id: type,
        type,
        games: items.slice().sort(compareGameIdsDescending),
      })),
    }));
  }, [games]);

  if (loading) {
    return (
      <main className="home-page">
        <div className="home-status">
          <span className="home-loader" />
          <p>Loading your games...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="home-page">
        <div className="home-status">
          <p>{error}</p>

          <button
            type="button"
            className="home-retry-button"
            onClick={() => void refreshGames()}
          >
            <FontAwesomeIcon icon={faRotate} />
            Try again
          </button>
        </div>
      </main>
    );
  }

  const recentCategory = {
    id: "recently-added",
    type: "Recently Added",
  };
  const updatedCategory = {
    id: "recently-updated",
    type: "Recently Updated",
  };
  let categorySectionIndex = 0;
  let editorialSectionIndex = 0;

  return (
    <main className="home-page">
      <HomeFeaturedHero />

      <HomeDiscovery games={games} />
      <HomeComingSoon items={comingSoon} />

      {recentlyAddedGames.length > 0 && (
        <GamesCarousel
          games={recentlyAddedGames}
          platform={null}
          category={recentCategory}
          now={clock}
        />
      )}

      {recentlyUpdatedGames.length > 0 && (
        <GamesCarousel
          games={recentlyUpdatedGames}
          platform={null}
          category={updatedCategory}
          now={clock}
        />
      )}

      {sections.map((platformSection) => {
        const totalGames = games.filter(
          (game) =>
            normalizePlatform(game.platform) === platformSection.id
        ).length;

        return (
          <section
            className="home-platform-section"
            key={platformSection.id}
            id={`platform-${platformSection.id}`}
          >
            <header className="home-platform-heading">
              <div>
                <span className="home-platform-kicker">
                  {platformSection.kicker}
                </span>

                <h2>
                  <FontAwesomeIcon
                    className="home-platform-icon"
                    icon={platformSection.icon}
                    aria-hidden="true"
                  />
                  {platformSection.title}
                </h2>
                <p>{platformSection.description}</p>
              </div>

              <Link
                className="home-platform-count"
                to={`/games?platform=${encodeURIComponent(
                  platformSection.id
                )}`}
              >
                {totalGames} games
                <FontAwesomeIcon icon={faChevronRight} />
              </Link>
            </header>

            {platformSection.categories.length === 0 ? (
              <p className="home-empty">
                No games available for this platform yet.
              </p>
            ) : (
              platformSection.categories.map((category) => {
                categorySectionIndex += 1;
                const editorialSection = categorySectionIndex % 3 === 0
                  ? homeSections[editorialSectionIndex++]
                  : null;
                return <Fragment key={`${platformSection.id}-${category.type}`}>
                  <GamesCarousel
                    games={category.games}
                    platform={platformSection}
                    category={category}
                    now={clock}
                  />
                  {editorialSection && <HomeEditorialSection key={editorialSection.id} section={editorialSection} games={games} />}
                </Fragment>;
              })
            )}
          </section>
        );
      })}
      {homeSections.slice(editorialSectionIndex).map((section) => <HomeEditorialSection key={section.id} section={section} games={games} />)}
    </main>
  );
}

export default Home;
