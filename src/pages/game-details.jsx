import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowLeft,
    faDownload,
    faCircleCheck,
    faCircleXmark,
    faCompass,
    faHeart,
    faBell,
    faBug,
    faGamepad,
    faChevronLeft,
    faChevronRight,
    faTag,
    faCodeBranch,
    faHdd,
    faBuilding,
    faXmark,
    faTrash,
    faFolderOpen,
} from "@fortawesome/free-solid-svg-icons";
import {
    faWindows,
    faPlaystation,
} from "@fortawesome/free-brands-svg-icons";

import {
    getFavorites,
    addFavorite,
    removeFavorite,
} from "../api/favorites";
import { getCommunityApiToken } from "../api/session";
import { addFollow, getFollows, recordGameActivity, removeFollow } from "../api/follows";
import { useAuth } from "../context/AuthContext";
import AddonsPanel from "../components/AddonsPanel";
import GameCard from "../components/GameCard";
import { getGameCategories } from "../utils/game-categories";
import { getAddonList } from "../utils/addons";
import { GameReviews } from "./reviews";
import { useGameCatalog } from "../hooks/useGameCatalog";
import { useDialog } from "../context/DialogContext";

import "./../style/game-details-style.css";

const BANNERS_BASE_URL =
    "https://raw.githubusercontent.com/mhdpstudio/GameOnix-Data-Content/main/images/games/banners/";
const GAME_REPORT_API_URL =
    "https://gameonixfav.vercel.app/api/game-report";

function formatDownloadBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = value / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
}

function RequirementsPanel({ game }) {
    const requirements = game?.requirements && typeof game.requirements === "object"
        ? game.requirements
        : {};
    const minimum = String(requirements.minimum || "").trim();
    const recommended = String(requirements.recommended || "").trim();
    const isPc = ["pc", "windows", "computer"].includes(
        String(game?.platform || "").trim().toLowerCase()
    );
    const tiers = [
        { label: "Minimum", note: "To run the game", text: minimum, tone: "minimum" },
        { label: "Recommended", note: "For a smoother experience", text: recommended, tone: "recommended" },
    ].filter((tier) => tier.text);
    const parseRequirements = (text) => text.split(/\r?\n/)
        .map((line) => line.trim().replace(/^[-*•]\s*/, "").replace(/\s{2,}/g, " "))
        .filter(Boolean)
        .map((line) => {
            const separator = line.indexOf(":");
            if (separator > 0 && separator < 36) {
                return { label: line.slice(0, separator).replace(/\s*\*$/, "").trim(), value: line.slice(separator + 1).trim() };
            }
            return { label: "Additional info", value: line };
        });

    return (
        <section className="game-requirements-panel" aria-labelledby="game-requirements-title">
            <header className="game-requirements-heading">
                <div className="game-requirements-heading-copy">
                    <span className="game-requirements-eyebrow">PC SPECS</span>
                    <h2 id="game-requirements-title">System requirements</h2>
                    <p>Check what you need to get {game.title} running, then compare with the recommended setup.</p>
                </div>
                {isPc && <span className="game-requirements-platform"><span aria-hidden="true">▰</span> Windows PC</span>}
            </header>
            {!isPc ? (
                <div className="game-requirements-empty"><strong>PC specifications unavailable</strong><span>System requirements are not applicable to this platform.</span></div>
            ) : !tiers.length ? (
                <div className="game-requirements-empty"><strong>Requirements coming soon</strong><span>System requirements have not been added for this game yet.</span></div>
            ) : (
                <div className="game-requirements-grid">
                    {tiers.map((tier) => (
                        <article className={"game-requirements-card game-requirements-card--" + tier.tone} key={tier.label}>
                            <div className="game-requirements-card-heading">
                                <div><span className="game-requirements-tier-label">{tier.note}</span><h3>{tier.label}</h3></div>

                            </div>
                            <ul className="game-requirements-list">
                                {parseRequirements(tier.text).map((item, index) => (
                                    <li className="game-requirements-item" key={item.label + "-" + index}>
                                        <span className="game-requirements-item-label">{item.label}</span>
                                        <span className="game-requirements-item-value">{item.value}</span>
                                    </li>
                                ))}
                            </ul>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function chooseRelatedGames(game, allGames) {
    const categories = new Set(getGameCategories(game).map((value) => value.toLocaleLowerCase()));
    const platform = String(game.platform || "").toLocaleLowerCase();
    const publisher = String(game.publisher || "").trim().toLocaleLowerCase();
    const candidates = allGames
        .filter((candidate) => candidate.slug !== game.slug && candidate.availability !== false)
        .map((candidate) => {
            const sharedCategories = getGameCategories(candidate)
                .filter((value) => categories.has(value.toLocaleLowerCase())).length;
            const samePlatform = platform && String(candidate.platform || "").toLocaleLowerCase() === platform;
            const samePublisher = publisher && String(candidate.publisher || "").trim().toLocaleLowerCase() === publisher;
            const score = sharedCategories * 3 + Number(samePlatform) + Number(samePublisher) * 0.5;
            return { candidate, score };
        })
        .filter((item) => item.score > 0);

    if (!candidates.length) return [];

    let recent = [];
    try {
        recent = JSON.parse(window.sessionStorage.getItem(`gameonix:related:${game.slug}`) || "[]");
        if (!Array.isArray(recent)) recent = [];
    } catch {
        recent = [];
    }

    const recentSlugs = new Set(recent);
    const freshCandidates = candidates.filter((item) => !recentSlugs.has(item.candidate.slug));
    const pool = freshCandidates.length >= Math.min(4, candidates.length) ? freshCandidates : candidates;
    const selected = [];

    while (pool.length && selected.length < 4) {
        const weights = pool.map(({ score, candidate }) => score * score * (recentSlugs.has(candidate.slug) ? 0.08 : 1));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = Math.random() * totalWeight;
        let selectedIndex = weights.findIndex((weight) => (roll -= weight) <= 0);
        if (selectedIndex < 0) selectedIndex = pool.length - 1;
        selected.push(pool.splice(selectedIndex, 1)[0].candidate);
    }

    try {
        window.sessionStorage.setItem(
            `gameonix:related:${game.slug}`,
            JSON.stringify([...recent, ...selected.map((item) => item.slug)].slice(-16))
        );
    } catch {
        // Recommendations remain usable when session storage is unavailable.
    }

    return selected;
}

function isLoginError(err) {
    const message = String(err?.message || "").toLowerCase();

    return (
        message.includes("log in") ||
        message.includes("login") ||
        message.includes("unauthorized") ||
        message.includes("unauthenticated") ||
        message.includes("401")
    );
}

function GameDetails() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const { confirm, alert } = useDialog();
    const { user } = useAuth();
    const { games: allGames, loading: catalogLoading, error: catalogError } = useGameCatalog();

    const thumbnailsRef = useRef(null);
    const reportDescriptionRef = useRef(null);

    const [game, setGame] = useState(null);
    const [relatedGames, setRelatedGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [favorites, setFavorites] = useState([]);
    const [favoritesLoaded, setFavoritesLoaded] = useState(false);
    const [favoriteBusy, setFavoriteBusy] = useState(false);
    const [favoriteError, setFavoriteError] = useState("");
    const [downloadStarting, setDownloadStarting] = useState(false);
    const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
    const [downloadDialogId, setDownloadDialogId] = useState("");
    const [downloadDialogInfo, setDownloadDialogInfo] = useState(null);
    const [downloadDialogFiles, setDownloadDialogFiles] = useState(null);
    const [downloadDialogError, setDownloadDialogError] = useState("");
    const [downloadDialogBusy, setDownloadDialogBusy] = useState(false);
    const [downloadDialogIsNew, setDownloadDialogIsNew] = useState(false);
    const [downloadTargetDirectory, setDownloadTargetDirectory] = useState("");
    const [showFavoriteMessage, setShowFavoriteMessage] = useState(false);
    const [follows, setFollows] = useState([]);
    const [followBusy, setFollowBusy] = useState(false);
    const [followError, setFollowError] = useState("");
    const [showFollowLoginMessage, setShowFollowLoginMessage] = useState(false);
    const viewedSlug = useRef("");

    async function startDesktopDownload() {
        if (!window.gameonixDesktop || !game) return;
        setDownloadStarting(true);
        try {
            const settings = await window.gameonixDesktop.settings.get();
            setDownloadTargetDirectory(settings.downloadDirectory || "");
            const currentDownloads = await window.gameonixDesktop.downloads.list();
            const existing = currentDownloads.find((item) => item.id === game.slug);
            setDownloadDialogIsNew(!existing);
            setDownloadDialogId(game.slug);
            setDownloadDialogInfo(existing || null);
            setDownloadDialogFiles(null);
            setDownloadDialogError("");
            const result = await window.gameonixDesktop.downloads.start({
                slug: game.slug,
                title: game.title,
                torrentUrl: game.gameLink,
            });
            setDownloadDialogId(result?.id || game.slug);
            setDownloadDialogOpen(true);
        } catch (reason) {
            void alert({ title: "Download could not start", message: reason?.message || "Try again from the game page." });
        } finally {
            setDownloadStarting(false);
        }
    }

    useEffect(() => {
        const desktop = window.gameonixDesktop;
        if (!desktop || !downloadDialogOpen || !downloadDialogId) return undefined;
        let active = true;
        const updateDialog = (items) => {
            if (!active) return;
            const item = items.find((entry) => entry.id === downloadDialogId);
            setDownloadDialogInfo(item || null);
            if (item?.files?.length) {
                setDownloadDialogFiles((selected) => selected === null
                    ? (item.selectedFiles?.length ? item.selectedFiles : item.files.map((_, index) => index))
                    : selected);
            }
        };
        const unsubscribe = desktop.downloads.onUpdate(updateDialog);
        desktop.downloads.list().then(updateDialog).catch((reason) => {
            if (active) setDownloadDialogError(reason.message || "Could not read the torrent file list.");
        });
        return () => { active = false; unsubscribe(); };
    }, [downloadDialogOpen, downloadDialogId]);

    async function closeDownloadDialog() {
        if (downloadDialogBusy) return;
        setDownloadDialogOpen(false);
        if (downloadDialogIsNew && (!downloadDialogInfo || ["starting", "selecting"].includes(downloadDialogInfo.status))) {
            await window.gameonixDesktop?.downloads.remove(downloadDialogId, false).catch(() => {});
        }
        setDownloadDialogIsNew(false);
    }

    async function beginSelectedDownload() {
        if (!downloadDialogId || !downloadDialogFiles?.length) return;
        setDownloadDialogBusy(true);
        setDownloadDialogError("");
        try {
            await window.gameonixDesktop.downloads.begin(downloadDialogId, downloadDialogFiles);
            void recordGameActivity(game.slug, "download").catch(() => {});
            setDownloadDialogOpen(false);
            setDownloadDialogIsNew(false);
            navigate("/downloads");
        } catch (reason) {
            setDownloadDialogError(reason.message || "Could not start this download.");
        } finally {
            setDownloadDialogBusy(false);
        }
    }

    async function removeGameFromDevice() {
        const accepted = await confirm({
            title: "Remove this game from this device?",
            message: `This removes ${game.title} and its downloaded files from your device. This cannot be undone.`,
            confirmLabel: "Remove game and files",
            danger: true,
        });
        if (!accepted) return;
        setDownloadDialogBusy(true);
        try {
            await window.gameonixDesktop.downloads.remove(downloadDialogId, true);
            setDownloadDialogOpen(false);
            setDownloadDialogIsNew(false);
        } catch (reason) {
            setDownloadDialogError(reason.message || "Could not remove the game files.");
        } finally {
            setDownloadDialogBusy(false);
        }
    }

    async function resumeExistingDownload() {
        if (!downloadDialogId) return;
        setDownloadDialogBusy(true);
        setDownloadDialogError("");
        try {
            await window.gameonixDesktop.downloads.resume(downloadDialogId);
            setDownloadDialogOpen(false);
            setDownloadDialogIsNew(false);
            navigate("/downloads");
        } catch (reason) {
            setDownloadDialogError(reason.message || "Could not resume this download.");
        } finally {
            setDownloadDialogBusy(false);
        }
    }

    useEffect(() => {
        if (!downloadDialogOpen || downloadDialogBusy) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") void closeDownloadDialog();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [downloadDialogOpen, downloadDialogBusy, downloadDialogId, downloadDialogInfo]);

    const [selectedImage, setSelectedImage] = useState(0);
    const [failedImages, setFailedImages] = useState([]);
    const [activeTab, setActiveTab] = useState("overview");
    const [reportOpen, setReportOpen] = useState(false);
    const [reportDescription, setReportDescription] = useState("");
    const [reportError, setReportError] = useState("");
    const [reportSubmitting, setReportSubmitting] = useState(false);
    const [reportSubmitted, setReportSubmitted] = useState(false);

    useEffect(() => {
        if (!reportOpen) return undefined;

        function handleReportKeyDown(event) {
            if (event.key === "Escape" && !reportSubmitting) {
                setReportOpen(false);
            }
        }

        window.addEventListener("keydown", handleReportKeyDown);
        reportDescriptionRef.current?.focus();
        return () => window.removeEventListener("keydown", handleReportKeyDown);
    }, [reportOpen, reportSubmitting]);

    useEffect(() => {
        setRelatedGames(game && allGames.length ? chooseRelatedGames(game, allGames) : []);
    }, [game, allGames]);

    // Keep game details and related games in sync with the shared catalog.
    useEffect(() => {
        if (catalogLoading) return;
        if (catalogError && !allGames.length) {
            setError("Couldn't load games.");
            setLoading(false);
            return;
        }

        const found = allGames.find((item) => item.slug === slug);
        if (!found) {
            setError("Game not found.");
            setLoading(false);
            return;
        }

        setError("");
        setGame(found);
        setLoading(false);
        if (viewedSlug.current !== found.slug) {
            viewedSlug.current = found.slug;
            void recordGameActivity(found.slug, "view").catch(() => {});
        }
    }, [slug, allGames, catalogLoading, catalogError]);

    useEffect(() => {
        let active = true;
        getFollows().then((data) => { if (active) setFollows(Array.isArray(data.follows) ? data.follows : []); }).catch(() => { if (active) setFollows([]); });
        return () => { active = false; };
    }, [slug]);

    // Load favorites from the backend.
    useEffect(() => {
        let active = true;

        async function loadFavorites() {
            setFavoritesLoaded(false);
            setFavoriteError("");
            setShowFavoriteMessage(false);

            try {
                const data = await getFavorites();

                if (active) {
                    setFavorites(
                        Array.isArray(data.favorites)
                            ? data.favorites
                            : []
                    );
                }
            } catch (err) {
                if (active) {
                    setFavorites([]);

                    if (isLoginError(err)) {
                        // Keep the login message hidden until the heart is clicked.
                        setFavoriteError("");
                    } else {
                        setFavoriteError(
                            "Couldn't load favorites. Please try again."
                        );
                    }
                }
            } finally {
                if (active) {
                    setFavoritesLoaded(true);
                }
            }
        }

        loadFavorites();

        return () => {
            active = false;
        };
    }, []);

    // Build screenshot URLs from mediaPrefix and mediaCount.
    const mediaImages = game?.mediaPrefix
        ? Array.from(
              {
                  length: Math.max(
                      0,
                      Math.floor(Number(game.mediaCount) || 0)
                  ),
              },
              (_, index) => ({
                  id: index,
                  src: `${BANNERS_BASE_URL}${game.mediaPrefix}-${index + 1}.webp`,
              })
          ).filter((image) => !failedImages.includes(image.id))
        : [];

    const currentImage =
        mediaImages.find((image) => image.id === selectedImage) ||
        mediaImages[0];

    useEffect(() => {
        if (mediaImages.length < 2 || !currentImage) return undefined;

        const currentIndex = mediaImages.findIndex(
            (image) => image.id === currentImage.id
        );
        const timeout = window.setTimeout(() => {
            setSelectedImage(mediaImages[(currentIndex + 1) % mediaImages.length].id);
        }, 5000);

        return () => window.clearTimeout(timeout);
    }, [currentImage?.id, mediaImages.length]);

    // Change the main screenshot using the main image arrows.
    function selectRelativeImage(direction) {
        if (!mediaImages.length || !currentImage) return;

        const currentIndex = mediaImages.findIndex(
            (image) => image.id === currentImage.id
        );

        const nextIndex =
            (currentIndex + direction + mediaImages.length) %
            mediaImages.length;

        setSelectedImage(mediaImages[nextIndex].id);
    }

    // Scroll the thumbnails strip only.
    function scrollThumbnails(direction) {
        const container = thumbnailsRef.current;

        if (!container) return;

        const thumbnail = container.querySelector("button");
        const gap = 12;

        const amount = thumbnail
            ? thumbnail.getBoundingClientRect().width + gap
            : 132;

        container.scrollBy({
            left: direction * amount,
            behavior: "smooth",
        });
    }

    // Add or remove a favorite through the backend.
    async function toggleFavorite() {
        if (!game || favoriteBusy) return;

        setFavoriteError("");

        // If favorites couldn't be loaded because the user is logged out,
        // show the message only after the heart is clicked.
        if (!favoritesLoaded) return;

        if (favoriteError) return;

        setShowFavoriteMessage(false);

        const wasFavorite = favorites.includes(game.slug);

        try {
            setFavoriteBusy(true);

            const data = wasFavorite
                ? await removeFavorite(game.slug)
                : await addFavorite(game.slug);

            if (Array.isArray(data.favorites)) {
                setFavorites(data.favorites);
            } else {
                setFavorites((previous) =>
                    wasFavorite
                        ? previous.filter((item) => item !== game.slug)
                        : previous.includes(game.slug)
                          ? previous
                          : [...previous, game.slug]
                );
            }
        } catch (err) {
            console.error("Couldn't update favorites:", err);

            if (isLoginError(err)) {
                setShowFavoriteMessage(true);
            } else {
                setFavoriteError(
                    err.message ||
                        "Couldn't update favorites. Please try again."
                );
            }
        } finally {
            setFavoriteBusy(false);
        }
    }

    async function toggleFollow() {
        if (!game || followBusy) return;
        setFollowBusy(true);
        setFollowError("");
        setShowFollowLoginMessage(false);
        const isFollowing = follows.some((item) => item.slug === game.slug);
        try {
            const data = isFollowing
                ? await removeFollow(game.slug)
                : await addFollow(game.slug, Array.isArray(game.addons) ? game.addons.length : 0);
            setFollows(Array.isArray(data.follows) ? data.follows : []);
        } catch (err) {
            const message = String(err?.message || "").toLowerCase();
            if (message.includes("log in") || message.includes("unauthorized") || message.includes("401")) setShowFollowLoginMessage(true);
            else setFollowError(err.message || "Couldn't update your followed games.");
        } finally { setFollowBusy(false); }
    }

    function reportBug() {
        if (!game) return;
        setReportError("");
        setReportSubmitted(false);
        setReportDescription("");
        setReportOpen(true);
    }

    async function submitBugReport(event) {
        event.preventDefault();
        if (!user || !game || reportSubmitting) return;

        const description = reportDescription.trim();
        if (description.length < 10) {
            setReportError("Please describe the issue in at least 10 characters.");
            return;
        }

        setReportSubmitting(true);
        setReportError("");
        try {
            const token = await getCommunityApiToken();
            const response = await fetch(GAME_REPORT_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    Authorization: `Bearer ${token}`,
                },
                credentials: "omit",
                body: JSON.stringify({
                    description,
                    game: {
                        slug: game.slug,
                        title: game.title,
                        version: game.version,
                        platform: game.platform,
                        gameType: game.gameType,
                        publisher: game.publisher,
                        size: game.size,
                        fileType: game.fileType,
                    },
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Unable to send your report.");
            }
            setReportSubmitted(true);
            window.dispatchEvent(new Event("wallet-notifications-updated"));
        } catch (submitError) {
            console.error("Game bug report failed:", submitError);
            setReportError(
                submitError.message || "Unable to send your report. Please try again."
            );
        } finally {
            setReportSubmitting(false);
        }
    }

    if (loading) {
        return (
            <main className="game-page-status">
                <FontAwesomeIcon icon={faGamepad} />
                <p>Loading game...</p>
            </main>
        );
    }

    if (error || !game) {
        return (
            <main className="game-page-status">
                <FontAwesomeIcon icon={faGamepad} />
                <h2>{error || "Game not found"}</h2>
                <Link to="/">Back to Home</Link>
            </main>
        );
    }

    const isFavorite = favorites.includes(game.slug);
    const addons = getAddonList(game.addons);
    const downloadFiles = downloadDialogInfo?.files || [];
    const selectedDownloadFiles = downloadDialogFiles || [];
    const selectedDownloadSize = downloadFiles.reduce((size, file, index) =>
        selectedDownloadFiles.includes(index) ? size + (Number(file.length) || 0) : size, 0);
    const existingDownloadStatus = downloadDialogInfo?.status || "starting";

    return (
        <>
        <main className="game-page">
            <Link to="/" className="game-back">
                <FontAwesomeIcon icon={faArrowLeft} />
                Back to Home
            </Link>

            <header className="game-heading">
                <h1>{game.title}</h1>

                <div className="game-heading-meta">
                    {getGameCategories(game).length > 0 && (
                        <span>{getGameCategories(game).join(" · ")}</span>
                    )}
                    {game.publisher && <span>{game.publisher}</span>}
                    {game.version && (
                        <span>Version {game.version}</span>
                    )}
                </div>
            </header>

            <nav
                className="game-tabs"
                aria-label="Game details sections"
            >
                <button
                    type="button"
                    className={activeTab === "overview" ? "active" : ""}
                    onClick={() => { setActiveTab("overview"); document.getElementById("game-overview")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                >
                    Overview
                </button>

                <button
                    type="button"
                    className={activeTab === "addons" ? "active" : ""}
                    onClick={() => { setActiveTab("addons"); document.getElementById("game-addons-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                    aria-label={
                        addons.length
                            ? `Add-Ons, ${addons.length} available`
                            : "Add-Ons"
                    }
                >
                    Add-Ons
                    {addons.length > 0 && (
                        <span className="game-tab-count" aria-hidden="true">
                            {addons.length}
                        </span>
                    )}
                </button>

                <button
                    type="button"
                    className={activeTab === "requirements" ? "active" : ""}
                    onClick={() => { setActiveTab("requirements"); document.getElementById("game-requirements-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                >
                    Requirements
                </button>

                <button
                    type="button"
                    className={activeTab === "reviews" ? "active" : ""}
                    onClick={() => { setActiveTab("reviews"); document.getElementById("game-reviews-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                >
                    Reviews
                </button>
            </nav>

            <section className="game-layout" id="game-overview">
                    <div className="game-gallery">
                        <div className="game-main-image">
                            {currentImage ? (
                                <img
                                    key={currentImage.src}
                                    src={currentImage.src}
                                    alt={`${game.title} screenshot`}
                                    onError={() => {
                                        setFailedImages((previous) =>
                                            previous.includes(currentImage.id)
                                                ? previous
                                                : [...previous, currentImage.id]
                                        );
                                    }}
                                />
                            ) : game.poster ? (
                                <img
                                    src={game.poster}
                                    alt={`${game.title} poster`}
                                />
                            ) : (
                                <div className="game-image-placeholder">
                                    <FontAwesomeIcon icon={faGamepad} />
                                    <span>No screenshots available</span>
                                </div>
                            )}

                            {mediaImages.length > 1 && currentImage && (
                                <>
                                    <button
                                        type="button"
                                        className="gallery-arrow gallery-arrow-left"
                                        aria-label="Previous screenshot"
                                        onClick={() => selectRelativeImage(-1)}
                                    >
                                        <FontAwesomeIcon icon={faChevronLeft} />
                                    </button>

                                    <button
                                        type="button"
                                        className="gallery-arrow gallery-arrow-right"
                                        aria-label="Next screenshot"
                                        onClick={() => selectRelativeImage(1)}
                                    >
                                        <FontAwesomeIcon icon={faChevronRight} />
                                    </button>
                                </>
                            )}
                        </div>

                        {mediaImages.length > 1 && currentImage && (
                            <div
                                className="game-gallery-progress"
                                aria-hidden="true"
                            >
                                <span key={currentImage.id} />
                            </div>
                        )}

                        {mediaImages.length > 0 && (
                            <div className="game-thumbnails-wrapper">
                                {mediaImages.length > 1 && (
                                    <button
                                        type="button"
                                        className="thumbnail-nav"
                                        aria-label="Scroll thumbnails left"
                                        onClick={() => scrollThumbnails(-1)}
                                    >
                                        <FontAwesomeIcon icon={faChevronLeft} />
                                    </button>
                                )}

                                <div
                                    ref={thumbnailsRef}
                                    className="game-thumbnails"
                                    aria-label="Game screenshots"
                                >
                                    {mediaImages.map((image, index) => (
                                        <button
                                            key={image.id}
                                            type="button"
                                            className={
                                                currentImage?.id === image.id
                                                    ? "selected"
                                                    : ""
                                            }
                                            onClick={() =>
                                                setSelectedImage(image.id)
                                            }
                                            aria-label={`Show screenshot ${index + 1}`}
                                            aria-pressed={
                                                currentImage?.id === image.id
                                            }
                                        >
                                            <img
                                                src={image.src}
                                                alt={`${game.title} screenshot ${index + 1}`}
                                                loading="lazy"
                                            />
                                        </button>
                                    ))}
                                </div>

                                {mediaImages.length > 1 && (
                                    <button
                                        type="button"
                                        className="thumbnail-nav"
                                        aria-label="Scroll thumbnails right"
                                        onClick={() => scrollThumbnails(1)}
                                    >
                                        <FontAwesomeIcon icon={faChevronRight} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <aside className="game-sidebar">
                        <div className="game-logo">
                            {game.game_poster ? (
                                <img
                                    src={game.game_poster}
                                    alt={`${game.title} logo`}
                                />
                            ) : (
                                <h2>{game.title}</h2>
                            )}
                        </div>

                        <div className="game-info-card">
                            <span className="game-info-label">
                                GAME DETAILS
                            </span>

                            <div>
                                <span>
                                    <FontAwesomeIcon icon={faGamepad} /> Platform
                                </span>

                                <strong className="game-platform-value">
                                    {[
                                        "pc",
                                        "windows",
                                        "computer",
                                    ].includes(
                                        String(game.platform || "")
                                            .trim()
                                            .toLowerCase()
                                    ) ? (
                                        <FontAwesomeIcon
                                            icon={faWindows}
                                            title="Windows"
                                            aria-label="Windows"
                                        />
                                    ) : [
                                          "ps",
                                          "playstation",
                                          "ps3",
                                          "ps4",
                                          "ps5",
                                      ].includes(
                                          String(game.platform || "")
                                              .trim()
                                              .toLowerCase()
                                      ) ? (
                                        <FontAwesomeIcon
                                            icon={faPlaystation}
                                            title="PlayStation"
                                            aria-label="PlayStation"
                                        />
                                    ) : (
                                        game.platform || "N/A"
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    <FontAwesomeIcon icon={faTag} /> Genre
                                </span>
                                <strong>
                                    {getGameCategories(game).join(", ") || "N/A"}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    <FontAwesomeIcon icon={faCodeBranch} /> Version
                                </span>
                                <strong>{game.version || "N/A"}</strong>
                            </div>

                            <div>
                                <span>
                                    <FontAwesomeIcon icon={faHdd} /> Size
                                </span>
                                <strong>{game.size || "N/A"}</strong>
                            </div>

                            <div>
                                <span>
                                    <FontAwesomeIcon icon={faBuilding} /> Publisher
                                </span>
                                <strong>{game.publisher || "N/A"}</strong>
                            </div>
                            <div>
                                <span><FontAwesomeIcon icon={faDownload} aria-hidden="true" /> Download type</span>
                                <strong>{game.fileType ? String(game.fileType).replace(/^\w/, (letter) => letter.toUpperCase()) : "Torrent"}</strong>
                            </div>

                            <div>
                                <span><FontAwesomeIcon icon={game.availability === false ? faCircleXmark : faCircleCheck} aria-hidden="true" /> Availability</span>
                                <strong className={game.availability === false ? "game-availability-unavailable" : "game-availability-available"}>
                                    {game.availability === false ? "Currently unavailable" : "Available to download"}
                                </strong>
                            </div>

                        </div>

                        <div className="game-actions-row">
                            {game.availability !== false && game.gameLink ? (
                                window.gameonixDesktop && String(game.fileType || "torrent").toLowerCase() === "torrent" ? (
                                    <button
                                        type="button"
                                        className="game-action game-download"
                                        onClick={startDesktopDownload}
                                        disabled={downloadStarting}
                                    >
                                        <FontAwesomeIcon icon={faDownload} />
                                        {downloadStarting ? "Starting download..." : "Download Game"}
                                    </button>
                                ) : (
                                <a
                                    className="game-action game-download"
                                    href={game.gameLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => { void recordGameActivity(game.slug, "download").catch(() => {}); }}
                                >
                                    <FontAwesomeIcon icon={faDownload} />
                                    Download Game
                                </a>
                                )
                            ) : (
                                <button
                                    type="button"
                                    className="game-action game-download"
                                    disabled
                                >
                                    <FontAwesomeIcon icon={faDownload} />
                                    {game.availability === false
                                        ? "Currently unavailable"
                                        : "Download unavailable"}
                                </button>
                            )}

                            <div className="favorite-button-wrapper">
                                <button
                                    type="button"
                                    className={`game-favorite-icon ${
                                        isFavorite ? "is-favorite" : ""
                                    }`}
                                    onClick={toggleFavorite}
                                    disabled={favoriteBusy}
                                    aria-label={
                                        isFavorite
                                            ? "Remove from favorites"
                                            : "Add to favorites"
                                    }
                                    aria-pressed={isFavorite}
                                    title={
                                        !favoritesLoaded
                                            ? "Loading favorites..."
                                            : isFavorite
                                              ? "Saved to Favorites"
                                              : "Add to Favorites"
                                    }
                                >
                                    <FontAwesomeIcon icon={faHeart} />
                                </button>

                                {showFavoriteMessage && (
                                    <div
                                        className="favorite-login-message"
                                        role="alert"
                                    >
                                        <span>
                                            Please log in to view and manage favorites.
                                        </span>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                setShowFavoriteMessage(false)
                                            }
                                            aria-label="Dismiss message"
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="favorite-button-wrapper">
                                <button type="button" className={`game-follow-button${follows.some((item) => item.slug === game.slug) ? " is-following" : ""}`} onClick={toggleFollow} disabled={followBusy} aria-pressed={follows.some((item) => item.slug === game.slug)}>
                                    <FontAwesomeIcon icon={faBell} /> {follows.some((item) => item.slug === game.slug) ? "Following" : "Follow updates"}
                                </button>
                                {showFollowLoginMessage && <div className="favorite-login-message" role="alert"><span>Please log in to follow this game.</span><button type="button" onClick={() => setShowFollowLoginMessage(false)} aria-label="Dismiss message">×</button></div>}
                            </div>
                        </div>

                        {favoriteError && (
                            <p className="favorite-error" role="alert">
                                {favoriteError}
                            </p>
                        )}
                        {followError && <p className="favorite-error" role="alert">{followError}</p>}
                        <button
                            type="button"
                            className="game-action game-report"
                            onClick={reportBug}
                        >
                            <FontAwesomeIcon icon={faBug} />
                            Report a Bug
                        </button>

                        <p className="game-sidebar-note">
                            Check the game details before downloading.
                        </p>
                    </aside>
            </section>
            <section className="game-scroll-section" id="game-addons-section">
                <div className="game-scroll-heading"><span>MORE TO PLAY</span><h2>Extra content</h2><p>Expansions, DLC, and bonus content for {game.title}.</p></div>
                <AddonsPanel addons={addons} />
            </section>
            <section className="game-scroll-section" id="game-requirements-section">
                <RequirementsPanel game={game} />
            </section>
            <section className="game-scroll-section" id="game-reviews-section">
                <div className="game-scroll-heading"><span>PLAYER COMMUNITY</span><h2>Reviews and ratings</h2><p>See what players think and share your experience.</p></div>
                <GameReviews slug={game.slug} title={game.title} />
            </section>
            {relatedGames.length > 0 && (
                <section className="game-related-section" aria-labelledby="game-related-title">
                    <div className="game-related-heading">
                        <div>
                            <span><FontAwesomeIcon icon={faCompass} aria-hidden="true" /> KEEP EXPLORING</span>
                            <h2 id="game-related-title">More like this</h2>
                        </div>
                        <p>Games with similar genres and platforms</p>
                    </div>
                    <div className="game-related-grid">
                        {relatedGames.map((relatedGame) => (
                            <GameCard key={relatedGame.slug} game={relatedGame} />
                        ))}
                    </div>
                </section>
            )}
        </main>
        {downloadDialogOpen && createPortal(
            <div className="game-download-overlay" onMouseDown={(event) => {
                if (event.target === event.currentTarget) void closeDownloadDialog();
            }}>
                <section className="game-download-dialog" role="dialog" aria-modal="true" aria-labelledby="game-download-title">
                    <header className="game-download-dialog-header">
                        <span className="game-download-dialog-icon"><FontAwesomeIcon icon={faDownload} /></span>
                        <div><span>GAMEONIX DOWNLOAD</span><h2 id="game-download-title">{game.title}</h2><p>Choose which files to save on this device.</p></div>
                        <button type="button" className="game-download-close" onClick={() => void closeDownloadDialog()} disabled={downloadDialogBusy} aria-label="Close file selection"><FontAwesomeIcon icon={faXmark} /></button>
                    </header>

                    {downloadDialogError && <p className="game-download-error" role="alert">{downloadDialogError}</p>}

                    {existingDownloadStatus === "completed" ? (
                        <div className="game-download-existing">
                            <FontAwesomeIcon icon={faCircleCheck} />
                            <div><strong>This game is already on your device</strong><span>Your downloaded files are saved in the GameOnix download folder.</span></div>
                        </div>
                    ) : existingDownloadStatus === "downloading" ? (
                        <div className="game-download-existing">
                            <span className="game-download-live-dot" />
                            <div><strong>This game is already downloading</strong><span>Open Downloads to see progress or pause it.</span></div>
                        </div>
                    ) : ["paused", "error"].includes(existingDownloadStatus) ? (
                        <div className="game-download-existing">
                            <span className="game-download-live-dot is-paused" />
                            <div><strong>{existingDownloadStatus === "paused" ? "This download is paused" : "This download needs attention"}</strong><span>Resume it to continue with the files you previously selected.</span></div>
                        </div>
                    ) : downloadFiles.length ? (
                        <>
                            <div className="game-download-file-tools"><span>{downloadFiles.length} files in this torrent</span><div><button type="button" onClick={() => setDownloadDialogFiles(downloadFiles.map((_, index) => index))}>Select all</button><button type="button" onClick={() => setDownloadDialogFiles([])}>Clear</button></div></div>
                            <div className="game-download-file-list" role="group" aria-label="Choose game files">
                                {downloadFiles.map((file, index) => (
                                    <label className="game-download-file-row" key={`${file.name}-${index}`}>
                                        <input type="checkbox" checked={selectedDownloadFiles.includes(index)} onChange={(event) => setDownloadDialogFiles((current) => {
                                            const next = new Set(current || downloadFiles.map((_, fileIndex) => fileIndex));
                                            if (event.target.checked) next.add(index); else next.delete(index);
                                            return [...next].sort((left, right) => left - right);
                                        })} />
                                        <span className="game-download-file-check" aria-hidden="true" />
                                        <span className="game-download-file-name" title={file.name}>{file.name}</span>
                                        <small>{formatDownloadBytes(file.length)}</small>
                                    </label>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="game-download-loading"><span className="game-download-spinner" /><strong>Reading torrent contents…</strong><p>The file list will appear here as soon as it is ready.</p></div>
                    )}

                    <footer className="game-download-dialog-footer">
                        <div className="game-download-selected-size"><span>{downloadFiles.length && ["selecting", "starting"].includes(existingDownloadStatus) ? `${selectedDownloadFiles.length} of ${downloadFiles.length} files selected` : "Download location"}</span><strong title={downloadTargetDirectory}>{downloadFiles.length && ["selecting", "starting"].includes(existingDownloadStatus) ? formatDownloadBytes(selectedDownloadSize) : (downloadTargetDirectory || "Chosen in Settings")}</strong></div>
                        <div className="game-download-dialog-actions">
                            {downloadDialogInfo?.status === "completed" && <button type="button" className="game-download-secondary" onClick={() => void window.gameonixDesktop.downloads.openFolder(downloadDialogId)} disabled={downloadDialogBusy}><FontAwesomeIcon icon={faFolderOpen} /> Open game folder</button>}
                            {downloadDialogInfo && (downloadDialogInfo.status === "completed" || Number(downloadDialogInfo.downloaded) > 0) && <button type="button" className="game-download-remove" onClick={() => void removeGameFromDevice()} disabled={downloadDialogBusy}><FontAwesomeIcon icon={faTrash} /> Remove game and files from device</button>}
                            {["paused", "error"].includes(downloadDialogInfo?.status) && <button type="button" className="game-download-start" onClick={() => void resumeExistingDownload()} disabled={downloadDialogBusy}>{downloadDialogBusy ? "Resuming…" : "Resume download"}</button>}
                            {downloadDialogInfo?.status === "downloading" && <button type="button" className="game-download-start" onClick={() => { setDownloadDialogOpen(false); navigate("/downloads"); }}>Open Downloads</button>}
                            {downloadDialogInfo?.status === "completed" && <button type="button" className="game-download-start" onClick={() => { setDownloadDialogOpen(false); navigate("/downloads"); }}>Go to Downloads</button>}
                            {!["downloading", "paused", "error", "completed"].includes(downloadDialogInfo?.status) && <button type="button" className="game-download-start" onClick={() => void beginSelectedDownload()} disabled={downloadDialogBusy || !downloadFiles.length || !selectedDownloadFiles.length}>{downloadDialogBusy ? "Starting…" : `Start download${selectedDownloadSize ? ` · ${formatDownloadBytes(selectedDownloadSize)}` : ""}`}</button>}
                        </div>
                    </footer>
                </section>
            </div>,
            document.body
        )}
        {reportOpen &&
            createPortal(
                <div
                    className="game-report-overlay"
                    onMouseDown={(event) => {
                        if (
                            event.target === event.currentTarget &&
                            !reportSubmitting
                        ) {
                            setReportOpen(false);
                        }
                    }}
                >
                    <section
                        className="game-report-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="game-report-title"
                    >
                        <button
                            type="button"
                            className="game-report-close"
                            onClick={() => setReportOpen(false)}
                            disabled={reportSubmitting}
                            aria-label="Close report form"
                        >
                            <FontAwesomeIcon icon={faXmark} />
                        </button>

                        {reportSubmitted ? (
                            <div className="game-report-success">
                                <span className="game-report-dialog-icon">
                                    <FontAwesomeIcon icon={faBug} />
                                </span>
                                <h2 id="game-report-title">Report received</h2>
                                <p>
                                    Thanks for letting us know. We’ll review your
                                    report and notify you here and by email when
                                    we reply.
                                </p>
                                <button
                                    type="button"
                                    className="game-report-submit"
                                    onClick={() => setReportOpen(false)}
                                >
                                    Done
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="game-report-dialog-heading">
                                    <span className="game-report-dialog-icon">
                                        <FontAwesomeIcon icon={faBug} />
                                    </span>
                                    <div>
                                        <span>GAMEONIX SUPPORT</span>
                                        <h2 id="game-report-title">
                                            Report a problem
                                        </h2>
                                        <p>
                                            Game and account details are attached
                                            automatically.
                                        </p>
                                    </div>
                                </div>

                                <div className="game-report-context">
                                    {[
                                        ["Game", game.title],
                                        ["Version", game.version || "Not listed"],
                                        ["Platform", game.platform || "Not listed"],
                                        [
                                            "Categories",
                                            getGameCategories(game).join(", ") ||
                                                "Not listed",
                                        ],
                                        ["Publisher", game.publisher || "Not listed"],
                                        ["Game size", game.size || "Not listed"],
                                        ["Download type", game.fileType || "Not listed"],
                                        ["Username", user ? `@${user.username}` : "Sign in required"],
                                        ["Account email", user?.email || "Email not available on account"],
                                    ]
                                        .map(([label, value]) => (
                                            <div
                                                className="game-report-context-row"
                                                key={label}
                                            >
                                                <span>{label}</span>
                                                <strong>{value}</strong>
                                            </div>
                                        ))}
                                </div>

                                {!user ? (
                                    <div className="game-report-login">
                                        <p>
                                            Sign in first so we can attach your
                                            account and send you a reply.
                                        </p>
                                        <Link
                                            to="/login"
                                            onClick={() => setReportOpen(false)}
                                        >
                                            Sign in to continue
                                        </Link>
                                    </div>
                                ) : (
                                    <form
                                        className="game-report-form"
                                        onSubmit={submitBugReport}
                                    >
                                        <label htmlFor="game-report-description">
                                            What went wrong?
                                        </label>
                                        <textarea
                                            ref={reportDescriptionRef}
                                            id="game-report-description"
                                            value={reportDescription}
                                            onChange={(event) =>
                                                setReportDescription(
                                                    event.target.value
                                                )
                                            }
                                            maxLength={1500}
                                            minLength={10}
                                            placeholder="Describe what happened and how we can reproduce it..."
                                            required
                                        />
                                        <div className="game-report-form-footer">
                                            {reportError && (
                                                <p role="alert">{reportError}</p>
                                            )}
                                            <span>
                                                {reportDescription.length}/1500
                                            </span>
                                        </div>
                                        <button
                                            type="submit"
                                            className="game-report-submit"
                                            disabled={reportSubmitting}
                                        >
                                            <FontAwesomeIcon icon={faBug} />
                                            {reportSubmitting
                                                ? "Sending report..."
                                                : "Send private report"}
                                        </button>
                                    </form>
                                )}
                            </>
                        )}
                    </section>
                </div>,
                document.body
            )}
        </>
    );
}

export default GameDetails;
