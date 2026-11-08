'use client';

// Hold timeline: a custom AG Studio widget drawing one bar per hold, from PayPal authorisation to expiry,
// with the 3-day honour period shaded at the start, a date axis underneath and a line marking today.
// Bars are labelled by the optional Label field (the hire ref by default) but always cross-filter on the
// hold itself; Ctrl/Cmd-click adds to the selection, clicking empty space clears it.

import { useEffect, useRef, useState } from 'react';
import type {
  AgDataMappingDefinition,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
  AgWidgetParams,
} from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';

type HoldTimelineDataMapping = {
  hold: AgWidgetFieldReference[];
  label?: AgWidgetFieldReference[];
  authorisedAt: AgWidgetFieldReference[];
  honourEndsAt: AgWidgetFieldReference[];
  expiresAt: AgWidgetFieldReference[];
};

export interface HoldTimelineState extends AgWidgetData<HoldTimelineDataMapping, AgWidgetDataFormat<unknown>> {
  type: 'hold-timeline';
}

type Bar = { id: unknown; label: string; start: number; honourEnd: number; end: number; title: string };

const toTime = (value: unknown) => new Date(value as string | number | Date).getTime();

const DAY = 86_400_000;
const TICK_STEPS_DAYS = [1, 2, 7, 14, 28, 91, 182];
const MAX_TICKS = 6;
const LABEL_COLUMN = '11rem';
const GAP = 8;
const TODAY_COLOUR = 'var(--amber)';
const formatTick = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// Local midnights from the first one after `min`, spaced so that at most MAX_TICKS fit before `max`.
export function axisTicks(min: number, max: number): number[] {
  const stepDays = TICK_STEPS_DAYS.find((d) => (max - min) / (d * DAY) <= MAX_TICKS) ?? TICK_STEPS_DAYS.at(-1)!;
  const ticks: number[] = [];
  const day = new Date(min);
  day.setHours(24, 0, 0, 0);
  // setDate, not adding ms, so ticks stay on midnight across clock changes.
  for (; day.getTime() <= max; day.setDate(day.getDate() + stepDays)) ticks.push(day.getTime());
  return ticks;
}

export function HoldTimeline(params: AgWidgetParams<HoldTimelineState>) {
  const { dataMapping, widgetApi } = params;
  const hasLoaded = useRef(false);
  const [bars, setBars] = useState<Bar[]>([]);
  // Taken on each load, so the today line moves on whenever the data refreshes.
  const [now, setNow] = useState(0);

  const holdField = dataMapping.hold?.at(0);
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
      const hold = dataMapping.hold?.at(0);
      const label = dataMapping.label?.at(0);
      const authorisedAt = dataMapping.authorisedAt?.at(0);
      const honourEndsAt = dataMapping.honourEndsAt?.at(0);
      const expiresAt = dataMapping.expiresAt?.at(0);
      if (!hold || !authorisedAt || !honourEndsAt || !expiresAt) {
        widgetApi.setDisplayState('incompleteDataMapping');
        setBars([]);
        return;
      }

      // A solid overlay on first load; after that a quiet refresh indicator over the previous bars.
      widgetApi.setDisplayState('loading', { prominent: !hasLoaded.current });
      const response = await widgetApi.getData({
        fields: [hold, ...(label ? [label] : []), authorisedAt, honourEndsAt, expiresAt],
        sort: [{ field: authorisedAt, direction: 'asc' }],
      });
      if (!active) return;

      const next: Bar[] = [];
      for (const row of response.results.rows) {
        const start = toTime(row[authorisedAt.key]);
        const honourEnd = toTime(row[honourEndsAt.key]);
        const end = toTime(row[expiresAt.key]);
        if ([start, honourEnd, end].some(Number.isNaN)) continue;
        const fmt = (field: typeof hold) => widgetApi.formatFieldValue(field, row[field.key]);
        const holdText = fmt(hold);
        const name = label ? fmt(label) : holdText;
        next.push({
          id: row[hold.key],
          label: name,
          start,
          honourEnd,
          end,
          title:
            `${name}${label ? ` (${holdText})` : ''}: authorised ${fmt(authorisedAt)}, ` +
            `honour ends ${fmt(honourEndsAt)}, expires ${fmt(expiresAt)}`,
        });
      }

      hasLoaded.current = next.length > 0;
      setNow(Date.now());
      setBars(next);
      widgetApi.setDisplayState(next.length > 0 ? 'displayed' : 'noData');
    };

    fetchData().catch((err) => {
      if (active) console.error('[HoldTimeline] getData failed', err);
    });
    return () => {
      active = false;
    };
  }, [params]);

  const min = Math.min(...bars.map((b) => b.start));
  const max = Math.max(...bars.map((b) => b.end));
  const span = max - min || 1;
  const frac = (t: number) => (t - min) / span;
  const pct = (t: number) => `${frac(t) * 100}%`;
  const width = (from: number, to: number) => `${(Math.max(0, to - from) / span) * 100}%`;
  const showToday = bars.length > 0 && now >= min && now <= max;
  // A point inside the track column, which starts after the label column and the gap.
  const trackLeft = (t: number) => `calc(${LABEL_COLUMN} + ${GAP}px + (100% - ${LABEL_COLUMN} - ${GAP}px) * ${frac(t)})`;

  return (
    <div
      onClick={() => widgetApi.resetCrossFilter()}
      style={{ height: '100%', padding: GAP, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Rows share the height so the bars fill the widget: at least 22px each, scrolling past that. */}
        <div style={{ position: 'relative', minHeight: '100%', display: 'grid', gridAutoRows: 'minmax(22px, 1fr)' }}>
          {bars.map((bar) => {
            const isSelected = selected.has(bar.id);
            const dimmed = selected.size > 0 && !isSelected;
            return (
              <button
                key={String(bar.id)}
                type="button"
                title={bar.title}
                aria-label={bar.title}
                aria-pressed={isSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!holdField) return;
                  widgetApi.toggleCrossFilter({
                    type: 'value',
                    value: bar.id,
                    field: holdField,
                    group: 0,
                    reset: !(e.metaKey || e.ctrlKey),
                  });
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `${LABEL_COLUMN} 1fr`,
                  alignItems: 'center',
                  gap: GAP,
                  padding: 0,
                  border: 0,
                  background: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  opacity: dimmed ? 0.35 : 1,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {bar.label}
                </span>
                <span style={{ position: 'relative', height: 18 }}>
                  <span
                    style={{
                      position: 'absolute',
                      insetBlock: 0,
                      left: pct(bar.start),
                      width: width(bar.start, bar.end),
                      borderRadius: 0,
                      background: 'color-mix(in srgb, var(--l-blue) 35%, white)',
                      outline: isSelected ? '2px solid var(--l-blue)' : undefined,
                    }}
                  />
                  {/* Honour period: authorisation to honourEndsAt, capped at expiry. */}
                  <span
                    style={{
                      position: 'absolute',
                      insetBlock: 0,
                      left: pct(bar.start),
                      width: width(bar.start, Math.min(bar.honourEnd, bar.end)),
                      borderRadius: 0,
                      background: 'var(--l-blue)',
                    }}
                  />
                </span>
              </button>
            );
          })}
          {showToday && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                insetBlock: 0,
                left: trackLeft(now),
                borderLeft: `2px solid ${TODAY_COLOUR}`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>
      {bars.length > 0 && (
        <div aria-hidden style={{ display: 'grid', gridTemplateColumns: `${LABEL_COLUMN} 1fr`, gap: GAP, fontSize: 11 }}>
          <span />
          <span style={{ position: 'relative', height: 18, borderTop: '1px solid var(--l-line)' }}>
            {axisTicks(min, max).map((t) => (
              <span
                key={t}
                style={{
                  position: 'absolute',
                  top: 2,
                  left: pct(t),
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                  opacity: 0.7,
                }}
              >
                {formatTick(t)}
              </span>
            ))}
            {showToday && (
              <span
                style={{
                  position: 'absolute',
                  top: 1,
                  left: pct(now),
                  transform: 'translateX(-50%)',
                  padding: '0 3px',
                  borderRadius: 0,
                  background: TODAY_COLOUR,
                  color: 'white',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Today
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
  '<rect x="1" y="2" width="9" height="3" rx="1"/><rect x="4" y="6.5" width="11" height="3" rx="1"/>' +
  '<rect x="2" y="11" width="7" height="3" rx="1"/></svg>';

// Each date must be a single value per hold.
const perHold = (aiDescription: string): AgDataMappingDefinition<keyof HoldTimelineDataMapping> => ({
  type: 'field',
  supportedRoles: ['temporal'],
  requires: { per: 'dataMapping.hold', cardinality: 'one' },
  required: true,
  aiDescription,
});

export const holdTimelineWidget: AgWidgetDefinition<'hold-timeline', HoldTimelineState> = {
  id: 'hold-timeline',
  label: 'Hold timeline',
  icon: ICON,
  dataMapping: {
    hold: {
      type: 'field',
      supportedRoles: ['category'],
      requires: { cardinality: 'many' },
      required: true,
      aiDescription: 'The hold (authorization) each bar represents. Clicking a bar cross-filters on it.',
    },
    label: {
      type: 'field',
      supportedRoles: ['category'],
      requires: { per: 'dataMapping.hold', cardinality: 'one' },
      required: false,
      aiDescription: 'Optional text shown beside each bar instead of the hold id, e.g. the hire reference.',
    },
    authorisedAt: perHold('When PayPal authorised the hold; the bar starts here.'),
    honourEndsAt: perHold('End of the 3-day honour period; shaded from the bar start.'),
    expiresAt: perHold('When the authorization expires; the bar ends here.'),
  },
  form: (params) =>
    params.createDefaults({
      dataMappingItems: [
        { key: 'hold', label: 'Hold' },
        { key: 'label', label: 'Label' },
        { key: 'authorisedAt', label: 'Authorised' },
        { key: 'honourEndsAt', label: 'Honour ends' },
        { key: 'expiresAt', label: 'Expires' },
      ],
    }),
  defaultState: {
    dataMapping: {
      hold: [{ id: 'holds.id' }],
      label: [{ id: 'hires.hireRef' }],
      authorisedAt: [{ id: 'holds.createdAt' }],
      honourEndsAt: [{ id: 'holds.honourEndsAt' }],
      expiresAt: [{ id: 'holds.expiresAt' }],
    },
  },
  comp: HoldTimeline,
  // About ten holds at a comfortable row height, plus the axis.
  defaultSize: { width: 800, height: 280 },
  minSize: { width: 320, height: 160 },
  ai: { description: 'Timeline of payment holds from authorisation to expiry, with the honour period shaded.' },
};
