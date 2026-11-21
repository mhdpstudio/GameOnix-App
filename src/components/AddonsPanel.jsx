import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faBoxOpen,
    faDownload,
} from "@fortawesome/free-solid-svg-icons";

import {
    getAddonFileKind,
    getAddonHost,
    getAddonInitials,
    getAddonLink,
    getAddonList,
    getAddonTotalSize,
    getAddonType,
} from "../utils/addons";
import "../style/addons.css";

function AddonLogo({ addon, single }) {
    const [failed, setFailed] = useState(false);

    const logo = typeof addon.logo === "string" ? addon.logo.trim() : "";
    const showLogo = Boolean(logo) && !failed;

    return (
        <span
            className={`addon-logo ${
                showLogo ? "has-image" : "has-initials"
            }`}
        >
            {showLogo ? (
                <img
                    src={logo}
                    alt=""
                    loading="lazy"
                    onError={() => setFailed(true)}
                />
            ) : (
                <span
                    className="addon-logo-initials"
                    aria-hidden="true"
                    data-size={single ? "lg" : "sm"}
                >
                    {getAddonInitials(addon.name)}
                </span>
            )}
        </span>
    );
}

function AddonCard({ addon, single }) {
    const name = String(addon.name || "").trim();
    const link = getAddonLink(addon.link);
    const type = getAddonType(addon.type);
    const host = getAddonHost(link);
    const fileKind = getAddonFileKind(link);
    const size = String(addon.size || "").trim();
    const description = String(addon.description || "").trim();

    return (
        <article className={`addon-card${single ? " is-single" : ""}`}>
            <div className="addon-card-identity">
                <AddonLogo addon={addon} single={single} />

                <div className="addon-card-copy">
                    <div className="addon-card-title">
                        <h3>{addon.name}</h3>

                        {type && (
                            <span className={`addon-type is-${type.tone}`}>
                                {type.label}
                            </span>
                        )}
                    </div>

                    {description && (
                        <p className="addon-description">{description}</p>
                    )}

                    {(size || fileKind) && (
                        <p className="addon-specs">
                            {size && <span className="addon-size">{size}</span>}
                            {fileKind && (
                                <span className="addon-file-kind">
                                    {fileKind}
                                </span>
                            )}
                        </p>
                    )}
                </div>
            </div>

            <div className="addon-card-action">
                {link ? (
                    <a
                        className="addon-download"
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Download ${name}${
                            size ? ` (${size})` : ""
                        } from ${host.label}`}
                    >
                        <FontAwesomeIcon
                            icon={faDownload}
                            className="addon-download-icon"
                            aria-hidden="true"
                        />
                        <span>Download</span>
                    </a>
                ) : (
                    <span className="addon-download is-unavailable">
                        No download link
                    </span>
                )}
            </div>
        </article>
    );
}

export default function AddonsPanel({ addons = [] }) {
    const list = getAddonList(addons);
    const totalSize = getAddonTotalSize(list);
    const isSingle = list.length === 1;

    return (
        <section className="addons-panel" aria-labelledby="addons-title">
            <header className="addons-head">
                <h2 id="addons-title">Add-Ons</h2>

                {list.length > 0 && (
                    <p className="addons-summary">
                        <span>
                            {list.length}{" "}
                            {list.length === 1 ? "package" : "packages"}
                        </span>

                        {list.length > 1 && totalSize && (
                            <span className="addons-total">
                                {totalSize} total
                            </span>
                        )}
                    </p>
                )}
            </header>

            {list.length === 0 ? (
                <div className="addons-empty">
                    <span className="addons-empty-icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faBoxOpen} />
                    </span>

                    <div>
                        <h3>No add-on files listed</h3>
                        <p>This game is available as the base download only.</p>
                    </div>
                </div>
            ) : (
                <ul className="addons-list">
                    {list.map((addon, index) => (
                        <li key={`${addon.name}-${index}`}>
                            <AddonCard addon={addon} single={isSingle} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
