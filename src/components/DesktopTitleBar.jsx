import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faArrowRight } from "@fortawesome/free-solid-svg-icons";
import "../style/desktop-titlebar.css";

export default function DesktopTitleBar() {
  const desktop = window.gameonixDesktop;
  const [maximized, setMaximized] = useState(false);
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    if (!desktop) return undefined;
    void desktop.windowControls.isMaximized().then(setMaximized);
    const unsubscribeWindow = desktop.windowControls.onStateChange(setMaximized);
    const unsubscribeUpdate = desktop.updates.onStateChange(setUpdate);
    void desktop.updates.getState().then(setUpdate);
    return () => {
      unsubscribeWindow();
      unsubscribeUpdate();
    };
  }, [desktop]);

  if (!desktop) return null;

  const updateText = update?.status === "downloading"
    ? `Update ${Math.round(update.progress || 0)}%`
    : update?.status === "restarting"
      ? "Restarting to finish update…"
      : update?.status === "error"
        ? "Update could not be installed"
        : "";

  return <header className="desktop-titlebar">
    <div className="desktop-titlebar-drag">
      <div className="desktop-titlebar-navigation">
        <button type="button" aria-label="Go back" title="Go back" onClick={() => desktop.windowControls.back()}><FontAwesomeIcon icon={faArrowLeft} /></button>
        <button type="button" aria-label="Go forward" title="Go forward" onClick={() => desktop.windowControls.forward()}><FontAwesomeIcon icon={faArrowRight} /></button>
      </div>
      <img src="/gameonix-icon.png" alt="" />
      <span>GameOnix</span>
      {updateText && <span className={`desktop-update-indicator is-${update.status}`} title={update.error || "GameOnix update"}>
        {update.status === "downloading" && <i style={{ width: `${Math.max(0, Math.min(100, update.progress || 0))}%` }} />}
        {updateText}
      </span>}
    </div>
    <div className="desktop-titlebar-controls">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => desktop.windowControls.minimize()}><span className="titlebar-minimize" /></button>
      <button type="button" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={() => desktop.windowControls.toggleMaximize()}><span className={maximized ? "titlebar-restore" : "titlebar-maximize"} /></button>
      <button type="button" className="is-close" aria-label="Close" title="Close" onClick={() => desktop.windowControls.close()}><span className="titlebar-close" /></button>
    </div>
  </header>;
}
