import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateRight, faClock, faRocket } from "@fortawesome/free-solid-svg-icons";
import "../style/update-restart-prompt.css";

export default function UpdateRestartPrompt() {
  const desktop = window.gameonixDesktop;
  const [update, setUpdate] = useState(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!desktop) return undefined;
    const sync = (state) => {
      setUpdate(state);
      if (state?.status === "ready") setVisible(true);
      if (state?.status === "deferred") setVisible(false);
    };
    const unsubscribe = desktop.updates.onStateChange(sync);
    void desktop.updates.getState().then(sync);
    return unsubscribe;
  }, [desktop]);

  if (!desktop || !visible || update?.status !== "ready") return null;

  async function restartNow() {
    setBusy(true);
    setError("");
    try {
      await desktop.updates.restart();
    } catch (reason) {
      setBusy(false);
      setError(reason?.message || "The update could not be started.");
    }
  }

  async function restartLater() {
    setBusy(true);
    setError("");
    try {
      const state = await desktop.updates.defer();
      setUpdate(state);
      setVisible(false);
    } catch (reason) {
      setError(reason?.message || "The update could not be postponed.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="update-restart-overlay">
    <section className="update-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="update-restart-title" aria-describedby="update-restart-copy">
      <div className="update-restart-icon"><FontAwesomeIcon icon={faRocket} /></div>
      <span className="update-restart-eyebrow">UPDATE READY</span>
      <h2 id="update-restart-title">Restart GameOnix now?</h2>
      <p id="update-restart-copy">Version {update.availableVersion} is downloaded and ready. Restart now to install it; GameOnix will reopen when the installer has finished.</p>
      {busy && <p className="update-restart-progress" role="status" aria-live="polite">Closing GameOnix and starting the installer…</p>}
      {error && <p className="update-restart-error" role="alert">{error}</p>}
      <div className="update-restart-actions">
        <button type="button" className="update-restart-later" onClick={() => void restartLater()} disabled={busy}><FontAwesomeIcon icon={faClock} /> Later</button>
        <button type="button" className="update-restart-now" onClick={() => void restartNow()} disabled={busy}><FontAwesomeIcon icon={faArrowRotateRight} /> Restart now</button>
      </div>
    </section>
  </div>;
}
