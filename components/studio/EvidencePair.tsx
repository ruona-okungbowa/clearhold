'use client';

// Evidence pair: a custom AG Studio widget showing one finding at a time, with its pick-up and return photos
// side by side and the finding's box drawn on the return photo. A list steps through the findings in the current
// filter; clicking the clause cross-filters on it. Lower, Approve and Settle go through the hire's server actions.

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import type { AgFieldRole, AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';
import { approveHire, lowerFinding, settleApproved } from '@/app/control-room/actions';
import { CLAUSES } from '@/lib/schedule';

const FIELDS = {
  finding: { id: 'findings.id', label: 'Finding', role: 'category' },
  hireRef: { id: 'hires.hireRef', label: 'Hire', role: 'category' },
  hireStatus: { id: 'hires.status', label: 'Hire status', role: 'category' },
  openApproval: { id: 'hires.openApproval', label: 'Open final approval', role: 'category' },
  angle: { id: 'findings.angle', label: 'Angle', role: 'category' },
  description: { id: 'findings.description', label: 'Description', role: 'category' },
  clauseId: { id: 'findings.clauseId', label: 'Clause', role: 'category' },
  severity: { id: 'findings.severity', label: 'Severity', role: 'category' },
  box: { id: 'findings.box', label: 'Box', role: 'category' },
  pickupPhotoId: { id: 'findings.pickupPhotoId', label: 'Pick-up photo', role: 'category' },
  returnPhotoId: { id: 'findings.returnPhotoId', label: 'Return photo', role: 'category' },
  confidence: { id: 'findings.confidence', label: 'Confidence', role: 'numeric' },
  outcome: { id: 'findings.outcome', label: 'Outcome', role: 'category' },
  reason: { id: 'findings.reason', label: 'Reason', role: 'category' },
  proposedGBP: { id: 'findings.proposedGBP', label: 'AI proposed', role: 'numeric' },
  setGBP: { id: 'findings.setGBP', label: 'Set by a person', role: 'numeric' },
  setBy: { id: 'findings.setBy', label: 'Set by', role: 'category' },
} satisfies Record<string, { id: string; label: string; role: AgFieldRole }>;

type Key = keyof typeof FIELDS;
const KEYS = Object.keys(FIELDS) as Key[];

type EvidencePairDataMapping = Record<Key, AgWidgetFieldReference[]>;

export interface EvidencePairState extends AgWidgetData<EvidencePairDataMapping, AgWidgetDataFormat<unknown>> {
  type: 'evidence-pair';
}

type Row = {
  finding: string;
  hireRef: string;
  hireStatus: string;
  openApproval: boolean;
  angle: string;
  description: string;
  clauseId: string | null;
  severity: string | null;
  box: string | null;
  pickupPhotoId: string | null;
  returnPhotoId: string | null;
  confidence: number;
  outcome: string;
  reason: string;
  proposedGBP: number | null;
  setGBP: number | null;
  setBy: string | null;
};
type Box = { x: number; y: number; w: number; h: number };

const gbp = (n: number) => `£${n.toFixed(2)}`;
const toPence = (n: number) => Math.round(n * 100);
const OUTCOMES: Record<string, string> = { charge: 'Charge', owner_look: 'Owner look', no_charge: 'No charge' };
const LINE = '1px solid rgb(128 128 128 / 0.35)';
const button = { padding: '2px 8px', border: LINE, borderRadius: 4, background: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' };

function Photo({ id, label, box }: { id: string | null; label: string; box?: Box | null }) {
  return (
    <figure style={{ margin: 0, minWidth: 0 }}>
      <figcaption style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</figcaption>
      {id ? (
        // The wrapper is exactly the image's size, so the box's fractions of the image land in the right place.
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser */}
          <img src={`/api/photos/${id}`} alt={`${label} photo`} style={{ display: 'block', width: '100%', height: 'auto' }} />
          {box && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
                outline: '2px solid rgb(214 40 40)',
              }}
            />
          )}
        </div>
      ) : (
        <p style={{ margin: 0, padding: 16, border: LINE, textAlign: 'center' }}>No photo</p>
      )}
    </figure>
  );
}

export function EvidencePair(params: AgWidgetParams<EvidencePairState>) {
  const { dataMapping, widgetApi } = params;
  const router = useRouter();
  const hasLoaded = useRef(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();

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

      // A solid overlay on first load; after that a quiet refresh indicator over the previous finding.
      widgetApi.setDisplayState('loading', { prominent: !hasLoaded.current });
      const response = await widgetApi.getData({
        fields: KEYS.map(field),
        sort: (['hireRef', 'angle', 'finding'] as const).map((k) => ({ field: field(k), direction: 'asc' as const })),
      });
      if (!active) return;

      const next =response.results.rows.map((row) => Object.fromEntries(KEYS.map((k) => [k, row[field(k).key] ?? null])) as Row);
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

  const row = rows.find((r) => r.finding === selectedId) ?? rows[0];
  // A root element even with no rows: Studio attaches the widget by the DOM of its first render.
  if (!row) return <div style={{ height: '100%' }} />;

  const clause = CLAUSES.find((c) => c.id === row.clauseId);
  const band = !clause
    ? null
    : !clause.chargeable
      ? 'never charged'
      : clause.lowGBP === clause.highGBP
        ? `${gbp(clause.lowGBP)} fixed`
        : `${gbp(clause.lowGBP)}–${gbp(clause.highGBP)}`;
  const amount = row.setGBP ?? row.proposedGBP;
  const settled = row.hireStatus === 'settled';
  const locked = pending || settled;
  const clauseFilter = dataMapping.clauseId?.at(0);
  const clauseSelected = (widgetApi.getCrossFilterSelections() ?? []).some((s) => s.type === 'value' && s.values.includes(row.clauseId));

  const run = (action: () => Promise<string | null>) => {
    setError(null);
    startAction(async () => {
      const message = await action().catch(() => 'Could not reach the server; check the hire before trying again');
      setError(message);
      router.refresh();
    });
  };

  const lower = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // personPence doesn't throw on a raise, it restores the AI's amount, so a mistyped figure must stop here.
    const entered = toPence(Number(form.get('amountGBP')));
    if (row.outcome === 'charge' && entered >= toPence(row.proposedGBP ?? 0)) {
      setError(`Refused: a charge can only go down, so it must be under the AI's ${gbp(row.proposedGBP ?? 0)}`);
      return;
    }
    run(() => lowerFinding(row.hireRef, row.finding, form));
  };

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '9rem 1fr', fontSize: 13 }}>
      <nav aria-label="Findings" style={{ overflowY: 'auto', borderRight: LINE }}>
        {rows.map((r) => (
          <button
            key={r.finding}
            type="button"
            aria-current={r === row}
            onClick={() => {
              setSelectedId(r.finding);
              setError(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '4px 8px',
              border: 0,
              borderBottom: LINE,
              background: r === row ? 'rgb(0 112 224 / 0.15)' : 'none',
              color: 'inherit',
              font: 'inherit',
              fontSize: 12,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {r.hireRef}
            <br />
            {r.angle}: {OUTCOMES[r.outcome] ?? r.outcome}
          </button>
        ))}
      </nav>

      <div style={{ minWidth: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'start' }}>
          <Photo id={row.pickupPhotoId} label={`Pick-up, ${row.angle}`} />
          <Photo id={row.returnPhotoId} label={`Return, ${row.angle}`} box={row.box ? (JSON.parse(row.box) as Box) : null} />
        </div>

        <p style={{ margin: 0 }}>{row.description}</p>
        <div>
          Clause:{' '}
          {row.clauseId ? (
            <button
              type="button"
              aria-pressed={clauseSelected}
              title="Filter the report on this clause"
              onClick={(e) => {
                if (!clauseFilter) return;
                widgetApi.toggleCrossFilter({ type: 'value', value: row.clauseId, field: clauseFilter, group: 0, reset: !(e.metaKey || e.ctrlKey) });
              }}
              style={{ ...button, background: clauseSelected ? 'rgb(0 112 224 / 0.15)' : 'none', textAlign: 'left' }}
            >
              {row.clauseId}: {clause?.name ?? 'not in the schedule'}
            </button>
          ) : (
            'none'
          )}
          {band && ` (${band})`}
        </div>
        <div>
          Severity: {row.severity ?? 'none'} · Confidence: {Math.round(row.confidence * 100)}%
        </div>
        <div>
          {OUTCOMES[row.outcome] ?? row.outcome}: {row.reason}
        </div>
        <div>
          Amount:{' '}
          {amount === null ? (
            'none'
          ) : (
            <>
              <strong>{gbp(amount)}</strong> {row.setGBP !== null ? `Set by ${row.setBy}` : 'AI proposed'}
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {row.outcome !== 'no_charge' && clause?.chargeable && (
            // Keyed so the box empties once the new amount is in.
            <form key={`${row.finding}-${row.setGBP}`} onSubmit={lower} style={{ display: 'flex', gap: 4 }}>
              <input
                name="amountGBP"
                type="number"
                min="0"
                step="0.01"
                required
                disabled={locked}
                aria-label="Amount in pounds"
                style={{ width: '6rem', padding: '2px 4px', border: LINE, borderRadius: 4, background: 'none', color: 'inherit', font: 'inherit' }}
              />
              <button disabled={locked} style={button}>
                {row.outcome === 'charge' ? 'Lower' : 'Set amount'}
              </button>
            </form>
          )}
          {/* A second approval would stay open after the capture, so one at a time, as on the approve page. */}
          {!row.openApproval && (
            <button type="button" disabled={locked} onClick={() => run(() => approveHire(row.hireRef))} style={button}>
              Approve all charges on {row.hireRef}
            </button>
          )}
          {row.openApproval && !settled && (
            <button type="button" disabled={pending} onClick={() => run(() => settleApproved(row.hireRef))} style={button}>
              Settle {row.hireRef}
            </button>
          )}
          {pending && <span role="status">Working…</span>}
        </div>
        {error && (
          <p role="alert" style={{ margin: 0, color: 'rgb(214 40 40)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
  '<path d="M1 3h6v10H1zm8 0h6v10H9zm1.5 2v3h3V5z" fill-rule="evenodd"/></svg>';

export const evidencePairWidget: AgWidgetDefinition<'evidence-pair', EvidencePairState> = {
  id: 'evidence-pair',
  label: 'Evidence pair',
  icon: ICON,
  // Everything but the finding itself is one value per finding.
  dataMapping: Object.fromEntries(
    KEYS.map((k) => [
      k,
      {
        type: 'field',
        supportedRoles: [FIELDS[k].role],
        requires: k === 'finding' ? { cardinality: 'many' } : { per: 'dataMapping.finding', cardinality: 'one' },
        required: true,
      },
    ]),
  ) as AgWidgetDefinition<'evidence-pair', EvidencePairState>['dataMapping'],
  form: (params) => params.createDefaults({ dataMappingItems: KEYS.map((key) => ({ key, label: FIELDS[key].label })) }),
  defaultState: {
    dataMapping: Object.fromEntries(KEYS.map((k) => [k, [{ id: FIELDS[k].id }]])) as EvidencePairDataMapping,
  },
  comp: EvidencePair,
  defaultSize: { width: 640, height: 560 },
  minSize: { width: 420, height: 320 },
  ai: { description: 'One damage finding at a time: pick-up and return photos side by side, its clause and amount, with Lower, Approve and Settle.' },
};
