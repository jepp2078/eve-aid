/**
 * Photos of the printed cards, by id: `src/assets/cards/developments/<dev id>.webp` and
 * `src/assets/cards/ships/<ship id>.webp`. Vite turns each file into a hashed URL at build time, so only the cards
 * that have a file get an image, and a card without one simply shows none. The images load on demand (an <img>
 * when a card is shown), never with the app.
 */
import type { NamedCard } from './cardNames';

const DEV_FILES = import.meta.glob<string>('../../assets/cards/developments/*.webp', { query: '?url', import: 'default', eager: true });
const SHIP_FILES = import.meta.glob<string>('../../assets/cards/ships/*.webp', { query: '?url', import: 'default', eager: true });

function byId(files: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]));
}

const DEV_IMAGES = byId(DEV_FILES);
const SHIP_IMAGES = byId(SHIP_FILES);

/** The card photo's URL, or null when there is none. */
export function cardImage(card: NamedCard): string | null {
  return (card.kind === 'dev' ? DEV_IMAGES.get(card.dev.id) : SHIP_IMAGES.get(card.ship.id)) ?? null;
}
