/**
 * Read a secret from the terminal without echoing it.
 *
 * Raw mode, echoing an asterisk per keystroke as it arrives. The earlier
 * version wrapped readline and redrew the line from `rl.line` inside a `data`
 * handler, but `data` fires before readline updates that property — so the mask
 * lagged a character behind and the first keystroke drew nothing at all, which
 * reads as a dead prompt.
 */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const input = process.stdin;
    process.stdout.write(question);

    // Piped or redirected input: there is no terminal to hide anything from,
    // and raw mode is unavailable.
    if (!input.isTTY) {
      let buffered = '';
      input.setEncoding('utf8');
      input.on('data', (chunk) => {
        buffered += chunk;
      });
      input.on('end', () => resolve(buffered.split('\n')[0].trim()));
      return;
    }

    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let value = '';

    const finish = (result: string | null) => {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      if (result === null) {
        // Ctrl-C: exit the way the shell expects rather than resolving empty.
        process.exit(130);
      }
      resolve(result);
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(value);
        if (ch === '\x03') return finish(null);
        if (ch === '\x7f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b'); // erase the last asterisk
          }
          continue;
        }
        // Ignore arrow keys and other control sequences.
        if (ch < ' ') continue;
        value += ch;
        process.stdout.write('*');
      }
    };

    input.on('data', onData);
  });
}
