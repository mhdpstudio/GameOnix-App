// Helpers for the add-on packages listed on a game page.
//
// An add-on is a downloadable extra file for a game (a crack fix, an update,
// a DLC or a mod). The helpers here normalise the loose data coming from the
// games JSON so the UI can render a badge tone, a file host label and a
// comparable total size.

const TYPE_TONES = {
    crack: "crack",
    "crack fix": "crack",
    crackfix: "crack",
    fix: "crack",
    update: "update",
    patch: "update",
    hotfix: "update",
    dlc: "dlc",
    expansion: "dlc",
    mod: "mod",
    mods: "mod",
    trainer: "mod",
    language: "language",
    "language pack": "language",
    voice: "language",
    voices: "language",
};

const FILE_KINDS = {
    rar: "RAR archive",
    zip: "ZIP archive",
    "7z": "7Z archive",
    exe: "EXE installer",
    msi: "MSI installer",
    iso: "ISO image",
    bin: "BIN file",
    dmg: "DMG image",
    torrent: "Torrent file",
};

// Ordered by how often the hosts appear in the games data.
const FILE_HOSTS = [
    { label: "MediaFire", icon: "fire", domains: ["mediafire.com"] },
    {
        label: "MEGA",
        icon: "cloud",
        domains: ["mega.nz", "mega.io", "mega.co.nz"],
    },
    {
        label: "Google Drive",
        icon: "google-drive",
        domains: ["drive.google.com", "docs.google.com"],
    },
    {
        label: "Dropbox",
        icon: "dropbox",
        domains: ["dropbox.com", "dropboxusercontent.com"],
    },
    {
        label: "OneDrive",
        icon: "cloud",
        domains: ["1drv.ms", "onedrive.live.com"],
    },
    {
        label: "Pixeldrain",
        icon: "cloud",
        domains: ["pixeldrain.com"],
    },
];

const SIZE_UNITS = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
};

export function getAddonList(addons) {
    if (!Array.isArray(addons)) return [];

    return addons.filter(
        (addon) => addon && String(addon.name || "").trim().length > 0
    );
}

export function getAddonInitials(name) {
    const words = String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

// Returns the badge copy plus the tone that colours it, or null when the
// data does not carry a type.
export function getAddonType(type) {
    const label = String(type || "").trim();

    if (!label) return null;

    return {
        label,
        tone: TYPE_TONES[label.toLowerCase()] || "other",
    };
}

// Only http(s) links are usable, which also keeps "javascript:" style values
// out of the anchor.
export function getAddonLink(link) {
    const value = typeof link === "string" ? link.trim() : "";

    if (!value) return "";

    try {
        const url = new URL(value);

        return ["http:", "https:"].includes(url.protocol) ? value : "";
    } catch {
        return "";
    }
}

function parseUrl(link) {
    const value = getAddonLink(link);

    if (!value) return null;

    try {
        return new URL(value);
    } catch {
        return null;
    }
}

// Resolves the download host so the primary action can name where the file
// is served from: "Download from MediaFire".
export function getAddonHost(link) {
    const url = parseUrl(link);

    if (!url) return null;

    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const known = FILE_HOSTS.find((host) =>
        host.domains.some(
            (domain) =>
                hostname === domain || hostname.endsWith(`.${domain}`)
        )
    );

    if (known) {
        return { label: known.label, icon: known.icon, hostname };
    }

    return { label: hostname, icon: "link", hostname };
}

export function getAddonFileKind(link) {
    const url = parseUrl(link);

    if (!url) return "";

    const path = decodeURIComponent(url.pathname).toLowerCase();
    // Hosts often keep the file name mid-path ("/file/<id>/Name.rar/file"),
    // so look for the first archive extension instead of the last segment.
    const match = path.match(/\.([a-z0-9]{2,5})(?=[/?#]|$)/);

    if (!match) return "";

    const extension = match[1];

    return FILE_KINDS[extension] || `${extension.toUpperCase()} file`;
}

export function parseAddonSize(size) {
    const match = String(size || "")
        .trim()
        .match(/^([\d.,]+)\s*(b|kb|mb|gb|tb)$/i);

    if (!match) return 0;

    const value = Number(match[1].replace(/,/g, ""));

    if (!Number.isFinite(value) || value <= 0) return 0;

    return value * SIZE_UNITS[match[2].toLowerCase()];
}

export function formatAddonBytes(bytes) {
    if (!bytes || bytes <= 0) return "";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const formatted = value
        .toFixed(value >= 100 ? 2 : 1)
        .replace(/\.?0+$/, "");

    return `${formatted} ${units[unitIndex]}`;
}

// Combined weight of the listed packages, shown next to the package count.
export function getAddonTotalSize(addons) {
    const list = getAddonList(addons);
    const total = list.reduce(
        (sum, addon) => sum + parseAddonSize(addon.size),
        0
    );

    return total > 0 ? formatAddonBytes(total) : "";
}
