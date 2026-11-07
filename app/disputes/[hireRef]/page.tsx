import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Photo } from '@/components/studio/EvidencePair';
import { buildEvidencePack } from '@/lib/evidence-pack';
import { draftDisputeResponse } from './actions';
import { DraftPanel } from './draft-panel';

export const metadata: Metadata = { title: 'Dispute evidence' };

const gbp = (n: number | null) => (n === null ? '—' : `£${n.toFixed(2)}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB') : '—');

export default async function DisputePage({ params }: PageProps<'/disputes/[hireRef]'>) {
  const { hireRef } = await params;
  const pack = await buildEvidencePack(hireRef).catch((err: Error) => (err.message.startsWith('No hold') ? notFound() : Promise.reject(err)));
  const { hire, findings, clauses, approvals, captures, hold, contest } = pack;
  const clause = new Map(clauses.map((c) => [c.id, c]));

  return (
    <main>
      <p>
        <Link href="/disputes">All disputes</Link>
      </p>
      <h1>Evidence pack: {hire.ref}</h1>
      <p>
        {hire.itemRef} · {hire.branch} · out {when(hire.startAt)}, due back {when(hire.dueBackAt)}, returned {when(hire.returnedAt)}
      </p>
      <p>
        <a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(pack, null, 2))}`} download={`evidence-pack-${hire.ref}.json`}>
          Download evidence pack (JSON)
        </a>
      </p>

      <h2>Findings</h2>
      {findings.length === 0 && <p>No findings on record.</p>}
      {findings.map((f) => {
        const c = f.clauseId ? clause.get(f.clauseId) : undefined;
        return (
          <article key={f.id} className="mb-6">
            <h3>
              {f.angle}: {f.kind} ({f.outcome})
            </h3>
            <div className="grid max-w-3xl grid-cols-2 gap-2">
              <Photo id={f.pickupPhotoId} label={`Pick-up, ${f.angle}`} />
              <Photo id={f.returnPhotoId} label={`Return, ${f.angle}`} box={f.box} />
            </div>
            <p>{f.description}</p>
            <p>
              Clause: {c ? `${c.id}: ${c.text} (${!c.chargeable ? 'never charged' : c.lowGBP === c.highGBP ? `${gbp(c.lowGBP)} fixed` : `${gbp(c.lowGBP)}–${gbp(c.highGBP)}`})` : 'none'}
            </p>
            <p>
              AI proposed {gbp(f.proposedGBP)} · set by a person {gbp(f.setGBP)}
              {f.setBy && ` (${f.setBy})`} · finding {f.id}
            </p>
          </article>
        );
      })}

      <h2>Approvals</h2>
      <table>
        <thead>
          <tr>
            <th>Approval</th>
            <th>Approver</th>
            <th>Up to</th>
            <th>Expires</th>
            <th>Used</th>
            <th>Signature</th>
          </tr>
        </thead>
        <tbody>
          {approvals.map((a) => (
            <tr key={a.id}>
              <td>{a.id}</td>
              <td>{a.approver}</td>
              <td>{gbp(a.maxGBP)}</td>
              <td>{when(a.expiresAt)}</td>
              <td>{when(a.usedAt)}</td>
              <td>{a.signatureVerifies ? 'verifies' : <strong>does not verify</strong>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>PayPal</h2>
      <p>
        Hold {hold.id}: {gbp(hold.amountGBP)}, {hold.status}
      </p>
      <ul>
        {captures.map((c) => (
          <li key={c.id}>
            Capture {c.id}: {gbp(c.amountGBP)}, {c.final ? 'final' : 'not final'}
          </li>
        ))}
      </ul>

      <h2>Contest</h2>
      {contest ? (
        <>
          <p>
            {contest.status}
            {contest.resolvedBy && `, resolved by ${contest.resolvedBy}`}
          </p>
          <blockquote>{contest.note}</blockquote>
          {contest.photoId && (
            <div className="max-w-sm">
              <Photo id={contest.photoId} label="Renter's photo" />
            </div>
          )}
        </>
      ) : (
        <p>The renter has not contested this hire.</p>
      )}

      <h2>Known marks on {hire.itemRef}</h2>
      <ul>
        {pack.knownMarks.map((m) => (
          <li key={m.id}>
            {m.id}: {m.description}, first seen {m.firstSeen}
          </li>
        ))}
      </ul>

      <h2>Photos</h2>
      <table>
        <thead>
          <tr>
            <th>Photo</th>
            <th>Stage</th>
            <th>Angle</th>
            <th>SHA-256</th>
            <th>Server time</th>
          </tr>
        </thead>
        <tbody>
          {pack.photos.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.stage}</td>
              <td>{p.angle}</td>
              <td className="font-mono text-xs break-all">{p.sha256}</td>
              <td>{when(p.serverAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Timeline</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Type</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {pack.timeline.map((e, i) => (
            <tr key={i}>
              <td>{when(e.at)}</td>
              <td>{e.actor}</td>
              <td>{e.type}</td>
              <td>{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        <small>{pack.aiNotice}</small>
      </p>

      <DraftPanel draft={draftDisputeResponse.bind(null, hire.ref)} />
    </main>
  );
}
