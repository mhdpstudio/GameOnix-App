import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getReviews, saveReview, saveReviewReply } from "../api/session";
import { useAuth } from "../context/AuthContext";
import "./../style/reviews-style.css";

function ReviewStars({ rating, label }) {
  return (
    <span className="review-stars" aria-label={label || `${rating} out of 5 stars`}>
      {"★".repeat(Math.max(0, Math.min(5, Number(rating) || 0)))}
      <span className="review-stars-empty">
        {"★".repeat(5 - Math.max(0, Math.min(5, Number(rating) || 0)))}
      </span>
    </span>
  );
}

function ReviewSection({ target, gameSlug, gameTitle }) {
  const { user, authLoading } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ratingDraft, setRatingDraft] = useState(null);
  const [commentDraft, setCommentDraft] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyingId, setReplyingId] = useState("");
  const [replyError, setReplyError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await getReviews({ target, gameSlug });
        if (active) setReviews(result);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load reviews."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [target, gameSlug, user?.username]);

  const ownReview = reviews.find(
    (review) =>
      String(review.username || "").toLowerCase() ===
      String(user?.username || "").toLowerCase()
  );
  const rating = ratingDraft ?? ownReview?.rating ?? 5;
  const comment = commentDraft ?? ownReview?.comment ?? "";

  const averageRating = useMemo(() => {
    if (!reviews.length) return 0;
    return reviews.reduce((total, review) => total + Number(review.rating || 0), 0) /
      reviews.length;
  }, [reviews]);

  async function submit(event) {
    event.preventDefault();
    if (!user || submitting) return;

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveReview({
        target,
        ...(target === "game" ? { gameSlug, gameTitle } : {}),
        rating,
        comment,
      });
      setReviews((current) => [
        saved,
        ...current.filter(
          (review) =>
            String(review.username || "").toLowerCase() !==
            String(user.username).toLowerCase()
        ),
      ]);
      setRatingDraft(null);
      setCommentDraft(null);
      setNotice("Your review has been saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save review."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(event, review) {
    event.preventDefault();
    if (!user || replyingId) return;
    const reply = String(replyDrafts[review.id] || "").trim();
    if (!reply) return;
    setReplyingId(review.id);
    setReplyError("");
    try {
      const result = await saveReviewReply(review.id, reply);
      setReviews((current) => current.map((item) =>
        item.id === review.id ? result.review : item
      ));
      setReplyDrafts((current) => ({ ...current, [review.id]: "" }));
    } catch (error) {
      setReplyError(error.message || "Unable to post your reply.");
    } finally {
      setReplyingId("");
    }
  }

  return (
    <section className="reviews-section">
      <div className="reviews-summary">
        <div>
          <span className="reviews-eyebrow">
            {target === "game" ? "PLAYER REVIEWS" : "COMMUNITY FEEDBACK"}
          </span>
          <h2>{target === "game" ? `${gameTitle} reviews` : "Reviews"}</h2>
        </div>
        <div className="reviews-average">
          <ReviewStars rating={Math.round(averageRating)} />
          <strong>{reviews.length ? averageRating.toFixed(1) : "—"}</strong>
          <span>{reviews.length} {reviews.length === 1 ? "review" : "reviews"}</span>
        </div>
      </div>

      {user ? (
        <form className="review-form" onSubmit={submit}>
          <div className="review-form-heading">
            <div>
              <strong>{ownReview ? "Update your review" : "Write a review"}</strong>
              <span>Posting as @{user.username}</span>
            </div>
            <div className="review-rating-picker" role="group" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={value <= rating ? "selected" : ""}
                  onClick={() => setRatingDraft(value)}
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                  aria-pressed={rating === value}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <label className="review-input-label">
            <span>Your thoughts</span>
            <textarea
              value={comment}
              onChange={(event) => setCommentDraft(event.target.value)}
              maxLength={2000}
              rows={4}
              required
              placeholder={
                target === "game"
                  ? `What did you think of ${gameTitle}?`
                  : "Share your experience with GameOnix."
              }
            />
          </label>
          <div className="review-form-footer">
            <span>{comment.length}/2000</span>
            <button type="submit" disabled={submitting || !comment.trim()}>
              {submitting ? "Saving…" : ownReview ? "Update review" : "Post review"}
            </button>
          </div>
          {notice && <p className="review-notice" role="status">{notice}</p>}
        </form>
      ) : (
        <div className="review-login-prompt">
          <p>{authLoading ? "Checking your account…" : "Sign in to share your review."}</p>
          {!authLoading && <Link to="/login">Sign in</Link>}
        </div>
      )}

      {error && <p className="review-error" role="alert">{error}</p>}
      {replyError && <p className="review-error" role="alert">{replyError}</p>}

      {loading ? (
        <div className="reviews-state">Loading reviews…</div>
      ) : reviews.length ? (
        <div className="review-list">
          {reviews.map((review) => (
            <article
              className={`review-card${review.featured ? " is-featured" : ""}`}
              key={review.id}
            >
              <div className="review-card-heading">
                <div>
                  <span className="review-card-author">
                    <strong>@{review.username || "GameOnix user"}</strong>
                    {review.featured && (
                      <span className="review-featured">Featured</span>
                    )}
                  </span>
                  <time dateTime={review.updatedAt || review.createdAt}>
                    {new Date(review.updatedAt || review.createdAt).toLocaleDateString()}
                    {review.updatedAt && review.createdAt !== review.updatedAt ? " · edited" : ""}
                  </time>
                </div>
                <ReviewStars rating={review.rating} />
              </div>
              <p>{review.comment}</p>
              {review.adminReply && (
                <div className="review-reply">
                  <span>GameOnix reply</span>
                  <p>{review.adminReply}</p>
                </div>
              )}
              {(Array.isArray(review.replies) ? review.replies : []).map((reply) => (
                <div className="review-community-reply" key={reply.id}>
                  <strong>@{reply.username}</strong>
                  <p>{reply.comment}</p>
                </div>
              ))}
              {user ? (
                <form className="review-reply-form" onSubmit={(event) => void submitReply(event, review)}>
                  <textarea
                    rows={2}
                    maxLength={600}
                    value={replyDrafts[review.id] || ""}
                    onChange={(event) => setReplyDrafts((current) => ({ ...current, [review.id]: event.target.value }))}
                    placeholder={"Reply to @" + (review.username || "user") + "..."}
                    aria-label={"Reply to review by " + (review.username || "user")}
                  />
                  <button type="submit" disabled={replyingId === review.id || !String(replyDrafts[review.id] || "").trim()}>
                    {replyingId === review.id ? "Sending..." : "Reply"}
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="reviews-state">No reviews yet. Be the first to share your thoughts.</div>
      )}
    </section>
  );
}

export function GameReviews({ slug, title }) {
  return <ReviewSection target="game" gameSlug={slug} gameTitle={title} />;
}

export default function ReviewsPage() {
  return (
    <main className="reviews-page">
      <Link to="/" className="reviews-back">Back to GameOnix</Link>
      <header className="reviews-page-heading">
        <span className="reviews-eyebrow">YOUR VOICE MATTERS</span>
        <h1>GameOnix Reviews</h1>
        <p>Share your experience with the GameOnix website and read feedback from the community.</p>
      </header>
      <ReviewSection target="site" />
    </main>
  );
}
