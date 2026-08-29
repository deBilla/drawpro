#!/usr/bin/env node
/**
 * askHidden() against a simulated TTY.
 *
 *   npx tsx packages/client/tests/prompt.ts
 *
 * This is the prompt the account passcode is typed into, so the properties
 * asserted here are security properties, not cosmetics: the secret must never
 * be echoed, and the mask must appear on the first keystroke — a prompt that
 * looks dead invites people to paste into a visible shell instead.
 */
import { PassThrough } from 'node:stream';
import { askHidden } from '../src/prompt';

const fake = new PassThrough() as unknown as NodeJS.ReadStream & { isRaw: boolean };
(fake as { isTTY?: boolean }).isTTY = true;
fake.isRaw = false;
(fake as unknown as { setRawMode: (v: boolean) => void }).setRawMode = (v) => {
  fake.isRaw = v;
};
Object.defineProperty(process, 'stdin', { value: fake, configurable: true });

let captured = '';
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string) => {
  captured += chunk;
  return true;
}) as typeof process.stdout.write;

const pending = askHidden('passcode: ');

// Type "abc", backspace, then "d", then Enter.
const stream = fake as unknown as PassThrough;
for (const ch of ['a', 'b', 'c']) stream.write(ch);
stream.write('\x7f');
stream.write('d');
stream.write('\r');

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  realWrite(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  — ${detail}`}\n`);
  if (!pass) failures++;
}

void pending.then((value) => {
  process.stdout.write = realWrite;
  const stars = (captured.match(/\*/g) ?? []).length;

  check('backspace is applied to the returned value', value === 'abd', JSON.stringify(value));
  check('one asterisk echoed per keystroke, immediately', stars === 4, `saw ${stars}`);
  check('backspace erases the last asterisk', captured.includes('\b \b'));
  check(
    'the secret is never echoed in plaintext',
    !captured.includes('abc') && !captured.includes('abd'),
  );
  check('raw mode is restored afterwards', fake.isRaw === false);

  process.exit(failures > 0 ? 1 : 0);
});
