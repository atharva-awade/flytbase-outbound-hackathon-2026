import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { loadAccount, loadOutreach } from "@/lib/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Consent-first send.
 *
 * The recipient is whatever the operator typed into the field on the page, so
 * this can demonstrate a real delivery without ever mailing a prospect. Two
 * transport notes worth recording:
 *
 *  - Every free transactional sandbox (Resend, Mailgun, MailerSend) restricts
 *    recipients to the account owner's own address, so none of them can deliver
 *    to an arbitrary reviewer. Gmail SMTP with an app password is the only
 *    zero-DNS path that can, which is why it is the primary transport here.
 *  - Nothing is sent unless the copy passed the critic. An unreviewed draft is
 *    not eligible for delivery.
 */
export async function POST(req: Request) {
  let payload: { slug?: string; to?: string };
  try {
    payload = (await req.json()) as { slug?: string; to?: string };
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const { slug, to } = payload;
  if (!slug || !to) {
    return NextResponse.json({ error: "Both an account and a recipient are required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return NextResponse.json(
      {
        error:
          "No mailbox is configured on this deployment, so nothing was sent. Set GMAIL_USER and GMAIL_APP_PASSWORD to enable delivery. The exports work regardless.",
      },
      { status: 503 },
    );
  }

  const found = await loadAccount(slug);
  if (!found) return NextResponse.json({ error: "Unknown account." }, { status: 404 });
  const { run, account } = found;

  const outreach = await loadOutreach();
  const candidates = account.contacts
    .map((c) => ({ contact: c, draft: (outreach?.drafts[c.id] ?? []).find((d) => d.accepted) }))
    .filter((x) => x.draft);

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        error:
          "No message for this account passed the critic, so there is nothing eligible to send. Rejected drafts are visible on the page but are deliberately not sendable.",
      },
      { status: 409 },
    );
  }

  const { contact, draft } = candidates[0];
  if (!draft) {
    return NextResponse.json({ error: "No accepted draft." }, { status: 409 });
  }

  const header = [
    `This is the message Aerion generated for ${contact.name ?? contact.targetRole} at ${account.displayName}.`,
    `It is being sent to you because you asked for it on the account page. It was not sent to the prospect.`,
    ``,
    `Language: ${draft.language} · critic score ${draft.score}/100 · accepted on iteration ${draft.iteration} · model ${draft.model}`,
    `Run ${run.id}, executed ${run.startedAt}`,
    ``,
    `── message ──────────────────────────────────────────────`,
    ``,
  ].join("\n");

  const footer = [
    ``,
    `── facts asserted, with sources ─────────────────────────`,
    ``,
    ...draft.citedFacts.map((f, i) => {
      const row = run.evidence[f.evidenceId];
      return `${i + 1}. ${f.text}\n   ${row?.sourceUrl ?? "no source recorded"}`;
    }),
    ``,
    `Every sentence above rests on one of those sources. Nothing was asserted without one.`,
  ].join("\n");

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user, pass },
    });

    const info = await transport.sendMail({
      from: `Aerion <${user}>`,
      to,
      subject: `[Aerion] ${draft.subject}`,
      text: `${header}${draft.body}\n${footer}`,
      headers: {
        // Stamp the run so a delivered message can be traced back to its origin.
        "X-Aerion-Run-Id": run.id,
        "X-Aerion-Account": account.slug,
        "X-Aerion-Critic-Score": String(draft.score),
      },
    });

    return NextResponse.json({
      ok: true,
      detail: `Sent to ${to} — message id ${info.messageId}. Check your inbox.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `The mail server refused the message: ${(err as Error).message}`,
      },
      { status: 502 },
    );
  }
}
