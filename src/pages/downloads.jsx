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
  return ({ selecting: "Choose files", starting: "Connecting", downloading: "Downloading", paused: "Paused", completed: "Complete", error: "Needs attention" })[status] || "Waiting";
}

export default function Downloads() {
  const [items, setItems] = useState([]);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [fileChoices, setFileChoices] = useState({});
  const desktop = window.gameonixDesktop;
  const { confirmWithCheckbox } = useDialog();

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const [nextItems, nextFolder] = await Promise.all([desktop.downloads.list(), desktop.downloads.getDirectory()]);
      setItems(nextItems);
      setFolder(nextFolder);
      setError("");
    } catch (reason) {
      setError(reason.message || "Could not load downloads.");
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return undefined;
    const unsubscribe = desktop.downloads.onUpdate(setItems);
    void refresh();
    return unsubscribe;
  }, [desktop, refresh]);

  const activeCount = useMemo(() => items.filter((item) => ["downloading", "starting"].includes(item.status)).length, [items]);
  const completedCount = useMemo(() => items.filter((item) => item.status === "completed").length, [items]);

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

  async function removeDownload(item) {
    const answer = await confirmWithCheckbox({
      title: "Remove this download?",
      message: `Remove ${item.title} from your downloads? You can choose whether its files should also be deleted from this device.`,
      checkboxLabel: "Also delete downloaded files from this device",
      checkboxChecked: false,
      confirmLabel: "Remove download",
      danger: true,
    });
    if (!answer?.confirmed) return;
    await runAction(item.id, () => desktop.downloads.remove(item.id, answer.checked));
  }

  if (!desktop) return <main className="downloads-page"><section className="downloads-empty"><FontAwesomeIcon icon={faDownload} /><h1>Downloads are available in GameOnix Desktop</h1><p>Install the GameOnix app to download torrents and track their progress here.</p><Link to="/games">Browse games</Link></section></main>;

  return <main className="downloads-page">
    <header className="downloads-heading"><div><span className="downloads-eyebrow">GAMEONIX DESKTOP</span><h1>Downloads</h1><p>Track active torrents and find completed games in one place.</p></div><Link to="/settings" className="downloads-folder-button"><FontAwesomeIcon icon={faFolderOpen} /> Manage download settings</Link></header>
    <section className="downloads-summary"><article><span>Active downloads</span><strong>{activeCount}</strong></article><article><span>Completed</span><strong>{completedCount}</strong></article><article className="downloads-location"><span>Save location</span><strong title={folder}>{folder || "Loading..."}</strong></article></section>
    {error && <div className="downloads-error" role="alert">{error}</div>}
    {!items.length ? <section className="downloads-empty"><span className="downloads-empty-icon"><FontAwesomeIcon icon={faArrowDown} /></span><h2>Your downloads will show here</h2><p>Open a game page and choose <strong>Download Game</strong> to start its torrent.</p><Link to="/games">Browse games</Link></section> : <section className="downloads-list" aria-label="Download list">{items.map((item) => {
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
        <div className="download-card-actions">
          {item.status === "downloading" || item.status === "starting" ? <button type="button" onClick={() => void runAction(item.id, () => desktop.downloads.pause(item.id))} disabled={isBusy}><FontAwesomeIcon icon={faPause} /> Pause</button> : ["paused", "error"].includes(item.status) && <button type="button" className="is-primary" onClick={() => void runAction(item.id, () => desktop.downloads.resume(item.id))} disabled={isBusy}><FontAwesomeIcon icon={faPlay} /> Resume</button>}
          {item.status === "completed" && <button type="button" className="is-primary" onClick={() => void desktop.downloads.openFolder(item.id)}><FontAwesomeIcon icon={faFolderOpen} /> Open folder</button>}
          {item.status === "completed" && <span className="download-complete-label"><FontAwesomeIcon icon={faCheck} /> Ready</span>}
          <button type="button" className="download-remove-button" onClick={() => void removeDownload(item)} disabled={isBusy}><FontAwesomeIcon icon={faTrash} /> Remove</button>
        </div>
      </article>;
    })}</section>}
    <p className="downloads-stability-note">Speed and remaining time use a rolling 6-second average to reduce display jumps. Actual torrent speeds depend on available peers and your connection.</p>
  </main>;
}
