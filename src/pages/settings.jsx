import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowRotateRight, faBell, faCheck, faFolderOpen, faGear, faLaptop, faRocket } from "@fortawesome/free-solid-svg-icons";
import "../style/settings-style.css";

function SwitchRow({ title, description, checked, onChange, disabled = false }) {
  return <div className="settings-switch-row">
    <div><strong>{title}</strong><p>{description}</p></div>
    <button type="button" role="switch" aria-checked={checked} className={`settings-switch${checked ? " is-on" : ""}`} onClick={() => onChange(!checked)} disabled={disabled}><span /></button>
  </div>;
}

const UPDATE_LABELS = {
  idle: "Updates are checked automatically",
  checking: "Checking GitHub for a new version…",
  current: "You're using the latest version",
  available: "A new version is available",
  downloading: "Downloading the update in GameOnix",
  restarting: "Restarting to finish installing the update…",
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
      <div className="settings-folder-row"><div><strong>Download location</strong><p>New games are saved in a separate folder here. Existing downloads stay where they are.</p><code title={settings?.downloadDirectory}>{settings?.downloadDirectory || "Loading folder…"}</code></div><button type="button" className="settings-secondary-button" onClick={() => void chooseFolder()} disabled={!settings || settingsBusy}><FontAwesomeIcon icon={faFolderOpen} />{busy === "folder" ? "Opening…" : "Choose folder"}</button></div>
    </section>

    <section className="settings-panel" aria-labelledby="settings-updates-title">
      <header className="settings-panel-heading"><span><FontAwesomeIcon icon={faRocket} /></span><div><h2 id="settings-updates-title">Updates</h2><p>GameOnix checks its public GitHub release feed automatically.</p></div></header>
      <div className="settings-update-version"><div className="settings-version-mark"><FontAwesomeIcon icon={faLaptop} /></div><div><strong>GameOnix Desktop</strong><span>Installed version {settings?.version || "…"}</span></div><span className={`settings-update-badge is-${updateStatus}`}>{updateStatus === "current" ? <FontAwesomeIcon icon={faCheck} /> : <FontAwesomeIcon icon={faBell} />}{UPDATE_LABELS[updateStatus] || "Update status"}</span></div>
      {updateStatus === "downloading" && <div className="settings-update-progress"><div><span>Downloading version {update?.availableVersion}</span><strong>{progress}%</strong></div><div className="settings-progress-track"><span style={{ width: `${progress}%` }} /></div><small>The files are downloaded inside GameOnix. The app closes, updates its portable files, then restarts automatically.</small></div>}
      {updateStatus === "error" && <p className="settings-update-error">{update?.error}</p>}
      <div className="settings-update-actions"><button type="button" className="settings-secondary-button" onClick={() => void checkUpdates()} disabled={settingsBusy || ["downloading", "restarting"].includes(updateStatus)}><FontAwesomeIcon icon={faArrowRotateRight} />{busy === "updates" ? "Checking…" : "Check for updates"}</button><span>Updates install automatically—no new setup file or browser download.</span></div>
    </section>
  </main>;
}
