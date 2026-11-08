// AG Studio theme for the staff "ledger room". Every value points at a design token from app/globals.css, the same
// variables the staff screens' CSS Modules use, so Studio renders as part of the page rather than a component
// embedded in it: change a token there and the shell, widgets, grids and charts all follow.

import { studioTheme } from 'ag-studio';

const line = (color: string) => ({ width: 1, color });

const INK = 'var(--l-ink)';
const MUTED = 'var(--l-muted)';
const RULE = 'var(--l-line)';
const BLUE = 'var(--l-blue)';
const FONT = 'var(--ledger)';
const WHITE = '#ffffff';

const CHART_COLOURS = [BLUE, INK, 'var(--amber)', 'var(--green)', MUTED];
const palette = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => {
    const colour = CHART_COLOURS[i % CHART_COLOURS.length];
    return [
      [`chartPaletteFills${i + 1}Color`, colour],
      [`chartPaletteStrokes${i + 1}Color`, colour],
    ];
  }).flat(),
);

export const agStudioLedgerTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: FONT,
  fontSize: 14,
  textColor: INK,
  foregroundColor: INK,
  subtleTextColor: MUTED,
  backgroundColor: WHITE,
  borderColor: RULE,
  accentColor: BLUE,
  iconColor: INK,
  rowHoverColor: 'var(--l-hover)',

  // No frame: the canvas is the page's own background.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: 'var(--l-ground)',
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: 'var(--l-ground)',
  studioCanvasPadding: 0,
  // The default of 720 would scroll a phone sideways.
  studioCanvasMinWidth: 280,
  studioCanvasRowHeight: 16,
  studioCanvasFontFamily: FONT,

  // Widgets are the ledger's panels. Studio's border param is all four sides, so the 3px top rule is .studio in
  // app/(lab)/staff.module.css, along with the panel's inner padding.
  studioWidgetBackgroundColor: WHITE,
  studioWidgetBorder: false,
  studioWidgetBorderRadius: 0,
  // Studio puts this outside the white panel, so 8 each side is the page's 16px gap between panels.
  studioWidgetPadding: 8,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 18,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: INK,
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: MUTED,
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: MUTED,
  studioWidgetResizeBorderColor: BLUE,

  // Edit-mode panels.
  studioPanelContainerBackgroundColor: WHITE,
  studioPanelContainerBorder: line(RULE),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: RULE,
  studioPanelDividerActiveColor: BLUE,
  studioPanelSectionBorderColor: RULE,
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: 'var(--l-hover)',
  studioPanelChevronButtonHoverColor: BLUE,
  studioToggleButtonActiveBackgroundColor: 'var(--l-selected)',
  studioToggleButtonActiveBorderColor: BLUE,
  studioToggleButtonActiveColor: BLUE,

  // Built-in grid widgets (a person can add one in Edit layout).
  gridFontFamily: FONT,
  gridFontSize: 14,
  gridCellTextColor: INK,
  gridHeaderBackgroundColor: 'var(--l-head)',
  gridHeaderTextColor: MUTED,
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 44,
  gridRowBorder: line(RULE),
  gridHeaderRowBorder: line(RULE),
  gridPinnedRowBorder: line(RULE),
  gridRowHoverColor: 'var(--l-hover)',
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: FONT,
  chartTextColor: INK,
  chartSubtleTextColor: MUTED,
  chartAxisLineColor: RULE,
  chartGridLineColor: RULE,
  ...palette,
});
