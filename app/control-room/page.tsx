import type { Metadata } from "next";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { getSavedLayout } from "./saved-layout";
import { ControlRoom } from "./control-room";

export const metadata: Metadata = { title: "Control room" };

export default async function ControlRoomPage() {
  // Live database rows: render per request, not at build time.
  await connection();
  const [authorizations, hires, findings, openApprovals, savedState] = await Promise.all([
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
    getSavedLayout(),
  ]);

  // settleHire only looks at a hire's newest hold, and these come oldest first, so the newest wins.
  const currentHold = new Map(authorizations.map((a) => [a.hireId, a.id]));
  const approvedHolds = new Set(openApprovals.map((a) => a.authorizationId));

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
    />
  );
}
