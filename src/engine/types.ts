import type {
  AbilitySlot,
  ActionType,
  BasicMineral,
  BlackFace,
  DevId,
  FactionId,
  Material,
  Mineral,
  Orbit,
  Resources,
  ShipId,
  StructureType,
  WhiteFace,
} from '../data/types';

export type Side = 'attacker' | 'defender';
export interface PlayerPublic {
  faction: FactionId; name: string; uid: string; setupDone: boolean;
  res: Resources; vp: number; cubesUsed: number; slots: Record<ActionType, number>; passed: boolean;
  ships: Record<ShipId, number>; systems: number; central: boolean;
  structures: Record<StructureType, number>; homeCitadels: number;
  belts: Record<Mineral, number>; lockedHomeBelts: number;
  completed: DevId[]; tapped: DevId[]; devAreaCount: number;
}
export interface AreaCard { dev: DevId; tokens: number }
export interface PrivateSnapshot { seq: number; area: AreaCard[]; pendingResearch: number; pendingCards: number }
export interface PlayerPrivate { area: AreaCard[]; pendingResearch: number; pendingCards: number; history: PrivateSnapshot[] }
export interface RaidDecl { raider: FactionId; target: FactionId; strength: number }
export interface TurnState { faction: FactionId; actionTaken: ActionType | null; deployable: boolean }
export interface HistoryItem { seq: number; actor: FactionId | null; touchedPrivate: boolean }
export interface GameResult { ranking: FactionId[]; winners: FactionId[] }
/** The saved shape's version: bump it with every change to it, and teach `server/migrate.ts` the step up. */
export const GAME_VERSION = 3;
/**
 * `full`: the app runs the whole game (resources, fleets, the board). `light`: the board keeps ISK, minerals, ships and
 * cubes; the app only tracks VP, systems, development cards, turns, combat and upkeep. Fixed when the game is created.
 */
export type GameMode = 'full' | 'light';
export interface GameState {
  v: typeof GAME_VERSION; mode: GameMode; code: string; createdAt: number; uids: string[];
  phase: 'lobby' | 'setup' | 'actions' | 'upkeep' | 'ended';
  round: number; seats: FactionId[]; firstPlayer: FactionId; turn: TurnState | null;
  /** Factions that retreated from a combat this round (Pacifist's condition); emptied when the next round begins. */
  retreatsThisRound: FactionId[];
  players: Partial<Record<FactionId, PlayerPublic>>;
  /** `largeShips`: Fleet Supremacy holders who declared a large ship in a light upkeep (always `[]` in a full game). */
  upkeep: { emergency: boolean; confirmed: FactionId[]; raids: RaidDecl[]; largeShips: FactionId[] } | null;
  verge: { by: FactionId; finalRound: number; emergencyPending: boolean } | null;
  combat: CombatState | null; result: GameResult | null;
  logSeq: number; history: HistoryItem[]; // last 50 undoable entries, newest last
}
export interface CombatShip { uid: string; ship: ShipId; side: Side; orbit: Orbit; role: 'leader' | 'support';
  damage: number; destroyed: boolean; removed: boolean; evasive: boolean;
  /** Added mid-battle by a destroyed Panther (U2); absent on every other ship, and on older saved games. */
  added?: true }
export interface CombatSide { faction: FactionId; assigned: boolean; ready: boolean;
  citadelOrbit: Orbit | null; vanguardOrbit: Orbit | null; curse: { ship: ShipId; slot: AbilitySlot } | null }
export interface DiceEntry { white: Record<WhiteFace, number>; black: Record<BlackFace, number> }
export interface AttackResult { side: Side; orbit: Orbit; target: string; aims: number; damage: number; crits: number;
  dif: number; red: number; locked: boolean; dealt: number; destroyed: string[]; notes: string[] }
export interface CombatOutcome { winner: Side; strength: Record<Side, number>; vp: Partial<Record<FactionId, number>>;
  events: Record<Side, number>; insurance: Partial<Record<FactionId, number>> }
export interface CombatState {
  attacker: FactionId; defender: FactionId; homeOf: FactionId | null; controller: FactionId | null; citadels: number;
  stage: 'assign' | 'start' | 'retreat' | 'attack' | 'realign' | 'end';
  round: number; lastRound: number; sides: Record<Side, CombatSide>; ships: CombatShip[]; nextUid: number;
  retreatAsked: Side[]; retreatedSide: Side | null;
  step: { orbit: Orbit; side: Side } | null;
  attack: { target: string | null; overflow: { aims: number; damage: number; zeroDif: boolean } | null } | null;
  results: AttackResult[]; kills: Record<Side, number>; outcome: CombatOutcome | null;
}
/**
 * What a claimed system holds, as the claimer says it (the app tracks no individual systems): asteroid belts per
 * mineral (a double belt counts 2) and structures by type. Both go to the claimer and, from a rival, leave the rival.
 */
export interface SystemContents { belts: Partial<Record<Mineral, number>>; structures: Partial<Record<StructureType, number>> }
export type TradeItem = 'component' | 'planetary' | 'moon' | 'morphite' | BasicMineral | 'triple';
export interface TradeOp { dir: 'buy' | 'sell'; item: TradeItem; mineral: BasicMineral | null } // mineral only for 'triple'
export interface ManufactureOp { output: 'component' | 'moon' | 'planetary' | 'research' | 'vp' | 'card'; pay: 'basic' | 'morphite' }
export type BuildItem =
  | { kind: 'ship'; ship: ShipId }
  | { kind: 'structure'; structure: StructureType; home: boolean; discount: { bp: number; isk: number; pyrite: boolean } }
  | { kind: 'unlockBelt'; mineral: Mineral };
export type DiscoveryReward =
  | { kind: 'minerals'; minerals: BasicMineral[] } | { kind: 'research'; amount: number } | { kind: 'control'; contents?: SystemContents }
  | { kind: 'moon'; amount: number } | { kind: 'planetary'; amount: number } | { kind: 'component'; amount: number }
  | { kind: 'card' } | { kind: 'isk'; amount: number };
export interface AdjustDelta { res: Partial<Resources>; vp: number; systems: number; homeCitadels: number; lockedHomeBelts: number;
  structures: Partial<Record<StructureType, number>>; belts: Partial<Record<Mineral, number>>; ships: Record<ShipId, number>; central: boolean | null }
export type UseParams =
  | { kind: 'none' } | { kind: 'mineralMarket'; from: BasicMineral; to: BasicMineral }
  | { kind: 'trade'; op: TradeOp } | { kind: 'manufacture'; op: ManufactureOp }
  | { kind: 'mineral'; mineral: Mineral } | { kind: 'material'; material: Material }
  | { kind: 'target'; faction: FactionId } | { kind: 'dev'; dev: DevId } | { kind: 'payMaterial'; material: Material | null };
export type Command =
  | { type: 'join'; name: string; faction: FactionId } | { type: 'takeOver'; faction: FactionId }
  | { type: 'setSeats'; seats: FactionId[] } | { type: 'startGame'; firstPlayer: FactionId }
  | { type: 'setupFaction'; revealedBelt: Mineral | null; devs: DevId[] } // revealedBelt: a mineral in a full game, null in a light one
  | { type: 'action'; action: 'move' }
  | { type: 'action'; action: 'claim'; from: FactionId | null; central: boolean; contents?: SystemContents }
  | { type: 'action'; action: 'extract'; planetary: boolean; moon: boolean }
  | { type: 'action'; action: 'trade'; ops: TradeOp[] }
  | { type: 'action'; action: 'manufacture'; ops: ManufactureOp[] }
  | { type: 'action'; action: 'build'; items: BuildItem[] }
  | { type: 'action'; action: 'research'; fill: DevId[]; swap: { out: DevId; in: DevId }[] }
  | { type: 'lightClaim'; from: FactionId | null; central: boolean } // light games only: no action, no cube
  | { type: 'gainResearch'; research: number } // light games only: tokens to place, 1..MAX_GAINED_RESEARCH
  | { type: 'lightUpkeep'; research: number; researchLab: boolean; raids: FactionId[]; largeShip: boolean } // light games only: raids = the rivals whose raids succeeded
  | { type: 'endTurn' } | { type: 'pass' }
  | { type: 'forceAdvance'; expected: FactionId } // expected = the turn holder being skipped (refused once that turn ended)
  | { type: 'discover'; rewards: DiscoveryReward[] } | { type: 'autoClaim'; central: boolean; contents?: SystemContents }
  | { type: 'payJump'; planetary: number; moon: number }
  | { type: 'deployableInfrastructure'; structure: StructureType; home: boolean; discount: { bp: number; isk: number; pyrite: boolean } }
  | { type: 'adjust'; delta: AdjustDelta; correction: boolean; reason: string }
  | { type: 'missionComplete'; vp: number } | { type: 'eventPlayed' }
  | { type: 'discardMinerals'; minerals: Partial<Record<Mineral, number>> }
  | { type: 'distributeResearch'; alloc: Record<DevId, number>; fetch: { dev: DevId; replace: DevId | null }[] }
  | { type: 'addCard'; dev: DevId | null } | { type: 'completeDev'; dev: DevId } | { type: 'useDev'; dev: DevId; params: UseParams }
  | { type: 'confirmUpkeep'; refinery: { planetary: number; moon: number; convert: number }; discard: Partial<Record<Mineral, number>>; raids: { target: FactionId; strength: number }[]; researchLab: boolean;
      /** Belts and structures held by enemy ships this upkeep: they pay out nothing (manual p. 15). Only customs, engineering and refinery structures count. */
      occupied?: SystemContents }
  | { type: 'combatStart'; defender: FactionId; homeOf: FactionId | null; controller: FactionId | null; citadels: number }
  | { type: 'combatAssign'; ships: { ship: ShipId; orbit: Orbit; role: 'leader' | 'support' }[] }
  | { type: 'combatStartChoices'; citadelOrbit: Orbit | null; vanguardOrbit: Orbit | null; evasive: string[]; curse: { ship: ShipId; slot: AbilitySlot } | null }
  | { type: 'combatRetreat'; retreat: boolean } | { type: 'combatTarget'; target: string }
  | { type: 'combatRoll'; dice: DiceEntry; adjust: { aim: number; damage: number; crit: number } }
  | { type: 'combatOverflow'; target: string | null }
  | { type: 'combatRealign'; assign: { uid: string; orbit: Orbit; role: 'leader' | 'support' }[] }
  | { type: 'combatDamage'; ship: string; delta: number } | { type: 'combatDestroy'; ship: string }
  | { type: 'combatAddShips'; ships: ShipId[]; orbit: Orbit }
  | { type: 'combatContinue' } | { type: 'combatFinish'; noEscape: boolean } | { type: 'combatCancel' };
/**
 * What a notice asks of its reader. `todo`: a step at the physical table, or something that happened to me on another
 * device, kept on the Panel's checklist until ticked. `info`: news, or a prompt the app itself walks the player
 * through (a combat stage, the upkeep form, the verge banner, the final ranking); toasted once when it arrives and
 * kept in the log, never on the checklist. Every engine notice sets it explicitly.
 */
export type NoticeKind = 'todo' | 'info';
/**
 * `key`: a to-do with a key replaces older to-dos with the same key and addressee on the checklist (only the latest
 * "pass the first player token" matters). Most notices have none.
 */
export interface Notice { to: FactionId | 'all'; text: string; kind: NoticeKind; key?: string }
export interface RuleError { error: true; code: string; message: string }
export interface Ctx { actor: FactionId | null; uid: string; priv: PlayerPrivate | null; now: number }
export interface ApplyResult { game: GameState; priv: PlayerPrivate | null; privOwner: FactionId | null; lines: string[]; notices: Notice[] }
export function isError(x: unknown): x is RuleError {
  return typeof x === 'object' && x !== null && (x as { error?: unknown }).error === true;
}
