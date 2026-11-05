// Inspector evals: runs fixtures/expected.json through the real inspector and settlement. Ids are the plan's E01-E22.
//   npm run evals    makes real model calls; they land in the audit trail under hire ref EVAL-<id>
// Exits non-zero if a guardrail case fails, a clean case gets any charge, or the model could not be reached,
// because the inspector turns a model failure into "owner look" and that must not read as a pass.
//
// A case either names photo pairs (fixtures/<garment>/<stage>/<angle>, .jpg or .jpeg) or gives canned findings,
// which skip the model and test settlement alone. A case with "awaiting" shows NO FIXTURE until its photos exist.

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { auditScope } from '../lib/audit';
import { db } from '../lib/db';
import { INSPECT_FAILED, inspect, settle, type AngleFinding, type Outcome, type Settled } from '../lib/inspector';
import type { KnownMark } from '../lib/schedule';

type Case = {
  id: string;
  title: string;
  guardrail?: boolean;
  clean?: boolean;
  awaiting?: string;
  remainingGBP?: number;
  knownMarks?: KnownMark[];
  pairs?: Record<string, [string, string | null]>;
  findings?: Partial<AngleFinding>[];
  expect: {
    allow?: Record<string, Outcome[]>; // every finding on the angle must have one of these outcomes
    need?: Record<string, Outcome[]>; // at least one finding on the angle must
    chargeClauses?: string[];
    maxTotalGBP?: number;
  };
};

const CANNED: AngleFinding = {
  angle: 'front',
  kind: 'new_damage',
  description: 'Canned finding',
  clauseId: 'S1',
  severity: 'moderate',
  box: null,
  pickupPhotoId: 'P',
  returnPhotoId: 'R',
  knownMarkId: null,
  confidence: 0.9,
};

const photoFile = (ref: string) => ['.jpg', '.jpeg'].map((ext) => `fixtures/${ref}${ext}`).find((f) => existsSync(f));

function run(c: Case): Promise<Settled[]> | Settled[] {
  const knownMarks = c.knownMarks ?? [];
  const remainingGBP = c.remainingGBP ?? 60;
  if (c.findings) {
    const findings = c.findings.map((f) => ({ ...CANNED, ...f }));
    return settle(findings, { photoIds: { front: { pickup: 'P', return: 'R' } }, knownMarks, remainingGBP });
  }
  const pairs = Object.entries(c.pairs ?? {});
  const photos = pairs.flatMap(([angle, refs]) =>
    (['pickup', 'return'] as const).flatMap((stage, i) => {
      const ref = refs[i];
      if (!ref) return [];
      const pathname = photoFile(ref);
      if (!pathname) throw new Error(`${c.id}: no photo at fixtures/${ref}.jpg`);
      return [{ id: `${stage}-${angle}`, stage, angle, pathname, contentType: 'image/jpeg' }];
    }),
  );
  const angles = pairs.map(([id]) => ({ id, label: id }));
  return auditScope.run(`EVAL-${c.id}`, () => inspect(photos, knownMarks, remainingGBP, { angles, read: (p) => readFile(p) }));
}

const totalGBP = (settled: Settled[]) => settled.reduce((sum, f) => sum + Math.round((f.proposedGBP ?? 0) * 100), 0) / 100;

function judge({ expect }: Case, settled: Settled[]) {
  const fails: string[] = [];
  for (const [angle, allowed] of Object.entries(expect.allow ?? {})) {
    const got = settled.filter((f) => f.angle === angle);
    if (!got.length) fails.push(`${angle}: no finding at all`);
    for (const f of got) if (!allowed.includes(f.outcome)) fails.push(`${angle}: ${f.outcome}, wanted ${allowed.join(' or ')} (${f.reason})`);
  }
  for (const [angle, wanted] of Object.entries(expect.need ?? {}))
    if (!settled.some((f) => f.angle === angle && wanted.includes(f.outcome))) fails.push(`${angle}: nothing came out as ${wanted.join(' or ')}`);
  for (const f of settled)
    if (expect.chargeClauses && f.outcome === 'charge' && !expect.chargeClauses.includes(f.clauseId ?? ''))
      fails.push(`${f.angle}: charged on ${f.clauseId}, wanted ${expect.chargeClauses.join(' or ')}`);
  if (expect.maxTotalGBP !== undefined && totalGBP(settled) > expect.maxTotalGBP) fails.push(`total £${totalGBP(settled)} is over £${expect.maxTotalGBP}`);
  return fails;
}

async function main() {
  const { cases }: { cases: Case[] } = JSON.parse(readFileSync('fixtures/expected.json', 'utf8'));
  const rows: Record<string, string>[] = [];
  const details: string[] = [];
  const stop: string[] = [];

  for (const c of cases) {
    const type = c.guardrail ? 'G' : c.clean ? 'C' : '';
    const refs = Object.values(c.pairs ?? {}).flat();
    if (c.awaiting && refs.some((r) => r && !photoFile(r))) {
      rows.push({ id: c.id, type, result: 'NO FIXTURE', charged: '', case: c.title });
      details.push(`${c.id} needs ${c.awaiting}`);
      continue;
    }
    const settled = await run(c);
    const fails = judge(c, settled);
    const unreached = settled.filter((f) => f.reason === INSPECT_FAILED);
    const result = unreached.length ? 'ERROR' : fails.length ? 'FAIL' : 'PASS';
    rows.push({ id: c.id, type, result, charged: `£${totalGBP(settled).toFixed(2)}`, case: c.title });
    details.push(
      `${c.id} ${settled.map((f) => `${f.angle}: ${f.kind}/${f.outcome}${f.proposedGBP ? ` £${f.proposedGBP}` : ''}`).join('; ')}`,
      ...fails.map((why) => `  FAIL ${why}`),
    );
    if (unreached.length) stop.push(`${c.id}: the model failed on ${unreached.map((f) => f.angle).join(', ')}, so this run proves nothing`);
    if (c.guardrail && fails.length) stop.push(`${c.id}: guardrail case failed`);
    if (c.clean && totalGBP(settled) > 0) stop.push(`${c.id}: clean return was charged £${totalGBP(settled)}`);
  }

  console.table(rows);
  console.log(details.join('\n'));
  const count = (result: string) => rows.filter((r) => r.result === result).length;
  console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('ERROR')} never reached the model, ${count('NO FIXTURE')} waiting for photos.`);
  if (stop.length) {
    console.error(`\nGATE FAILED\n${stop.join('\n')}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
