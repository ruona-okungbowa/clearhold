// The control room's desk agent: answers questions about holds, hires and findings, and hands widget work to
// AG's own page and widget agents. It runs on Claude through lib/studio/anthropic-adapter.ts -> /api/ai/responses
// and has no tool that moves money or reaches a renter: approving, lowering, capturing and
// releasing stay on the hire's pages, behind a person and a signed approval.

import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { anthropicAdapter } from '@/lib/studio/anthropic-adapter';

type Row = Record<string, unknown>;

const DAY = 86_400_000;
// A hold that can still be captured; CAPTURED, VOIDED and EXPIRED ones are done with.
const OPEN = new Set(['CREATED', 'PARTIALLY_CAPTURED']);
const time = (v: unknown) => new Date(v as string | number | Date).getTime();

export type HoldAtRisk = { holdId: string; hireRef: string; branch: string; daysLeft: number; reason: string };

// Open holds that run out before the kit is back plus 2 days, or are past the 3-day honour period with no
// reauthorisation (a later hold naming this one as its parent). Days left counts to PayPal's expiry.
export function holdsAtRisk(holds: Row[], hires: Row[], now: number): HoldAtRisk[] {
  const hireById = new Map(hires.map((h) => [h.id, h]));
  const reauthorised = new Set(holds.map((h) => h.parentId).filter(Boolean));
  return holds.flatMap((h) => {
    const hire = hireById.get(h.hireId);
    if (!hire || !OPEN.has(String(h.status))) return [];
    const reasons = [
      time(h.expiresAt) < time(hire.dueBackAt) + 2 * DAY && 'expires before the kit is due back plus 2 days',
      time(h.honourEndsAt) < now && !reauthorised.has(h.id) && 'past its honour period and not reauthorised',
    ].filter(Boolean);
    if (!reasons.length) return [];
    return [
      {
        holdId: String(h.id),
        hireRef: String(hire.hireRef),
        branch: String(hire.branch),
        daysLeft: Math.floor((time(h.expiresAt) - now) / DAY),
        reason: reasons.join('; '),
      },
    ];
  });
}

export const HOLDS_AT_RISK = {
  name: 'holds_at_risk',
  description:
    'Read-only. Lists open payment holds at risk: ones that expire before their hire is due back plus 2 days, or that are past their 3-day honour period and not yet reauthorised. Returns hold ids, hire refs, branch, days left until expiry and the reason.',
};

export const DESK_INSTRUCTIONS = `## Role
You are the desk agent in a formalwear hire shop's control room. Staff ask you about payment holds (PayPal authorisations, table holds), hires (table hires) and inspection findings (table findings). You are read-only: you answer and you arrange the dashboard, nothing else.

## Answering
- Holds expiring, running out, lapsing, or needing reauthorisation: call holds_at_risk. Report each hold's hire ref, branch and days left.
- Any other question about holds, hires or findings: delegate to Data (type 'data') and pass on its answer.
- Use @field[id], @widget[id] and @table[id] references.

## Widgets
When staff ask to show, filter or narrow the hires or holds, change what they see: delegate to Widget with "This is a modify", naming the widget of type 'work-queue' on the current page, and have it add a widget filter. @field[hires.ageDays] is the hold's age in days, @field[hires.heldGBP] the money still held, @field[hires.holdOpen] whether a hold is open, @field[hires.branch] the shop, @field[hires.stepStatus] the status and @field[hires.look] the look. Then say in one sentence what the queue now shows.
To add a widget, delegate to Page (type 'page') to place it, then to Widget (type 'widget', with the widgetType and the widgetId Page returned) to configure it. Never stop after Page: an unconfigured widget is empty. To filter a widget, delegate to Widget with "This is a modify".
When you report holds at risk, also show them: add a Hold timeline (widgetType 'hold-timeline') and have Widget give it a widget filter on @field[holds.id] keeping only the at-risk hold ids. Skip this if the page already has a Hold timeline filtered to the same holds.

## Never
You have no tool that approves, lowers, captures, releases or voids a charge or hold, or that contacts a renter or anyone else, and renter personal data (names, email addresses, phone numbers, addresses) is not available to you. If asked to do any of these, or for any renter's personal data, reply in exactly one sentence that you can't, and that staff do it on the hire's page; call no tool. Never ask the Data agent to look for personal data.`;

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Holds at risk', prompt: 'Which holds expire before their kit is due back?' },
  { label: 'Open findings', prompt: 'Which hires have findings waiting for an owner look?' },
];

// The first model is the default, the picker shows for two or more. The rows are the
// ones the page handed Studio, so holds_at_risk reads exactly what the widgets show.
export function buildDeskAi(models: string[], holds: Row[], hires: Row[]): AgAiHarnessSetup {
  const adapter = anthropicAdapter({ endpoint: '/api/ai' });

  return ({ api }) => {
    const holdsAtRiskTool = api.defineAiTool({
      ...HOLDS_AT_RISK,
      params: (s) => s.object({}),
      execute: (_args, ctx) => {
        const rows = holdsAtRisk(holds, hires, Date.now());
        return ctx.success(rows.length ? JSON.stringify(rows) : 'No holds are at risk.', rows);
      },
    });

    return createAiHarness(api, ({ builtIn }) => ({
      primary: 'desk',
      promptStarters: PROMPT_STARTERS,
      models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
      agents: [
        directLlmRunner({
          id: 'desk',
          name: 'Desk',
          description: 'Answers questions about holds, hires and findings, and arranges widgets. Read-only.',
          adapter,
          instructions: () => DESK_INSTRUCTIONS,
          tools: ({ studio, tools }) => [
            holdsAtRiskTool,
            studio.viewSchema(),
            studio.viewReport(),
            studio.viewPage(),
            tools.renameThread(),
            tools.delegateTo(['data', 'page', 'widget']),
          ],
        }),
        // Page places a widget and Widget configures it: Widget alone can't add one.
        ...[builtIn.data, builtIn.page, builtIn.widget].map((agent) => directLlmRunner({ ...agent, adapter })),
      ],
    }));
  };
}
