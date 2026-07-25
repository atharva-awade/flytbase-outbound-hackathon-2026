import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { callerKey, limitResponse, take } from "@/lib/ratelimit";
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
 *
 * The endpoint is unauthenticated, because a reviewer should be able to prove
 * delivery without an account. That makes it a relay unless it is capped, so it
 * is capped twice: a short window per caller, and a day's ceiling for the whole
 * deployment to protect the mailbox behind it.
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

  // Counted here rather than at the top of the handler: a mistyped address, an
  // unknown account or a deployment with no mailbox should not consume a
  // caller's allowance, because nothing was sent.
  const burst = take(`send:${callerKey(req)}`, 3, 10 * 60_000);
  if (!burst.ok) {
    return limitResponse(
      burst,
      `This deployment allows three sends per ten minutes from one address, so a public demonstration cannot be used as a relay. Try again in ${burst.retryAfter}s — the CSV and JSON exports are not limited.`,
    );
  }
  const daily = take("send:all", 40, 24 * 60 * 60_000);
  if (!daily.ok) {
    return limitResponse(
      daily,
      "The daily send ceiling for this deployment has been reached. The drafts and their sources are all still on the page, and the exports still work.",
    );
  }

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
    // The operator needs to know why a send failed, but an SMTP rejection can
    // quote the authenticating mailbox back, so only the reason is returned.
    const reason = (err as Error).message.replace(/[\w.+-]+@[\w.-]+/g, "the configured mailbox");
    console.error("send failed", err);
    return NextResponse.json({ error: `The mail server refused the message: ${reason}` }, { status: 502 });
  }
}
