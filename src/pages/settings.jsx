import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowRotateRight, faBell, faCheck, faChevronDown, faFolderOpen, faGear, faLaptop, faRocket } from "@fortawesome/free-solid-svg-icons";
import "../style/settings-style.css";

function SwitchRow({ title, description, checked, onChange, disabled = false }) {
  return <div className="settings-switch-row">
    <div><strong>{title}</strong><p>{description}</p></div>
    <button type="button" role="switch" aria-checked={checked} className={`settings-switch${checked ? " is-on" : ""}`} onClick={() => onChange(!checked)} disabled={disabled}><span /></button>
  </div>;
}

const SPEED_LIMITS = Array.from({ length: 20 }, (_, index) => (index + 1) / 2);

function SpeedLimitRow({ title, description, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const pickerRef = useRef(null);
  const optionRefs = useRef([]);
  const options = [0, ...SPEED_LIMITS];
  const selectedIndex = Math.max(0, options.indexOf(Number(value) || 0));
  const selectedLabel = selectedIndex === 0 ? "Unlimited" : `${Number(value).toFixed(1)} MB/s`;

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function showOptions(index = selectedIndex) {
    setActiveIndex(index);
    setOpen(true);
  }

  function chooseOption(index) {
    const nextValue = options[index];
    if (nextValue !== undefined) onChange(nextValue);
    setOpen(false);
    pickerRef.current?.querySelector(".settings-speed-trigger")?.focus();
  }

  function handleOptionKeyDown(event, index) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      pickerRef.current?.querySelector(".settings-speed-trigger")?.focus();
    }
  }

  return <div className={`settings-speed-row${open ? " is-open" : ""}`}>
    <div><strong>{title}</strong><p>{description}</p></div>
    <div className={`settings-speed-picker${open ? " is-open" : ""}`} ref={pickerRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button type="button" className="settings-speed-trigger" aria-label={`${title}: ${selectedLabel}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => open ? setOpen(false) : showOptions()} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showOptions(selectedIndex);
        }
      }} disabled={disabled}>
        <span>{selectedLabel}</span><FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
      </button>
      {open && <div className="settings-speed-menu" role="listbox" aria-label={title}>
        <div className="settings-speed-menu-heading"><span>DOWNLOAD SPEED</span><small>MB/s</small></div>
        {options.map((limit, index) => {
          const selected = index === selectedIndex;
          return <div key={limit} ref={(element) => { optionRefs.current[index] = element; }} role="option" aria-selected={selected} tabIndex={activeIndex === index ? 0 : -1} className={`settings-speed-option${selected ? " is-selected" : ""}`} onFocus={() => setActiveIndex(index)} onClick={() => chooseOption(index)} onKeyDown={(event) => handleOptionKeyDown(event, index)}>
            <span className="settings-speed-option-mark">{selected && <FontAwesomeIcon icon={faCheck} aria-hidden="true" />}</span>
            <span>{limit === 0 ? "Unlimited" : `${limit.toFixed(1)} MB/s`}</span>
            {limit === 0 && <small>No speed cap</small>}
          </div>;
        })}
      </div>}
    </div>
  </div>;
}

const UPDATE_LABELS = {
  idle: "Updates are checked automatically",
  checking: "Checking GitHub for a new version…",
  current: "You're using the latest version",
  available: "A new version is available",
  downloading: "Downloading the update in GameOnix",
  ready: "Update ready to install",
  deferred: "Update ready — restart when you're finished",
  restarting: "Installing the update…",
  error: "Couldn't check or install the update",
  development: "Updates are available in the installed desktop app",
};

export default function Settings() {
  const desktop = window.gameonixDesktop;
  const [settings, setSettings] = useState(null);
  const [update, setUpdate] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refreshSettings = useCallback(async () => {
    if (!desktop) return;
    try {
      setSettings(await desktop.settings.get());
      setError("");
    } catch (reason) {
      setError(reason?.message || "Couldn't load your settings.");
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return undefined;
    void refreshSettings();
    const unsubscribe = desktop.updates.onStateChange(setUpdate);
    void desktop.updates.getState().then(setUpdate);
    return unsubscribe;
  }, [desktop, refreshSettings]);

  async function saveSettings(patch) {
    setBusy("settings");
    setError("");
    try {
      setSettings(await desktop.settings.update(patch));
    } catch (reason) {
      setError(reason?.message || "Couldn't save that setting.");
    } finally {
      setBusy("");
    }
  }

  async function chooseFolder() {
    setBusy("folder");
    setError("");
    try {
      await desktop.downloads.chooseDirectory();
      await refreshSettings();
    } catch (reason) {
      setError(reason?.message || "Couldn't change the download location.");
    } finally {
      setBusy("");
    }
  }

  async function checkUpdates() {
    setBusy("updates");
    setError("");
    try {
      setUpdate(await desktop.updates.check());
    } catch (reason) {
      setUpdate((current) => ({ ...current, status: "error", error: reason?.message || "Couldn't check for updates." }));
    } finally {
      setBusy("");
    }
  }

  async function restartForUpdate() {
    setBusy("restart-update");
    setError("");
    try {
      setUpdate(await desktop.updates.restart());
    } catch (reason) {
      setError(reason?.message || "Couldn't restart to install the update.");
    } finally {
      setBusy("");
    }
  }

  if (!desktop) return <main className="settings-page"><section className="settings-panel settings-web-fallback"><h1>Desktop settings</h1><p>These options are available in GameOnix Desktop.</p><Link to="/">Back to GameOnix</Link></section></main>;

  const updateStatus = update?.status || "idle";
  const progress = Math.max(0, Math.min(100, Number(update?.progress) || 0));
  const settingsBusy = Boolean(busy);

  return <main className="settings-page">
    <header className="settings-heading"><span className="settings-eyebrow">GAMEONIX DESKTOP</span><h1>Settings</h1><p>Set up downloads, startup, and automatic updates.</p></header>
    {error && <div className="settings-error" role="alert">{error}</div>}

    <section className="settings-panel" aria-labelledby="settings-general-title">
      <header className="settings-panel-heading"><span><FontAwesomeIcon icon={faGear} /></span><div><h2 id="settings-general-title">General</h2><p>Choose how GameOnix behaves on your PC.</p></div></header>
      <SwitchRow title="Close to the system tray" description="Clicking X hides GameOnix in the background, so downloads keep running. Use the tray icon to reopen or quit." checked={Boolean(settings?.closeToTray)} disabled={!settings || settingsBusy} onChange={(value) => void saveSettings({ closeToTray: value })} />
      <SwitchRow title="Launch when Windows starts" description="Start GameOnix when you sign in. It opens in the background when the tray option is enabled." checked={Boolean(settings?.launchAtStartup)} disabled={!settings || settingsBusy} onChange={(value) => void saveSettings({ launchAtStartup: value })} />
    </section>

    <section className="settings-panel" aria-labelledby="settings-downloads-title">
      <header className="settings-panel-heading"><span><FontAwesomeIcon icon={faArrowDown} /></span><div><h2 id="settings-downloads-title">Downloads</h2><p>Pick a save location and choose when downloads start.</p></div></header>
      <SwitchRow title="Ask before every download" description="Show a confirmation popup each time you press Download Game. Turn this off to start immediately." checked={settings?.askBeforeDownload !== false} disabled={!settings || settingsBusy} onChange={(value) => void saveSettings({ askBeforeDownload: value })} />
      <SpeedLimitRow title="Direct download speed limit" description="Maximum combined speed for all direct downloads. Measured in MB/s." value={settings?.directSpeedLimit} disabled={!settings || settingsBusy} onChange={(value) => void saveSettings({ directSpeedLimit: value })} />
      <SpeedLimitRow title="Torrent download speed limit" description="Maximum combined speed for all torrent downloads. Measured in MB/s." value={settings?.torrentSpeedLimit} disabled={!settings || settingsBusy} onChange={(value) => void saveSettings({ torrentSpeedLimit: value })} />
      <div className="settings-folder-row"><div><strong>Download location</strong><p>New games are saved in a separate folder here. Existing downloads stay where they are.</p><code title={settings?.downloadDirectory}>{settings?.downloadDirectory || "Loading folder…"}</code></div><button type="button" className="settings-secondary-button" onClick={() => void chooseFolder()} disabled={!settings || settingsBusy}><FontAwesomeIcon icon={faFolderOpen} />{busy === "folder" ? "Opening…" : "Choose folder"}</button></div>
    </section>

    <section className="settings-panel" aria-labelledby="settings-updates-title">
      <header className="settings-panel-heading"><span><FontAwesomeIcon icon={faRocket} /></span><div><h2 id="settings-updates-title">Updates</h2><p>GameOnix checks its public GitHub release feed automatically.</p></div></header>
      <div className="settings-update-version"><div className="settings-version-mark"><FontAwesomeIcon icon={faLaptop} /></div><div><strong>GameOnix Desktop</strong><span>Installed version {settings?.version || "…"}</span></div><span className={`settings-update-badge is-${updateStatus}`}>{updateStatus === "current" ? <FontAwesomeIcon icon={faCheck} /> : <FontAwesomeIcon icon={faBell} />}{UPDATE_LABELS[updateStatus] || "Update status"}</span></div>
      {updateStatus === "downloading" && <div className="settings-update-progress"><div><span>Downloading version {update?.availableVersion}</span><strong>{progress}%</strong></div><div className="settings-progress-track"><span style={{ width: `${progress}%` }} /></div><small>The update downloads inside GameOnix. When it is ready, choose whether to restart now or later.</small></div>}
      {updateStatus === "restarting" && <div className="settings-update-progress"><div><span>Preparing installer for version {update?.availableVersion}</span><strong>…</strong></div><div className="settings-progress-track is-indeterminate"><span /></div><small>A separate installer window shows progress. GameOnix will reopen after the files are installed and checked.</small></div>}
      {updateStatus === "error" && <p className="settings-update-error">{update?.error}</p>}
      <div className="settings-update-actions"><button type="button" className="settings-secondary-button" onClick={() => void checkUpdates()} disabled={settingsBusy || ["downloading", "restarting", "ready", "deferred"].includes(updateStatus)}><FontAwesomeIcon icon={faArrowRotateRight} />{busy === "updates" ? "Checking…" : "Check for updates"}</button>{["ready", "deferred"].includes(updateStatus) && <button type="button" className="settings-secondary-button" onClick={() => void restartForUpdate()} disabled={settingsBusy}><FontAwesomeIcon icon={faArrowRotateRight} />{busy === "restart-update" ? "Restarting…" : "Restart now"}</button>}<span>Choose when to restart after an update is ready.</span></div>
    </section>
  </main>;
}
