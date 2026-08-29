const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

/** Excalidraw ids are 21-char nanoid-style strings. */
export function elementId(): string {
  let out = '';
  for (let i = 0; i < 21; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function seed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * `index` is a required field on every Excalidraw element: a fractional index
 * that encodes z-order. It is assigned in assignIndices() once the full element
 * list is known, using the same fractional-indexing algorithm Excalidraw itself
 * depends on, so array order and z-order agree.
 */
export function elementMeta() {
  return {
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    updated: Date.now(),
  };
}

import { generateNKeysBetween } from 'fractional-indexing';

/** Stamp z-order indices onto elements, in array order. */
export function assignIndices<T extends Record<string, unknown>>(elements: T[]): T[] {
  const keys = generateNKeysBetween(null, null, elements.length);
  elements.forEach((el, i) => {
    (el as Record<string, unknown>).index = keys[i];
  });
  return elements;
}
