import type { BlackFace, WhiteFace } from './types';

/** White die: blank, aim, aim, damage, crit, double-aim. */
export const WHITE_FACES: WhiteFace[] = ['blank', 'aim', 'aim', 'damage', 'crit', 'aim2'];

/** Black die: blank, aim, damage, crit, aim+damage, double-damage. */
export const BLACK_FACES: BlackFace[] = [
  'blank',
  'aim',
  'damage',
  'crit',
  'aimDamage',
  'damage2',
];

export interface FaceValue {
  aim: number;
  damage: number;
  crit: number;
}

/** A crit counts as 1 damage plus 1 crit. */
export const FACE_VALUE: Record<WhiteFace | BlackFace, FaceValue> = {
  blank: { aim: 0, damage: 0, crit: 0 },
  aim: { aim: 1, damage: 0, crit: 0 },
  damage: { aim: 0, damage: 1, crit: 0 },
  crit: { aim: 0, damage: 1, crit: 1 },
  aim2: { aim: 2, damage: 0, crit: 0 },
  aimDamage: { aim: 1, damage: 1, crit: 0 },
  damage2: { aim: 0, damage: 2, crit: 0 },
};
