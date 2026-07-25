"use client";

import { useState } from "react";

import { Panel, cx } from "./ui";

/**
 * Handoff controls.
 *
 * The send path is deliberately consent-first: the operator types the address it
 * goes to, so nothing is ever delivered to a prospect from a demo. Inferred
 * addresses are excluded from the sendable column of the export rather than
 * quietly included, because a guessed address in a CRM becomes a real send
 * later by someone who never saw the caveat.
 */
export function ExportBar({ slug, displayName }: { slug: string; displayName: string }) {
  const [address, setAddress] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    setState("sending");
    setMessage("");
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, to: address.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; detail?: string };
      if (res.ok && json.ok) {
        setState("sent");
        setMessage(json.detail ?? "Delivered.");
      } else {
        setState("error");
        setMessage(json.error ?? `Request failed with ${res.status}.`);
      }
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
      <Panel className="p-4">
        <p className="t-label">Exports</p>
        <p className="t-small mt-1.5">
          Contacts, measured sites and accepted copy, shaped for a CRM import. Column headers match a
          standard contact import so the file maps without hand-editing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/export/${slug}?format=contacts`}
            className="rounded-[8px] bg-[var(--color-ink)] px-3 py-2 text-[0.84rem] font-[520] text-white transition-opacity hover:opacity-88"
          >
            Contacts CSV
          </a>
          <a
            href={`/api/export/${slug}?format=sites`}
            className="rounded-[8px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.84rem] font-[520] transition-shadow hover:shadow-[var(--shadow-hair)]"
          >
            Measured sites CSV
          </a>
          <a
            href={`/api/export/${slug}?format=json`}
            className="rounded-[8px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.84rem] font-[520] transition-shadow hover:shadow-[var(--shadow-hair)]"
          >
            Full account JSON
          </a>
        </div>
        <p className="t-micro mt-3 border-t border-[var(--color-hair)] pt-2.5">
          The contacts file carries a <code className="font-[family-name:var(--font-mono)]">provenance</code>{" "}
          column and an <code className="font-[family-name:var(--font-mono)]">email_status</code> column. Rows
          without a sourced address are exported with an empty email field rather than a guess, so an import
          cannot turn an inference into a send.
        </p>
      </Panel>

      <Panel className="p-4">
        <p className="t-label">Send a copy to yourself</p>
        <p className="t-small mt-1.5">
          Type your own address and the accepted message for {displayName} is delivered to you, unchanged.
          Nothing is ever sent to a prospect from here, the recipient is whatever you type, which is what
          makes this a demonstration rather than outreach.
        </p>
        <form onSubmit={send} className="mt-3 flex flex-wrap gap-2">
          <input
            type="email"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="you@example.com"
            className="min-w-0 flex-1 rounded-[8px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.86rem] shadow-[inset_0_0_0_1px_rgba(16,18,22,0.07)] outline-none placeholder:text-[var(--color-ink-4)]"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className={cx(
              "rounded-[8px] px-3 py-2 text-[0.84rem] font-[520] transition-opacity",
              state === "sending"
                ? "bg-[var(--color-ink-4)] text-white"
                : "bg-[var(--color-accent)] text-white hover:opacity-88",
            )}
          >
            {state === "sending" ? "Sending…" : "Send to me"}
          </button>
        </form>

        {state === "sent" && (
          <p className="chip chip-verified mt-2.5">{message || "Delivered."}</p>
        )}
        {state === "error" && (
          <div className="mt-2.5 rounded-[8px] bg-[var(--color-conflict-wash)] p-2.5">
            <p className="text-[0.8rem]" style={{ color: "var(--color-conflict)" }}>
              {message}
            </p>
          </div>
        )}

        <p className="t-micro mt-3 border-t border-[var(--color-hair)] pt-2.5">
          Sending is disabled unless a mailbox is configured on the server, and the route refuses any
          recipient other than the one typed into this field.
        </p>
      </Panel>
    </div>
  );
}
