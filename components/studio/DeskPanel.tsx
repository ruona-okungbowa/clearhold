'use client';

// Ask the desk: a custom AG Studio widget, so it can sit beside the grid it changes. Questions go to the Studio AI
// harness (desk-agent.ts), whose Data and Widget agents can filter the report; if that's unavailable or fails, to the
// read-only askDesk server action. Neither has a tool that moves money or contacts a renter.

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import type { AgAiChatSession, AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';
import { Chip } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { askDesk } from '@/app/control-room/actions';
import { useRoom } from './room-context';

export interface DeskPanelState extends AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>> {
  type: 'desk-panel';
}

const RUN_TIMEOUT = 120_000;

// Resolves with the agent's answer once the run it starts here has finished.
function askSession(session: AgAiChatSession, question: string) {
  return new Promise<string>((resolve, reject) => {
    const before = session.messages.length;
    function stop() {
      clearTimeout(timer);
      session.removeEventListener('changed', onChange);
    }
    function onChange() {
      if (session.status === 'error') {
        stop();
        reject(new Error('The desk run failed'));
      }
      const last = session.messages.at(-1);
      if (session.status !== 'idle' || session.messages.length <= before + 1 || last?.role !== 'assistant') return;
      stop();
      const answer = last.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n').trim();
      if (answer) resolve(answer);
      else reject(new Error('The desk gave no answer'));
    }
    const timer = setTimeout(() => {
      stop();
      session.cancel();
      reject(new Error('The desk took too long'));
    }, RUN_TIMEOUT);
    session.addEventListener('changed', onChange);
    session.sendMessage(question);
  });
}

export function DeskPanel({ widgetApi }: AgWidgetParams<DeskPanelState>) {
  const { harness } = useRoom();
  const session = useRef<AgAiChatSession | null>(null);
  const [asked, setAsked] = useState<{ q: string; a: string } | null>(null);
  const [asking, startAsk] = useTransition();
  const live = Boolean(harness());

  useEffect(() => widgetApi.setDisplayState('displayed'), [widgetApi]);

  const answer = async (q: string) => {
    const desk = harness();
    if (desk) {
      try {
        session.current ??= await desk.createThread({ agentId: 'desk' });
        return await askSession(session.current, q);
      } catch (err) {
        console.error('[desk] Studio agent failed, using the read-only desk', err);
        session.current = null;
      }
    }
    const res = await askDesk(q).catch(() => ({ error: 'Could not reach the server' }));
    return 'answer' in res ? res.answer : res.error;
  };

  const ask = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const q = String(new FormData(form).get('ask') ?? '').trim();
    if (!q) return;
    startAsk(async () => {
      const a = await answer(q);
      setAsked({ q, a });
      form.reset();
    });
  };

  return (
    <section className={st.widget} aria-labelledby="agent-title">
      <div className={w.panelHead}>
        <h2 id="agent-title" className={w.sH2}>
          Ask the desk
        </h2>
        <Chip kind="stAi">AI</Chip>
      </div>
      {asked && (
        <div className={st.transcript} aria-live="polite">
          <p className={st.agentYou}>{asked.q}</p>
          <p className={st.agentAi}>{asked.a}</p>
        </div>
      )}
      <form className={st.askForm} onSubmit={ask}>
        <label htmlFor="ask" className={w.srOnly}>
          Ask the desk
        </label>
        <input id="ask" name="ask" maxLength={300} className={w.sInput} placeholder="Ask about holds, hires or findings" />
        <button type="submit" className={w.btnGhost} disabled={asking}>
          {asking ? '…' : 'Ask'}
        </button>
      </form>
      <p className={w.sSub}>The desk can {live ? 'filter and explain' : 'explain'}. It can’t approve, capture or release money.</p>
    </section>
  );
}

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
  '<path d="M2 2h12v9H6l-3 3v-3H2z"/></svg>';

export const deskPanelWidget: AgWidgetDefinition<'desk-panel', DeskPanelState> = {
  id: 'desk-panel',
  label: 'Ask the desk',
  icon: ICON,
  dataMapping: {},
  form: (params) => params.createDefaults({ dataMappingItems: [] }),
  defaultState: { dataMapping: {} },
  comp: DeskPanel,
  defaultSize: { width: 400, height: 240 },
  minSize: { width: 280, height: 200 },
  ai: { description: 'The panel staff type questions into. It shows no data.' },
};
