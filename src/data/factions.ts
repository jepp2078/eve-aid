import type { FactionId, ShipId } from './types';

export interface FactionInfo {
  name: string;
  color: string;
  income: 4;
  build: 6;
  research: 3;
  /** Explorer frigate + interceptor frigate. */
  startingShips: [ShipId, ShipId];
}

export const FACTION_INFO: Record<FactionId, FactionInfo> = {
  amarr: {
    name: 'Amarr',
    color: '#d4a017',
    income: 4,
    build: 6,
    research: 3,
    startingShips: ['anathema', 'malediction'],
  },
  caldari: {
    name: 'Caldari',
    color: '#3b82c4',
    income: 4,
    build: 6,
    research: 3,
    startingShips: ['buzzard', 'crow'],
  },
  gallente: {
    name: 'Gallente',
    color: '#2f9e74',
    income: 4,
    build: 6,
    research: 3,
    startingShips: ['helios', 'ares'],
  },
  minmatar: {
    name: 'Minmatar',
    color: '#c0392b',
    income: 4,
    build: 6,
    research: 3,
    startingShips: ['cheetah', 'stiletto'],
  },
};
