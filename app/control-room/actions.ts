'use server';

import type { AgReportState } from 'ag-studio';
import { approveCharges, setAmount, settleHire } from '@/app/hire/[hireRef]/actions';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { MODEL } from '@/lib/inspector';
import { loadHires } from '@/lib/staff-view';
import { refusal } from '@/lib/refusal';
import { requireStaff } from '@/lib/staff';
import { LAYOUT_ROLE_COOKIE, layoutName, type LayoutRole } from './saved-layout';

const MAX_STATE_BYTES = 512_000;

const DESK_INSTRUCTIONS = `You are the Clearhold desk for Ledgerton Hire staff. Answer questions about holds, hires and findings using only the JSON snapshot you are given.
- Be brief: two or three sentences, naming hire refs and £ amounts exactly as they appear.
- You cannot approve, lower, capture, release, refresh a hold or contact a renter. If asked, say which hire page a person should open to do it.
- Hold age is days since PayPal authorised it; holds older than 3 days are past the honour period and get refreshed before any capture. PayPal holds last 29 days.
- If the snapshot doesn't answer the question, say so.`;

// Read-only: the model sees structured fields only (no renter-written text), and has no tools.
export async function askDesk(question: string): Promise<{ answer: string } | { error: string }> {
  await requireStaff();
  const parsed = z.string().trim().min(1).max(300).safeParse(question);
  if (!parsed.success) return { error: 'Ask a question of up to 300 characters' };
  const hires = (await loadHires()).filter((h) => h.status !== 'settled');
  const snapshot = {
    today: new Date().toISOString().slice(0, 10),
    hires: hires.map((h) => ({
      ref: h.ref,
      item: h.item,
      shop: h.branch,
      status: h.step.status,
      nextStep: h.step.next,
      needsPerson: h.step.needsPerson,
      heldGBP: h.heldPence / 100,
      holdAgeDays: h.holdAgeDays,
      holdNeedsRefresh: h.holdToRefresh,
      collect: h.startAt.toISOString().slice(0, 10),
      dueBack: h.dueBackAt.toISOString().slice(0, 10),
      findings: h.findings.map((f) => ({
        angle: f.angle,
        kind: f.kind,
        outcome: f.outcome,
        confidence: f.confidence,
        proposedGBP: f.proposedGBP === null ? null : Number(f.proposedGBP),
        setGBP: f.setGBP === null ? null : Number(f.setGBP),
      })),
    })),
  };
  const started = Date.now();
  try {
    const { text, usage } = await generateText({
      model: anthropic(MODEL),
      instructions: DESK_INSTRUCTIONS,
      messages: [{ role: 'user', content: `${JSON.stringify(snapshot)}\n\nQuestion: ${parsed.data}` }],
      maxOutputTokens: 400,
    });
    await audit({ actor: 'ai', type: 'desk.answer', summary: `Desk answered: ${parsed.data.slice(0, 120)}`, model: MODEL, tokens: usage.totalTokens ?? null, latencyMs: Date.now() - started });
    return { answer: text.trim() };
  } catch (err) {
    console.error('[desk] failed', err);
    return { error: 'The desk could not answer just now; try again' };
  }
}

export async function lowerFinding(hireRef: string, findingId: string, form: FormData) {
  return refusal(requireStaff().then(() => setAmount(hireRef, findingId, form)));
}

export async function approveHire(hireRef: string) {
  return refusal(requireStaff().then(() => approveCharges(hireRef)));
}

export async function settleApproved(hireRef: string) {
  return refusal(requireStaff().then(() => settleHire(hireRef)));
}

const Role = z.enum(['ops', 'branch']);

// Remembers which layout this browser shows.
export async function setLayoutRole(role: LayoutRole): Promise<void> {
  await requireStaff();
  (await cookies()).set(LAYOUT_ROLE_COOKIE, Role.parse(role), { httpOnly: true, sameSite: 'lax', path: '/control-room', maxAge: 31_536_000 });
}

// Stores api.getState() as the given role's layout.
export async function saveLayout(role: LayoutRole, state: AgReportState): Promise<void> {
  await requireStaff();
  const name = layoutName(Role.parse(role));
  // Reachable by direct POST, so check the shape before storing it.
  if (typeof state !== 'object' || state === null || !Array.isArray((state as { pages?: unknown }).pages)) {
    throw new Error('Layout is not a Studio state object');
  }
  const json = JSON.stringify(state);
  if (json.length > MAX_STATE_BYTES) throw new Error('Layout is too large to save');

  const data = JSON.parse(json);
  await db.studioLayout.upsert({
    where: { name },
    create: { name, state: data },
    update: { state: data },
  });
}
