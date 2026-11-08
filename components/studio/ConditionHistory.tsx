'use client';

// Condition history: a custom AG Studio widget showing one garment's life across its hires, oldest on the left. Each
// column is a hire: its ref and date, the pick-up front photo, the outcome and what it charged. Below, the garment's
// known marks, each joined by a line to the hire that first logged it: the item remembers.
// Clicking a column cross-filters on that hire (so the Evidence pair shows its findings); Ctrl/Cmd-click adds to the
// selection, clicking empty space clears it. The garment defaults to the one behind the report's current cross
// filter, otherwise the one with the most hires.

import { useEffect, useRef, useState } from 'react';
import type { AgFieldRole, AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';

const FIELDS = {
  hire: { id: 'hires.id', label: 'Hire', role: 'category' },
  hireRef: { id: 'hires.hireRef', label: 'Hire ref', role: 'category' },
  itemRef: { id: 'hires.itemRef', label: 'Garment', role: 'category' },
  startAt: { id: 'hires.startAt', label: 'Hired', role: 'temporal' },
  pickupPhotoId: { id: 'hires.pickupPhotoId', label: 'Pick-up front photo', role: 'category' },
  outcome: { id: 'hires.outcome', label: 'Outcome', role: 'category' },
  chargedGBP: { id: 'hires.chargedGBP', label: 'Charged', role: 'numeric' },
  mark: { id: 'marks.id', label: 'Known mark', role: 'category' },
  markItemRef: { id: 'marks.itemRef', label: 'Mark garment', role: 'category' },
  markDescription: { id: 'marks.description', label: 'Mark description', role: 'category' },
  markFirstSeen: { id: 'marks.firstSeen', label: 'Mark first seen', role: 'category' },
  markHire: { id: 'marks.hireId', label: 'Mark logged on hire', role: 'category' },
} satisfies Record<string, { id: string; label: string; role: AgFieldRole }>;

type Key = keyof typeof FIELDS;
const KEYS = Object.keys(FIELDS) as Key[];
const HIRE_KEYS = KEYS.filter((k) => FIELDS[k].id.startsWith('hires.'));
const MARK_KEYS = KEYS.filter((k) => FIELDS[k].id.startsWith('marks.'));

type ConditionHistoryDataMapping = Record<Key, AgWidgetFieldReference[]>;

export interface ConditionHistoryState extends AgWidgetData<ConditionHistoryDataMapping, AgWidgetDataFormat<unknown>> {
  type: 'condition-history';
}

type Hire = { id: unknown; hireRef: string; startAt: number; photoId: string; outcome: string; chargedGBP: number };
type Mark = { id: string; itemRef: string; description: string; firstSeen: string; hireId: unknown };

const COLUMN = 128;
const MARK_ROW = 30;
const LINE = '1px solid var(--l-line)';
const MARK_COLOUR = 'var(--amber)';
// Text and border colour per outcome; anything else (a hire not yet inspected) is neutral.
const CHIPS: Record<string, string> = {
  clean: 'var(--green)',
  charged: 'var(--l-ink)',
  'owner look': MARK_COLOUR,
  contested: 'var(--amber)',
};
const NEUTRAL = 'var(--l-muted)';

const gbp = (n: number) => `£${n.toFixed(2)}`;
const formatDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const outcomeText = (h: Hire) => (h.outcome === 'charged' ? `charged ${gbp(h.chargedGBP)}` : h.outcome);

export function ConditionHistory(params: AgWidgetParams<ConditionHistoryState>) {
  const { dataMapping, widgetApi } = params;
  const hasLoaded = useRef(false);
  const lastSelected = useRef<string | null>(null);
  const [byItem, setByItem] = useState<Map<string, Hire[]>>(new Map());
  const [marks, setMarks] = useState<Mark[]>([]);
  const [fromSelection, setFromSelection] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const hireField = dataMapping.hire?.at(0);
  const selected = new Set<unknown>();
  for (const selection of widgetApi.getCrossFilterSelections() ?? []) {
    if (selection.type === 'value') selection.values.forEach((v: unknown) => selected.add(v));
  }

  // Keyed on params, not dataMapping: Studio passes new params when page or cross filters change,
  // while dataMapping and widgetApi stay the same objects.
  useEffect(() => {
    const { dataMapping, widgetApi } = params;
    let active = true;
    const fetchData = async () => {
      if (KEYS.some((k) => !dataMapping[k]?.at(0))) {
        widgetApi.setDisplayState('incompleteDataMapping');
        setByItem(new Map());
        return;
      }
      const field = (k: Key) => dataMapping[k]!.at(0)!;

      widgetApi.setDisplayState('loading', { prominent: !hasLoaded.current });
      const [hireData, markData] = await Promise.all([
        // Highlight: every hire, so the garment's whole life shows, plus the cross-filtered ones to pick the garment.
        widgetApi.getData(
          { fields: HIRE_KEYS.map(field), sort: [{ field: field('startAt'), direction: 'asc' }] },
          { crossFilter: 'highlight', queryId: 'hires' },
        ),
        widgetApi.getData({ fields: MARK_KEYS.map(field) }, { crossFilter: 'none', queryId: 'marks' }),
      ]);
      if (!active) return;

      const value = (row: Record<string, unknown>, k: Key) => row[field(k).key];
      const next = new Map<string, Hire[]>();
      for (const row of hireData.results.rows) {
        const itemRef = String(value(row, 'itemRef') ?? '');
        const startAt = new Date(value(row, 'startAt') as string | number | Date).getTime();
        if (!itemRef || Number.isNaN(startAt)) continue;
        if (!next.has(itemRef)) next.set(itemRef, []);
        next.get(itemRef)!.push({
          id: value(row, 'hire'),
          hireRef: String(value(row, 'hireRef') ?? ''),
          startAt,
          photoId: String(value(row, 'pickupPhotoId') ?? ''),
          outcome: String(value(row, 'outcome') ?? ''),
          chargedGBP: Number(value(row, 'chargedGBP') ?? 0),
        });
      }

      // With a cross filter on, the filtered rows are fewer: their most common garment is the one in view.
      const filtered = hireData.crossFilter?.rows ?? [];
      let selection: string | null = null;
      if (filtered.length > 0 && filtered.length < hireData.results.rows.length) {
        const counts = new Map<string, number>();
        for (const row of filtered) {
          const ref = String(value(row, 'itemRef') ?? '');
          counts.set(ref, (counts.get(ref) ?? 0) + 1);
        }
        selection = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      }
      // A new selection elsewhere replaces the garment picked here.
      if (selection && selection !== lastSelected.current) setPicked(null);
      lastSelected.current = selection;

      hasLoaded.current = next.size > 0;
      setByItem(next);
      setFromSelection(selection);
      setMarks(
        markData.results.rows.map((row) => ({
          id: String(value(row, 'mark')),
          itemRef: String(value(row, 'markItemRef') ?? ''),
          description: String(value(row, 'markDescription') ?? ''),
          firstSeen: String(value(row, 'markFirstSeen') ?? ''),
          hireId: value(row, 'markHire'),
        })),
      );
      widgetApi.setDisplayState(next.size > 0 ? 'displayed' : 'noData');
    };

    fetchData().catch((err) => {
      if (active) console.error('[ConditionHistory] getData failed', err);
    });
    return () => {
      active = false;
    };
  }, [params]);

  // Most hires first, then by ref; that order also gives the fallback garment.
  const items = [...byItem]
    .map(([ref, hires]) => ({ ref, count: hires.length }))
    .sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref));
  const itemRef = [picked, fromSelection].find((r) => r && byItem.has(r)) ?? items[0]?.ref;
  // A root element even with no rows: Studio attaches the widget by the DOM of its first render.
  if (!itemRef) return <div style={{ height: '100%' }} />;

  const hires = byItem.get(itemRef)!;
  const column = new Map(hires.map((h, i) => [h.id, i]));
  const itemMarks = marks
    .filter((m) => m.itemRef === itemRef)
    .sort((a, b) => (column.get(a.hireId) ?? Infinity) - (column.get(b.hireId) ?? Infinity));

  return (
    <div
      onClick={() => widgetApi.resetCrossFilter()}
      style={{ height: '100%', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}
    >
      <style>{`.condition-history-column:focus-visible { outline: 2px solid var(--l-blue); outline-offset: 2px; }`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Garment
          <select
            value={itemRef}
            onChange={(e) => setPicked(e.target.value)}
            style={{ padding: '2px 4px', border: LINE, borderRadius: 0, background: 'none', color: 'inherit', font: 'inherit' }}
          >
            {items.map((item) => (
              <option key={item.ref} value={item.ref}>
                {item.ref} ({item.count})
              </option>
            ))}
          </select>
        </label>
        <span style={{ opacity: 0.7 }}>
          {hires.length} {hires.length === 1 ? 'hire' : 'hires'} · {itemMarks.length} known{' '}
          {itemMarks.length === 1 ? 'mark' : 'marks'}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div
          role="group"
          aria-label={`Hires of ${itemRef}, oldest first`}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${hires.length}, ${COLUMN}px)`,
            gridTemplateRows: 'auto',
            gridAutoRows: MARK_ROW,
            columnGap: 8,
            width: 'max-content',
            paddingBottom: 4,
          }}
        >
          {hires.map((h, i) => {
            const isSelected = selected.has(h.id);
            const colour = CHIPS[h.outcome] ?? NEUTRAL;
            return (
              <button
                key={String(h.id)}
                type="button"
                className="condition-history-column"
                aria-pressed={isSelected}
                aria-label={`${h.hireRef}, hired ${formatDate(h.startAt)}: ${outcomeText(h)}. Filters the report to this hire.`}
                title={`${h.hireRef}: ${outcomeText(h)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!hireField) return;
                  widgetApi.toggleCrossFilter({ type: 'value', value: h.id, field: hireField, group: 0, reset: !(e.metaKey || e.ctrlKey) });
                }}
                style={{
                  gridRow: 1,
                  gridColumn: i + 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: 6,
                  marginBottom: 6,
                  border: isSelected ? '2px solid var(--l-blue)' : LINE,
                  borderRadius: 0,
                  background: isSelected ? 'var(--l-selected)' : 'none',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  opacity: selected.size > 0 && !isSelected ? 0.5 : 1,
                }}
              >
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                  {h.hireRef}
                </span>
                <span style={{ opacity: 0.7 }}>{formatDate(h.startAt)}</span>
                {h.photoId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser
                  <img
                    src={`/api/photos/${h.photoId}`}
                    alt=""
                    loading="lazy"
                    style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 0, background: 'var(--l-ground)' }}
                  />
                ) : (
                  <span
                    style={{
                      width: '100%',
                      aspectRatio: '4 / 3',
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 0,
                      background: 'var(--l-ground)',
                      opacity: 0.7,
                    }}
                  >
                    No photo
                  </span>
                )}
                <span
                  style={{
                    alignSelf: 'flex-start',
                    padding: '1px 6px',
                    borderRadius: 0,
                    border: `1px solid ${colour}`,
                    color: colour,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h.outcome}
                </span>
                <span>{h.outcome === 'not inspected' ? '—' : gbp(h.chargedGBP)}</span>
              </button>
            );
          })}

          {itemMarks.map((m, i) => {
            const at = column.get(m.hireId);
            const row = i + 2;
            const text = (
              <>
                <strong>{m.id}</strong> {m.description} · first seen {m.firstSeen}
                {at !== undefined && ` (${hires[at].hireRef})`}
              </>
            );
            // A mark logged before this history (or on a hire outside it) has no column to point at.
            if (at === undefined)
              return (
                <div key={m.id} style={{ gridRow: row, gridColumn: '1 / -1', alignSelf: 'center', whiteSpace: 'nowrap' }}>
                  {text}
                </div>
              );
            return [
              // From the bottom of the hire's column down to this mark's row.
              <div key={`${m.id}-line`} aria-hidden style={{ gridRow: `2 / ${row + 1}`, gridColumn: at + 1, position: 'relative', pointerEvents: 'none' }}>
                <span
                  style={{ position: 'absolute', left: COLUMN / 2 - 1, top: -6, bottom: MARK_ROW / 2, borderLeft: `2px solid ${MARK_COLOUR}` }}
                />
              </div>,
              <div
                key={m.id}
                style={{
                  gridRow: row,
                  gridColumn: `${at + 1} / -1`,
                  alignSelf: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  paddingLeft: COLUMN / 2 - 1,
                  whiteSpace: 'nowrap',
                }}
              >
                <span aria-hidden style={{ width: 12, borderTop: `2px solid ${MARK_COLOUR}` }} />
                <span>{text}</span>
              </div>,
            ];
          })}
        </div>
      </div>
    </div>
  );
}

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
  '<rect x="1" y="2" width="3" height="6" rx="1"/><rect x="6.5" y="2" width="3" height="6" rx="1"/>' +
  '<rect x="12" y="2" width="3" height="6" rx="1"/><path d="M7.25 9h1.5v3H14v1.5H7.25z"/></svg>';

const ANCHORS: Partial<Record<Key, true>> = { hire: true, mark: true };

export const conditionHistoryWidget: AgWidgetDefinition<'condition-history', ConditionHistoryState> = {
  id: 'condition-history',
  label: 'Condition history',
  icon: ICON,
  // Hire fields are one value per hire, mark fields one per mark.
  dataMapping: Object.fromEntries(
    KEYS.map((k) => [
      k,
      {
        type: 'field',
        supportedRoles: [FIELDS[k].role],
        requires: ANCHORS[k]
          ? { cardinality: 'many' }
          : { per: HIRE_KEYS.includes(k) ? 'dataMapping.hire' : 'dataMapping.mark', cardinality: 'one' },
        required: true,
      },
    ]),
  ) as AgWidgetDefinition<'condition-history', ConditionHistoryState>['dataMapping'],
  form: (params) => params.createDefaults({ dataMappingItems: KEYS.map((key) => ({ key, label: FIELDS[key].label })) }),
  defaultState: {
    dataMapping: Object.fromEntries(KEYS.map((k) => [k, [{ id: FIELDS[k].id }]])) as ConditionHistoryDataMapping,
  },
  comp: ConditionHistory,
  defaultSize: { width: 640, height: 360 },
  minSize: { width: 360, height: 240 },
  ai: {
    description:
      "One garment's life across its hires, oldest first: each hire's pick-up photo, outcome and charge, and the garment's known marks linked to the hire that logged them.",
  },
};
