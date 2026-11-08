'use client';

import type { AgAiHarness, AgAiHarnessSetupParams, AgReportState, AgStudioApi } from 'ag-studio';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { RoomContext } from '@/components/studio/room-context';
import { saveLayout, setLayoutRole } from './actions';
import { ALL_SHOPS, buildLayout, ControlRoom, forSaving, stacked, studioHeight, withPositionsOf, withView, type ControlRoomRegistry, type RoomState } from './control-room';
import { buildDeskAi } from './desk-agent';
import type { LayoutRole } from './saved-layout';

export type Kpi = { label: string; value: string; note: string; risk?: boolean };

type Row = Record<string, unknown>;

const PAGES = [
  ['holds', 'Holds'],
  ['risk', 'Risk'],
] as const;
const ROLES: [LayoutRole, string][] = [
  ['ops', 'Ops'],
  ['branch', 'Branch'],
];

const PHONE = '(max-width: 900px)';
const EDIT_MIN_HEIGHT = 900;
const subscribePhone = (notify: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener('change', notify);
  return () => mq.removeEventListener('change', notify);
};

export function Room({
  kpis,
  ages,
  shops,
  renters,
  layouts,
  holds,
  hires,
  findings,
  marks,
  initialView,
  initialRole,
  licenseKey,
  aiModels,
}: {
  kpis: Kpi[];
  ages: number[];
  shops: string[];
  renters: Record<string, string>;
  layouts: Record<LayoutRole, AgReportState | null>;
  holds: Row[];
  hires: Row[];
  findings: Row[];
  marks: Row[];
  initialView: number;
  initialRole: LayoutRole;
  licenseKey?: string;
  aiModels?: string[];
}) {
  const router = useRouter();
  const apiRef = useRef<AgStudioApi<ControlRoomRegistry> | null>(null);
  const savedLayouts = useRef(layouts);
  // Positions to go back to when a phone-width window widens again.
  const desktop = useRef<RoomState | null>(null);

  const [view, setViewState] = useState(initialView);
  const [role, setRole] = useState(initialRole);
  const [shop, setShop] = useState(initialRole === 'branch' ? shops[0] : ALL_SHOPS);
  const [pageId, setPageId] = useState('holds');
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [firstRef, setFirstRef] = useState<string | null>(null);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);

  // Read once, when Studio is created. One harness, shared by Studio's own chat panel and the desk panel.
  const [ai] = useState(() => {
    if (!aiModels?.length) return undefined;
    const build = buildDeskAi(aiModels, holds, hires) as (params: AgAiHarnessSetupParams) => AgAiHarness;
    let harness: AgAiHarness | undefined;
    return (params: AgAiHarnessSetupParams) => (harness ??= build(params));
  });
  const [initialState] = useState(() => {
    const state = withView(buildLayout(layouts[initialRole], initialRole), initialView, initialRole === 'branch' ? shops[0] : ALL_SHOPS);
    return { ...state, selectedPageId: 'holds' } as RoomState;
  });
  const [height, setHeight] = useState(() => studioHeight(initialState));

  const apply = (nextView: number, nextShop: string) => {
    const api = apiRef.current;
    if (api) api.setState(withView(api.getState(), nextView, nextShop));
  };
  const setView = (next: number) => {
    setViewState(next);
    apply(next, shop);
  };
  const changeShop = (next: string) => {
    setShop(next);
    apply(view, next);
  };

  const showPage = (id: string) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState({ ...api.getState(), selectedPageId: id });
    setPageId(id);
  };

  const switchRole = (next: LayoutRole) => {
    const api = apiRef.current;
    if (!api || next === role) return;
    savedLayouts.current[role] = forSaving(api.getState()) as unknown as AgReportState;
    const nextShop = next === 'branch' ? (shop === ALL_SHOPS ? shops[0] : shop) : ALL_SHOPS;
    api.setState({ ...withView(buildLayout(savedLayouts.current[next], next), view, nextShop), selectedPageId: 'holds' } as RoomState);
    setRole(next);
    setShop(nextShop);
    setPageId('holds');
    setStatus('idle');
    setLayoutRole(next).catch((err) => console.error('[Control room] could not remember the layout', err));
  };

  const save = async () => {
    const api = apiRef.current;
    if (!api) return;
    setStatus('saving');
    try {
      const state = forSaving(api.getState());
      await saveLayout(role, state as unknown as AgReportState);
      savedLayouts.current[role] = state as unknown as AgReportState;
      setStatus('saved');
    } catch (err) {
      console.error('[Control room] save failed', err);
      setStatus('error');
    }
  };

  const fitToWindow = () => {
    const api = apiRef.current;
    if (!api) return;
    if (window.matchMedia(PHONE).matches) {
      if (desktop.current) return;
      desktop.current = api.getState();
      api.setState(stacked(api.getState()));
    } else if (desktop.current) {
      api.setState(withPositionsOf(api.getState(), desktop.current));
      desktop.current = null;
    }
  };
  const fit = useRef(fitToWindow);
  useEffect(() => {
    fit.current = fitToWindow;
  });
  useEffect(() => fit.current(), [phone]);

  const holdingsLabel = shop === ALL_SHOPS ? `All ${shops.length} shops` : `Ledgerton ${shop}`;
  const hasRisk = role === 'ops';

  return (
    <>
      <div className={w.sHead}>
        <div>
          <h1 className={w.sH1}>Control room</h1>
          <p className={w.sSub}>{holdingsLabel} · sandbox</p>
        </div>
        <div className={st.headRight}>
          <div className={st.tabs} role="group" aria-label="Layout">
            {ROLES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={role === id} onClick={() => switchRole(id)}>
                {label}
              </button>
            ))}
          </div>
          <select aria-label="Shop" className={w.sInput} value={shop} onChange={(e) => changeShop(e.target.value)}>
            <option>{ALL_SHOPS}</option>
            {shops.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button type="button" className={w.btnGhost} onClick={() => router.refresh()}>
            Refresh
          </button>
          {!phone && (
            <button type="button" className={w.btnGhost} aria-pressed={editing} onClick={() => setEditing(!editing)}>
              Edit layout
            </button>
          )}
          {editing && !phone && (
            <>
              <button type="button" className={w.btnGhost} onClick={save} disabled={status === 'saving'}>
                Save layout
              </button>
              <button type="button" className={w.btnGhost} onClick={() => setEditing(false)}>
                Done
              </button>
            </>
          )}
          <span role="status" aria-live="polite" className={w.sSub}>
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Layout saved' : status === 'error' ? 'Save failed' : ''}
          </span>
        </div>
      </div>

      <ul className={st.kpis}>
        {kpis.map((k) => (
          <li key={k.label} className={k.risk ? st.kpiRisk : undefined}>
            <span>{k.label}</span>
            <strong>{k.value}</strong>
            <em>{k.note}</em>
          </li>
        ))}
      </ul>

      {hasRisk && (
        <div className={st.tabs} role="group" aria-label="Pages">
          {PAGES.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={pageId === id} onClick={() => showPage(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <RoomContext.Provider
        value={{ view, setView, shop, ages, renters, firstRef, setFirstRef, harness: () => (ai && apiRef.current ? ai({ api: apiRef.current as unknown as AgStudioApi, context: undefined }) : null) }}
      >
        <ControlRoom
          apiRef={apiRef}
          initialState={initialState}
          holds={holds}
          hires={hires}
          findings={findings}
          marks={marks}
          licenseKey={licenseKey}
          ai={ai}
          editing={editing}
          height={Math.max(height, editing ? EDIT_MIN_HEIGHT : 0)}
          onReady={() => fit.current()}
          onStateUpdated={() => {
            setStatus((s) => (s === 'saved' ? 'idle' : s));
            if (apiRef.current) setHeight(studioHeight(apiRef.current.getState()));
          }}
        />
      </RoomContext.Provider>
    </>
  );
}
