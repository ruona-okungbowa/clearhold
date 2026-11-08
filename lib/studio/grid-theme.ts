// The ledger room's AG Grid look, for the disputes table and the work queue. Separate from theme.ts so the disputes
// page doesn't pull AG Studio into its bundle.

import { enableDevValidations, themeQuartz } from 'ag-grid-community';

if (process.env.NODE_ENV !== 'production') enableDevValidations();

export const ledgerGridTheme = themeQuartz.withParams({
  fontFamily: 'var(--ledger)',
  fontSize: 14,
  foregroundColor: 'var(--l-ink)',
  textColor: 'var(--l-ink)',
  backgroundColor: '#ffffff',
  accentColor: 'var(--l-blue)',
  borderColor: 'var(--l-line)',
  borderRadius: 0,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerBackgroundColor: 'var(--l-head)',
  headerTextColor: 'var(--l-muted)',
  headerFontSize: 13,
  headerFontWeight: 600,
  headerHeight: 36,
  rowHeight: 44,
  rowBorder: { width: 1, color: 'var(--l-line)' },
  headerRowBorder: { width: 1, color: 'var(--l-line)' },
  rowHoverColor: 'var(--l-hover)',
  selectedRowBackgroundColor: 'var(--l-selected)',
  cellHorizontalPadding: 10,
});
