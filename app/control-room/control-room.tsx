"use client";

// The AG Studio report inside the control room: holds (PayPal authorizations) and hires as sync sources linked by
// hireId, a Holds page of custom widgets and a Risk page of built-in charts. Save stores api.getState() in a
// StudioLayout row per role, and the page passes those rows back. Everything here that isn't a React component is
// a pure function over Studio's state, so the tabs, shop filter and role switch can drive it through api.setState.

import { useMemo, type RefObject } from "react";
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  type AgAiHarnessSetup,
  type AgBaseRegistry,
  type AgDataSourcesDefinition,
  type AgDefaultWidgetDefinition,
  type AgPanelConfig,
  type AgReportState,
  type AgStudioApi,
  type AgWidgetsConfig,
  type AgDefaultRegistry,
} from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import st from "@/app/(lab)/staff.module.css";
import { conditionHistoryWidget } from "@/components/studio/ConditionHistory";
import { deskPanelWidget } from "@/components/studio/DeskPanel";
import { evidencePairWidget } from "@/components/studio/EvidencePair";
import { holdTimelineWidget } from "@/components/studio/HoldTimeline";
import { workQueueWidget } from "@/components/studio/WorkQueue";
import { agStudioLedgerTheme } from "@/lib/studio/theme";
import type { LayoutRole } from "./saved-layout";

export interface ControlRoomRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | typeof workQueueWidget
    | typeof deskPanelWidget
    | typeof holdTimelineWidget
    | typeof evidencePairWidget
    | typeof conditionHistoryWidget
  )[];
}

export type RoomState = AgReportState<ControlRoomRegistry>;

if (process.env.NODE_ENV !== "production") {
  enableStudioDevValidations();
}

type Row = Record<string, unknown>;

// Listed, not inferred: inference drops a column with no values, and most hires have no setGBP or setBy.
const FINDING_FIELDS = [
  ...["id", "hireId", "angle", "kind", "description", "clauseId", "severity", "box", "pickupPhotoId", "returnPhotoId", "outcome", "reason", "setBy"].map((id) => ({
    id,
    format: "textFormat" as const,
  })),
  ...["confidence", "proposedGBP", "setGBP"].map((id) => ({ id, format: "decimalFormat" as const })),
];

// Listed for the same reason: hireId and photoId are null on marks recorded before Clearhold.
const MARK_FIELDS = ["id", "itemRef", "description", "firstSeen", "hireId", "photoId"].map((id) => ({ id, format: "textFormat" as const }));

const CONDITION_HISTORY = {
  widget: {
    type: "condition-history",
    format: { title: { text: "Condition history", enabled: true } },
    dataMapping: conditionHistoryWidget.defaultState!.dataMapping,
  },
  ySpan: 20,
} as const;

const HOLD_TIMELINE = {
  type: "hold-timeline",
  format: { title: { text: "Hold timeline", enabled: true } },
  dataMapping: holdTimelineWidget.defaultState!.dataMapping,
} as const;

const OLD_EVIDENCE_SPAN = 34;
const EVIDENCE_SPAN = 44;
const QUEUE_SPAN = EVIDENCE_SPAN + 24;

// The designed screen: queue left with Evidence and the desk beside it, 17/7 of 24 tracks being the old 1fr and 400px.
const holdsPage = (role: LayoutRole) => ({
  id: "holds",
  widgets: {
    1: { type: "work-queue", dataMapping: workQueueWidget.defaultState!.dataMapping },
    2: { type: "evidence-pair", dataMapping: evidencePairWidget.defaultState!.dataMapping },
    3: { type: "desk-panel", dataMapping: {} },
    4: HOLD_TIMELINE,
    5: CONDITION_HISTORY.widget,
  },
  widgetLayout: {
    1: { xTrack: 0, yTrack: 0, xSpan: 17, ySpan: QUEUE_SPAN },
    2: { xTrack: 17, yTrack: 0, xSpan: 7, ySpan: EVIDENCE_SPAN },
    3: { xTrack: 17, yTrack: EVIDENCE_SPAN, xSpan: 7, ySpan: 24 },
    // A branch cares more about its garments than its holds.
    4: role === "ops" ? { xTrack: 0, yTrack: QUEUE_SPAN, xSpan: 12, ySpan: 20 } : { xTrack: 0, yTrack: QUEUE_SPAN, xSpan: 8, ySpan: 26 },
    5: role === "ops" ? { xTrack: 12, yTrack: QUEUE_SPAN, xSpan: 12, ySpan: CONDITION_HISTORY.ySpan } : { xTrack: 8, yTrack: QUEUE_SPAN, xSpan: 16, ySpan: 26 },
  },
});

// Risk: built-in charts over the per-hire numbers the page computes (keptPct, contestedPct, decided,
// staffDecisions); averaging a 0-or-100 field gives the rate.
const RISK_PAGE = {
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
};

const defaultState = (role: LayoutRole) => ({ pages: role === "ops" ? [holdsPage(role), RISK_PAGE] : [holdsPage(role)], selectedPageId: "holds" }) as unknown as RoomState;

// Studio's state, typed only as far as the functions below read it.
type Track = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
type Filter = { field: { id: string }; model?: unknown };
type LooseWidget = { type: string; dataMapping?: object; sort?: unknown };
type LoosePage = { id: string; widgets?: Record<string, LooseWidget>; widgetLayout?: Record<string, Track>; filter?: { page?: Filter[]; widget?: Record<string, Filter[]> }; crossFilter?: unknown };
type LooseState = { pages: LoosePage[]; selectedPageId?: string };
const loose = (state: RoomState) => state as unknown as LooseState;
const tight = (state: LooseState) => state as unknown as RoomState;

// A saved layout, brought up to what this version of the page needs. Never mutates what it's given.
export function buildLayout(saved: AgReportState | null, role: LayoutRole): RoomState {
  if (!saved) return defaultState(role);
  const state = structuredClone(saved) as unknown as LooseState;
  const fresh = loose(defaultState(role));

  // A layout from before the work queue has no usable Holds page: its grid and Evidence pair read other fields.
  const holdsAt = state.pages.findIndex((p) => p.id === "holds");
  if (holdsAt < 0 || !Object.values(state.pages[holdsAt].widgets ?? {}).some((w) => w.type === "work-queue")) {
    if (holdsAt < 0) state.pages.unshift(fresh.pages[0]);
    else state.pages[holdsAt] = fresh.pages[0];
  }
  // A layout saved before the Risk page existed gets it added.
  if (role === "ops" && !state.pages.some((p) => p.id === "risk")) state.pages.push(RISK_PAGE as unknown as LoosePage);

  // And one saved before Condition history gets it, under the Evidence pair (or below everything else).
  const holds = state.pages.find((p) => p.id === "holds");
  if (holds && !Object.values(holds.widgets ?? {}).some((w) => w.type === "condition-history")) {
    const widgets = (holds.widgets ??= {});
    const layout = (holds.widgetLayout ??= {});
    const id = String(Math.max(0, ...Object.keys(widgets).map(Number).filter(Number.isFinite)) + 1);
    const evidence = Object.keys(widgets).find((k) => widgets[k].type === "evidence-pair");
    const under = evidence && layout[evidence];
    const bottom = Math.max(0, ...Object.values(layout).map((l) => l.yTrack + l.ySpan));
    widgets[id] = { ...CONDITION_HISTORY.widget };
    layout[id] = under
      ? { xTrack: under.xTrack, yTrack: under.yTrack + under.ySpan, xSpan: under.xSpan, ySpan: CONDITION_HISTORY.ySpan }
      : { xTrack: 0, yTrack: bottom, xSpan: 24, ySpan: CONDITION_HISTORY.ySpan };
  }
  // One saved when the Evidence pair was too short for its finding has it grown, pushing down what's below and
  // stretching anything running alongside. Matches the old height exactly, so a size someone chose is left alone.
  const evidenceId = holds && Object.keys(holds.widgets ?? {}).find((k) => holds.widgets![k].type === "evidence-pair");
  const evidence = evidenceId ? holds.widgetLayout?.[evidenceId] : undefined;
  if (evidence?.ySpan === OLD_EVIDENCE_SPAN) {
    const bottom = evidence.yTrack + OLD_EVIDENCE_SPAN;
    const grow = EVIDENCE_SPAN - OLD_EVIDENCE_SPAN;
    for (const l of Object.values(holds!.widgetLayout!)) {
      if (l.yTrack >= bottom) l.yTrack += grow;
      else if (l.yTrack + l.ySpan > bottom) l.ySpan += grow;
    }
    evidence.ySpan = EVIDENCE_SPAN;
  }

  // A layout saved before a field joined a widget lacks its mapping, which would leave the widget asking for one.
  const defaults: Record<string, object | undefined> = {
    "work-queue": workQueueWidget.defaultState!.dataMapping,
    "evidence-pair": evidencePairWidget.defaultState!.dataMapping,
    "condition-history": conditionHistoryWidget.defaultState!.dataMapping,
  };
  for (const page of state.pages)
    for (const w of Object.values(page.widgets ?? {})) if (defaults[w.type]) w.dataMapping = { ...defaults[w.type], ...w.dataMapping };

  return tight(state);
}

export const ALL_SHOPS = "All shops";
const HOLDS_VIEW = 2;
const VIEW_FILTERS: Filter[] = [
  { field: { id: "hires.needsPerson" }, model: { operator: "isTrue" } },
  { field: { id: "hires.isSettled" }, model: { operator: "isFalse" } },
  { field: { id: "hires.holdOpen" }, model: { operator: "isTrue" } },
  { field: { id: "hires.isSettled" }, model: { operator: "isTrue" } },
];
// The filters the page owns; anything else on the queue (a person's, or the desk agent's) is left alone.
const OWNED = new Set(["hires.needsPerson", "hires.isSettled", "hires.holdOpen", "hires.branch"]);
const free = (filters: Filter[] = []) => filters.filter((f) => !OWNED.has(f.field.id));

/** The state with the view tab and shop applied. `view: null` takes them off again, which is what gets saved. */
export function withView(state: RoomState, view: number | null, shop: string): RoomState {
  const s = loose(state);
  return tight({
    ...s,
    pages: s.pages.map((p) => {
      const queue = p.id === "holds" ? Object.keys(p.widgets ?? {}).find((k) => p.widgets![k].type === "work-queue") : undefined;
      if (!queue) return p;
      return {
        ...p,
        widgets: { ...p.widgets, [queue]: { ...p.widgets![queue], sort: view === HOLDS_VIEW ? [{ field: { id: "hires.ageDays" }, direction: "desc" }] : undefined } },
        filter: {
          ...p.filter,
          page: [...free(p.filter?.page), ...(shop === ALL_SHOPS ? [] : [{ field: { id: "hires.branch" }, model: { operator: "equals", value: shop } }])],
          widget: { ...p.filter?.widget, [queue]: [...free(p.filter?.widget?.[queue]), ...(view === null ? [] : [VIEW_FILTERS[view]])] },
        },
      };
    }),
  });
}

/** What a Save stores: the layout, without this moment's tab, shop or selected hire. */
export function forSaving(state: RoomState): RoomState {
  const s = loose(withView(state, null, ALL_SHOPS));
  return tight({ ...s, pages: s.pages.map((p) => ({ ...p, crossFilter: undefined })) });
}

/** One column on a phone: Studio's tracks don't reflow, so the widgets are restacked top to bottom. */
export function stacked(state: RoomState): RoomState {
  const s = loose(state);
  return tight({
    ...s,
    pages: s.pages.map((p) => {
      let y = 0;
      const order = Object.entries(p.widgetLayout ?? {}).sort(([, a], [, b]) => a.yTrack - b.yTrack || a.xTrack - b.xTrack);
      return {
        ...p,
        widgetLayout: Object.fromEntries(
          order.map(([id, l]) => {
            const placed = { ...l, xTrack: 0, xSpan: 24, yTrack: y };
            y += l.ySpan;
            return [id, placed];
          }),
        ),
      };
    }),
  });
}

/** `state` with the widget positions from `positions`: undoes `stacked` without losing a tab change made since. */
export function withPositionsOf(state: RoomState, positions: RoomState): RoomState {
  const s = loose(state);
  const from = loose(positions);
  return tight({ ...s, pages: s.pages.map((p) => ({ ...p, widgetLayout: from.pages.find((f) => f.id === p.id)?.widgetLayout ?? p.widgetLayout })) });
}

const TRACK_PX = 16;
// Studio's canvas measures 2px taller than its tracks, which would otherwise put a scrollbar on it.
const CANVAS_EXTRA_PX = 2;
/** How tall the canvas must be to show the current page without scrolling inside it. */
export function studioHeight(state: RoomState) {
  const s = loose(state);
  const page = s.pages.find((p) => p.id === s.selectedPageId) ?? s.pages[0];
  return Math.max(0, ...Object.values(page?.widgetLayout ?? {}).map((l) => l.yTrack + l.ySpan)) * TRACK_PX + CANVAS_EXTRA_PX;
}

const widgets = (config: AgWidgetsConfig<AgDefaultRegistry>) =>
  createWidgets<ControlRoomRegistry>({
    additionalTypes: [workQueueWidget, evidencePairWidget, deskPanelWidget, holdTimelineWidget, conditionHistoryWidget],
    menu: [...config.menu, { label: "Holds", widgetIds: ["work-queue", "evidence-pair", "desk-panel", "hold-timeline", "condition-history"] }],
  });

const AI_MODULES = [AgStudioAiModule];
// No panels in view mode: the shop filter would otherwise open Studio's filter panel over the designed screen.
const PANELS: AgPanelConfig = { view: {} };

export function ControlRoom({
  apiRef,
  initialState,
  holds,
  hires,
  findings,
  marks,
  licenseKey,
  ai,
  editing,
  height,
  onReady,
  onStateUpdated,
}: {
  apiRef: RefObject<AgStudioApi<ControlRoomRegistry> | null>;
  initialState: RoomState;
  holds: Row[];
  hires: Row[];
  findings: Row[];
  marks: Row[];
  licenseKey?: string;
  ai?: AgAiHarnessSetup;
  editing: boolean;
  height: number;
  onReady: () => void;
  onStateUpdated: () => void;
}) {
  const data = useMemo<AgDataSourcesDefinition<ControlRoomRegistry>>(
    () => ({
      sources: [
        { id: "holds", data: holds },
        { id: "hires", data: hires },
        { id: "findings", data: findings, fields: FINDING_FIELDS },
        { id: "marks", data: marks, fields: MARK_FIELDS },
      ],
      relationships: [
        { id: "holds-hires", source: { tableId: "holds", fieldId: "hireId" }, target: { tableId: "hires", fieldId: "id" }, type: "many-to-one" },
        { id: "findings-hires", source: { tableId: "findings", fieldId: "hireId" }, target: { tableId: "hires", fieldId: "id" }, type: "many-to-one" },
        { id: "marks-hires", source: { tableId: "marks", fieldId: "hireId" }, target: { tableId: "hires", fieldId: "id" }, type: "many-to-one" },
      ],
    }),
    [holds, hires, findings, marks],
  );

  return (
    <div className={st.studio} style={{ height }}>
      <AgStudioProvider licenseKey={licenseKey} modules={ai ? AI_MODULES : undefined}>
        <AgStudio<ControlRoomRegistry>
          style={{ height: "100%", width: "100%" }}
          theme={agStudioLedgerTheme}
          data={data}
          widgets={widgets}
          initialState={initialState}
          panels={PANELS}
          ai={ai}
          mode={editing ? "edit" : "view"}
          onApiReady={(event) => {
            apiRef.current = event.api as unknown as AgStudioApi<ControlRoomRegistry>;
          }}
          onStudioReady={onReady}
          onStateUpdated={onStateUpdated}
        />
      </AgStudioProvider>
    </div>
  );
}
