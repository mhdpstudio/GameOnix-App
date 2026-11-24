import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faCheck, faClock, faDownload, faFolderOpen, faPause, faPlay, faTrash, faWifi } from "@fortawesome/free-solid-svg-icons";
import { useDialog } from "../context/DialogContext";
import "../style/downloads-style.css";

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; }
  return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "Calculating time";
  const value = Math.round(seconds);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  if (days) return `${days}d ${hours}h remaining`;
  if (hours) return `${hours}h ${minutes}m remaining`;
  if (minutes) return `${minutes}m ${remaining}s remaining`;
  return `${remaining}s remaining`;
}

function statusLabel(status) {
  return ({ selecting: "Choose files", starting: "Connecting", downloading: "Downloading", "waiting-for-download": "Ready to start", finalizing: "Finishing files", paused: "Paused", completed: "Complete", cancelled: "Cancelled", error: "Needs attention" })[status] || "Waiting";
}

function peerDiscoveryHint(item) {
  if (item.peers > 0) return "";
  if (item.discoveryWarning) return `Network notice: ${item.discoveryWarning}`;
  const trackerCount = Number(item.trackerCount) || 0;
  const lastTrackerResponse = item.trackerLastAnnounceAt
    ? `Last tracker response ${new Date(item.trackerLastAnnounceAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. `
    : "";
  if (item.privateTorrent) {
    return `${lastTrackerResponse}${trackerCount ? `Checking ${trackerCount} listed trackers` : "Waiting for the torrent’s listed trackers"} for peers.`;
  }
  const methods = item.peerSearchSources?.length
    ? item.peerSearchSources.map((source) => ({ tracker: "trackers", dht: "DHT", lsd: "local network", ut_pex: "peer exchange" })[source] || source).join(", ")
    : "trackers, DHT, and peer exchange";
  return `${lastTrackerResponse}Searching ${trackerCount || "available"} trackers and ${methods} for peers.`;
}

export default function Downloads() {
  const [items, setItems] = useState([]);
  const [directItems, setDirectItems] = useState([]);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [fileChoices, setFileChoices] = useState({});
  const desktop = window.gameonixDesktop;
  const { confirmWithCheckbox } = useDialog();

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const [nextItems, nextDirectItems, nextFolder] = await Promise.all([desktop.downloads.list(), desktop.downloads.directList(), desktop.downloads.getDirectory()]);
      setItems(nextItems);
      setDirectItems(nextDirectItems);
      setFolder(nextFolder);
      setError("");
    } catch (reason) {
      setError(reason.message || "Could not load downloads.");
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return undefined;
    const unsubscribe = desktop.downloads.onUpdate(setItems);
    const unsubscribeDirect = desktop.downloads.onDirectUpdate(setDirectItems);
    void refresh();
    return () => { unsubscribe(); unsubscribeDirect(); };
  }, [desktop, refresh]);

  const activeCount = useMemo(() => items.filter((item) => ["downloading", "starting", "finalizing"].includes(item.status)).length + directItems.filter((item) => ["downloading", "waiting-for-download"].includes(item.status)).length, [items, directItems]);
  const completedCount = useMemo(() => items.filter((item) => item.status === "completed").length + directItems.filter((item) => item.status === "completed").length, [items, directItems]);

  async function runAction(id, action) {
    setBusyId(id);
    setError("");
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason.message || "The download action failed.");
    } finally {
      setBusyId("");
    }
  }

  async function removeDownload(item, isDirect = false) {
    const answer = await confirmWithCheckbox({
      title: "Remove this download?",
      message: `Remove ${item.title} from your downloads? You can choose whether its files should also be deleted from this device.`,
      checkboxLabel: "Also delete downloaded files from this device",
      checkboxChecked: false,
      confirmLabel: "Remove download",
      danger: true,
    });
    if (!answer?.confirmed) return;
    await runAction(item.id, () => isDirect ? desktop.downloads.directRemove(item.id, answer.checked) : desktop.downloads.remove(item.id, answer.checked));
  }

  if (!desktop) return <main className="downloads-page"><section className="downloads-empty"><FontAwesomeIcon icon={faDownload} /><h1>Downloads are available in GameOnix Desktop</h1><p>Install the GameOnix app to download games and track their progress here.</p><Link to="/games">Browse games</Link></section></main>;

  return <main className="downloads-page">
    <header className="downloads-heading"><div><span className="downloads-eyebrow">GAMEONIX DESKTOP</span><h1>Downloads</h1><p>Track game downloads and find completed files in one place.</p></div><Link to="/settings" className="downloads-folder-button"><FontAwesomeIcon icon={faFolderOpen} /> Manage download settings</Link></header>
    <section className="downloads-summary"><article><span>Active downloads</span><strong>{activeCount}</strong></article><article><span>Completed</span><strong>{completedCount}</strong></article><article className="downloads-location"><span>Save location</span><strong title={folder}>{folder || "Loading..."}</strong></article></section>
    {error && <div className="downloads-error" role="alert">{error}</div>}
    {!items.length && !directItems.length ? <section className="downloads-empty"><span className="downloads-empty-icon"><FontAwesomeIcon icon={faArrowDown} /></span><h2>Your downloads will show here</h2><p>Start a game download and follow its progress here.</p><Link to="/games">Browse games</Link></section> : <section className="downloads-list" aria-label="Download list">
      {directItems.map((item) => {
        const percent = Math.min(100, Math.max(0, Number(item.progress) * 100));
        const isBusy = busyId === item.id;
        const active = ["downloading", "waiting-for-download"].includes(item.status);
        return <article className={`download-card is-${item.status}`} key={`direct-${item.id}`}>
          <div className="download-card-top"><span className={`download-status status-${item.status}`}><i />{statusLabel(item.status)}</span><strong>{percent.toFixed(1)}%</strong></div>
          <h2>{item.title}</h2>
          {item.status === "waiting-for-download" && <p className="download-peer-discovery">The link is preparing in the background. Press Start download if the file does not begin automatically.</p>}
          {item.error && <p className="download-card-error">{item.error}</p>}
          <div className="download-progress"><span style={{ width: `${percent}%` }} /></div>
          <div className="download-meta"><span>{formatBytes(item.downloaded)} of {item.total ? formatBytes(item.total) : "—"}</span>{item.status === "downloading" && <span><FontAwesomeIcon icon={faArrowDown} /> {formatBytes(item.speed)}/s</span>}{item.status === "downloading" && <span><FontAwesomeIcon icon={faClock} /> {formatDuration(item.etaSeconds)}</span>}</div>
          <div className="download-card-actions">
            {item.status === "waiting-for-download" && <button type="button" className="is-primary" onClick={() => void runAction(item.id, () => desktop.downloads.directStartPage(item.id))} disabled={isBusy}><FontAwesomeIcon icon={faPlay} /> Start download</button>}
            {item.status === "downloading" && <button type="button" onClick={() => void runAction(item.id, () => desktop.downloads.directPause(item.id))} disabled={isBusy}><FontAwesomeIcon icon={faPause} /> Pause</button>}
            {item.status === "paused" && <button type="button" className="is-primary" onClick={() => void runAction(item.id, () => desktop.downloads.directResume(item.id))} disabled={isBusy}><FontAwesomeIcon icon={faPlay} /> Resume</button>}
            {item.status === "completed" && <button type="button" className="is-primary" onClick={() => void runAction(item.id, () => desktop.downloads.directOpen(item.id))}><FontAwesomeIcon icon={faFolderOpen} /> Open file</button>}
            {item.status === "completed" && <span className="download-complete-label"><FontAwesomeIcon icon={faCheck} /> Ready</span>}
            {["error", "cancelled"].includes(item.status) && <button type="button" className="is-primary" onClick={() => void runAction(item.id, () => desktop.downloads.directStart({ slug: item.slug, title: item.title, url: item.sourceUrl }))} disabled={isBusy}><FontAwesomeIcon icon={faPlay} /> Try again</button>}
            <button type="button" className="download-remove-button" onClick={() => void removeDownload(item, true)} disabled={isBusy}><FontAwesomeIcon icon={faTrash} /> Remove</button>
          </div>
        </article>;
      })}
      {items.map((item) => {
      const percent = Math.min(100, Math.max(0, Number(item.progress) * 100));
      const isBusy = busyId === item.id;
      const selectedFiles = fileChoices[item.id] ?? item.selectedFiles ?? [];
      return <article className={`download-card is-${item.status}`} key={item.id}>
        <div className="download-card-top"><span className={`download-status status-${item.status}`}><i />{statusLabel(item.status)}</span><strong>{percent.toFixed(1)}%</strong></div>
        <h2>{item.title}</h2>
        {item.status === "selecting" && <section className="download-file-picker" aria-label={`Choose files for ${item.title}`}><strong>Choose files to download</strong>{item.files?.length ? item.files.map((file, index) => <label key={`${file.name}-${index}`}><input type="checkbox" checked={selectedFiles.includes(index)} onChange={(event) => setFileChoices((current) => { const next = new Set(current[item.id] ?? item.selectedFiles ?? []); event.target.checked ? next.add(index) : next.delete(index); return { ...current, [item.id]: [...next] }; })} /><span>{file.name}</span><small>{formatBytes(file.length)}</small></label>) : <p>Reading torrent file list…</p>}<button type="button" className="is-primary" disabled={isBusy || !item.files?.length || !selectedFiles.length} onClick={() => void runAction(item.id, () => desktop.downloads.begin(item.id, selectedFiles))}><FontAwesomeIcon icon={faDownload} /> Download selected files</button></section>}
        {item.error && <p className="download-card-error">{item.error}</p>}
        <div className="download-progress"><span style={{ width: `${percent}%` }} /></div>
        <div className="download-meta"><span>{formatBytes(item.downloaded)} of {item.total ? formatBytes(item.total) : "—"}</span><span><FontAwesomeIcon icon={faWifi} /> {item.peers} peers</span>{item.status === "downloading" && <span><FontAwesomeIcon icon={faArrowDown} /> {formatBytes(item.speed)}/s</span>}{item.status === "downloading" && <span><FontAwesomeIcon icon={faClock} /> {formatDuration(item.etaSeconds)}</span>}</div>
        {!["paused", "completed", "finalizing", "error", "selecting"].includes(item.status) && peerDiscoveryHint(item) && <p className="download-peer-discovery">{peerDiscoveryHint(item)}</p>}
        <div className="download-card-actions">
          {item.status === "downloading" || item.status === "starting" ? <button type="button" onClick={() => void runAction(item.id, () => desktop.downloads.pause(item.id))} disabled={isBusy}><FontAwesomeIcon icon={faPause} /> Pause</button> : ["paused", "error"].includes(item.status) && <button type="button" className="is-primary" onClick={() => void runAction(item.id, () => desktop.downloads.resume(item.id))} disabled={isBusy}><FontAwesomeIcon icon={faPlay} /> Resume</button>}
          {item.status === "completed" && <button type="button" className="is-primary" onClick={() => void desktop.downloads.openFolder(item.id)}><FontAwesomeIcon icon={faFolderOpen} /> Open folder</button>}
          {item.status === "completed" && <span className="download-complete-label"><FontAwesomeIcon icon={faCheck} /> Ready</span>}
          <button type="button" className="download-remove-button" onClick={() => void removeDownload(item)} disabled={isBusy || item.status === "finalizing"}><FontAwesomeIcon icon={faTrash} /> Remove</button>
        </div>
      </article>;
    })}</section>}
    <p className="downloads-stability-note">Speed and remaining time use a rolling 6-second average to reduce display jumps. Actual torrent speeds depend on available peers and your connection.</p>
  </main>;
}
