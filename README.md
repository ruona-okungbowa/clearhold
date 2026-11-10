# Clearhold

> **Fair deposits for clothes hire**

Clearhold is a deposit workflow for formalwear hire shops. It holds a renter's deposit on PayPal, compares pick-up and return photos with Claude, and lets staff capture only a published, evidence-backed amount—or release the rest—after human sign-off.

**Hosted demo:** [clearhold-gamma.vercel.app](https://clearhold-gamma.vercel.app/)  
**Repository:** [github.com/ruona-okungbowa/clearhold](https://github.com/ruona-okungbowa/clearhold)  
**License:** MIT ([LICENSE](LICENSE))

## The one-sentence identity

**Clearhold is a fair-deposit system for formalwear hire shops: it holds a renter's deposit on PayPal, compares time-stamped pick-up and return photos with an AI inspector, and lets staff capture only a published, evidence-backed amount—or release the rest—after human sign-off.**

## Who it is for

Clearhold is built for the owner or counter manager of a multi-branch formalwear hire shop. The shop needs to protect its garments without making renters pay for normal wear, an old mark, or an unexplained decision.

The renter-facing promise is simple:

- Creases, lint, light pilling and normal wear are never charged.
- A mark already recorded on the garment belongs to the garment's history, not the new renter.
- Any proposed charge includes the pick-up photo, return photo, reason and published price band.
- A person signs off before money is captured.
- A renter can contest once, and the charge can stay the same, go down or disappear—never go up.

## The 60-second judge route

1. Open the [hosted demo](https://clearhold-gamma.vercel.app/) and scroll to the worked example: a £24 new mark, paired photos, a published £18–£30 stain band and a £60 deposit held on PayPal.
2. Open [Staff sign-in](https://clearhold-gamma.vercel.app/staff-login) and sign in with the demo credentials supplied to the judges. Choose a shop and continue to the control room.
3. In the [control room](https://clearhold-gamma.vercel.app/control-room), open **LH-BRA-10984** or use its **Approve or lower** action. This case shows two AI findings, a stain and a missing button, with the total capped at the £60 hold.
4. On [LH-BRA-10984's approval page](https://clearhold-gamma.vercel.app/hire/LH-BRA-10984/approve), lower, waive or keep the findings and show that staff can never raise an AI amount. The page shows the amount to capture and the amount to release.
5. For the renter-contest path, open the [disputes queue](https://clearhold-gamma.vercel.app/disputes) and choose **LH-HAL-0101**. The [contest approval page](https://clearhold-gamma.vercel.app/hire/LH-HAL-0101/approve) shows the renter's note and photo, paired evidence, and controls that can only keep, lower or remove the charge.

The hosted demo uses seeded demonstration cases so judges can reach the product without supplying their own PayPal or Anthropic credentials. The demo data is not presented as production customer data.

## How it works

### 1. PayPal holds the deposit

At booking, the PayPal JavaScript SDK creates an order in GBP with `intent=authorize`. The rental fee and deposit are authorized together; the deposit is held rather than captured immediately.

The server-side payment layer in [`lib/money.ts`](lib/money.ts) uses the PayPal Server SDK in the PayPal Sandbox and handles:

- **Orders v2 `AUTHORIZE`** to create the hold and authorize the order.
- **Payments v2 authorization capture** to capture an approved amount.
- **Payments v2 authorization void** to release a clean return's remaining hold.
- **Payments v2 authorization reauthorize** when a hold's three-day honour period needs refreshing before the garment is returned.
- **PayPal request IDs** on money-changing calls so retries replay the same operation rather than creating a second charge.
- PayPal debug IDs and response status in the application audit trail.

The demo is a PayPal Sandbox integration. It does not move real money.

### 2. Claude compares the photo pairs

At pick-up and return, staff take the same six garment angles:

- Front
- Back
- Left sleeve
- Right sleeve
- Collar and cuffs
- Care label and barcode

The inspector in [`lib/inspector.ts`](lib/inspector.ts) sends each pick-up/return pair to Claude and asks for structured findings such as `new_damage`, `known_mark`, `wear`, `dirt`, `missing_part` or `none`, together with a description, clause ID, severity, confidence and photo references.

**Claude's exact role is to compare paired photos and return structured findings. It never sets the amount, approves a charge, captures money or releases a hold.**

If the model fails, cites the wrong photo pair, returns an unknown clause, falls below the confidence floor or identifies major damage, the finding goes to a person for review.

### 3. Deterministic code settles the finding

The settlement code—not the model—decides what can be charged. [`lib/schedule.ts`](lib/schedule.ts) contains the published clauses:

- **W1:** normal wear such as creases, light pilling and lint — never charged.
- **S1:** stain needing specialist cleaning — £18–£30, once per garment.
- **B1:** missing button — £6.
- **R1:** beyond repair/replacement value — £140, capped at the remaining hold and sent to an owner look because major damage needs a person.

[`lib/inspector.ts`](lib/inspector.ts) then:

- validates the photo IDs and clause;
- matches known marks against the garment's history;
- applies the confidence and major-damage rules;
- clamps a charge into its published clause band;
- caps the running total at what remains of the PayPal hold; and
- merges repeated once-per-garment clauses into one charge.

Staff can lower or waive an AI charge, but cannot raise it. Every capture requires a short-lived signed approval from a person. The control-room desk agent is read-only: it can explain holds and arrange widgets, but it has no tool that approves, captures, releases or voids money.

### 4. The renter sees the evidence and can contest once

The renter page at [`/r/[token]`](app/r/[token]/page.tsx) shows the same evidence used by staff: paired photos, the finding, the price-list clause, the amount proposed by AI and the amount approved by staff.

A renter can accept the outcome or send one contest with a note and an optional photo. A contest cancels an open final approval. Staff can then keep the amount, lower it or remove it, but cannot increase it. [`lib/evidence-pack.ts`](lib/evidence-pack.ts) can assemble the photos, findings, clauses, approvals, captures and audit timeline into a JSON evidence pack. It can also ask Claude for a draft response grounded only in that pack; a person must review and submit any response to PayPal.

## Demo cases

### LH-BRA-10984 — staff approval

[Open the approval page](https://clearhold-gamma.vercel.app/hire/LH-BRA-10984/approve).

This case contains two AI-proposed findings on a returned garment:

- A stain under **S1**, proposed within the £18–£30 band.
- A missing button under **B1**, fixed at £6.

The page shows the evidence, confidence, editable staff amounts, total to approve, capture amount and amount released. Staff can lower or waive an amount, but the UI and server-side settlement rules do not allow a higher amount than the AI proposal or the remaining hold.

### LH-HAL-0101 — renter contest

[Open the contest approval page](https://clearhold-gamma.vercel.app/hire/LH-HAL-0101/approve).

The renter says the stain was already present at collection and attaches a photo. The page shows the renter's contest, pick-up and return pairs, the AI finding, a lower-confidence owner-look finding and the available staff response. The contest can only preserve, reduce or remove the charge.

The related evidence page is available at [`/disputes/LH-HAL-0101`](https://clearhold-gamma.vercel.app/disputes/LH-HAL-0101). It includes the evidence-pack download and a grounded draft-response action. Nothing is sent automatically from that page.

### Answering a PayPal dispute

The AI drafts; a named person clicks; only then does our code call PayPal. On `/disputes/<hireRef>`:

- **Send to PayPal** (only while PayPal shows `WAITING_FOR_SELLER_RESPONSE` and offers its `provide_evidence` action): edit the draft, pick up to 10 JPEG photos, then confirm the exact notes, files and capture id. It goes as evidence type `OTHER`, the type PayPal lists for "item not as described". One send per round of PayPal's review.
- **Accept claim and refund £X**: X is PayPal's dispute amount, never typed, and never more than the capture. After a confirm step, PayPal refunds the buyer and the hire is marked refunded via dispute.
- **Refresh from PayPal**, and the webhook's `CUSTOMER.DISPUTE.CREATED`/`UPDATED`/`RESOLVED` events, update our case status only.

Staff sign in with their name, and every response records it.

To open a sandbox dispute to test against (the hire must have been paid with a sandbox **Personal** PayPal account; a guest card payment can't be disputed from a buyer account):

1. Book a look at `/looks`. At checkout, choose **PayPal** and log in as a sandbox Personal account.
2. Hand the hire over in Clearhold, so the hire fee is captured.
3. Sign in to `https://www.sandbox.paypal.com` as that buyer, open **Activity**, choose the payment, then **Report a problem** → **Item not as described**, and submit.
4. In Clearhold, press **Refresh from PayPal** on `/disputes`: the dispute appears matched to the hire by its capture id.
5. PayPal often opens a dispute as an inquiry with no `provide_evidence` action. Until PayPal asks the seller for evidence, Send stays off and the page says why.

## What was built during the hackathon

The repository began from the PayPal/AG Grid hackathon starter structure: a Next.js application, PayPal integration scaffolding, AG Grid/AG Studio dependencies and the initial dashboard-oriented project setup.

The current Clearhold product was built during the hackathon. That work includes:

- the formalwear-hire customer experience and catalogue;
- PayPal Sandbox authorization holds in GBP;
- capture, void and reauthorization handling;
- idempotent PayPal request IDs and PayPal audit logging;
- the six-angle pick-up and return photo workflow;
- Claude structured-output inspection;
- deterministic price clauses and settlement guardrails;
- garment mark history so old marks are not charged again;
- signed staff approvals and human-only money actions;
- the multi-branch control room and read-only desk agent;
- renter evidence pages and one-time contests;
- evidence-pack generation and grounded dispute-response drafting;
- the evaluation harness and settlement checks; and
- the Vercel cron route for refreshing eligible PayPal holds.

The original starter-template README described PayPal SDK endpoint pages and an unrelated dashboard. It has been replaced with this Clearhold-specific documentation so judges can evaluate the submitted project rather than the starting scaffold.

## Run locally

### Requirements

- Node.js 20.9 or later
- A PostgreSQL database reachable through `DATABASE_URL`
- A PayPal Sandbox REST app from [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox)
- A Vercel Blob store for private garment photos when testing uploads
- An Anthropic API key for the Claude inspector and desk assistant

### Install

```bash
npm install
cp env.example .env.local
```

Fill `.env.local` with your own local values. Never commit `.env.local`, API keys, PayPal secrets, staff passcodes or database credentials.

At minimum, the application needs these server-side values:

```dotenv
DATABASE_URL=               # PostgreSQL connection string
PAYPAL_CLIENT_ID=           # PayPal Sandbox app client ID
PAYPAL_SECRET=              # PayPal Sandbox app secret
ANTHROPIC_API_KEY=          # Claude inspector/assistant key
APPROVAL_SECRET=            # at least 32 characters; signs staff capture approvals
RENTER_LINK_SECRET=         # at least 32 characters; signs renter evidence links
STAFF_PASSCODE=             # demo/staff sign-in passcode
STAFF_SESSION_SECRET=       # signs the staff session
```

Optional or deployment-specific variables include `AG_STUDIO`, `ANTHROPIC_MODELS`, `PAYPAL_WEBHOOK_ID`, `WEBHOOK_RECEIVER_URL`, `CRON_SECRET` and the Vercel Blob variables used by the deployment. See [`env.example`](env.example) and the route code for the complete deployment configuration.

Generate local signing secrets rather than copying a production value:

```bash
openssl rand -base64 32
```

### Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful commands:

```bash
npm run build             # production build
npm run start             # serve a production build
npm run lint              # ESLint
npm run check:money       # money and settlement checks
npm run check:day3        # PayPal honour-period checks
npm run evals             # inspector and settlement evaluation cases
npm run agent-evals       # control-room/agent evaluation cases
npm run check:adapter     # Anthropic adapter check
```

The evaluation scripts can make real Claude calls when photo fixtures are available. Cases marked `awaiting` are intentionally reported as waiting for their fixture; they are not counted as passes.

## Project map

```text
lib/money.ts                 PayPal Orders/Payments calls, idempotency and audit logging
lib/hold.ts                  Current hold, capture, release and reauthorization rules
lib/inspector.ts             Claude photo comparison and deterministic settlement
lib/schedule.ts              Published clauses, item catalogue and six capture angles
lib/approval.ts              Signed, expiring human approvals before capture
lib/evidence-pack.ts         Evidence pack and grounded response draft validation
app/control-room/            Staff work queue and read-only AG Studio desk agent
app/hire/[hireRef]/          Staff inspection and approval pages
app/r/[token]/               Renter evidence, outcome and contest pages
app/disputes/                Contest queue and evidence-pack page
scripts/evals.ts             Photo-fixture and settlement evaluation harness
fixtures/expected.json       Evaluation cases and expected guardrails
vercel.json                  Daily PayPal hold-reauthorization cron
```

## Safety boundary

Clearhold is intentionally not an autonomous payment agent. Claude can inspect paired garment photos and produce structured findings, but it cannot choose a monetary amount or invoke a PayPal money-moving operation. Code applies the price schedule and remaining-hold cap. A person must approve a capture, and a renter contest can never increase the amount.

The hosted demo is a hackathon demonstration using PayPal Sandbox and seeded cases. It is not production financial, legal or dispute-resolution advice.

## License

This project is released under the [MIT License](LICENSE).
