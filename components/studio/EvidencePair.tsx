'use client';

// Evidence pair: a custom AG Studio widget showing one hire's evidence: its pick-up and return crops with the ring box,
// the hire's status, and the next step. The hire is the one selected in the work queue (a cross filter), or the queue's
// top row until someone selects one.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AgFieldRole, AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';
import { Chip, gbp, type ChipKind } from '@/app/(lab)/chrome';
import { EvidencePair as Crops, type Box } from '@/app/(lab)/evidence';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { useRoom } from './room-context';

const FIELDS = {
  hireRef: { id: 'hires.hireRef', label: 'Hire', role: 'category' },
  chip: { id: 'hires.chip', label: 'Chip', role: 'category' },
  status: { id: 'hires.stepStatus', label: 'Status', role: 'category' },
  look: { id: 'hires.look', label: 'Look', role: 'category' },
  branch: { id: 'hires.branch', label: 'Shop', role: 'category' },
  holdOpen: { id: 'hires.holdOpen', label: 'Hold open', role: 'category' },
  held: { id: 'hires.heldGBP', label: 'Still held', role: 'numeric' },
  settled: { id: 'hires.isSettled', label: 'Settled', role: 'category' },
  next: { id: 'hires.nextStep', label: 'Next step', role: 'category' },
  nextHref: { id: 'hires.nextHref', label: 'Next step link', role: 'category' },
  pickupId: { id: 'hires.evidencePickupId', label: 'Pick-up photo', role: 'category' },
  returnId: { id: 'hires.evidenceReturnId', label: 'Return photo', role: 'category' },
  box: { id: 'hires.evidenceBox', label: 'Box', role: 'category' },
  what: { id: 'hires.evidenceWhat', label: 'Angle', role: 'category' },
} satisfies Record<string, { id: string; label: string; role: AgFieldRole }>;

type Key = keyof typeof FIELDS;
const KEYS = Object.keys(FIELDS) as Key[];

type EvidencePairDataMapping = Record<Key, AgWidgetFieldReference[]>;

export interface EvidencePairState extends AgWidgetData<EvidencePairDataMapping, AgWidgetDataFormat<unknown>> {
  type: 'evidence-pair';
}

type Row = { hireRef: string; chip: ChipKind; status: string; look: string; branch: string; holdOpen: boolean; held: number; settled: boolean; next: string; nextHref: string; pickupId: string; returnId: string; box: string; what: string };

const photo = (id: string) => `/api/photos/${id}`;

export function EvidencePair(params: AgWidgetParams<EvidencePairState>) {
  const { firstRef } = useRoom();
  const hasLoaded = useRef(false);
  const [rows, setRows] = useState<Row[]>([]);

  // Keyed on params, not dataMapping: Studio passes new params when page or cross filters change,
  // while dataMapping and widgetApi stay the same objects.
  useEffect(() => {
    const { dataMapping, widgetApi } = params;
    let active = true;
    const fetchData = async () => {
      if (KEYS.some((k) => !dataMapping[k]?.at(0))) {
        widgetApi.setDisplayState('incompleteDataMapping');
        setRows([]);
        return;
      }
      const field = (k: Key) => dataMapping[k]!.at(0)!;

      // A solid overlay on first load; after that a quiet refresh indicator over the previous hire.
      widgetApi.setDisplayState('loading', { prominent: !hasLoaded.current });
      const response = await widgetApi.getData({ fields: KEYS.map(field) });
      if (!active) return;

      const next = response.results.rows.map((row) => Object.fromEntries(KEYS.map((k) => [k, row[field(k).key] ?? ''])) as Row);
      hasLoaded.current = next.length > 0;
      setRows(next);
      widgetApi.setDisplayState(next.length > 0 ? 'displayed' : 'noData');
    };

    fetchData().catch((err) => {
      if (active) console.error('[EvidencePair] getData failed', err);
    });
    return () => {
      active = false;
    };
  }, [params]);

  // One row when a hire is selected in the queue.
  const row = rows.length === 1 ? rows[0] : (rows.find((r) => r.hireRef === firstRef) ?? rows[0]);
  // A root element even with no rows: Studio attaches the widget by the DOM of its first render.
  if (!row) return <div style={{ height: '100%' }} />;

  return (
    <section className={st.widget} aria-labelledby="ev-title">
      <div className={w.panelHead}>
        <h2 id="ev-title" className={w.sH2}>
          {row.hireRef}
        </h2>
        <Chip kind={row.chip}>{row.status}</Chip>
      </div>
      {row.pickupId || row.returnId ? (
        <Crops
          pickupId={row.pickupId || null}
          returnId={row.returnId || null}
          box={row.box ? (JSON.parse(row.box) as Box) : null}
          what={row.what}
          photo={photo}
          className={st.sPair}
        />
      ) : (
        <p className={w.sSub}>No findings yet for this hire.</p>
      )}
      <dl className={w.kv}>
        <div>
          <dt>Look</dt>
          <dd>{row.look}</dd>
        </div>
        <div>
          <dt>Shop</dt>
          <dd>{row.branch}</dd>
        </div>
        <div>
          <dt>Still held</dt>
          <dd>{row.holdOpen ? gbp(row.held) : '—'}</dd>
        </div>
      </dl>
      <Link href={row.nextHref} className={w.btn}>
        {row.settled ? 'Open the hire' : row.next}
      </Link>
    </section>
  );
}

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
  '<path d="M1 3h6v10H1zm8 0h6v10H9zm1.5 2v3h3V5z" fill-rule="evenodd"/></svg>';

export const evidencePairWidget: AgWidgetDefinition<'evidence-pair', EvidencePairState> = {
  id: 'evidence-pair',
  label: 'Evidence pair',
  icon: ICON,
  // Everything but the hire itself is one value per hire.
  dataMapping: Object.fromEntries(
    KEYS.map((k) => [
      k,
      {
        type: 'field',
        supportedRoles: [FIELDS[k].role],
        requires: k === 'hireRef' ? { cardinality: 'many' } : { per: 'dataMapping.hireRef', cardinality: 'one' },
        required: true,
      },
    ]),
  ) as AgWidgetDefinition<'evidence-pair', EvidencePairState>['dataMapping'],
  form: (params) => params.createDefaults({ dataMappingItems: KEYS.map((key) => ({ key, label: FIELDS[key].label })) }),
  defaultState: {
    dataMapping: Object.fromEntries(KEYS.map((k) => [k, [{ id: FIELDS[k].id }]])) as EvidencePairDataMapping,
  },
  comp: EvidencePair,
  defaultSize: { width: 400, height: 460 },
  minSize: { width: 300, height: 320 },
  ai: { description: "The selected hire's pick-up and return photos side by side, its status and its next step." },
};
