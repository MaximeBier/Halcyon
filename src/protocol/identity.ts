/** What a page needs of `crypto`, which is nothing in the worst case. */
export interface RandomSource {
  randomUUID?(): string;
}

let counter = 0;

/** Eight base-36 characters, padded — `toString(36)` can come up short. */
function chunk(): string {
  return Math.random().toString(36).slice(2).padEnd(8, '0').slice(0, 8);
}

/**
 * A name one end of the protocol can be told by (spec §11).
 *
 * Both ends need one, which is why this lives beside the messages rather than
 * with either page: the overlay so the capture can count who is listening, the
 * capture so a second one broadcasting is something anybody can notice.
 *
 * Nothing here is a secret, so `randomUUID` is a convenience rather than a
 * requirement — and it is absent outside a secure context, which the overlay
 * genuinely reaches: `docs/deploy.md` offers `http://<lan-ip>:8080` as the
 * fallback for the day the CEF inside OBS enforces local network access.
 * Calling it unguarded there throws during setup, and a browser source that
 * fails to mount shows nothing at all for the rest of the stream.
 *
 * The fallback's uniqueness rests on `performance.timeOrigin` and two draws of
 * `Math.random`, not on the counter. Two OBS browser sources are two JavaScript
 * contexts, so both start their counter at zero and it tells them apart in no
 * way whatsoever — it only separates repeated calls within one page.
 * `timeOrigin` is the moment its own context was created, which is the one
 * thing here that genuinely differs between two sources.
 */
export function newPageId(
  prefix: string,
  source: RandomSource | undefined = globalThis.crypto,
): string {
  // The prefix goes on both branches. It was on the fallback alone for a day,
  // which meant it was never on anything in production — every real page is in
  // a secure context, so every real id was a bare UUID, and the one branch that
  // honoured the contract was the one that never runs. `from` travels on every
  // `config` and every `frame`, so this is what tells a capture from an overlay
  // when someone is reading the bus to find out why two pages are talking.
  if (typeof source?.randomUUID === 'function') return `${prefix}-${source.randomUUID()}`;

  counter += 1;
  const origin = Math.trunc(performance.timeOrigin).toString(36);
  return `${prefix}-${origin}-${counter}-${chunk()}${chunk()}`;
}
