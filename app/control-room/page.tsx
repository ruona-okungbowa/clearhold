import type { Metadata } from "next";
import { connection } from "next/server";
import { aiEnabled, aiModels } from "@/lib/ai";
import { db } from "@/lib/db";
import { getSavedLayout } from "./saved-layout";
import { ControlRoom } from "./control-room";

export const metadata: Metadata = { title: "Control room" };

export default async function ControlRoomPage() {
  // Live database rows: render per request, not at build time.
  await connection();
  const [authorizations, hires, findings, openApprovals, contests, finalCaptures, savedState] = await Promise.all([
    db.authorization.findMany({
      omit: { updatedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.hire.findMany({
      omit: { createdAt: true },
      orderBy: { startAt: "asc" },
    }),
    db.finding.findMany({
      omit: { knownMarkId: true, model: true, promptVersion: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // The same test settleHire applies; the token stays on the server.
    db.approval.findMany({
      where: { finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } },
      select: { authorizationId: true },
    }),
    db.contest.findMany({ select: { hireId: true, note: true, photoId: true, status: true } }),
    db.capture.findMany({ where: { finalCapture: true, amountGBP: { gt: 0 } }, select: { authorizationId: true } }),
    getSavedLayout(),
  ]);

  // settleHire only looks at a hire's newest hold, and these come oldest first, so the newest wins.
  const currentHold = new Map(authorizations.map((a) => [a.hireId, a.id]));
  const approvedHolds = new Set(openApprovals.map((a) => a.authorizationId));
  const openContest = new Map(contests.filter((c) => c.status === "open").map((c) => [c.hireId, c]));

  // The Risk page's per-hire numbers, which Studio's built-in charts average. Percentages as 0 or 100, so an
  // average is the rate. A decision is a settled hire that charged something or was contested.
  const contested = new Set(contests.map((c) => c.hireId));
  const holdHire = new Map(authorizations.map((a) => [a.id, a.hireId]));
  const charged = new Set(finalCaptures.map((c) => holdHire.get(c.authorizationId)));
  const decided = (h: (typeof hires)[number]) => h.status === "settled" && (charged.has(h.id) || contested.has(h.id));
  const decisionsBy = new Map<string, number>();
  for (const h of hires) if (h.staffCode && decided(h)) decisionsBy.set(h.staffCode, (decisionsBy.get(h.staffCode) ?? 0) + 1);

  // Decimals don't cross to the client; GBP amounts to 2dp are exact enough as numbers.
  return (
    <ControlRoom
      holds={authorizations.map((a) => ({
        ...a,
        amountGBP: Number(a.amountGBP),
      }))}
      hires={hires.map((h) => ({
        ...h,
        feeGBP: Number(h.feeGBP),
        depositGBP: Number(h.depositGBP),
        openApproval: approvedHolds.has(currentHold.get(h.id)!),
        // Empty, not null, when there's none: Studio infers fields and drops a column with no values.
        contestNote: openContest.get(h.id)?.note ?? "",
        contestPhotoId: openContest.get(h.id)?.photoId ?? "",
        staffCode: h.staffCode ?? "",
        keptPct: charged.has(h.id) ? 100 : 0,
        decided: decided(h),
        contestedPct: contested.has(h.id) ? 100 : 0,
        // Every hire carries its staff code's total, so a row filter can keep codes with 20 or more.
        staffDecisions: h.staffCode ? (decisionsBy.get(h.staffCode) ?? 0) : 0,
      }))}
      findings={findings.map((f) => ({
        ...f,
        // Studio fields hold primitives, so the box travels as JSON. Null amounts stay null: 0 would mean waived.
        box: f.box && JSON.stringify(f.box),
        proposedGBP: f.proposedGBP === null ? null : Number(f.proposedGBP),
        setGBP: f.setGBP === null ? null : Number(f.setGBP),
      }))}
      savedState={savedState}
      licenseKey={process.env.AG_STUDIO}
      aiModels={aiEnabled() ? aiModels() : undefined}
    />
  );
}
