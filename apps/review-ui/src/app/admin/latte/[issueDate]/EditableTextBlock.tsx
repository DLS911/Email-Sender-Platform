"use client";

/**
 * Wraps a chunk of the issue's copy so the reviewer can:
 *   1. Highlight any span of text with the cursor.
 *   2. A floating "💬 Flag" pill appears next to the selection.
 *   3. Click it → popover opens with a feedback textarea + submit.
 *   4. On submit, POSTs to /api/admin/rewrite-passage which asks
 *      Sonnet to rewrite the WHOLE passage addressing the flagged
 *      selection + feedback, updates the DB row, re-renders the
 *      email HTML, and returns the new text.
 *   5. The block updates in place with the rewritten copy.
 *
 * The selection is captured via window.getSelection() on mouseup /
 * touchend. The pill position tracks the end of the selection so it
 * doesn't cover the highlighted range.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  issueDate: string;
  testSecret: string;
  fieldPath: string;
  label: string;
  initialText: string;
  /** Optional additional style for the outer text block. */
  style?: React.CSSProperties;
  /** Tag used to render the outer wrapper — default 'p'. Use 'span' inline. */
  as?: "p" | "div" | "span";
};

export function EditableTextBlock({ issueDate, testSecret, fieldPath, label, initialText, style, as = "p" }: Props) {
  const [text, setText] = useState(initialText);
  const [selectedText, setSelectedText] = useState("");
  const [pillPos, setPillPos] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEditAt, setLastEditAt] = useState<number | null>(null);
  const blockRef = useRef<HTMLElement | null>(null);

  // Sync when parent-provided initialText changes (rare, e.g. hard refresh).
  useEffect(() => { setText(initialText); }, [initialText]);

  const captureSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelectedText("");
      setPillPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = blockRef.current;
    if (!container) return;
    // Ensure the selection is WITHIN this block. If either end is
    // outside, ignore.
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      setSelectedText("");
      setPillPos(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setSelectedText("");
      setPillPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelectedText(text);
    // Position the pill at the top-right of the selection, adjusted
    // for the viewport (fixed positioning).
    setPillPos({ x: rect.right + window.scrollX, y: rect.top + window.scrollY });
  }, []);

  useEffect(() => {
    const onUp = () => setTimeout(captureSelection, 10);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
  }, [captureSelection]);

  const submit = useCallback(async () => {
    if (busy) return;
    const trimmed = feedback.trim();
    if (!trimmed) { setError("feedback required"); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rewrite-passage?test=${encodeURIComponent(testSecret)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${testSecret}` },
        body: JSON.stringify({ issueDate, fieldPath, selectedText, feedback: trimmed }),
      });
      const data = (await res.json()) as { newText?: string; error?: string };
      if (!res.ok || data.error || !data.newText) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setText(data.newText);
      setLastEditAt(Date.now());
      setOpen(false);
      setFeedback("");
      setSelectedText("");
      setPillPos(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, feedback, testSecret, issueDate, fieldPath, selectedText]);

  const Tag = as as "p" | "div" | "span";
  const pillWasEdited = lastEditAt !== null;
  return (
    <>
      <Tag
        ref={(el: HTMLElement | null) => { blockRef.current = el; }}
        data-fieldpath={fieldPath}
        title={`${label} — highlight text to flag it for a rewrite`}
        style={{
          ...(style ?? {}),
          background: pillWasEdited ? "rgba(184,101,26,0.06)" : undefined,
          transition: "background 500ms ease",
          borderRadius: 4,
          padding: as === "span" ? undefined : "2px 0",
        }}
      >
        {text}
      </Tag>
      {pillPos && selectedText && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            position: "absolute", left: pillPos.x + 6, top: pillPos.y - 8,
            background: "#0a5fb8", color: "#fff", border: "none", borderRadius: 12,
            padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)", zIndex: 100,
          }}
        >
          💬 Flag
        </button>
      ) : null}
      {open ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: Math.max(12, (pillPos?.x ?? 0) - 220),
            top: (pillPos?.y ?? 0) + 12,
            zIndex: 200, width: 320,
            background: "#fff", border: "1px solid #d5d8de", borderRadius: 6,
            padding: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>
            <b>{label}</b> · flagged: <span style={{ background: "#fff3d6", padding: "0 4px", borderRadius: 2 }}>&ldquo;{selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}&rdquo;</span>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="what's wrong / how should it change?"
            rows={3}
            autoFocus
            disabled={busy}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #d5d8de", borderRadius: 4, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
          {error ? <div style={{ fontSize: 11, color: "#c22", marginTop: 4 }}>err: {error}</div> : null}
          <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => { setOpen(false); setFeedback(""); setError(null); }}
              disabled={busy}
              style={{ padding: "5px 10px", border: "1px solid #d5d8de", borderRadius: 3, background: "#fff", cursor: "pointer", fontSize: 12 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !feedback.trim()}
              style={{
                padding: "5px 12px", border: "1px solid #0a5fb8", borderRadius: 3,
                background: busy ? "#f0f0f2" : "#0a5fb8", color: busy ? "#666" : "#fff",
                cursor: busy || !feedback.trim() ? "default" : "pointer", fontSize: 12, fontWeight: 600,
              }}
            >
              {busy ? "…" : "Rewrite"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
