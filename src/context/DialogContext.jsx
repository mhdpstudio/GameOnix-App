import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import "../style/dialogs.css";

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);

  const settle = useCallback((answer) => {
    resolver.current?.(answer);
    resolver.current = null;
    setDialog(null);
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current = resolve;
    setDialog({
      title: options?.title || "Are you sure?",
      message: options?.message || "Please confirm this action.",
      confirmLabel: options?.confirmLabel || "Continue",
      cancelLabel: options?.cancelLabel || "Cancel",
      danger: Boolean(options?.danger),
      type: "confirm",
    });
  }), []);

  const alert = useCallback((options) => new Promise((resolve) => {
    resolver.current = resolve;
    setDialog({
      title: options?.title || "GameOnix",
      message: options?.message || "",
      confirmLabel: options?.confirmLabel || "OK",
      type: "alert",
    });
  }), []);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, settle]);

  return <DialogContext.Provider value={{ confirm, alert }}>
    {children}
    {dialog && <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false); }}>
      <section className="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message">
        <button type="button" className="app-dialog-close" aria-label="Close" onClick={() => settle(false)}><FontAwesomeIcon icon={faXmark} /></button>
        <span className={`app-dialog-icon${dialog.danger ? " is-danger" : ""}`}><FontAwesomeIcon icon={faCircleExclamation} /></span>
        <h2 id="app-dialog-title">{dialog.title}</h2>
        <p id="app-dialog-message">{dialog.message}</p>
        <div className="app-dialog-actions">
          {dialog.type === "confirm" && <button type="button" className="app-dialog-cancel" onClick={() => settle(false)}>{dialog.cancelLabel}</button>}
          <button type="button" className={`app-dialog-confirm${dialog.danger ? " is-danger" : ""}`} autoFocus onClick={() => settle(true)}>{dialog.confirmLabel}</button>
        </div>
      </section>
    </div>}
  </DialogContext.Provider>;
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useDialog must be used inside DialogProvider.");
  return context;
}
