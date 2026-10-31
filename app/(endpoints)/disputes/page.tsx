import type { Metadata } from 'next';
import { connection } from 'next/server';
import { amountOf, listDisputes } from '@/lib/paypal';
import { EndpointPage } from '../endpoint-page';

export const metadata: Metadata = { title: 'Disputes' };

export default async function DisputesPage() {
  await connection();
  const disputes = await listDisputes();

  return (
    <EndpointPage
      title="Disputes"
      calls={['GET /v1/customer/disputes']}
      source="listDisputes()"
      note="The list returns dispute summaries, paged by cursor. Amounts are in the dispute's own currency."
      rows={disputes.map((d) => ({
        id: d.dispute_id,
        created: d.create_time,
        updated: d.update_time,
        reason: d.reason,
        status: d.status,
        state: d.dispute_state,
        stage: d.dispute_life_cycle_stage,
        channel: d.dispute_channel,
        amount: amountOf(d.dispute_amount),
        currency: d.dispute_amount?.currency_code,
        outcome: d.outcome,
        responseDue: d.seller_response_due_date,
      }))}
      columns={[
        { field: 'created', headerName: 'Created', cellDataType: 'dateTimeString', sort: 'desc' },
        { field: 'reason', headerName: 'Reason' },
        { field: 'status', headerName: 'Status' },
        { field: 'state', headerName: 'State' },
        { field: 'stage', headerName: 'Stage' },
        { field: 'channel', headerName: 'Channel' },
        { field: 'amount', headerName: 'Amount', type: 'money' },
        { field: 'currency', headerName: 'Currency' },
        { field: 'outcome', headerName: 'Outcome' },
        { field: 'responseDue', headerName: 'Response due', cellDataType: 'dateTimeString' },
        { field: 'updated', headerName: 'Updated', cellDataType: 'dateTimeString' },
        { field: 'id', headerName: 'Dispute ID' },
      ]}
    />
  );
}
