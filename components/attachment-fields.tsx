"use client";

/**
 * Shared attachment inputs (wave 2, reference-based only).
 *
 * An attachment is a URL to a document stored elsewhere plus a short
 * note — never an upload, never required. The URL is rendered as a
 * plain link wherever the voucher is printed or listed; an empty URL
 * stores NULL. No storage bucket or policy is involved.
 */

const inputCls =
  "w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground";
const labelCls = "block font-medium text-foreground mb-1";

export function AttachmentFields({
  url,
  note,
  onUrlChange,
  onNoteChange,
  idPrefix,
}: {
  url: string;
  note: string;
  onUrlChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <>
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-attachment-url`}>
          Attachment link (optional)
        </label>
        <input
          id={`${idPrefix}-attachment-url`}
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://… link to a scanned bill or receipt"
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-attachment-note`}>
          Attachment note (optional)
        </label>
        <input
          id={`${idPrefix}-attachment-note`}
          type="text"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="What this attachment is"
          className={inputCls}
        />
      </div>
    </>
  );
}

/** Small link shown on slips, prints and list rows when a URL exists. */
export function AttachmentLink({
  url,
  note,
}: {
  url?: string | null;
  note?: string | null;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-emerald-700 underline"
      title={note ?? undefined}
    >
      Attachment{note ? ` — ${note}` : ""}
    </a>
  );
}
