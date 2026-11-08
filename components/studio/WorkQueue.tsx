'use client';

// Work queue: a custom AG Studio widget holding an AG Grid of the hires, with the view tabs and the holds-by-age chart
// in the same panel. It's a custom widget because Studio's own grid has no row selection. Data comes through
// widgetApi.getData, so page and widget filters (the tabs, the shop, the desk agent) reach it; selecting a row
// cross-filters the report on that hire, which is what drives the Evidence pair.

import { AllCommunityModule, type CellKeyDownEvent, type ColDef, type GridApi, type SelectionChangedEvent } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AgFieldRole, AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';
import { Chip, staffUrl, type ChipKind } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { ledgerGridTheme } from '@/lib/studio/grid-theme';
import { useRoom, VIEWS } from './room-context';

const FIELDS = {
  ref: { id: 'hires.hireRef', label: 'Hire', role: 'category' },
  look: { id: 'hires.look', label: 'Look', role: 'category' },
  shop: { id: 'hires.branch', label: 'Shop', role: 'category' },
  chip: { id: 'hires.chip', label: 'Chip', role: 'category' },
  status: { id: 'hires.stepStatus', label: 'Status', role: 'category' },
  next: { id: 'hires.nextStep', label: 'Next step', role: 'category' },
  nextHref: { id: 'hires.nextHref', label: 'Next step link', role: 'category' },
  holdOpen: { id: 'hires.holdOpen', label: 'Hold open', role: 'category' },
  held: { id: 'hires.heldGBP', label: 'Held', role: 'numeric' },
  age: { id: 'hires.ageDays', label: 'Hold age', role: 'numeric' },
} satisfies Record<string, { id: string; label: string; role: AgFieldRole }>;

type Key = keyof typeof FIELDS;
const KEYS = Object.keys(FIELDS) as Key[];

type WorkQueueDataMapping = Record<Key, AgWidgetFieldReference[]>;

export interface WorkQueueState extends AgWidgetData<WorkQueueDataMapping, AgWidgetDataFormat<unknown>> {
  type: 'work-queue';
}

type Row = { ref: string; look: string; renter: string; shop: string; chip: ChipKind; status: string; next: string; nextHref: string; holdOpen: boolean; held: number; age: number };

const MODULES = [AllCommunityModule];
const SELECTION = { mode: 'singleRow', checkboxes: false, enableClickSelection: 'enableSelection' } as const;

// A column's own cellClass replaces the one its rightAligned type sets, so that class is repeated here.
const RIGHT_CELL = ['ag-right-aligned-cell', st.tabular];

const COLUMNS: ColDef<Row>[] = [
  // Fixed columns need a width: without one AG Grid gives each 200px and the eight no longer fit the panel.
  { field: 'ref', headerName: 'Hire', width: 115, cellRenderer: ({ value }: { value: string }) => <Link href={staffUrl.hire(value)}>{value}</Link> },
  { field: 'look', headerName: 'Look', minWidth: 120, flex: 1 },
  { field: 'renter', headerName: 'Renter', minWidth: 110, flex: 1 },
  { field: 'shop', headerName: 'Shop', width: 105 },
  { field: 'status', headerName: 'Status', width: 140, cellRenderer: ({ value, data }: { value: string; data?: Row }) => <Chip kind={data?.chip ?? 'stPlain'}>{value}</Chip> },
  { field: 'next', headerName: 'Next step', minWidth: 150, flex: 1, cellRenderer: ({ value, data }: { value: string; data?: Row }) => <Link href={data?.nextHref ?? '#'}>{value}</Link> },
  {
    field: 'held',
    headerName: 'Held',
    type: 'rightAligned',
    width: 80,
    cellClass: RIGHT_CELL,
    valueFormatter: ({ value, data }) => (data?.holdOpen ? `£${value.toFixed(2)}` : '—'),
  },
  {
    field: 'age',
    headerName: 'Hold age',
    type: 'rightAligned',
    width: 80,
    cellClass: RIGHT_CELL,
    cellClassRules: { [st.hot]: ({ value, data }) => Boolean(data?.holdOpen && value > 3) },
    valueFormatter: ({ value, data }) => (data?.holdOpen ? `${value}d` : '—'),
  },
];
const DEFAULT_COL: ColDef<Row> = { resizable: true };

export function WorkQueue(params: AgWidgetParams<WorkQueueState>) {
  const { dataMapping, widgetApi } = params;
  const { view, setView, shop, ages, renters, setFirstRef } = useRoom();
  const router = useRouter();
  const hasLoaded = useRef(false);
  const gridApi = useRef<GridApi<Row> | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  const selected = () => widgetApi.getCrossFilterSelections()?.flatMap((s) => (s.type === 'value' ? (s.values as string[]) : []))[0] ?? null;

  // Keyed on params, not dataMapping: Studio passes new params when page or widget filters change.
  useEffect(() => {
    const { dataMapping, widgetApi, sort } = params;
    let active = true;
    const fetchData = async () => {
      if (KEYS.some((k) => !dataMapping[k]?.at(0))) {
        widgetApi.setDisplayState('incompleteDataMapping');
        return;
      }
      const field = (k: Key) => dataMapping[k]!.at(0)!;
      widgetApi.setDisplayState('loading', { prominent: !hasLoaded.current });
      // crossFilter 'none': selecting a row must not shrink the queue to that row.
      const response = await widgetApi.getData({ fields: KEYS.map(field), sort }, { crossFilter: 'none' });
      if (!active) return;
      const next = response.results.rows.map((row) => {
        const value = Object.fromEntries(KEYS.map((k) => [k, row[field(k).key]])) as Omit<Row, 'renter'>;
        return { ...value, renter: renters[value.ref] ?? '—' };
      });
      hasLoaded.current = true;
      setRows(next);
      setFirstRef(next[0]?.ref ?? null);
      // A selection the new view no longer shows would leave the Evidence pair on a hire that isn't in the queue.
      const current = widgetApi.getCrossFilterSelections()?.flatMap((s) => (s.type === 'value' ? (s.values as string[]) : []))[0];
      if (current && !next.some((r) => r.ref === current)) widgetApi.resetCrossFilter();
      widgetApi.setDisplayState('displayed');
    };
    fetchData().catch((err) => {
      if (active) console.error('[WorkQueue] getData failed', err);
    });
    return () => {
      active = false;
    };
  }, [params, renters, setFirstRef]);

  // The row Evidence is showing stays marked as selected, including the top row before anyone has clicked.
  const markSelected = () => {
    const api = gridApi.current;
    const ref = selected() ?? rows?.[0]?.ref;
    if (api && ref) api.getRowNode(ref)?.setSelected(true, true, 'api');
  };

  const onSelectionChanged = (e: SelectionChangedEvent<Row>) => {
    // Only a person's selection moves Evidence: new rows dropping the selected one also land here.
    if (e.source === 'api' || e.source === 'rowDataChanged') return;
    const ref = e.api.getSelectedRows()[0]?.ref;
    const field = dataMapping.ref?.at(0);
    if (ref && field && ref !== selected()) widgetApi.toggleCrossFilter({ type: 'value', value: ref, field, group: 0, reset: true });
  };

  // Links inside cells aren't in the tab order, so Enter on the Hire or Next step cell follows them.
  const onCellKeyDown = (e: CellKeyDownEvent<Row>) => {
    if ((e.event as KeyboardEvent | null)?.key !== 'Enter' || !e.data) return;
    if (e.column.getColId() === 'ref') router.push(staffUrl.hire(e.data.ref));
    if (e.column.getColId() === 'next') router.push(e.data.nextHref);
  };

  const holdTotal = ages.reduce((a, b) => a + b, 0);
  const oldHolds = ages.slice(3).reduce((a, b) => a + b, 0);

  return (
    <section className={st.widget} aria-labelledby="queue-title">
      <div className={w.panelHead}>
        <h2 id="queue-title" className={w.sH2}>
          Work queue
        </h2>
        <p className={w.sSub}>Click a row to see its evidence.</p>
      </div>
      <div className={st.tabs} role="group" aria-label="Views">
        {VIEWS.map((t, i) => (
          <button key={t} type="button" aria-pressed={view === i} onClick={() => setView(i)}>
            {t}
          </button>
        ))}
      </div>
      {rows?.length === 0 ? (
        <p className={w.sSub}>Nothing here{shop === 'All shops' ? '' : ` for ${shop}`}.</p>
      ) : (
        <div className={`${st.ledgerGrid} ${st.queueGrid}`}>
          <AgGridReact<Row>
            modules={MODULES}
            theme={ledgerGridTheme}
            rowData={rows}
            columnDefs={COLUMNS}
            defaultColDef={DEFAULT_COL}
            getRowId={({ data }) => data.ref}
            rowSelection={SELECTION}
            onGridReady={(e) => {
              gridApi.current = e.api;
            }}
            onRowDataUpdated={markSelected}
            onSelectionChanged={onSelectionChanged}
            onCellKeyDown={onCellKeyDown}
          />
        </div>
      )}
      <h3 className={st.ageHead}>Holds by age, in days</h3>
      <div
        className={st.ageBar}
        role="img"
        aria-label={`${holdTotal} holds by age: ${holdTotal - oldHolds} are within the 3-day honour period, ${oldHolds} are older and are refreshed before any capture`}
      >
        {ages.map((n, i) => (
          <span key={i} className={i >= 3 ? st.ageRe : undefined} style={{ height: `${Math.min(100, Math.max(n, 0.15) * 24)}%` }} />
        ))}
      </div>
      <div className={st.axis}>
        <span>0</span>
        <span>3: refreshed after this</span>
        <span>29: PayPal limit</span>
      </div>
    </section>
  );
}

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
  '<path d="M1 2h14v3H1zm0 4.5h14v3H1zM1 11h14v3H1z"/></svg>';

export const workQueueWidget: AgWidgetDefinition<'work-queue', WorkQueueState> = {
  id: 'work-queue',
  label: 'Work queue',
  icon: ICON,
  dataMapping: Object.fromEntries(
    KEYS.map((k) => [
      k,
      {
        type: 'field',
        supportedRoles: [FIELDS[k].role],
        requires: k === 'ref' ? { cardinality: 'many' } : { per: 'dataMapping.ref', cardinality: 'one' },
        required: true,
      },
    ]),
  ) as AgWidgetDefinition<'work-queue', WorkQueueState>['dataMapping'],
  form: (params) => params.createDefaults({ dataMappingItems: KEYS.map((key) => ({ key, label: FIELDS[key].label })) }),
  defaultState: {
    dataMapping: Object.fromEntries(KEYS.map((k) => [k, [{ id: FIELDS[k].id }]])) as WorkQueueDataMapping,
  },
  comp: WorkQueue,
  defaultSize: { width: 900, height: 700 },
  minSize: { width: 420, height: 420 },
  ai: { description: 'The queue of hires staff work through, one row per hire. Filter this widget to change which hires are shown.' },
};
