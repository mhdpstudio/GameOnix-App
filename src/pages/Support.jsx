import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faCheck, faChevronDown, faCircleQuestion, faGift, faLock, faPaperPlane, faPen, faPlus, faReceipt, faRotateRight, faTicket, faTrashCan, faUserShield, faWallet } from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import { useAuth } from "../context/AuthContext";
import { getCommunityApiToken } from "../api/session";
import "./../style/support-style.css";

const SUPPORT_API_URL = "https://gameonixfav.vercel.app/api/support-request";
const TICKETS_API_URL = "https://gameonixfav.vercel.app/api/auth/wallet-notifications";
const NOTIFICATIONS_UPDATED_EVENT = "wallet-notifications-updated";
const WHATSAPP_URL = "https://wa.link/2od11q";
const MAX_MESSAGE_LENGTH = 1500;
const MAX_REPLY_LENGTH = 2000;
const MIN_MESSAGE_LENGTH = 10;
const TOPICS = [
  { value: "order", label: "Order or purchase", hint: "Payment, delivery, or order status", icon: faReceipt },
  { value: "gift-card", label: "Gift card code", hint: "A code did not work or arrive", icon: faGift },
  { value: "wallet", label: "Wallet top-up", hint: "Balance, deposit, or payment", icon: faWallet },
  { value: "account", label: "Account access", hint: "Sign-in or profile help", icon: faUserShield },
  { value: "other", label: "Something else", hint: "Any other question", icon: faCircleQuestion },
];

function TopicDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, TOPICS.findIndex((item) => item.value === value)));
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = "support-topic-options-" + useId().replace(/:/g, "");
  const selectedIndex = Math.max(0, TOPICS.findIndex((item) => item.value === value));
  const selected = TOPICS[selectedIndex];

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openAt(index = selectedIndex) {
    const next = (index + TOPICS.length) % TOPICS.length;
    setActiveIndex(next);
    setOpen(true);
    requestAnimationFrame(() => optionRefs.current[next]?.focus());
  }

  function moveFocus(index) {
    const next = (index + TOPICS.length) % TOPICS.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  }

  function handleTriggerKeyDown(event) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!open) openAt(event.key === "ArrowUp" ? selectedIndex - 1 : selectedIndex);
    }
  }

  function handleOptionKeyDown(event, index) {
    if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); moveFocus(0); }
    else if (event.key === "End") { event.preventDefault(); moveFocus(TOPICS.length - 1); }
    else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    else if (event.key === "Tab") setOpen(false);
  }

  return (
    <div className="support-topic-picker" ref={rootRef}>
      <span className="support-topic-label">Topic</span>
      <button
        ref={triggerRef}
        type="button"
        className="support-topic-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => open ? setOpen(false) : openAt()}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={"support-topic-icon is-" + selected.value}><FontAwesomeIcon icon={selected.icon} /></span>
        <span className="support-topic-copy"><strong>{selected.label}</strong><small>{selected.hint}</small></span>
        <FontAwesomeIcon className="support-topic-chevron" icon={faChevronDown} />
      </button>
      {open && (
        <div className="support-topic-menu" id={listboxId} role="listbox" aria-label="Support topic">
          {TOPICS.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={activeIndex === index ? 0 : -1}
              className={"support-topic-option" + (option.value === value ? " is-selected" : "")}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}
            >
              <span className={"support-topic-icon is-" + option.value}><FontAwesomeIcon icon={option.icon} /></span>
              <span className="support-topic-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
              {option.value === value && <FontAwesomeIcon className="support-topic-check" icon={faCheck} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getTopicLabel(ticket) {
  const details = ticket.details || {};
  return details.topicLabel || TOPICS.find((topic) => topic.value === details.topic)?.label ||
    (ticket.type === "bug_report" ? "Game report" : "Support request");
}

function getTicketMessages(ticket) {
  const details = ticket.details || {};
  if (Array.isArray(details.messages)) return details.messages;
  return [{
    id: ticket.id,
    author: "user",
    username: ticket.username,
    message: String(details.message || details.description || ticket.message || ""),
    createdAt: ticket.createdAt,
  }];
}

function getTicketStatus(ticket) {
  const stored = String(ticket.details?.status || "").toLowerCase();
  if (stored === "closed") return "closed";
  if (stored === "resolved") return "resolved";
  if (stored === "pending" || stored === "open") return "pending";
  if (stored === "answered" || ticket.details?.reply) return "resolved";
  return "pending";
}

export default function Support() {
  const { user, authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ticketError, setTicketError] = useState("");
  const [activeTicketId, setActiveTicketId] = useState("");
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [topic, setTopic] = useState("order");
  const [orderId, setOrderId] = useState(String(searchParams.get("order") || "").slice(0, 60));
  const [message, setMessage] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [canManageSupport, setCanManageSupport] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [messageActionId, setMessageActionId] = useState("");

  const loadTickets = useCallback(async ({ selectNewest = false, showSpinner = false } = {}) => {
    if (!user) return [];
    if (showSpinner) setRefreshing(true);
    setTicketError("");
    try {
      const token = await getCommunityApiToken();
      const response = await fetch(TICKETS_API_URL + "?support=tickets", {
        headers: { Accept: "application/json", Authorization: "Bearer " + token },
        credentials: "omit",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.notifications)) {
        throw new Error(data.error || "Unable to load your support tickets.");
      }
      const nextTickets = data.notifications
        .filter((item) => ["support_request", "bug_report"].includes(item.type))
        .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
      setTickets(nextTickets);
      setCanManageSupport(data.canSend === true);
      setActiveTicketId((current) => {
        if (selectNewest && nextTickets[0]) return nextTickets[0].id;
        if (current && nextTickets.some((ticket) => ticket.id === current)) return current;
        return nextTickets[0]?.id || "";
      });
      return nextTickets;
    } catch (error) {
      setTicketError(error.message || "Unable to load your support tickets.");
      return [];
    } finally {
      setLoadingTickets(false);
      if (showSpinner) setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setTickets([]);
      setLoadingTickets(false);
      return undefined;
    }
    void loadTickets();
    const interval = window.setInterval(() => void loadTickets(), 30000);
    const handleUpdated = () => void loadTickets();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdated);
    };
  }, [loadTickets, user]);

  const activeTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === activeTicketId) || null,
    [activeTicketId, tickets]
  );
  const activeTicketStatus = activeTicket ? getTicketStatus(activeTicket) : "";
  const activeTicketLocked = ["resolved", "closed"].includes(activeTicketStatus);

  async function handleSubmit(event) {
    event.preventDefault();
    setTicketError("");
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
      setTicketError("Add at least " + MIN_MESSAGE_LENGTH + " characters so we can help.");
      return;
    }
    const honeypot = new FormData(event.currentTarget).get("website") || "";
    setSubmitting(true);
    try {
      const token = await getCommunityApiToken();
      const response = await fetch(SUPPORT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
        credentials: "omit",
        body: JSON.stringify({ topic, orderId: topic === "order" ? orderId.trim() : "", message: trimmedMessage, website: honeypot }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Couldn't create your ticket. Please try again.");
      setMessage("");
      setShowNewTicket(false);
      window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
      const updated = await loadTickets({ selectNewest: true });
      if (data.ticketId) setActiveTicketId(data.ticketId);
      else if (updated[0]) setActiveTicketId(updated[0].id);
    } catch (error) {
      setTicketError(error.message || "Couldn't create your ticket. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function moderateTicketMessage(action, ticketId, messageId, text = "") {
    if (!ticketId || !messageId || messageActionId) return;
    if (action === "delete" && !window.confirm("Delete this message? It will be removed from the conversation.")) return;
    setMessageActionId(messageId);
    setTicketError("");
    try {
      const token = await getCommunityApiToken();
      const response = await fetch(TICKETS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
        credentials: "omit",
        body: JSON.stringify({
          action: action === "edit" ? "edit-support-message" : "delete-support-message",
          notificationId: ticketId,
          messageId,
          message: text,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "This message could not be updated.");
      setEditingMessageId("");
      setEditingMessageDraft("");
      await loadTickets();
    } catch (error) {
      setTicketError(error.message || "This message could not be updated.");
    } finally {
      setMessageActionId("");
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    if (!activeTicket || !replyDraft.trim() || sendingReply) return;
    if (activeTicketLocked) {
      setTicketError("This ticket is resolved. You can read the conversation, but replies are closed.");
      return;
    }
    setSendingReply(true);
    setTicketError("");
    try {
      const token = await getCommunityApiToken();
      const response = await fetch(TICKETS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
        credentials: "omit",
        body: JSON.stringify({ action: "reply-support-thread", notificationId: activeTicket.id, message: replyDraft.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Your reply could not be sent.");
      setReplyDraft("");
      await loadTickets();
      window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
    } catch (error) {
      setTicketError(error.message || "Your reply could not be sent.");
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <main className="support-page">
      <header className="support-header support-page-heading">
        <div>
          <span className="support-kicker">GAMEONIX HELP CENTER</span>
          <h1>Support tickets</h1>
          <p>Create a ticket, follow every update, and reply in one conversation. For urgent help, contact us on WhatsApp.</p>
        </div>
        {user && <button className="support-new-ticket" type="button" onClick={() => { setShowNewTicket(true); setTicketError(""); }}>
          <FontAwesomeIcon icon={faPlus} /> New Ticket
        </button>}
      </header>

      <div className="support-layout">
        <section className="support-card support-ticket-workspace" aria-label="Support tickets">
          {authLoading ? (
            <div className="support-state" role="status">Checking your account...</div>
          ) : !user ? (
            <div className="support-access">
              <span className="support-access-icon"><FontAwesomeIcon icon={faLock} /></span>
              <h2>Sign in to open a ticket</h2>
              <p>Your ticket history and replies are private to your account.</p>
              <Link className="support-access-link" to="/login" state={{ from: "/support" }}>Sign in <FontAwesomeIcon icon={faArrowRight} /></Link>
            </div>
          ) : (
            <>
              <div className="support-ticket-list">
                <div className="support-ticket-list-heading">
                  <div><span>YOUR INBOX</span><strong>{tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}</strong></div>
                  <button type="button" aria-label="Refresh tickets" onClick={() => void loadTickets({ showSpinner: true })} disabled={refreshing}><FontAwesomeIcon icon={faRotateRight} /></button>
                </div>
                {loadingTickets ? <div className="support-ticket-list-state">Loading tickets...</div> : tickets.length ? tickets.map((ticket) => {
                  const status = getTicketStatus(ticket);
                  return <button type="button" className={"support-ticket-item" + (ticket.id === activeTicketId && !showNewTicket ? " is-active" : "")} key={ticket.id} onClick={() => { setActiveTicketId(ticket.id); setShowNewTicket(false); setTicketError(""); }}>
                    <span className="support-ticket-item-top"><strong>{getTopicLabel(ticket)}</strong><i className={"support-ticket-status is-" + status}>{status}</i></span>
                    <span>{(Array.isArray(ticket.details?.messages) ? String(ticket.details.messages.at(-1)?.message || "No messages yet") : String(ticket.details?.message || ticket.details?.description || ticket.message || "No message")).slice(0, 90)}</span>
                    <small>#{ticket.id.slice(0, 8)} · {new Date(ticket.createdAt).toLocaleDateString()}</small>
                  </button>;
                }) : <div className="support-ticket-list-state"><FontAwesomeIcon icon={faTicket} /><span>No tickets yet.</span></div>}
              </div>

              <div className="support-ticket-detail">
                {ticketError && <p className="support-message is-error" role="alert">{ticketError}</p>}
                {showNewTicket ? (
                  <div className="support-ticket-new">
                    <div className="support-ticket-detail-heading"><div><span>NEW CONVERSATION</span><h2>Open a ticket</h2></div><button type="button" onClick={() => { setShowNewTicket(false); setTicketError(""); }}>Cancel</button></div>
                    <form className="support-form" onSubmit={handleSubmit} noValidate>
                      <TopicDropdown value={topic} onChange={(value) => { setTopic(value); if (value !== "order") setOrderId(""); }} />
                      {topic === "order" && <div className="support-field"><label htmlFor="support-order-id">Order ID <span>(optional)</span></label><input id="support-order-id" value={orderId} maxLength={60} autoComplete="off" onChange={(event) => setOrderId(event.target.value)} placeholder="Paste the request ID from My Orders" /></div>}
                      <div className="support-field"><label htmlFor="support-email">Account email</label><input id="support-email" type="email" value={user.email || ""} readOnly /></div>
                      <div className="support-field"><label htmlFor="support-message">How can we help?</label><textarea id="support-message" rows={5} maxLength={MAX_MESSAGE_LENGTH} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the issue and what you expected." /><span className="support-char-count">{message.length} / {MAX_MESSAGE_LENGTH}</span></div>
                      <input type="text" name="website" className="support-honeypot" tabIndex={-1} autoComplete="off" aria-hidden="true" />
                      <button type="submit" className="support-submit" disabled={submitting}><FontAwesomeIcon icon={faPaperPlane} /> {submitting ? "Creating ticket..." : "Create ticket"}</button>
                    </form>
                  </div>
                ) : activeTicket ? (
                  <div className="support-ticket-chat">
                    <header className="support-ticket-detail-heading">
                      <div><span>TICKET #{activeTicket.id.slice(0, 8)} · {getTopicLabel(activeTicket)}</span><h2>{activeTicket.type === "bug_report" ? String(activeTicket.details?.gameTitle || "Game report") : getTopicLabel(activeTicket)}</h2></div>
                      <i className={"support-ticket-status is-" + getTicketStatus(activeTicket)}>{getTicketStatus(activeTicket)}</i>
                    </header>
                    <div className="support-ticket-messages">
                      {getTicketMessages(activeTicket).length === 0 && <p className="support-ticket-no-messages">No messages in this ticket.</p>}
                      {getTicketMessages(activeTicket).map((item) => {
                        const messageUsername = String(item.username || activeTicket.username || user.username || "").trim();
                        const mine = item.author !== "admin" && Boolean(user.username) && messageUsername.toLowerCase() === String(user.username).toLowerCase();
                        const mineAsSupport = item.author === "admin" && Boolean(user.username) && messageUsername.toLowerCase() === String(user.username).toLowerCase();
                        const senderLabel = item.author === "admin" ? "GameOnix support" : mine ? "You" : "@" + (messageUsername || "Player");
                        const canEdit = !activeTicketLocked && (mine || canManageSupport);
                        const canDelete = mine || (canManageSupport && mineAsSupport);
                        const isEditing = editingMessageId === item.id;
                        return <article className={"support-ticket-message" + (item.author === "admin" ? " from-team" : "")} key={item.id}>
                          <div className="support-ticket-message-head">
                            <span>{senderLabel} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Just now"}</span>
                            {(canEdit || canDelete) && !isEditing && <div className="support-ticket-message-actions">
                              {canEdit && <button type="button" title="Edit message" aria-label="Edit message" onClick={() => { setEditingMessageId(item.id); setEditingMessageDraft(String(item.message || "")); }} disabled={messageActionId === item.id}><FontAwesomeIcon icon={faPen} /></button>}
                              {canDelete && <button type="button" title="Delete message" aria-label="Delete message" onClick={() => void moderateTicketMessage("delete", activeTicket.id, item.id)} disabled={messageActionId === item.id}><FontAwesomeIcon icon={faTrashCan} /></button>}
                            </div>}
                          </div>
                          {isEditing ? <div className="support-ticket-message-editor">
                            <textarea rows={3} maxLength={MAX_REPLY_LENGTH} value={editingMessageDraft} onChange={(event) => setEditingMessageDraft(event.target.value)} aria-label="Edit ticket message" />
                            <div><button type="button" onClick={() => { setEditingMessageId(""); setEditingMessageDraft(""); }}>Cancel</button><button type="button" onClick={() => void moderateTicketMessage("edit", activeTicket.id, item.id, editingMessageDraft.trim())} disabled={!editingMessageDraft.trim() || messageActionId === item.id}>{messageActionId === item.id ? "Saving..." : "Save changes"}</button></div>
                          </div> : <p>{item.message}</p>}
                        </article>;
                      })}
                    </div>
                    {activeTicketLocked ? <p className="support-ticket-locked" role="status">This ticket is {activeTicketStatus}. Replies are closed.</p> : <form className="support-ticket-reply" onSubmit={sendReply}>
                      <label htmlFor="ticket-reply">Reply to this ticket</label><textarea id="ticket-reply" rows={3} maxLength={MAX_REPLY_LENGTH} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="Write your message..." />
                      <div><span>{replyDraft.length} / {MAX_REPLY_LENGTH}</span><button type="submit" disabled={sendingReply || !replyDraft.trim()}><FontAwesomeIcon icon={faPaperPlane} /> {sendingReply ? "Sending..." : "Send reply"}</button></div>
                    </form>}
                  </div>
                ) : (
                  <div className="support-ticket-empty"><FontAwesomeIcon icon={faTicket} /><h2>Your support inbox</h2><p>Choose a ticket to read the conversation, or start a new one.</p><button type="button" className="support-new-ticket" onClick={() => setShowNewTicket(true)}><FontAwesomeIcon icon={faPlus} /> New Ticket</button></div>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="support-channels">
          <section className="support-whatsapp"><span className="support-whatsapp-icon"><FontAwesomeIcon icon={faWhatsapp} /></span><h2>WhatsApp</h2><p>Prefer WhatsApp? Send screenshots and get order updates directly.</p><a className="support-whatsapp-link" href={WHATSAPP_URL} target="_blank" rel="noreferrer">Contact on WhatsApp <FontAwesomeIcon icon={faArrowRight} /></a></section>
          <section className="support-note"><h2>Ticket updates</h2><ul>
            <li><FontAwesomeIcon icon={faCheck} /> Your replies stay in this private ticket.</li>
            <li><FontAwesomeIcon icon={faCheck} /> We notify you when support answers.</li>
            <li><FontAwesomeIcon icon={faCheck} /> Add an order ID to help us find your purchase.</li>
          </ul></section>
        </aside>
      </div>
    </main>
  );
}
