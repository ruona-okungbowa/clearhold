'use client';

import { AllCommunityModule, type CellKeyDownEvent, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Chip, staffUrl, type ChipKind } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import { ledgerGridTheme } from '@/lib/studio/grid-theme';

export type CaseRow = {
  hireRef: string | null;
  type: string;
  reason: string;
  charged: number | null;
  daysLeft: number | null;
  chip: ChipKind;
  status: string;
  open: boolean;
};

const MODULES = [AllCommunityModule];
const AUTO_HEIGHT_ROWS = 15;

const COLUMNS: ColDef<CaseRow>[] = [
  {
    field: 'hireRef',
    headerName: 'Hire',
    minWidth: 130,
    cellRenderer: ({ value }: { value: string | null }) => (value ? <Link href={staffUrl.dispute(value)}>{value}</Link> : 'Not ours'),
  },
  { field: 'type', headerName: 'Type', minWidth: 140 },
  { field: 'reason', headerName: 'Reason', flex: 2, minWidth: 220 },
  {
    field: 'charged',
    headerName: 'Charged',
    type: 'rightAligned',
    minWidth: 110,
    cellClass: st.tabular,
    valueFormatter: ({ value }) => (value === null ? '—' : `£${value.toFixed(2)}`),
  },
  {
    field: 'daysLeft',
    headerName: 'Days to respond',
    type: 'rightAligned',
    minWidth: 150,
    cellClass: st.tabular,
    cellClassRules: { [st.hot]: ({ value }) => value !== null && value <= 3 },
    valueFormatter: ({ value }) => value ?? '—',
  },
  {
    field: 'status',
    headerName: 'Status',
    minWidth: 170,
    cellRenderer: ({ value, data }: { value: string; data?: CaseRow }) => <Chip kind={data?.chip ?? 'stPlain'}>{value}</Chip>,
  },
  {
    colId: 'open',
    headerName: 'Open',
    headerClass: st.headHidden,
    minWidth: 80,
    sortable: false,
    filter: false,
    cellRenderer: ({ data }: { data?: CaseRow }) => data?.hireRef && <Link href={staffUrl.dispute(data.hireRef)}>Open</Link>,
  },
];

const DEFAULT_COL: ColDef<CaseRow> = { flex: 1, minWidth: 110, resizable: true };

// Rows arrive sorted: open cases first, then fewest days left. Enter on a focused row opens its case, as a click on the link does.
export function CasesGrid({ rows }: { rows: CaseRow[] }) {
  const router = useRouter();
  const short = rows.length <= AUTO_HEIGHT_ROWS;
  const open = (e: CellKeyDownEvent<CaseRow>) => {
    if ((e.event as KeyboardEvent | null)?.key === 'Enter' && e.data?.hireRef) router.push(staffUrl.dispute(e.data.hireRef));
  };
  return (
    <div className={st.ledgerGrid} style={{ height: short ? undefined : 640 }}>
      <AgGridReact<CaseRow>
        modules={MODULES}
        theme={ledgerGridTheme}
        rowData={rows}
        columnDefs={COLUMNS}
        defaultColDef={DEFAULT_COL}
        domLayout={short ? 'autoHeight' : 'normal'}
        onCellKeyDown={open}
        overlayNoRowsTemplate="No cases here."
      />
    </div>
  );
}
