import { createInterface } from 'node:readline';

const CLEAR_LINE = '\x1b[2K\x1b[200D';

/**
 * Read a secret from the terminal without echoing it.
 *
 * The passcode is the account's master secret; it must not land on screen or in
 * shell history. Typed characters are redrawn as asterisks.
 */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    const onData = () => {
      const typed = (rl as unknown as { line: string }).line ?? '';
      process.stdout.write(CLEAR_LINE + question + '*'.repeat(typed.length));
    };
    process.stdin.on('data', onData);
    rl.question('', (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
