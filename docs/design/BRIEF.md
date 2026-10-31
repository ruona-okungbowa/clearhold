# Clearhold front end: design brief

Phase 0 · 31 Oct 2026 · inputs: [`docs/plan.md`](../plan.md) (v3 plan, with the 30 Oct clothing update), [`docs/research/uk-clothing-hire-research.md`](../research/uk-clothing-hire-research.md) (cited below as R§). `docs/references/likes.md` did not exist, so the reference principles in section 3 come from the research alone.

**The one job of the whole front end:** anyone, on any screen, can answer "what is happening with this money?" in three seconds, and can see the photo that explains it.

## 1. Surfaces

| Surface | Who | The job | Emotional state | The one feeling |
| --- | --- | --- | --- | --- |
| Renter flow (phone first) | Callum, 33, hiring a wool blazer for a friend's wedding | Book with a known worst case; prove the blazer's condition; get money back or understand a charge | Before: event-anxious, wary of the small print. At return: braced for a bill | **"I can see exactly where my money is, and nobody can surprise me."** |
| Owner review (tablet and desktop) | Branch lead at the returns desk, between customers | Clear the returns queue; approve or lower each finding against its photos | Busy, interrupted, wary of arguing with a customer | **"The evidence decides; I just confirm it."** |
| Back office, in AG Studio (desktop) | Priya, ops manager, six branches, about £30,000 of other people's money; the auditor in view mode | See what is held, at risk, kept and why; defend every pound at month end | Accountable, sceptical of the AI and of staff | **"Nothing here is hidden from me, and I can trace any number to a photo."** |
| Landing page (desktop and phone) | Hackathon judges; hire firms and P2P platforms | Grasp the promise and the mechanism in one scroll; start the demo | Curious, time-poor, comparing with other entries | **"This is a real, fair way to hold deposits, and it works today."** |

## 2. The ten research findings that shape the UI

| # | Finding (R§) | What it means for the design |
| --- | --- | --- |
| 1 | Shops hold a card "up to £450" with no visible deposit; HURR charges 20% of RRP up front (R§2, R§7) | Show the hold as money **reserved, not taken**, with the exact £ and when it comes back. The hold needs its own visual state, distinct from a charge. |
| 2 | No UK platform defines wear versus damage; Moss charges either £20 or the full price (R§1 #2, R§6) | The damage schedule is a first-class, readable table before payment, with **"never charged"** rows shown as prominently as the priced ones. |
| 3 | Condition evidence is left to the user (lender videos, private condition reports) (R§7) | The **evidence pair** (pick-up crop beside return crop, region marked) is the product's signature object, shared by renter, owner and auditor. |
| 4 | Disputes end in "our decision is final", taking up to 30 days (R§6, R§7) | The contest is one calm, prominent action with a visible clock and a stated outcome rule (it can only keep, lower or remove a charge). |
| 5 | Condition, damage and loss make up 10 of 25 coded complaints (R§3) | Pick-up photos are sold to the renter as **their** protection; the pick-up confirmation screen is a moment of reassurance, not admin. |
| 6 | Drip pricing is now enforced: CMA guidance of 18 Nov 2025; renters complain of a 15% fee and of postage (R§1 #10, R§6) | Fee, deposit hold and total sit on the item page and stay on screen until payment. Nothing new appears at checkout. |
| 7 | CMA is investigating default opt-ins and countdown timers (R§5, R§6) | No pre-ticked add-ons, no timers, no scarcity copy. The only clocks shown are real deadlines (contest window, hold expiry). |
| 8 | Hygiene concern weakens intent to rent (Clube and Tennant 2020; Baek and Oh 2021, older sources) (R§3) | Garment photography must look clean and cared for: steamed, on a hanger, even light. Show a "cleaned on" date on the item. |
| 9 | Fabric, sheen and lighting make AI calls hard; odour and zips can't be judged from photos (R§7) | AI-suggested and human-decided must differ by **shape and words**, not colour alone. Confidence is shown; low confidence reads "needs a person". Manual checks appear as their own row type. |
| 10 | Common WCAG failures: date pickers, image-heavy product pages, filters (R§6) | The date picker accepts typed dates, has 24 px targets, and is fully keyboard-operable. Every evidence image has a text description of the finding. |

## 3. Reference principles (derived from the research; no likes file yet)

- **One page of every fee** (Moss's fee list, R§6): the worst case can be read in pounds before booking.
- **Published clocks** (By Rotation's 24h, 7-day and 30-day steps, R§6): every deadline is stated with a date, not "soon".
- **Arrival photos protect the renter** (Pickle, US, R§6): capture is framed as a shared record.
- **Rent price beside retail price** (Hirestreet, R§4): anchor honestly, and anchor the deposit to the schedule ("most returns cost £0" only once it is true), never to RRP.
- **Minor wear included** (Hirestreet, MWHQ, R§6): wear rows say "included in your fee".

If you add `docs/references/likes.md` before Phase 1, I will fold those sites in as principles only, never their assets, copy or trade dress.

## 4. Constraints

**From the repo**

- Next.js 16.3.6 (App Router, React 19.2). Its `AGENTS.md` warns that APIs differ from older docs, so I read `node_modules/next/dist/docs` before writing code.
- Tailwind CSS v4, with CSS custom properties in `app/globals.css` as the single token source (`--pp-*`), mapped into Tailwind with `@theme inline`. I keep this system: tokens get renamed and revalued, and nothing new is added.
- AG Grid 36.2 and AG Studio 3.0, already themed through `studioTheme.withParams` reading the same CSS variables (`app/dashboard/studio/theme.ts`). The new theme slots into that pattern.
- `lib/money.ts` is the money service. It is out of bounds for design work.
- There is no domain API, database or fixtures yet (no Prisma, no hire, finding or hold models), and no PayPal JS SDK on the client. Phase 3 will use typed local fixtures that match the plan's row shapes. Phase 4 cannot "connect to existing API contracts" until they exist, and will open issues instead of faking data.

**From the plan**

- The money model is £28 fee + £60 deposit = an £88 hold, fee captured at pick-up, damages captured at return, the rest voided. It has a 29-day expiry and a 3-day honour period.
- The six angles are front, back, left sleeve, right sleeve, a collar or cuff close-up, and the care-label tag.
- The 0.75 confidence floor sends a finding to an owner look. The owner can lower but never raise. Wear is never charged.
- The contest window is 48 hours in the demo and 7 days in production, with up to 500 characters and photos.
- The three custom widgets are the Hold timeline, Evidence pair and Condition history. There are three role layouts: ops manager in edit mode, branch lead in view mode with filters, and auditor in view mode with no buttons.
- Accessibility: no serious axe violations; Lighthouse 90 or above on the capture and evidence pages.

## 5. Success criteria

1. **The three-second test.** On every screen, a first-time viewer can state the money state (held, released, taken or contested) and the amount.
2. **AI and human states are told apart without colour,** in greyscale screenshots.
3. **Every finding shows its pair, clause and £** within the same visible area, at 390 px.
4. **The contest action is visible on the result screen without scrolling,** and never styled as an error.
5. **The owner amount control cannot express a raise.** Its range tops out at the proposed figure.
6. **Zero serious or critical axe violations** on every route, full keyboard paths through booking, capture, contest and approval, and reduced-motion variants.
7. **The back office reads as Clearhold's, not stock AG Studio:** brand theme, three custom widgets, three role layouts.
8. **One token source.** No hex value or spacing figure outside the token files.

## 6. Open questions (my default if you don't answer)

1. **Who takes the return photos?** The plan's non-goals exclude renters photographing returns at home. *Default:* the renter takes them at the returns desk, on their own phone or the shop's, guided by staff. This keeps your renter flow and the plan's controls (the same backdrop and light as pick-up).
2. **Owner review versus the Studio branch-lead layout.** The plan puts approval inside the Evidence pair widget in Studio. *Default:* design surface 2 as a standalone tablet view sharing the Evidence pair component, and also deliver it as the branch-lead Studio layout. I'll say "branch lead" or "owner", not "lender", since Ledgerton owns its stock.
3. **Whose brand leads?** Clearhold is the product; Ledgerton is a fictional customer whose theme in the plan is hire yellow and charcoal. The repo's current tokens copy PayPal's blue and "PayPal Open" font, which I'd drop as PayPal's trade dress. *Default:* Clearhold's own identity, with tenant theming (Ledgerton's yellow and charcoal) shown as a swappable layer in the back office.
4. **shadcn/ui.** The plan lists it, but it isn't installed, and you asked for no default library look. *Default:* our own components on Tailwind v4, with no new UI library.
