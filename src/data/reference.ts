/**
 * The rules reference: short sections paraphrased from the rulebook (never copied), a glossary for the keyword
 * popovers, the cost tables and dice faces as rows built from costs.ts / dice.ts (the UI renders tables from these,
 * never from prose), and `searchReference`, which searches sections, cost tables, ships and developments.
 *
 * Section bodies are plain text, one block per line:
 *   `## Heading`      a sub-heading
 *   `- text`          a bullet
 *   `3. text`         a numbered item
 *   `@view`           where the section's data table goes (default: after the body)
 *   anything else     a paragraph (blank lines are ignored)
 * `{NAME}` placeholders are filled from the data modules when this module loads, so caps and base values are never
 * retyped. Section ids are stable: other screens link to them (`RulesLink section="trade"`).
 */
import {
  BASE_BP,
  CUBE_COST,
  ISK_CAP,
  MANUFACTURE,
  MANUFACTURE_YIELD,
  MINERAL_CAP,
  SHIP_COST,
  SLOT_LIMIT,
  STRUCTURE_COST,
  STRUCTURE_SUPPLY,
  TRADE,
  UNLOCK_BELT_COST,
  type ManufactureOutput,
} from './costs';
import { BLACK_FACES, WHITE_FACES } from './dice';
import { DEV, DEVELOPMENTS, dev, type DevCategory } from './developments';
import { FACTION_INFO } from './factions';
import { SHIPS } from './ships';
import {
  BASIC_MINERALS,
  STRENGTH,
  type ActionType,
  type BlackFace,
  type DevId,
  type Mineral,
  type ResourceKey,
  type Resources,
  type Size,
  type StructureType,
  type WhiteFace,
} from './types';

/* ------------------------------------------------------------------ ids */

/** Stable section ids; screens link to these. */
export const REF_IDS = [
  'turn',
  'move',
  'discovery',
  'claim',
  'extract',
  'trade',
  'manufacture',
  'build',
  'research',
  'upkeep',
  'raids',
  'combat',
  'dice',
  'strength',
  'combat-rewards',
  'victory',
  'structures',
  'small-games',
  'light-games',
  'interpretations',
] as const;
export type RefId = (typeof REF_IDS)[number];

/** A data table a section shows (rendered from the data modules). */
export type RefView = 'trade' | 'manufacture' | 'build' | 'cubes' | 'dice' | null;

export interface RefSection {
  id: RefId;
  title: string;
  /** Paraphrased rules: short paragraphs, bullets, numbered items (see the module comment). */
  body: string;
  /** Extra words people may search for. */
  keywords: string[];
  view: RefView;
}

/* ------------------------------------------------------------ templates */

const VALUES: Record<string, number> = {
  ISK_CAP,
  MINERAL_CAP,
  BASE_BP,
  STRUCTURE_SUPPLY,
  INCOME: FACTION_INFO.amarr.income,
  RESEARCH: FACTION_INFO.amarr.research,
  STR_SMALL: STRENGTH.small,
  STR_MEDIUM: STRENGTH.medium,
  STR_LARGE: STRENGTH.large,
};

function fill(text: string): string {
  return text.replace(/\{([A-Z_]+)\}/g, (_, name: string) => {
    const v = VALUES[name];
    if (v === undefined) throw new Error(`Unknown reference placeholder {${name}}`);
    return String(v);
  });
}

const lines = (...ls: string[]): string => fill(ls.join('\n'));

/* ------------------------------------------------------------- sections */

const SECTIONS: RefSection[] = [
  {
    id: 'turn',
    title: 'Turn & actions',
    view: 'cubes',
    keywords: ['round', 'turn order', 'pass', 'action cube', 'slot', 'first player', 'free effect', 'end turn', 'event card', 'mission'],
    body: lines(
      'A round is a series of turns. The first player starts and play goes clockwise. On your turn you take exactly one action or you pass. When every player has passed, the round ends and upkeep follows.',
      '## Taking an action',
      '- Put one action cube on a free slot next to the action you want. Each action has only a few slots, which limits how often it can be taken in a round.',
      '- Your first cubes are free; later ones cost ISK. If you can\'t or won\'t pay for another cube, you pass.',
      '- Once you have passed, you get no more turns this round.',
      '@view',
      '## Free effects',
      'Before or after your action, as often as you like:',
      '- Complete a development whose research is done.',
      '- Use (tap) a completed development with the Use keyword, once per round (see Research & developments for when).',
      '- Play an event card from your hand.',
      'Right after a mission\'s objective is met you may complete it, even on someone else\'s turn. If you don\'t, you can complete it later only when the objective is met again. Combat cards and Use in combat developments are played during a battle.',
      '## Ending your turn',
      'Say that you are done (in the app: End turn). To keep things moving, the next player may start while you finish choices that don\'t affect them.',
      '## The seven actions',
      '- Move: move fleets, explore and start battles.',
      '- Claim: put your control token on a system where you have a fleet.',
      '- Extract: take the materials of a system you control.',
      '- Trade: up to three buy or sell operations for ISK.',
      '- Manufacture: up to three conversions of minerals into other things.',
      '- Build: spend build points on ships, structures and home belts.',
      '- Research: fill or swap cards in your development area.',
    ),
  },
  {
    id: 'move',
    title: 'Move & exploration',
    view: null,
    keywords: ['speed', 'SPD', 'fleet', 'split', 'exhausted', 'exhausted fleet token', 'stop', 'tier', 'unexplored', 'jump', 'teleport', 'black ops', 'auto-claim', 'occupied'],
    body: lines(
      'Pick one system where you have ships and no exhausted-fleet token of yours. From there you may:',
      '- move all of those ships together to one new system;',
      '- split them into two fleets heading to two different systems;',
      '- split them, move one part and leave the other where it is;',
      '- split them in three: two parts go to different systems and the third stays.',
      'Only one of the fleets moving in a single Move action may enter a system with enemy ships, so one Move action starts at most one battle.',
      '## Speed',
      '- A fleet travels up to as many systems as the SPD of its slowest ship.',
      '- Entering an unexplored system uses as much speed as its tier (1, 2 or 3). A fleet with SPD 3 can enter a tier 3 system only from a neighbouring system; a fleet with SPD 2 can\'t enter one at all until someone has explored it (from then on it costs 1 like any system).',
      '- Warp Drive Efficiency gives all your ships +1 SPD.',
      '## Where movement ends',
      'A moving fleet halts as soon as it reaches:',
      '- an unexplored system;',
      '- any system holding enemy ships;',
      '- a system that another player controls, or one of their home systems.',
      'Passing through a system with another of your fleets does not merge them, and ships can\'t join a fleet that is just passing through.',
      '## Exhausted fleets',
      '- Whenever a fleet arrives somewhere (by a Move action or any other effect), put your exhausted-fleet token in that system.',
      '- A Move action can\'t start from a system holding your exhausted-fleet token. So a fleet moves at most once per round with Move actions, and ships that were already waiting there can\'t leave with one either.',
      '- The token only blocks that choice: retreats, ship abilities and cards can still move those ships.',
      '- Remove the token when none of your ships are left in the system; upkeep removes all of them.',
      '## After moving',
      'All fleets of one Move action travel at the same time. Then deal with each arrival, in any order you like:',
      '- Enemy ships there: a battle starts (see Combat procedure).',
      '- An unclaimed system without enemies: if your fleet there now has strength 3 or more (your ships already there count too), place your control token for free. This only works after a Move action, not after a retreat or other forced move. If a battle came first, you claim the system when you won and still have strength 3 or more.',
      '- A system controlled by another player: it is occupied while your fleet stays. The owner can\'t extract there or deploy ships or structures there, and in upkeep it gives them no minerals and its structures give no bonuses.',
      '- Another player\'s home system: nothing happens now, but your fleet raids it in upkeep (see Raids).',
      '- An unexplored system: reveal it (see Discovery).',
      '## Jump',
      '- A jump teleports ships up to its range. Each system counts as 1, explored or not, and nothing along the way stops or affects the jumping ships.',
      '- Ships that jump in a Move action form their own fleet: one fleet can\'t mix jumping ships and normal movers.',
      '- Black Ops battleships with U1 can jump up to 4 systems, paying one planetary or moon material for each system they jump through.',
    ),
  },
  {
    id: 'discovery',
    title: 'Discovery & revealing systems',
    view: null,
    keywords: ['discovery token', 'reveal', 'unexplored', 'explore', 'asteroid', 'belt', 'asteroid token', 'explorer', 'reward', 'bag'],
    body: lines(
      'When a fleet ends its movement in an unexplored system, turn the tile face up and put the ships on it. Then check its icons.',
      '## Discovery tokens',
      'The discovery icon shows how many tokens to draw from the discovery bag. Take every reward straight away; drawn tokens leave the game.',
      '- Basic minerals: draw the number of mineral cards shown (pyrite, mexallon or tritanium, never morphite). In the app, pick which basic minerals you drew.',
      '- Research: gain the number of research tokens shown and place them on your developments at once.',
      '- Control: put your control token on the system.',
      '- Moon material, planetary material or component: take one.',
      '- Card: draw an event card or a mission card.',
      '- ISK: gain the amount shown.',
      'Explorer frigates (Anathema, Buzzard, Helios, Cheetah) may draw one extra token, then put one of the drawn tokens back in the bag.',
      '## Asteroid belts',
      'If the system has an asteroid belt slot, draw as many asteroid tokens as its icon shows, put one of them in the slot and return the others to the bag. Belts in systems you control give minerals in upkeep; a token with two belts gives two.',
      '## In the app',
      'After a Move action you can record the rewards you drew; every amount can be edited.',
    ),
  },
  {
    id: 'claim',
    title: 'Claim & control',
    view: null,
    keywords: ['control', 'control token', 'take over', 'enemy system', 'citadel', 'occupied', 'central system', 'auto-claim'],
    body: lines(
      'A Claim action puts your control token on a system where you have a fleet. If another player\'s token is there, take it off first.',
      '- You can\'t claim a system with enemy ships in it, and nobody can claim a home system.',
      '- To take a system from another player, your fleet there must be stronger than the system. A system has strength 0 of its own, plus its citadels and bonuses such as Guerilla Warfare.',
      '- A fleet with strength 3 or more claims an unclaimed system as it arrives, without an action (see Move).',
      '## What control gives you',
      '- You may build structures there and use Extract there.',
      '- Its asteroid belts give you minerals in upkeep.',
      '- Enemy fleets must stop when they enter it.',
      '- Structures there work for whoever controls the system now, whoever built them.',
      '- Domination in upkeep counts the non-home systems you control (see Victory).',
      '## In the app',
      'A claim adds one to your system count. Say which asteroid belts the system has and, if you took it from another player, pick them and say which structures it holds: the belts and structures move to you and leave them. An auto-claim and a discovery that gives control work the same way.',
    ),
  },
  {
    id: 'extract',
    title: 'Extract',
    view: null,
    keywords: ['material', 'planetary', 'moon', 'planetary material', 'moon material'],
    body: lines(
      'Choose a system you control. For each material icon printed on it, take one token of that material: a planetary material, a moon material, or one of each.',
      '- You can\'t extract from a system while an enemy fleet occupies it.',
      '- Materials pay for medium ships and some development effects. There is no limit to how many materials and components you may hold.',
      '- Refineries collect a material in upkeep without this action (see Structures).',
    ),
  },
  {
    id: 'trade',
    title: 'Trade',
    view: 'trade',
    keywords: ['sell', 'buy', 'price', 'ISK', 'exchange', 'mineral', 'component', 'three identical'],
    body: lines(
      'Make up to three operations from the trade panel, in any order. Each operation is separate, and the same one may be repeated.',
      '- Selling gives you ISK; buying costs ISK. The prices are in the table.',
      '- Selling or buying three identical basic minerals at once pays better than three single trades.',
      '- You can hold at most {ISK_CAP} ISK; anything above that is lost.',
      '- Gaining minerals past {MINERAL_CAP} (trade, cards, discovery, upkeep) is allowed: you then discard down to {MINERAL_CAP}, your choice.',
      '- Trade Contracts lets you make one extra trade operation when you use it.',
    ),
  },
  {
    id: 'manufacture',
    title: 'Manufacture',
    view: 'manufacture',
    keywords: ['recipe', 'convert', 'research token', 'victory point', 'VP', 'event card', 'mission card', 'component', 'mineral'],
    body: lines(
      'Turn minerals into more useful things. Make up to three operations from the manufacturing panel, in any order; each is separate and may be repeated.',
      '- The recipes are in the table. Where a recipe offers two payments, pick either.',
      '- Research tokens you make must be placed on your developments at once.',
      '- For a card, you choose whether to draw an event or a mission.',
      '- Manufacturing Hub lets you make one extra operation when you use it.',
    ),
  },
  {
    id: 'build',
    title: 'Build',
    view: 'build',
    keywords: ['build points', 'BP', 'ship', 'structure', 'deploy', 'discount slot', 'home belt', 'unlock', 'asteroid belt', 'engineering complex', 'medium hull', 'large hull', 'model', 'occupied', 'enemy fleet', 'shipyard', 'rookie pilot', 'errata'],
    body: lines(
      'A Build action gives you build points (BP) equal to your faction\'s Build value ({BASE_BP}; Assembly Line adds more). Spend them, together with the resources in the table, on ships, structures and home belt unlocks. Leftover BP vanish when the action ends.',
      '@view',
      '## Ships',
      '- New ships appear in one of your home systems or in a system you control that has an engineering complex.',
      '- Never in a system with an enemy fleet in it (official errata). That goes for ships and structures that cards place too, such as Rookie Pilot.',
      '- Upgraded Eng. Complex - Shipyard also lets you build in your systems next to one of your engineering complexes, but not through a complex an enemy fleet occupies (official errata).',
      '- You need a free model of that ship; with none left you can\'t build it.',
      '- Small ships are available from the start. Medium ships need Medium Hull; large ships need Large Hull (which needs Medium Hull first).',
      '- An engineering complex built in this action doesn\'t let you build ships in its system during the same action, unless that system already had one.',
      '- Mass Production makes each further ship of the same name cheaper in the same Build action.',
      '## Structures',
      '- Put a structure in an empty structure slot of a system you control or of one of your three home systems (any structure type), if a token of that type is left and no enemy fleet is there.',
      '- Discount slots: a slot printed with ISK, minerals or BP lowers the structure\'s cost by that much. A BP discount means you can place a structure there even with no BP left.',
      '- Materials Efficiency takes 1 ISK off each structure.',
      '- What each structure does: see Structures.',
      '## Home asteroid belts',
      'Your leftmost home system has three asteroid belts: the one you revealed at setup, and two under unlock tokens. In a Build action you can pay the unlock cost to remove one of those tokens for good; that belt then gives minerals in upkeep.',
    ),
  },
  {
    id: 'research',
    title: 'Research & developments',
    view: null,
    keywords: ['development', 'research token', 'development area', 'complete', 'prerequisite', 'use', 'use in combat', 'tap', 'untap', 'hull', 'systems', 'category'],
    body: lines(
      'Your development area has 4 slots for the cards you are researching. They lie face down, so only you know them until they are completed. You pick the first 4 at setup.',
      '## Research action',
      '- Search your development deck and fill any empty slots with cards of your choice.',
      '- You may also swap cards you are researching for new ones. A swapped-out card goes back to the deck and its research tokens are discarded.',
      '## Research tokens',
      '- Most arrive in upkeep: your Research value ({RESEARCH}) plus 1 for each engineering complex you control. Discovery tokens, manufacturing and cards give more.',
      '- Place new tokens on your development cards at once, split however you like.',
      '- Any 3 of the new tokens can buy a card instead: take one from your deck into an empty slot, or swap it for a card in progress. Repeat as often as your tokens allow and place the rest.',
      '- Unused tokens are lost.',
      '## Completing a development',
      '- On your turn, a card whose tokens reach its cost can be completed: discard the tokens, reveal the card and put it below your faction panel. Its effect starts at once.',
      '- Only on your own turn: the player aid lists developments among the things done at any time, but no card allows that yet (official errata).',
      '- Some cards let you add a new card to your development area when you complete them.',
      '- Only Spaceships cards have prerequisites: Large Hull needs Medium Hull, and each T2 Systems card needs its T1 card.',
      '- Completed Spaceships cards are marked on your development panel: the hulls, the ship ability tiers (O1, O2, D1, D2, U1, U2) and Warp Drive Efficiency.',
      '## Use and Use in combat',
      '- A completed card with Use or Use in combat can be tapped once per round: during your turn, or in a combat you fight in, unless the card names its own trigger (Guerilla Warfare, for example, when someone tries to claim your system; its payment is required).',
      '- Tactics cards work only in combat.',
      '- Tapped cards untap in upkeep.',
      '## Categories',
      '- Combat: fight better.',
      '- Conquest: more ways to score VP.',
      '- Diplomacy: effects that react to other players.',
      '- Economy: more resources.',
      '- Spaceships: bigger hulls, ship abilities and speed.',
      '- Structures: stronger structures.',
    ),
  },
  {
    id: 'upkeep',
    title: 'Upkeep',
    view: null,
    keywords: ['income', 'mine', 'minerals', 'refinery', 'research', 'untap', 'domination', 'first player token', 'emergency upkeep', 'shortage', 'cap'],
    body: lines(
      'When every player has passed, the round ends with upkeep. Everyone does every step except the last three (untap, domination, first player) at the same time; raids are resolved in first-player order.',
      '1. Refresh action cubes: all cubes go back to the action pool.',
      '2. Refresh fleets: remove every exhausted-fleet token.',
      '3. Mine minerals: take one mineral card in the belt\'s colour for each asteroid belt in systems you control (a double belt gives two). Keep at most {MINERAL_CAP} minerals, morphite included, and discard the rest. Occupied systems (enemy ships there, manual p.15) give no minerals and their structures no bonuses: mark them in the upkeep form.',
      '4. Extract materials: each refinery in a system you control gives one material shown in that system, your choice.',
      '5. Income: gain your Income value ({INCOME} ISK) plus 2 ISK for each customs office you control.',
      '6. Research: gain your Research value ({RESEARCH}) plus 1 for each engineering complex you control, and place the tokens at once.',
      '7. Raids: fleets in enemy home systems raid them (see Raids).',
      '8. Untap the developments used this round.',
      '9. Domination: score domination VP (see Victory). An emergency upkeep skips this step.',
      '10. First player: the token moves on to the next seat clockwise.',
      'If the supply runs short of something players gain in upkeep, hand it out one at a time, starting with the first player and going clockwise.',
      '## Cards that act in upkeep',
      '- Fleet Supremacy: +1 VP if you have at least one large ship (also in an emergency upkeep).',
      '- Upgraded Eng. Complex – Research Lab: if you control an engineering complex, you may add a new development card to your development area.',
      '- Upgraded Refinery: each refinery gives every material of its system, and can turn a moon plus a planetary into a component.',
      '- Upgraded Customs Office: each customs office gives 3 ISK instead of 2.',
      '## In the app',
      'Each player confirms their own upkeep on their phone. When the last player confirms, raids, untapping, domination and the next round are applied together.',
    ),
  },
  {
    id: 'raids',
    title: 'Raids',
    view: null,
    keywords: ['raid', 'steal', 'home system', 'citadel', 'home tile', 'VP'],
    body: lines(
      'A fleet that is in another player\'s home system during upkeep raids it. Each home system is raided separately: first every raid by the first player, then clockwise.',
      '- The raid succeeds when the fleet\'s strength is higher than the home system\'s: 2, plus the strength of the citadels built anywhere in that player\'s home tile (they defend all three home systems).',
      '- If it succeeds, the raider takes 1 VP from that player. Each upkeep a raider can take at most 1 VP from any one player.',
      '- Whatever the result, the raiders then leave together for one neighbouring system that is explored and is neither another player\'s system, nor a home system, nor holding enemy ships. This move doesn\'t exhaust them.',
      '- With nowhere to go, the raiding fleet is lost, and its owner draws reparations (see Combat rewards).',
    ),
  },
  {
    id: 'combat',
    title: 'Combat procedure',
    view: null,
    keywords: ['battle', 'attack', 'attacker', 'defender', 'strategy card', 'orbit', 'leader', 'support', 'target', 'dice pool', 'lock-on', 'aim', 'damage', 'excess', 'overflow', 're-align', 'retreat', 'round', 'ability', 'critical'],
    body: lines(
      'A battle starts when a fleet ends its movement in a system with enemy ships. The player who moved in is the attacker, whoever controls the system. If several battles start at once, the player whose turn it is picks the order.',
      '## Before the first round',
      '1. Strategy: both players choose a strategy card and lay it face down. Strategy cards are single-use for the whole game; Neutral Formation is the exception.',
      '2. Orbits: the ships move onto the combat panels, the attacker first. Each orbit (small, medium, large) takes at most one leader, whose size must match the orbit. Every orbit you want to use needs a leader, but you don\'t have to use all three. All other ships support an orbit that has a leader, split as you like (a leader may have no supports).',
      '3. Start of combat: reveal the strategy cards. The attacker resolves its card and its other start-of-combat choices first, then the defender does the same.',
      '## Each of the three rounds',
      '- Retreat: decided before any attack and before any "at the start of the round" effects, the attacker and then the defender may retreat. Once one side retreats, the other can\'t that round. That round becomes the last one; the retreating side makes no attacks, its ships get +1 DIF, and it loses the battle.',
      '- Orbits fight in order: small, then medium, then large. In each orbit the attacker attacks first, then the defender. Ships the attacker destroys still attack back in that orbit; destroyed ships leave once both sides have attacked from that orbit.',
      '- A side whose leader in an orbit is already gone doesn\'t attack from that orbit this round.',
      '## One attack',
      '1. Target: pick any enemy ship in any orbit.',
      '2. Dice: the leader\'s ATK plus the SUP of the orbit\'s supports and citadel bonus, at most 10 dice. The small orbit rolls white dice, the large orbit black dice, the medium orbit half of each (you pick the colour of an odd die). Extra dice from cards say which colour they are and may go past 10.',
      '3. Roll, then use rerolls, extra dice and effects that add or remove results, the attacker first. No die may be rerolled twice. Count the aim and damage results.',
      '4. Lock-on: the target is locked when the aim results reach its DIF; the lock counts for this attack only. Too few aims means a miss, and nothing else in the roll counts.',
      '5. Damage: the target\'s RED blocks that much damage in every attack. Each remaining damage puts a damage token on it, and tokens stay until the battle ends. When its damage reaches its HP, the ship is destroyed.',
      '6. Excess: after a kill, results left over (aim beyond its DIF, damage beyond its RED and remaining HP) can hit another ship in the same orbit as the destroyed one, as long as the remaining aim reaches that ship\'s DIF. Repeat while possible.',
      '- Excess damage hits ships, not targets (official errata): supports a Vanguard Ship protects can\'t be the target, but they can take the excess once their leader is destroyed.',
      '## End of a round',
      '- Re-align, attacker first: an orbit that lost its leader but still has supports either promotes one size-matched support (the others stay as its supports) or moves all its supports to other orbits, as leaders of empty orbits or as supports.',
      '## End of the battle',
      '- The battle ends after round 3, after a round with a retreat, or at once when one side has no ships left. Some effects change the number of rounds.',
      '- Surviving ships go back to the system and lose their damage tokens. Used strategy cards are discarded face up.',
      '- Strength decides the winner (see Strength & winning); for VP, reparations and escaping see Combat rewards.',
      '## Ship abilities in battle',
      '- Several ships with the same name in one orbit don\'t add up their abilities.',
      '- Leader abilities work only while the ship leads its orbit; Support abilities only while it supports.',
      '- Critical abilities work only for the orbit\'s leader. One marked once per attack triggers once however many crits are rolled; the others trigger for every crit. Extra dice they give may go past 10 but don\'t trigger them again.',
      '- An ability with a tier badge (O1, D2 and so on) works on all your ships once you complete that Systems development.',
    ),
  },
  {
    id: 'dice',
    title: 'Dice faces',
    view: 'dice',
    keywords: ['white die', 'black die', 'aim', 'damage', 'crit', 'critical damage', 'blank', 'roll', 'colour', 'color'],
    body: lines(
      'The orbit decides the dice: small orbit attacks roll white dice, large orbit attacks black dice, medium orbit attacks half of each. Dice from supports always match the leader\'s colour.',
      '- White dice lean towards aim results, black dice towards damage.',
      '- Aim: counts towards locking on to the target.',
      '- Damage: 1 damage.',
      '- Crit: 1 damage, and it triggers the leader\'s critical abilities.',
      '- Blank: nothing.',
      '@view',
      'In the app you tap only the faces you rolled; the rest count as blanks.',
    ),
  },
  {
    id: 'strength',
    title: 'Strength & winning',
    view: null,
    keywords: ['strength', 'winner', 'tie', 'home system', 'citadel', 'bonus', 'small ship', 'medium ship', 'large ship', 'mutual destruction'],
    body: lines(
      'Strength measures a fleet: each small ship counts {STR_SMALL}, each medium ship {STR_MEDIUM} and each large ship {STR_LARGE}.',
      '- A system has strength 0 of its own; a home system has 2.',
      '- A fleet with strength 3 or more claims an unclaimed system as it arrives (see Move).',
      '- Claims, raids and battles all compare strength.',
      '## Who wins a battle',
      '- Each side adds up the strength of its surviving ships plus its bonuses: +2 in its own home system, its citadels when it controls the system, and cards such as Guerilla Warfare.',
      '- Bonuses count only for a side that still has ships.',
      '- The higher total wins, and so does destroying every enemy ship. On a tie, or if both fleets are wiped out, the attacker loses.',
      '- Retreating counts as a loss, no matter the strength totals.',
    ),
  },
  {
    id: 'combat-rewards',
    title: 'Combat rewards',
    view: null,
    keywords: ['reparations', 'event card', 'VP', 'escape', 'defeated fleet', 'attacker reward', 'defender reward', 'space warlord', 'insurance'],
    body: lines(
      '## Attacker',
      '- +1 VP when the attacker wins and destroyed at least one enemy ship.',
      '- Reparations for its own losses.',
      '## Defender',
      '- No VP for a successful defence.',
      '- 1 event card if it lost at least one ship, plus reparations.',
      '## Reparations',
      'Draw 1 event card for each full 3 strength of your own ships destroyed in the battle: 5 strength lost gives 1 card, 6 gives 2.',
      '## Escape',
      'All surviving ships of the losing side flee together into one neighbouring system: explored, not another player\'s, and free of enemy ships (the attacker\'s starting system counts). They are exhausted there. If no system qualifies, those ships are destroyed too and count towards reparations.',
      '## Cards that add rewards',
      '- Space Warlord: +1 VP for each battle you win.',
      '- Spaceship Insurance: ISK for each of your ships destroyed.',
      '- Pacifist: +1 VP when another player retreats.',
    ),
  },
  {
    id: 'victory',
    title: 'Victory, domination & ties',
    view: null,
    keywords: ['verge of ascendancy', 'game end', 'final round', 'emergency upkeep', 'winner', 'tie', 'domination', 'central system', 'mission', 'VP', 'victory points'],
    body: lines(
      '## Verge of Ascendancy',
      'The first time a player reaches 10 VP, they announce the Verge of Ascendancy, and the end comes soon:',
      '- Reached during upkeep: finish that upkeep, play one more round and its upkeep, and the game ends.',
      '- Reached during a round: the active player finishes their turn and the round stops there. An emergency upkeep follows (every step except domination), then one more round and a normal upkeep, and the game ends.',
      '## Winning',
      'The player with the most VP wins, who is not necessarily the one who announced the verge. On a tie, more controlled systems wins; then the higher total ship strength; if still tied, the tied players share the win.',
      '## Domination (every upkeep)',
      '- +1 VP to every player who controls 5 or more non-home systems.',
      '- +1 VP to the one player who controls 5 or more non-home systems and more than anyone else (nobody gets it on a tie).',
      '- +1 VP to whoever controls the central system (the tier 3 system in the middle).',
      '- 2 players: the layout has no central system, so that VP goes to the one player who controls the most tier 3 systems, nobody on a tie (official errata). Mark that player as holding the central system.',
      '## Other ways to score',
      '- Missions: right after its objective is met, even on someone else\'s turn, you may reveal the mission card and take its reward. If you don\'t, it counts again only when the objective is met again.',
      '- Manufacturing: the VP recipe (see Manufacture).',
      '- Developments: several Conquest cards give VP, e.g. Fleet Supremacy, +1 VP each upkeep while you have a large ship.',
      '- Battles: +1 VP for an attacker who wins and destroys a ship.',
    ),
  },
  {
    id: 'structures',
    title: 'Structures',
    view: null,
    keywords: ['refinery', 'customs office', 'engineering complex', 'citadel', 'structure slot', 'income', 'research', 'SUP', 'strength', 'upgraded'],
    body: lines(
      'Structures are built with the Build action (costs under Build) in empty structure slots of systems you control or of your home systems. There are {STRUCTURE_SUPPLY} of each type. Their bonuses go to whoever controls the system now, not to the builder, and several of the same type in one system all count.',
      '## Refinery',
      'In upkeep, take one planetary or moon material shown in its system, your choice. Upgraded Refinery gives all of them and can turn a moon plus a planetary into a component.',
      '## Customs office',
      '+2 ISK income in each upkeep (3 with Upgraded Customs Office).',
      '## Engineering complex',
      '+1 research token in each upkeep, and you can build ships in its system. A complex built in a Build action can\'t be used to build ships in that same action, unless the system already had one.',
      '## Citadel',
      '- It works even while enemy ships occupy its system.',
      '- At the start of a battle in its system, its controller picks one orbit that gets +1 SUP for the whole battle. More citadels in the system don\'t add more (see Rule interpretations for Upgraded Citadel).',
      '- Each citadel adds 1 strength for the system\'s controller when the winner is decided.',
      '- Enemies can\'t claim the system unless their fleet is stronger than its citadels.',
      '- Citadels in your home tile also defend all your home systems against raids.',
    ),
  },
  {
    id: 'small-games',
    title: '2–3 player games',
    view: null,
    keywords: ['two players', 'three players', '2 players', '3 players', 'board layout', 'crucial shipyard', 'left', 'right', 'tier 3', 'central system', 'errata'],
    body: lines(
      'The game is balanced for 4 players but plays well with 2 or 3 after a few changes.',
      '- Build the board in the 2-player or 3-player layout pictured in the rulebook (page 33). These layouts don\'t use the border tiles; keep the combat and information panels next to the board.',
      '- Some cards and abilities are stronger or weaker with fewer players.',
      '- Any of the 4 factions can play.',
      '- 2 players: anything that mentions the faction on your left or your right means your opponent.',
      '- 2 players: take the Crucial Shipyard mission out of the mission deck.',
      '- 2 players: the central-system VP in domination goes to the one player with the most tier 3 systems instead (official errata); mark them as holding the central system.',
    ),
  },
  {
    id: 'light-games',
    title: 'Scorekeeper games',
    view: null,
    keywords: ['scorekeeper', 'light mode', 'light game', 'game mode', 'full game', 'less app', 'host', 'box', 'models', 'board'],
    body: lines(
      'A scorekeeper game uses the app for less: the board and its pieces keep the record of most things, and the app keeps only what is hard to track by hand.',
      '## Choosing it',
      'Whoever hosts picks Full or Scorekeeper under Game mode when creating the game. The mode is the same for every player and holds for the whole game.',
      '## What the app tracks',
      '- VP, with the rules that change it on their own: Lobbyist, the Verge of Ascendancy, domination, combat VP, raids and VP cards.',
      '- How many systems each player controls and who holds the central system, for domination and end-game ties.',
      '- Your private development area: research tokens, completing, using and tapping cards.',
      '- Whose turn it is, passing, the first player and the rounds.',
      '- The combat calculator.',
      '- A walk-through of each upkeep.',
      '- This rules reference.',
      '## What stays on the board',
      '- ISK, minerals, and planetary and moon materials.',
      '- Ships, structures, belts and action cubes.',
      'When a card or rule gives or costs ISK, the app tells you to take or pay it at the board.',
      '## At the table',
      '- On your turn, play your action on the board, then End turn (or Pass) in the app.',
      '- Record what the board gave you on the Panel: Gain VP, Claim system, Research tokens and Cards.',
      '- Combat: each side places ships from its faction\'s full list, up to the number of models in the box.',
      '- Raids are judged at the table; in upkeep, pick the ones that succeeded and the app moves the VP.',
      '- Ties: most VP, then most systems; anyone still tied shares the victory.',
    ),
  },
  {
    id: 'interpretations',
    title: 'Rule interpretations',
    view: null,
    keywords: ['house rule', 'interpretation', 'ruling', 'clarification', 'upgraded citadel', 'overflow', 'underdog', 'lobbyist', 'tie-break', 'cap'],
    body: [
      'Where the rulebook leaves room for doubt, this companion plays it like this.',
      '1. Upgraded Citadel: each citadel adds +1 SUP to every orbit (replacing the base single-orbit +1) and has 2 strength.',
      '2. "Enemy ships in its orbit" means enemy ships in the same-named orbit.',
      '3. Abilities of same-named ships don\'t stack; different ships\' identical effects do.',
      '4. Overflow consumes aims equal to the destroyed target\'s effective DIF and damage equal to its effective RED + remaining HP.',
      '5. Crit abilities apply only when the ship is its orbit\'s leader.',
      '6. Morphite counts toward the 12-mineral cap; ISK above 49 is lost.',
      '7. Underdog: strictly fewer VP than every other player.',
      '8. End-game tie-break "controlled systems" counts non-home systems.',
      '9. Lobbyist triggers on any VP another player gains (missions, steals, domination, combat), not on manual corrections.',
      '10. Flycatcher/Sin/Widow and similar choice effects are prompted with manual tools rather than enforced; Panther adds up to two small ships, once per destroyed Panther.',
    ].join('\n'),
  },
];

export const REFERENCE: readonly RefSection[] = SECTIONS;

const BY_ID = new Map<RefId, RefSection>(SECTIONS.map((s) => [s.id, s]));

export function refSection(id: RefId): RefSection {
  const s = BY_ID.get(id);
  if (s === undefined) throw new Error(`Unknown reference section: ${id}`);
  return s;
}

export function isRefId(id: string): id is RefId {
  return (REF_IDS as readonly string[]).includes(id);
}

/* --------------------------------------------------------------- blocks */

export type BodyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'ol'; n: number; text: string }
  | { kind: 'view' };

/** Splits a section body into blocks (see the module comment for the format). */
export function bodyBlocks(body: string): BodyBlock[] {
  const out: BodyBlock[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line === '@view') out.push({ kind: 'view' });
    else if (line.startsWith('## ')) out.push({ kind: 'h', text: line.slice(3) });
    else if (line.startsWith('- ')) out.push({ kind: 'li', text: line.slice(2) });
    else {
      const m = /^(\d+)\.\s+(.*)$/.exec(line);
      out.push(m ? { kind: 'ol', n: Number(m[1]), text: m[2]! } : { kind: 'p', text: line });
    }
  }
  return out;
}

/** A body as running text (for search and snippets): headings end with a full stop, markers are dropped. */
export function bodyText(body: string): string {
  return bodyBlocks(body)
    .flatMap((b) => {
      if (b.kind === 'view') return [];
      const text = b.kind === 'ol' ? `${b.n}. ${b.text}` : b.text;
      return [/[.!?:;]$/.test(text) ? text : `${text}.`];
    })
    .join(' ');
}

/* ------------------------------------------------------------- glossary */

/** Keyword terms that get a tappable definition in rules, ability and card text. */
export const TERM_IDS = ['dif', 'atk', 'sup', 'red', 'hp', 'spd', 'lock', 'crit', 'leader', 'support', 'orbit', 'retreat', 'reparations', 'strength'] as const;
export type TermId = (typeof TERM_IDS)[number];

export interface GlossaryEntry {
  /** "DIF · Difficulty" */
  label: string;
  /** Two or three lines. */
  text: string;
  /** Where the full rules are. */
  see: RefId;
}

export const GLOSSARY: Record<TermId, GlossaryEntry> = {
  dif: { label: 'DIF · Difficulty', see: 'combat', text: 'The number of aim results an attack needs to lock on to this ship. Retreating ships get +1; some abilities lower it.' },
  atk: { label: 'ATK · Attack', see: 'combat', text: 'The number of dice this ship rolls when it leads an orbit.' },
  sup: { label: 'SUP · Support', see: 'combat', text: 'Extra dice this ship gives the orbit it supports; citadels add SUP as well. The dice follow the orbit\'s colour.' },
  red: { label: 'RED · Reduction', see: 'combat', text: 'Each attack on this ship loses this much damage before any token goes on; it applies afresh to every attack.' },
  hp: { label: 'HP · Hull points', see: 'combat', text: 'The ship is destroyed once it carries this many damage tokens. Tokens stay until the battle ends.' },
  spd: { label: 'SPD · Speed', see: 'move', text: 'How many systems this ship may cross in one Move action. A fleet goes at its slowest ship\'s pace; unexplored systems cost their tier.' },
  lock: { label: 'Lock-on (aim)', see: 'combat', text: 'An attack locks on when its aim results reach the target\'s DIF. Without a lock-on the attack misses and all its results are lost.' },
  crit: { label: 'Crit · Critical damage', see: 'dice', text: 'Counts as 1 damage and triggers the critical abilities of the attacking orbit\'s leader.' },
  leader: { label: 'Leader', see: 'combat', text: 'The one ship that leads an orbit; its size must match the orbit. It rolls its ATK, and an orbit without a leader doesn\'t attack.' },
  support: { label: 'Support', see: 'combat', text: 'Every ship in a battle that isn\'t a leader. It adds its SUP dice to the orbit it supports.' },
  orbit: { label: 'Orbit', see: 'combat', text: 'The small, medium and large lanes of a battle. They attack in that order: small rolls white dice, large black, medium half of each.' },
  retreat: { label: 'Retreat', see: 'combat', text: 'At the start of a round, attacker first: that round becomes the last, the retreating side doesn\'t attack, its ships get +1 DIF, and it loses.' },
  reparations: { label: 'Reparations', see: 'combat-rewards', text: 'After losing ships, draw 1 event card for each full 3 strength of your own ships destroyed.' },
  strength: {
    label: 'Strength',
    see: 'strength',
    text: fill('Small ships count {STR_SMALL}, medium {STR_MEDIUM}, large {STR_LARGE}. Strength decides battles, raids and claims, and a fleet of 3 or more claims an uncontrolled system as it arrives.'),
  },
};

/* ------------------------------------------------------ data-built rows */

const RES_WORD: Record<ResourceKey, string> = {
  isk: 'ISK',
  pyrite: 'pyrite',
  mexallon: 'mexallon',
  tritanium: 'tritanium',
  morphite: 'morphite',
  planetary: 'planetary',
  moon: 'moon',
  component: 'component',
};
const RES_ORDER: ResourceKey[] = ['pyrite', 'mexallon', 'tritanium', 'morphite', 'planetary', 'moon', 'component', 'isk'];

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "1 pyrite + 1 mexallon + 4 ISK": the non-zero parts of a cost in a fixed order. */
export function payWords(pay: Partial<Resources>): string {
  return RES_ORDER.filter((k) => (pay[k] ?? 0) > 0)
    .map((k) => `${pay[k]} ${RES_WORD[k]}`)
    .join(' + ');
}

/** The resource keys of a cost in display order, with amounts. */
export function payParts(pay: Partial<Resources>): { key: ResourceKey; n: number }[] {
  return RES_ORDER.filter((k) => (pay[k] ?? 0) > 0).map((k) => ({ key: k, n: pay[k]! }));
}

export type TradeItem = 'component' | 'planetary' | 'moon' | Mineral;

export interface TradeRow {
  id: string;
  label: string;
  /** The goods this row trades (any one of them; `count` 3 means three identical ones). */
  items: TradeItem[];
  count: 1 | 3;
  /** ISK received. */
  sell: number;
  /** ISK paid. */
  buy: number;
}

const TRADE_GROUPS: { items: TradeItem[]; count: 1 | 3 }[] = [
  { items: ['component'], count: 1 },
  { items: ['planetary', 'moon'], count: 1 },
  { items: ['morphite'], count: 1 },
  { items: [...BASIC_MINERALS], count: 1 },
  { items: [...BASIC_MINERALS], count: 3 },
];

function tradeLabel(items: TradeItem[], count: 1 | 3): string {
  if (count === 3) return 'Three identical basic minerals';
  if (items.length === BASIC_MINERALS.length && BASIC_MINERALS.every((m) => items.includes(m))) return 'One basic mineral';
  return capital(items.map((i) => RES_WORD[i]).join(' or '));
}

/** The trade table, built from TRADE: items with the same price share a row. */
export function tradeRows(): TradeRow[] {
  const rows: TradeRow[] = [];
  for (const g of TRADE_GROUPS) {
    const price = (item: TradeItem) => (g.count === 3 ? TRADE.triple : TRADE[item]);
    const buckets: TradeItem[][] = [];
    for (const item of g.items) {
      const same = buckets.find((b) => price(b[0]!).sell === price(item).sell && price(b[0]!).buy === price(item).buy);
      if (same) same.push(item);
      else buckets.push([item]);
    }
    for (const items of buckets) {
      const p = price(items[0]!);
      rows.push({ id: g.count === 3 ? 'triple' : items.join('-'), label: tradeLabel(items, g.count), items, count: g.count, sell: p.sell, buy: p.buy });
    }
  }
  return rows;
}

const MANUFACTURE_LABEL: Record<ManufactureOutput, string> = {
  component: 'Component',
  moon: 'Moon material',
  planetary: 'Planetary material',
  research: 'Research tokens',
  vp: 'Victory point',
  card: 'Event or mission card',
};

export interface ManufactureRow {
  output: ManufactureOutput;
  label: string;
  /** How many one operation makes. */
  gain: number;
  /** Alternative payments (pay one of them). */
  options: Partial<Resources>[];
}

/** The manufacturing table, built from MANUFACTURE and MANUFACTURE_YIELD. */
export function manufactureRows(): ManufactureRow[] {
  return (Object.keys(MANUFACTURE) as ManufactureOutput[]).map((output) => {
    const r = MANUFACTURE[output];
    return {
      output,
      label: MANUFACTURE_LABEL[output],
      gain: MANUFACTURE_YIELD[output],
      options: [r.basic, r.morphite].filter((o): o is Partial<Resources> => o !== undefined),
    };
  });
}

export interface BuildRow {
  id: Size | StructureType | 'belt';
  group: 'ship' | 'structure' | 'belt';
  label: string;
  bp: number;
  isk: number;
  pay: Partial<Resources>;
  /** A development needed first (hulls). */
  needs: DevId | null;
}

const SHIP_ROWS: { size: Size; label: string; needs: DevId | null }[] = [
  { size: 'small', label: 'Small ship', needs: null },
  { size: 'medium', label: 'Medium ship', needs: DEV.mediumHull },
  { size: 'large', label: 'Large ship', needs: DEV.largeHull },
];
const STRUCTURE_ROWS: { type: StructureType; label: string }[] = [
  { type: 'engineering', label: 'Engineering complex' },
  { type: 'citadel', label: 'Citadel' },
  { type: 'customs', label: 'Customs office' },
  { type: 'refinery', label: 'Refinery' },
];

/** The build table, built from SHIP_COST, STRUCTURE_COST and UNLOCK_BELT_COST. */
export function buildRows(): BuildRow[] {
  return [
    ...SHIP_ROWS.map((s) => ({ id: s.size, group: 'ship' as const, label: s.label, ...SHIP_COST[s.size], needs: s.needs })),
    ...STRUCTURE_ROWS.map((s) => ({ id: s.type, group: 'structure' as const, label: s.label, ...STRUCTURE_COST[s.type], needs: null })),
    { id: 'belt', group: 'belt', label: 'Unlock a home belt', bp: UNLOCK_BELT_COST.bp, isk: UNLOCK_BELT_COST.isk, pay: {}, needs: null },
  ];
}

/** ISK for each action cube (1-based), from CUBE_COST. */
export function cubeRows(): { cube: number; isk: number }[] {
  return CUBE_COST.map((isk, i) => ({ cube: i + 1, isk }));
}

const ACTION_ORDER: ActionType[] = ['move', 'claim', 'extract', 'trade', 'manufacture', 'build', 'research'];

/** Action slots per round, from SLOT_LIMIT. */
export function slotRows(): { action: ActionType; slots: number }[] {
  return ACTION_ORDER.map((action) => ({ action, slots: SLOT_LIMIT[action] }));
}

/** The six sides of a die, as printed (from dice.ts). */
export function diceFaces(die: 'white'): WhiteFace[];
export function diceFaces(die: 'black'): BlackFace[];
export function diceFaces(die: 'white' | 'black'): (WhiteFace | BlackFace)[] {
  return die === 'white' ? [...WHITE_FACES] : [...BLACK_FACES];
}

const FACE_WORD: Record<WhiteFace | BlackFace, string> = {
  blank: 'blank',
  aim: 'aim',
  aim2: 'double aim',
  damage: 'damage',
  damage2: 'double damage',
  crit: 'crit',
  aimDamage: 'aim and damage',
};

/* -------------------------------------------------------- cost tables */

export type CostId = 'trade' | 'manufacture' | 'build' | 'cubes';

export interface CostTable {
  id: CostId;
  title: string;
  /** The rules section that explains it. */
  section: RefId;
  /** Searchable text generated from the rows. */
  text: string;
}

const ACTION_WORD: Record<ActionType, string> = {
  move: 'Move',
  claim: 'Claim',
  extract: 'Extract',
  trade: 'Trade',
  manufacture: 'Manufacture',
  build: 'Build',
  research: 'Research',
};

function tradeText(): string {
  return tradeRows()
    .map((r) => `${r.label}: sell ${r.sell} ISK, buy ${r.buy} ISK.`)
    .join(' ');
}

function manufactureText(): string {
  return manufactureRows()
    .map((r) => `${r.gain} ${r.label.toLowerCase()}: ${r.options.map(payWords).join(' or ')}.`)
    .join(' ');
}

function buildText(): string {
  const rows = buildRows()
    .map((r) => `${r.label}: ${r.bp} BP + ${payWords({ ...r.pay, isk: r.isk })}${r.needs === null ? '' : ` (needs ${dev(r.needs).name})`}.`)
    .join(' ');
  return `Build points per action: ${BASE_BP}. ${rows}`;
}

function cubesText(): string {
  const cubes = cubeRows()
    .map((c) => `cube ${c.cube} ${c.isk === 0 ? 'free' : `${c.isk} ISK`}`)
    .join(', ');
  const slots = slotRows()
    .map((s) => `${ACTION_WORD[s.action]} ${s.slots}`)
    .join(', ');
  return `Action cubes: ${cubes}. Slots per round: ${slots}. Limits: at most ${ISK_CAP} ISK (the rest is lost), at most ${MINERAL_CAP} minerals including morphite.`;
}

function diceText(): string {
  const faces = (fs: (WhiteFace | BlackFace)[]) => fs.map((f) => FACE_WORD[f]).join(', ');
  return `White die: ${faces(diceFaces('white'))}. Black die: ${faces(diceFaces('black'))}.`;
}

export const COST_TABLES: readonly CostTable[] = [
  { id: 'trade', title: 'Trade prices', section: 'trade', text: tradeText() },
  { id: 'manufacture', title: 'Manufacture recipes', section: 'manufacture', text: manufactureText() },
  { id: 'build', title: 'Build costs', section: 'build', text: buildText() },
  { id: 'cubes', title: 'Action cubes & limits', section: 'turn', text: cubesText() },
];

const VIEW_TEXT: Record<NonNullable<RefView>, string> = {
  trade: tradeText(),
  manufacture: manufactureText(),
  build: buildText(),
  cubes: cubesText(),
  dice: diceText(),
};

/* --------------------------------------------------------------- search */

export type SearchKind = 'rule' | 'cost' | 'ship' | 'dev';

export interface TextRange {
  start: number;
  end: number;
}

export interface SearchResult {
  kind: SearchKind;
  /** A RefId, CostId, ShipId or DevId, by kind. */
  id: string;
  title: string;
  snippet: string;
  /** Where the query sits in `title`, if it does. */
  titleMatch: TextRange | null;
  /** Where the query sits in `snippet`, if it does. */
  snippetMatch: TextRange | null;
}

interface Doc {
  kind: SearchKind;
  id: string;
  title: string;
  /** Extra searchable words (not shown). */
  keys: string;
  /** Shown as the snippet. */
  body: string;
  order: number;
}

const KIND_ORDER: Record<SearchKind, number> = { rule: 0, cost: 1, ship: 2, dev: 3 };

const CATEGORY_WORD: Record<DevCategory, string> = {
  combat: 'combat',
  conquest: 'conquest',
  diplomacy: 'diplomacy',
  economy: 'economy',
  spaceships: 'spaceships',
  structures: 'structures',
};

/** Ship ability text with its bracket tokens as plain words ("[Critical Damage]" → "critical damage"). */
export function shipWords(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, (_, w: string) => w.toLowerCase());
}

/** Card text with its tokens as words ("[ISK]" stays "ISK", "[DAMAGE]" → "damage", tiers stay). */
function cardWords(text: string): string {
  return text
    .replace(/\[([A-Z0-9_]+)\]/g, (_, t: string) => (/^([ODU][12]|ISK|BP)$/.test(t) ? t : t.toLowerCase()))
    .replace(/\n/g, ' ');
}

function buildDocs(): Doc[] {
  const docs: Doc[] = [];
  let order = 0;
  for (const s of SECTIONS) {
    const extra = s.view === null ? '' : ` ${VIEW_TEXT[s.view]}`;
    docs.push({ kind: 'rule', id: s.id, title: s.title, keys: s.keywords.join(' · '), body: bodyText(s.body) + extra, order: order++ });
  }
  for (const t of COST_TABLES) {
    docs.push({ kind: 'cost', id: t.id, title: t.title, keys: `costs ${refSection(t.section).title}`, body: t.text, order: order++ });
  }
  for (const s of SHIPS) {
    const abilities = s.abilities.map((a) => `${a.requires.length > 0 ? `${a.requires.join('+')}: ` : ''}${shipWords(a.text)}`).join(' · ');
    docs.push({
      kind: 'ship',
      id: s.id,
      title: s.name,
      keys: `${s.cls} ${s.size} ${FACTION_INFO[s.faction].name}`,
      body: `${abilities} · ${s.role}`,
      order: order++,
    });
  }
  for (const d of DEVELOPMENTS) {
    docs.push({
      kind: 'dev',
      id: d.id,
      title: d.name,
      keys: `${CATEGORY_WORD[d.category]} development${d.keyword === null ? '' : ` ${d.keyword.replace(/_/g, ' ')}`}`,
      body: cardWords(d.text),
      order: order++,
    });
  }
  return docs;
}

const DOCS = buildDocs();

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;
const SNIPPET_HEAD = 120;

/** The first index of `needle` in `hay` (both lower case) that starts a word, or -1. */
function wordIndex(hay: string, needle: string, from = 0): number {
  for (let i = hay.indexOf(needle, from); i !== -1; i = hay.indexOf(needle, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(hay[i - 1]!)) return i;
  }
  return -1;
}

/** Where the phrase starts a word in `text`, else the earliest of its words; null when none occurs. */
function findMatch(text: string, phrase: string, terms: string[]): TextRange | null {
  const lower = text.toLowerCase();
  const at = wordIndex(lower, phrase);
  if (at !== -1) return { start: at, end: at + phrase.length };
  let best: TextRange | null = null;
  for (const t of terms) {
    const i = wordIndex(lower, t);
    if (i !== -1 && (best === null || i < best.start)) best = { start: i, end: i + t.length };
  }
  return best;
}

/** A short window of `body` around the match, cut at spaces, with "…" where it was cut. */
function snippetOf(body: string, match: TextRange | null): { snippet: string; snippetMatch: TextRange | null } {
  if (match === null) {
    if (body.length <= SNIPPET_HEAD) return { snippet: body, snippetMatch: null };
    const cut = body.lastIndexOf(' ', SNIPPET_HEAD);
    return { snippet: `${body.slice(0, cut > 0 ? cut : SNIPPET_HEAD)}…`, snippetMatch: null };
  }
  let start = Math.max(0, match.start - SNIPPET_BEFORE);
  if (start > 0) {
    const space = body.indexOf(' ', start);
    start = space !== -1 && space < match.start ? space + 1 : match.start;
  }
  let end = Math.min(body.length, match.end + SNIPPET_AFTER);
  if (end < body.length) {
    const space = body.lastIndexOf(' ', end);
    end = space > match.end ? space : match.end;
  }
  const head = start > 0 ? '…' : '';
  const tail = end < body.length ? '…' : '';
  const offset = head.length - start;
  return {
    snippet: `${head}${body.slice(start, end)}${tail}`,
    snippetMatch: { start: match.start + offset, end: match.end + offset },
  };
}

/** Lower is better: 0–2 the title matches (whole phrase at its start, phrase inside, all words), then keys, then body. */
function score(doc: Doc, phrase: string, terms: string[]): number {
  const title = doc.title.toLowerCase();
  const at = wordIndex(title, phrase);
  if (at === 0) return 0;
  if (at !== -1) return 1;
  if (terms.every((t) => wordIndex(title, t) !== -1)) return 2;
  if (wordIndex(doc.keys.toLowerCase(), phrase) !== -1) return 3;
  if (wordIndex(doc.body.toLowerCase(), phrase) !== -1) return 4;
  return 5;
}

/** Shortest query that is searched; shorter ones return nothing. */
export const MIN_QUERY = 2;

/**
 * Searches rules sections, cost tables, ships (name, class, role, abilities) and developments (name, text, category).
 * Case-insensitive; every word of the query must occur at the start of a word ("lock" finds "lock-on", not "unlock").
 * Title matches rank first, then keyword, then text matches;
 * ties keep the order rules → costs → ships → developments, each in its own order.
 */
export function searchReference(query: string): SearchResult[] {
  const phrase = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (phrase.length < MIN_QUERY) return [];
  const terms = phrase.split(' ');
  const hits: { doc: Doc; score: number }[] = [];
  for (const doc of DOCS) {
    const hay = `${doc.title}\n${doc.keys}\n${doc.body}`.toLowerCase();
    if (!terms.every((t) => wordIndex(hay, t) !== -1)) continue;
    hits.push({ doc, score: score(doc, phrase, terms) });
  }
  hits.sort((a, b) => a.score - b.score || KIND_ORDER[a.doc.kind] - KIND_ORDER[b.doc.kind] || a.doc.order - b.doc.order);
  return hits.map(({ doc, score: s }) => {
    const titleMatch = s <= 2 ? findMatch(doc.title, phrase, terms) : null;
    const { snippet, snippetMatch } = snippetOf(doc.body, findMatch(doc.body, phrase, terms));
    return { kind: doc.kind, id: doc.id, title: doc.title, snippet, titleMatch, snippetMatch };
  });
}
