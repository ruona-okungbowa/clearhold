'use client';

// What the control room's custom Studio widgets share with the page around them. Renter names travel here rather than
// through a Studio data source, so the desk agent, which can read every source, never sees them.

import type { AgAiHarness } from 'ag-studio';
import { createContext, useContext } from 'react';

export const VIEWS = ['Needs a person', 'All open hires', 'Holds', 'Item history'];

export type RoomContextValue = {
  view: number;
  setView: (view: number) => void;
  shop: string;
  ages: number[];
  renters: Record<string, string>;
  // The work queue's top row: the Evidence pair shows it until a person selects one.
  firstRef: string | null;
  setFirstRef: (ref: string | null) => void;
  harness: () => AgAiHarness | null;
};

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom() {
  const room = useContext(RoomContext);
  if (!room) throw new Error('A control room widget rendered outside the room');
  return room;
}
