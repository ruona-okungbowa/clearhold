import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { RenterFooter, RenterNav, Who } from "./chrome";
import l from "./landing.module.css";
import { Runway } from "./runway";
import { TryReturn } from "./try-return";
import w from "./wire.module.css";

export const metadata: Metadata = { title: "Landing page" };

const RULES = [
  [
    "Creases are on us.",
    "A night of dancing leaves creases, lint and a bit of pilling. That’s wear, and cleaning is already in your fee.",
  ],
  [
    "Old marks aren’t yours.",
    "Every garment keeps its own history, so a mark someone made in March stays with March.",
  ],
  [
    "You see it before you pay for it.",
    "Any charge comes with your pick-up photo, your return photo and the price list it came from.",
  ],
  [
    "A real person signs off.",
    "Nothing is charged until someone at the shop has looked at the photos themselves.",
  ],
  [
    "Charges only go down.",
    "If the shop changes a charge, it can only make it smaller.",
  ],
  [
    "Not happy? Tell us once.",
    "Send your own photos and a note. We look again, and the charge can only stay the same, drop or disappear.",
  ],
];

const FAQ = [
  [
    "Is cleaning included?",
    "Yes. Every hire is professionally cleaned when it comes back, and creases, lint and everyday wear are never charged.",
  ],
  [
    "What’s the deposit for?",
    "It’s held on PayPal, not taken, and released when you hand the look back. It only ever covers new damage, priced from our published list.",
  ],
  [
    "What if I spill something?",
    "It happens. You’ll see the photos and the price before anything is charged, and if you think we’ve got it wrong you can tell us once.",
  ],
  [
    "How do I pay?",
    "With PayPal. You’ll see the full price before you pay, and nothing is added at checkout.",
  ],
  [
    "Are my photos private?",
    "Yes. They’re of the garment only, shared with no one but you and the shop, and deleted after 180 days.",
  ],
  [
    "Can I hire for longer?",
    "Yes. Pick your dates when you book, and the price updates before you pay.",
  ],
];

export default function LandingPage() {
  return (
    <div className={`${w.page} ${l.page}`}>
      <a href="#main" className={w.skip}>
        Skip to content
      </a>
      <RenterNav home="" className={l.nav} />

      <main id="main">
        <section className={l.hero} id="top">
          <h1>
            <span className={l.wordmark}>Clearhold</span>
            <span className={l.heroLine}>Hire it. Wear it. Hand it back.</span>
          </h1>
          <div className={l.heroText}>
            <p>
              Suits, dresses and black tie for weddings, the races and every
              party in between. Hire for the weekend, then hand it back.
              Cleaning’s on us.
            </p>
            <a href="#how" className={l.ghostLink}>
              How hiring works
            </a>
          </div>
          <Runway />
        </section>

        <section id="how" className={l.how} aria-labelledby="how-title">
          <div className={l.howHead}>
            <h2 id="how-title" className={l.bigH2}>
              How hiring works
            </h2>
            <p className={l.howSub}>
              Three steps, and no surprises at the end.
            </p>
            <div className={l.tryBox}>
              <TryReturn />
            </div>
          </div>
          <ol className={l.steps}>
            <li className={l.step}>
              <div className={l.stepText}>
                <p className={l.when}>Book your look</p>
                <h3>Pick your dates, see the whole price</h3>
                <p>
                  Everything is on the page before you pay, including the price
                  list for the rare times something needs fixing. Nothing gets
                  added at checkout.
                </p>
              </div>
              <div className={`${l.stepPic} ${l.bookPic}`}>
                <div className={l.bookCard}>
                  <p className={l.bookItem}>Brown wool blazer, 40R</p>
                  <p className={`${w.muted} ${w.small}`}>
                    Fri 13 to Mon 16 Nov · Halifax
                  </p>
                  <p className={l.bookTotal}>
                    <span>Weekend hire, cleaning included</span>
                    <strong className={w.num}>£28</strong>
                  </p>
                  <p className={l.bookNote}>
                    Plus a £60 deposit, held on PayPal and released when you
                    return it. Creases and lint are never charged.
                  </p>
                </div>
              </div>
            </li>
            <li className={l.step}>
              <div className={l.stepText}>
                <p className={l.when}>Pick it up</p>
                <h3>Six quick photos, and it’s yours for the weekend</h3>
                <p>
                  Front, back, sleeves, cuffs and label, in under a minute at
                  the counter. Any marks already there are noted on the garment,
                  not on you.
                </p>
              </div>
              <div className={l.stepPic}>
                <Image
                  src="/design-lab/cuff-pickup.jpg"
                  alt="Close-up of the left cuff at pick-up, showing a faint older mark"
                  fill
                  sizes="(max-width: 900px) 100vw, 30vw"
                />
              </div>
            </li>
            <li className={l.step}>
              <div className={l.stepText}>
                <p className={l.when}>Hand it back</p>
                <h3>Drop it off, and you’re done</h3>
                <p>
                  The same six photos are compared side by side, and most
                  returns are signed off in minutes. If something new turns up,
                  you see the photos and the price first.
                </p>
              </div>
              <div className={l.stepPic}>
                <Image
                  src="/design-lab/lapel-return.jpg"
                  alt="The left lapel at return, with the area of a new mark circled"
                  fill
                  sizes="(max-width: 900px) 100vw, 30vw"
                />
                <span className={l.ring} />
              </div>
            </li>
          </ol>
        </section>

        <section id="rules" className={l.rules} aria-labelledby="rules-title">
          <div className={l.inner}>
            <h2 id="rules-title" className={l.bigH2}>
              Our fair-hire promise
            </h2>
            <ul className={l.ruleList}>
              {RULES.map(([rule, reason]) => (
                <li key={rule}>
                  <strong>{rule}</strong>
                  <p>{reason}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="renters"
          className={l.renters}
          aria-labelledby="renters-title"
        >
          <div className={l.rentersText}>
            <h2 id="renters-title">Spilt the champagne? No surprises.</h2>
            <p>
              If something does need fixing, you’ll see exactly what the shop
              sees: both photos, the reason in plain English, and the price.
              Happy with it? Accept. Not sure? Tell us why, once, with your own
              photos.
            </p>
            <ul className={l.ticks}>
              <li>
                Your pick-up photos protect you from marks you didn’t make
              </li>
              <li>Reasons in two sentences, never small print</li>
              <li>A real date to reply by, not “in due course”</li>
            </ul>
          </div>
          <article className={l.finding} aria-labelledby="finding-title">
            <div className={l.findingHead}>
              <h3 id="finding-title">Left lapel: a new mark</h3>
              <p className={`${l.findingAmount} ${w.num}`}>£24</p>
            </div>
            <div className={l.pair}>
              <figure>
                <div className={l.crop}>
                  <Image
                    src="/design-lab/lapel-pickup.jpg"
                    alt="Left lapel at pick-up on 13 Nov: no mark in the circled area"
                    fill
                    sizes="(max-width: 900px) 50vw, 20vw"
                  />
                  <span className={l.ringEmpty} />
                </div>
                <figcaption>Pick-up, 13 Nov</figcaption>
              </figure>
              <figure>
                <div className={l.crop}>
                  <Image
                    src="/design-lab/lapel-return.jpg"
                    alt="Left lapel at return on 16 Nov, with the area of the new mark circled"
                    fill
                    sizes="(max-width: 900px) 50vw, 20vw"
                  />
                  <span className={l.ring} />
                </div>
                <figcaption>Return, 16 Nov</figcaption>
              </figure>
            </div>
            <p>
              There’s a new mark on the left lapel that wasn’t in your pick-up
              photo. It needs a specialist clean, which our price list puts at
              £18 to £30.
            </p>
            <ul className={l.trail}>
              <li>
                <Who ai>Spotted</Who> in your return photos:{" "}
                <strong className={w.num}>£24</strong>
              </li>
              <li>
                <Who>Checked</Who> by our Halifax team:{" "}
                <strong className={w.num}>£24</strong>
              </li>
            </ul>
            <button type="button" className={`${w.ghost} ${l.contest}`}>
              Contest this charge
            </button>
            <p className={`${w.muted} ${w.small}`}>
              Reply by Wed 18 Nov, 4pm. Until then, nothing is taken.
            </p>
          </article>
        </section>

        <section id="help" className={l.help} aria-labelledby="help-title">
          <div className={l.inner}>
            <h2 id="help-title" className={l.bigH2}>
              Good to know
            </h2>
            <dl className={l.faq}>
              {FAQ.map(([q, a]) => (
                <div key={q}>
                  <dt>{q}</dt>
                  <dd>{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className={l.cta} aria-labelledby="cta-title">
          <div className={l.ctaInner}>
            <div className={l.ctaText}>
              <h2 id="cta-title">Got something in the diary?</h2>
              <p>
                Find your look for the weekend, wear it all night, and hand it
                back without a second thought.
              </p>
              <Link href="/looks" className={w.block}>
                Find your look
              </Link>
            </div>
            <Image
              src="/design-lab/guests.webp"
              alt="Illustration of two wedding guests in a blush dress and a chocolate suit"
              width={640}
              height={1170}
              className={l.guests}
            />
          </div>
        </section>
      </main>

      <RenterFooter>
        Built for the PayPal AI Hackathon, November 2026.{" "}
      </RenterFooter>
    </div>
  );
}
