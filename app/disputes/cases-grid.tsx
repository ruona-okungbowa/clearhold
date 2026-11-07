'use client';

import { AllCommunityModule, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import Link from 'next/link';

export type CaseRow = {
  hireRef: string | null;
  branch: string | null;
  chargedGBP: number | null;
  contestStatus: string | null;
  disputeId: string | null;
  disputeStatus: string | null;
  reason: string | null;
  daysLeft: number | null;
};

const MODULES = [AllCommunityModule];

const COLUMNS: ColDef<CaseRow>[] = [
  {
    field: 'hireRef',
    headerName: 'Hire',
    cellRenderer: ({ value }: { value: string | null }) => (value ? <Link href={`/disputes/${value}`} className="underline">{value}</Link> : 'not ours'),
  },
  { field: 'branch' },
  { field: 'chargedGBP', headerName: 'Charged', valueFormatter: ({ value }) => (value === null ? '' : `£${value.toFixed(2)}`) },
  { field: 'contestStatus', headerName: 'Contest' },
  { field: 'disputeId', headerName: 'PayPal dispute' },
  { field: 'disputeStatus', headerName: 'Dispute status' },
  { field: 'reason' },
  { field: 'daysLeft', headerName: 'Days left to respond', sort: 'asc' },
];

export function CasesGrid({ rows }: { rows: CaseRow[] }) {
  return (
    <AgGridReact<CaseRow>
      modules={MODULES}
      rowData={rows}
      columnDefs={COLUMNS}
      defaultColDef={{ filter: true, flex: 1, minWidth: 110 }}
      overlayNoRowsTemplate="No contested hires or PayPal disputes"
    />
  );
}
