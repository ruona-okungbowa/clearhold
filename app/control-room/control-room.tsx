"use client";

// The control room: one AG Studio report over the holds database. Holds (PayPal authorizations) and
// hires are two sync sources linked by hireId. Save stores api.getState() in a StudioLayout row, and
// the page passes that row back as initialState on the next load.

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  type AgBaseRegistry,
  type AgDataSourcesDefinition,
  type AgDefaultWidgetDefinition,
  type AgReportState,
  type AgStudioApi,
  type AgWidgetsConfig,
  type AgDefaultRegistry,
} from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { conditionHistoryWidget } from "@/components/studio/ConditionHistory";
import { evidencePairWidget } from "@/components/studio/EvidencePair";
import { holdTimelineWidget } from "@/components/studio/HoldTimeline";

interface ControlRoomRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | typeof holdTimelineWidget
    | typeof evidencePairWidget
    | typeof conditionHistoryWidget
  )[];
}
import { signOut } from "@/app/staff-login/actions";
import { saveLayout } from "./actions";
import { buildDeskAi } from "./desk-agent";

if (process.env.NODE_ENV !== "production") {
  enableStudioDevValidations();
}

type Row = Record<string, unknown>;

// Listed, not inferred: inference drops a column with no values, and most hires have no setGBP or setBy.
const FINDING_FIELDS = [
  ...[
    "id",
    "hireId",
    "angle",
    "kind",
    "description",
    "clauseId",
    "severity",
    "box",
    "pickupPhotoId",
    "returnPhotoId",
    "outcome",
    "reason",
    "setBy",
  ].map((id) => ({ id, format: "textFormat" as const })),
  ...["confidence", "proposedGBP", "setGBP"].map((id) => ({
    id,
    format: "decimalFormat" as const,
  })),
];

// Listed for the same reason: hireId and photoId are null on marks recorded before Clearhold.
const MARK_FIELDS = ["id", "itemRef", "description", "firstSeen", "hireId", "photoId"].map((id) => ({
  id,
  format: "textFormat" as const,
}));

// Under the Evidence pair on the holds page.
const CONDITION_HISTORY = {
  widget: { type: "condition-history", dataMapping: conditionHistoryWidget.defaultState!.dataMapping },
  ySpan: 20,
} as const;

// First visit, before anything is saved: a built-in grid of every hold with its hire, and the evidence beside it.
const DEFAULT_STATE = {
  pages: [
    {
      id: "holds",
      widgets: {
        1: {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "holds.id" },
              { id: "hires.hireRef" },
              { id: "hires.branch" },
              { id: "holds.status" },
              { id: "holds.amountGBP" },
              { id: "holds.createdAt" },
              { id: "holds.honourEndsAt" },
              { id: "holds.expiresAt" },
              { id: "hires.seeded" },
            ],
          },
        },
        2: {
          type: "evidence-pair",
          dataMapping: evidencePairWidget.defaultState!.dataMapping,
        },
        3: CONDITION_HISTORY.widget,
      },
      widgetLayout: {
        1: { xTrack: 0, yTrack: 0, xSpan: 10, ySpan: 40 },
        2: { xTrack: 10, yTrack: 0, xSpan: 14, ySpan: 40 },
        3: { xTrack: 10, yTrack: 40, xSpan: 14, ySpan: CONDITION_HISTORY.ySpan },
      },
    },
    // Risk: built-in charts over the per-hire numbers the page computes (keptPct, contestedPct, decided,
    // staffDecisions); averaging a 0-or-100 field gives the rate.
    {
      id: "risk",
      widgets: {
        1: {
          type: "line-chart",
          format: { title: { text: "Keep rate by shop, per week (% of settled hires charged)", enabled: true } },
          dataMapping: {
            categoryKey: [{ id: "hires.returnedAt::week" }],
            valueKey: [{ id: "hires.keptPct", aggregation: "avg" }],
            legendKey: [{ id: "hires.branch" }],
          },
        },
        2: {
          type: "bar-chart-grouped",
          format: { title: { text: "Contest rate by staff code (% of charge decisions, codes with 20 or more)", enabled: true } },
          dataMapping: {
            categoryKey: [{ id: "hires.staffCode" }],
            valueKey: [{ id: "hires.contestedPct", aggregation: "avg" }],
            tooltipKey: [{ id: "hires.staffDecisions", aggregation: "max" }],
          },
        },
      },
      widgetLayout: {
        1: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 30 },
        2: { xTrack: 0, yTrack: 30, xSpan: 24, ySpan: 34 },
      },
      filter: {
        widget: {
          1: [{ field: { id: "hires.status" }, model: { operator: "equals", value: "settled" } }],
          2: [
            { field: { id: "hires.decided" }, model: { operator: "isTrue" } },
            { field: { id: "hires.staffDecisions" }, model: { operator: "greaterThanOrEqual", value: 20 } },
          ],
        },
      },
    },
  ],
  selectedPageId: "holds",
} as AgReportState<ControlRoomRegistry>;

const PAGES = [
  ["holds", "Holds"],
  ["risk", "Risk"],
] as const;

const widgets = (config: AgWidgetsConfig<AgDefaultRegistry>) =>
  createWidgets<ControlRoomRegistry>({
    additionalTypes: [holdTimelineWidget, evidencePairWidget, conditionHistoryWidget],
    menu: [
      ...config.menu,
      { label: "Holds", widgetIds: ["hold-timeline", "evidence-pair", "condition-history"] },
    ],
  });

export function ControlRoom({
  holds,
  hires,
  findings,
  marks,
  savedState,
  licenseKey,
  aiModels,
}: {
  holds: Row[];
  hires: Row[];
  findings: Row[];
  marks: Row[];
  savedState: AgReportState<ControlRoomRegistry> | null;
  licenseKey?: string;
  aiModels?: string[];
}) {
  const apiRef = useRef<AgStudioApi | null>(null);
  // Read once, when Studio is created; off when no OpenAI key is configured.
  const [ai] = useState(() => (aiModels?.length ? buildDeskAi(aiModels, holds, hires) : undefined));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const data = useMemo<AgDataSourcesDefinition<ControlRoomRegistry>>(
    () => ({
      sources: [
        { id: "holds", data: holds },
        { id: "hires", data: hires },
        { id: "findings", data: findings, fields: FINDING_FIELDS },
        { id: "marks", data: marks, fields: MARK_FIELDS },
      ],
      relationships: [
        {
          id: "holds-hires",
          source: { tableId: "holds", fieldId: "hireId" },
          target: { tableId: "hires", fieldId: "id" },
          type: "many-to-one",
        },
        {
          id: "findings-hires",
          source: { tableId: "findings", fieldId: "hireId" },
          target: { tableId: "hires", fieldId: "id" },
          type: "many-to-one",
        },
        {
          id: "marks-hires",
          source: { tableId: "marks", fieldId: "hireId" },
          target: { tableId: "hires", fieldId: "id" },
          type: "many-to-one",
        },
      ],
    }),
    [holds, hires, findings, marks],
  );
  // Read once by Studio on mount. A layout saved before a field joined the evidence widget lacks its mapping,
  // which would leave the widget asking for one, so missing keys come from the widget's defaults.
  const [initialState] = useState(() => {
    if (!savedState) return DEFAULT_STATE;
    // A layout saved before the Risk page existed gets it added.
    if (!savedState.pages.some((p) => p.id === "risk")) savedState.pages.push(DEFAULT_STATE.pages.find((p) => p.id === "risk")!);
    // And one saved before Condition history gets it, under the Evidence pair (or below everything else).
    const holdsPage = savedState.pages.find((p) => p.id === "holds") as
      | { widgets?: Record<string, { type: string }>; widgetLayout?: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> }
      | undefined;
    if (holdsPage && !Object.values(holdsPage.widgets ?? {}).some((w) => w.type === "condition-history")) {
      const widgets = (holdsPage.widgets ??= {});
      const layout = (holdsPage.widgetLayout ??= {});
      const id = String(Math.max(0, ...Object.keys(widgets).map(Number).filter(Number.isFinite)) + 1);
      const evidence = Object.keys(widgets).find((k) => widgets[k].type === "evidence-pair");
      const under = evidence && layout[evidence];
      const bottom = Math.max(0, ...Object.values(layout).map((l) => l.yTrack + l.ySpan));
      widgets[id] = { ...CONDITION_HISTORY.widget };
      layout[id] = under
        ? { xTrack: under.xTrack, yTrack: under.yTrack + under.ySpan, xSpan: under.xSpan, ySpan: CONDITION_HISTORY.ySpan }
        : { xTrack: 0, yTrack: bottom, xSpan: 24, ySpan: CONDITION_HISTORY.ySpan };
    }
    for (const page of savedState.pages)
      for (const w of Object.values(page.widgets ?? {}) as { type: string; dataMapping?: object }[]) {
        if (w.type === "evidence-pair") w.dataMapping = { ...evidencePairWidget.defaultState!.dataMapping, ...w.dataMapping };
        if (w.type === "condition-history") w.dataMapping = { ...conditionHistoryWidget.defaultState!.dataMapping, ...w.dataMapping };
      }
    return savedState;
  });

  // Studio leaves page navigation to the host, so the header switches pages.
  const [pageId, setPageId] = useState(initialState.selectedPageId ?? "holds");
  const showPage = (id: string) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState({ ...api.getState(), selectedPageId: id });
    setPageId(id);
  };

  const save = async () => {
    const api = apiRef.current;
    if (!api) return;
    setStatus("saving");
    try {
      await saveLayout(api.getState());
      setStatus("saved");
    } catch (err) {
      console.error("[Control room] save failed", err);
      setStatus("error");
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-2">
        <div className="flex items-center gap-4">
          <h1 className="font-semibold">Control room</h1>
          <nav aria-label="Pages" className="flex gap-1 text-sm">
            {PAGES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => showPage(id)}
                aria-current={pageId === id ? "page" : undefined}
                className="rounded px-3 py-1 font-medium hover:bg-black/5 aria-[current=page]:bg-black/10"
              >
                {label}
              </button>
            ))}
            <Link href="/disputes" className="rounded px-3 py-1 font-medium hover:bg-black/5">
              Disputes
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span role="status" aria-live="polite">
            {status === "saving"
              ? "Saving…"
              : status === "saved"
                ? "Layout saved"
                : status === "error"
                  ? "Save failed"
                  : ""}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={status === "saving"}
            className="rounded border border-black/20 px-3 py-1 font-medium hover:bg-black/5 disabled:opacity-50"
          >
            Save layout
          </button>
          <form action={signOut}>
            <button type="submit" className="underline hover:text-black/70">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio<ControlRoomRegistry>
            style={{ height: "100%", width: "100%" }}
            data={data}
            widgets={widgets}
            initialState={initialState}
            ai={ai}
            mode="edit"
            onApiReady={(event) => {
              apiRef.current = event.api;
            }}
            onStateUpdated={() =>
              setStatus((s) => (s === "saved" ? "idle" : s))
            }
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
