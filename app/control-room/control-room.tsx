'use client';

// The control room: one AG Studio report over the holds database. Holds (PayPal authorizations) and
// hires are two sync sources linked by hireId. Save stores api.getState() in a StudioLayout row, and
// the page passes that row back as initialState on the next load.

import { useMemo, useRef, useState } from 'react';
import {
  enableStudioDevValidations,
  type AgBaseRegistry,
  type AgDataSourcesDefinition,
  type AgDefaultWidgetDefinition,
  type AgReportState,
  type AgStudioApi,
  type AgWidgetsConfig,
  type AgDefaultRegistry,
} from 'ag-studio';
import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import { holdTimelineWidget } from '@/components/studio/HoldTimeline';

interface ControlRoomRegistry extends AgBaseRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | typeof holdTimelineWidget)[];
}
import { saveLayout } from './actions';

if (process.env.NODE_ENV !== 'production') {
  enableStudioDevValidations();
}

type Row = Record<string, unknown>;

// First visit, before anything is saved: a built-in grid of every hold with its hire.
const DEFAULT_STATE = {
  pages: [
    {
      id: 'holds',
      widgets: {
        1: {
          type: 'grid',
          dataMapping: {
            cols: [
              { id: 'holds.id' },
              { id: 'hires.hireRef' },
              { id: 'hires.branch' },
              { id: 'holds.status' },
              { id: 'holds.amountGBP' },
              { id: 'holds.createdAt' },
              { id: 'holds.honourEndsAt' },
              { id: 'holds.expiresAt' },
              { id: 'hires.seeded' },
            ],
          },
        },
      },
      widgetLayout: { 1: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 16 } },
    },
  ],
  selectedPageId: 'holds',
} as AgReportState<ControlRoomRegistry>;

const widgets = (config: AgWidgetsConfig<AgDefaultRegistry>) =>
  createWidgets<ControlRoomRegistry>({
    additionalTypes: [holdTimelineWidget],
    menu: [...config.menu, { label: 'Holds', widgetIds: ['hold-timeline'] }],
  });

export function ControlRoom({ holds, hires, savedState }: { holds: Row[]; hires: Row[]; savedState: AgReportState<ControlRoomRegistry> | null }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const data = useMemo<AgDataSourcesDefinition<ControlRoomRegistry>>(
    () => ({
      sources: [
        { id: 'holds', data: holds },
        { id: 'hires', data: hires },
      ],
      relationships: [
        {
          id: 'holds-hires',
          source: { tableId: 'holds', fieldId: 'hireId' },
          target: { tableId: 'hires', fieldId: 'id' },
          type: 'many-to-one',
        },
      ],
    }),
    [holds, hires],
  );
  // Read once by Studio on mount.
  const [initialState] = useState(() => savedState ?? DEFAULT_STATE);

  const save = async () => {
    const api = apiRef.current;
    if (!api) return;
    setStatus('saving');
    try {
      await saveLayout(api.getState());
      setStatus('saved');
    } catch (err) {
      console.error('[Control room] save failed', err);
      setStatus('error');
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-2">
        <h1 className="font-semibold">Control room</h1>
        <div className="flex items-center gap-3 text-sm">
          <span role="status" aria-live="polite">
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Layout saved' : status === 'error' ? 'Save failed' : ''}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={status === 'saving'}
            className="rounded border border-black/20 px-3 py-1 font-medium hover:bg-black/5 disabled:opacity-50"
          >
            Save layout
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <AgStudioProvider>
          <AgStudio<ControlRoomRegistry>
            style={{ height: '100%', width: '100%' }}
            data={data}
            widgets={widgets}
            initialState={initialState}
            mode="edit"
            onApiReady={(event) => {
              apiRef.current = event.api;
            }}
            onStateUpdated={() => setStatus((s) => (s === 'saved' ? 'idle' : s))}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
