// @vitest-environment node
import { PROTOCOL_VERSION } from '../protocol/messages';
import { describe, it, expect, vi } from 'vitest';
import { createConfigBroadcaster } from './broadcast';
import { createOverlayRegistry } from './overlays';
import { defaultConfig, type OverlayConfig } from '../config/schema';
import { resolve } from '../config/resolve';
import type { OverlayMessage } from '../protocol/messages';

function setup(options: { onRivals?(present: boolean): void } = {}) {
  const broadcast = vi.fn((_message: OverlayMessage) => true);
  const registry = createOverlayRegistry();
  let config = defaultConfig();
  const broadcaster = createConfigBroadcaster({
    obs: { broadcast },
    current: () => config,
    registry,
    from: 'me',
    ...options,
  });
  return { broadcaster, broadcast, registry, set: (c: OverlayConfig) => (config = c) };
}

describe('createConfigBroadcaster', () => {
  it('answers a hello with the resolved configuration', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'hello', id: 'a', browser: false },
      1000,
    );

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'config',
      from: 'me',
      config: expect.objectContaining({ unit: 72, gap: 8, keys: [] }),
    });
  });

  it('broadcasts a flattened shape: the overlay knows nothing about inheritance', () => {
    const { broadcaster, broadcast, set } = setup();
    const config = defaultConfig();
    config.keys.push({
      id: 174,
      usage: 0x50,
      mode: 'key',
      label: 'Q',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      style: { activeColor: '#ff0000' },
    });
    set(config);

    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'hello', id: 'a', browser: false },
      1000,
    );

    const sent = broadcast.mock.calls[0]![0];
    if (sent.t !== 'config') throw new Error('expected a config message');
    expect(sent.config.keys[0]!.style).toMatchObject({ activeColor: '#ff0000' });
    expect(sent.config.keys[0]!.style).toHaveProperty('restColor');
  });

  it('registers the overlay that announces itself', () => {
    const { broadcaster, registry } = setup();

    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'beat', id: 'a', browser: false }, 1000);

    expect(registry.counts(1000).inObs).toBe(1);
  });

  it('does not resend the configuration on every beat', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'beat', id: 'a', browser: false }, 1000);

    // The beat is answered with `here`, which is presence, not configuration.
    expect(broadcast.mock.calls.filter(([m]) => m.t === 'config')).toHaveLength(0);
  });

  it('rebroadcasts on every configuration change', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.publish(defaultConfig());

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('rebroadcasts as soon as the OBS connection is identified', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.onIdentified();

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('ignores the messages that do not concern the capture page', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'frame', from: 'me', k: [[1, 2, 0]] },
      1000,
    );

    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('createConfigBroadcaster - an overlay that leaves', () => {
  it('stops counting an overlay that said goodbye', () => {
    const { broadcaster, registry } = setup();
    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'hello', id: 'a', browser: false },
      1000,
    );

    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'bye', id: 'a' }, 1100);

    expect(registry.counts(1100).inObs).toBe(0);
  });

  it('sends nothing on a goodbye: there is nobody left to send it to', () => {
    const { broadcaster, broadcast } = setup();
    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'hello', id: 'a', browser: false },
      1000,
    );
    broadcast.mockClear();

    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'bye', id: 'a' }, 1100);

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('answers a reloading overlay again, under its new id', () => {
    // A reload is a goodbye then a hello under a fresh name. The new page holds
    // nothing, so it needs the configuration resent, not deduplicated away.
    const { broadcaster, broadcast } = setup();
    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'hello', id: 'first', browser: false },
      1000,
    );
    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'bye', id: 'first' }, 1100);
    broadcast.mockClear();

    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'hello', id: 'second', browser: false },
      1200,
    );

    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});

describe('createConfigBroadcaster - a second capture page', () => {
  const beat = (id = 'an-overlay') =>
    ({ v: PROTOCOL_VERSION, t: 'beat', id, browser: false }) as const;
  const here = (from: string) => ({ v: PROTOCOL_VERSION, t: 'here', from }) as const;
  const gone = (from: string) => ({ v: PROTOCOL_VERSION, t: 'gone', from }) as const;
  const configsSent = (broadcast: ReturnType<typeof setup>['broadcast']) =>
    broadcast.mock.calls.filter(([m]) => m.t === 'config').length;

  it('does not mistake its own broadcast for somebody else', () => {
    const { broadcaster } = setup();

    broadcaster.publish(defaultConfig());
    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'config', from: 'me', config: resolve(defaultConfig()) },
      1000,
    );
    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'me', k: [] }, 1000);
    broadcaster.onOverlayMessage(here('me'), 1000);

    expect(broadcaster.hasOtherCapture(1000)).toBe(false);
  });

  it('notices a capture page that is not this one', () => {
    const { broadcaster } = setup();

    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'other', k: [] }, 1000);

    expect(broadcaster.hasOtherCapture(1000)).toBe(true);
  });

  // The capture page owns no clock (spec §10): a background tab's timers are
  // throttled down to once a minute, and a page beating that slowly would be
  // given up for dead by every rival while it stands ready to answer the next
  // hello. The overlay's beat arrives as a WebSocket message, unthrottled, so
  // it is the tick this page is allowed to speak on.
  it('says it is here on the overlay beat, signed with its own name', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.onOverlayMessage(beat(), 1000);

    expect(broadcast).toHaveBeenCalledWith(here('me'));
  });

  // Four overlays are four beats every two seconds; one answer a second is
  // plenty for a timeout of six, and keeps the bus from filling with presence.
  it('answers at most once a second, however many overlays beat', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.onOverlayMessage(beat('a'), 1000);
    broadcaster.onOverlayMessage(beat('b'), 1100);
    broadcaster.onOverlayMessage(beat('c'), 1900);
    broadcaster.onOverlayMessage(beat('a'), 2000);

    expect(broadcast.mock.calls.filter(([m]) => m.t === 'here')).toHaveLength(2);
  });

  // A rival answers the same beats, so its presence is one message every two
  // seconds; three missed in a row is the same verdict the overlay count uses.
  it('counts a rival heard within three beats, and lets it go after', () => {
    const { broadcaster } = setup();
    broadcaster.onOverlayMessage(here('other'), 1000);

    expect(broadcaster.hasOtherCapture(7000)).toBe(true);
    expect(broadcaster.hasOtherCapture(7001)).toBe(false);
  });

  it('keeps counting a rival that goes on speaking', () => {
    const { broadcaster } = setup();
    broadcaster.onOverlayMessage(here('other'), 1000);
    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'other', k: [] }, 6000);

    expect(broadcaster.hasOtherCapture(11_000)).toBe(true);
  });

  it('stops counting a rival that said it was gone', () => {
    const { broadcaster } = setup();
    broadcaster.onOverlayMessage(here('other'), 1000);

    broadcaster.onOverlayMessage(gone('other'), 1100);

    expect(broadcaster.hasOtherCapture(1100)).toBe(false);
  });

  // The overlay obeys whichever page spoke last, and the page that just left
  // may well be it. Resending here is what used to be the "then reload" step
  // of the warning — the one thing the page could do for someone, and did not.
  it('resends its configuration once the last rival is gone', () => {
    const { broadcaster, broadcast } = setup();
    broadcaster.onOverlayMessage(here('other'), 1000);
    broadcast.mockClear();

    broadcaster.onOverlayMessage(gone('other'), 1100);

    expect(configsSent(broadcast)).toBe(1);
  });

  it('resends as well when the last rival simply falls silent', () => {
    const { broadcaster, broadcast } = setup();
    broadcaster.onOverlayMessage(here('other'), 1000);
    broadcast.mockClear();

    // Expiry is only computed on read, and the read arrives with the next
    // message off the bus — the beat this page answers anyway.
    broadcaster.onOverlayMessage(beat(), 8000);

    expect(configsSent(broadcast)).toBe(1);
  });

  it('does not resend while another rival is still there', () => {
    const { broadcaster, broadcast } = setup();
    broadcaster.onOverlayMessage(here('other-1'), 1000);
    broadcaster.onOverlayMessage(here('other-2'), 1000);
    broadcast.mockClear();

    broadcaster.onOverlayMessage(gone('other-1'), 1100);

    expect(configsSent(broadcast)).toBe(0);
  });

  // The journal is capped at two hundred lines, and a line per message — or
  // per name, since a reloaded page is a page renamed — would push the decode
  // anomalies out of the report. Only the two transitions are worth a line.
  it('reports the rivals arriving once, and leaving once', () => {
    const met = vi.fn();
    const { broadcaster } = setup({ onRivals: met });

    for (const name of ['other-1', 'other-2', 'other-3']) {
      broadcaster.onOverlayMessage(here(name), 1000);
    }
    expect(met).toHaveBeenCalledTimes(1);
    expect(met).toHaveBeenLastCalledWith(true);

    broadcaster.onOverlayMessage(gone('other-1'), 1100);
    broadcaster.onOverlayMessage(gone('other-2'), 1100);
    expect(met).toHaveBeenCalledTimes(1);

    broadcaster.onOverlayMessage(gone('other-3'), 1200);
    expect(met).toHaveBeenCalledTimes(2);
    expect(met).toHaveBeenLastCalledWith(false);
  });

  // Two pages answering each other's configurations would broadcast in a loop,
  // and the overlay would flip between the two layouts as fast as the bus
  // allows. Noticing a rival changes what is displayed here, never what is sent.
  it('sends nothing back at a rival', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'config', from: 'other', config: resolve(defaultConfig()) },
      1000,
    );
    broadcaster.onOverlayMessage(here('other'), 1000);

    expect(broadcast).not.toHaveBeenCalled();
  });

  // Nobody is reachable through a dead socket, and expiry is only computed on
  // read: a warning left standing would never come down. Quietly, though — the
  // journal already carries the line that says OBS went away, and the rival
  // has not gone anywhere; it will be heard again with the first beat.
  it('forgets every rival when the connection drops, without a word', () => {
    const met = vi.fn();
    const { broadcaster, broadcast } = setup({ onRivals: met });
    broadcaster.onOverlayMessage(here('other'), 1000);
    broadcast.mockClear();
    met.mockClear();

    broadcaster.onDisconnected();

    expect(broadcaster.hasOtherCapture(1000)).toBe(false);
    expect(met).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('says goodbye under its own name', () => {
    const { broadcaster, broadcast } = setup();

    broadcaster.leave();

    expect(broadcast).toHaveBeenCalledWith(gone('me'));
  });
});
