// @vitest-environment node
import { PROTOCOL_VERSION } from '../protocol/messages';
import { describe, it, expect, vi } from 'vitest';
import { createConfigBroadcaster } from './broadcast';
import { createOverlayRegistry } from './overlays';
import { defaultConfig, type OverlayConfig } from '../config/schema';
import { resolve } from '../config/resolve';
import type { OverlayMessage } from '../protocol/messages';

function setup(options: { onOtherCapture?(): void } = {}) {
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

    expect(broadcast).not.toHaveBeenCalled();
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
  it('does not mistake its own broadcast for somebody else', () => {
    const { broadcaster } = setup();

    broadcaster.publish(defaultConfig());
    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'config', from: 'me', config: resolve(defaultConfig()) },
      1000,
    );
    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'me', k: [] }, 1000);

    expect(broadcaster.hasOtherCapture()).toBe(false);
  });

  it('notices a capture page that is not this one', () => {
    const { broadcaster } = setup();

    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'other', k: [] }, 1000);

    expect(broadcaster.hasOtherCapture()).toBe(true);
  });

  // Deliberately never expires, unlike the overlay count. A capture page speaks
  // only when something moves, so a silence means nothing at all — and the
  // silence is exactly when one sits calmly configuring, which is when the
  // other page is about to answer the next hello with its own layout. A warning
  // that goes quiet during the dangerous moment is worse than none.
  it('goes on saying so long after the last word', () => {
    const { broadcaster } = setup();
    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'other', k: [] }, 1000);

    broadcaster.onOverlayMessage(
      { v: PROTOCOL_VERSION, t: 'hello', id: 'an-overlay', browser: false },
      9_999_999,
    );

    expect(broadcaster.hasOtherCapture()).toBe(true);
  });

  it('speaks up once, however many messages arrive', () => {
    const met = vi.fn();
    const { broadcaster } = setup({ onOtherCapture: met });

    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'other', k: [] }, 1000);
    broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: 'other', k: [] }, 1100);

    expect(met).toHaveBeenCalledOnce();
  });

  // The defect found by reloading a second capture page: every load draws a new
  // name, so one tab reloaded three times used to read as three pages. The
  // journal is capped at two hundred lines, and a line per reload would push
  // real anomalies out of the report.
  it('says nothing new when the same page comes back under another name', () => {
    const met = vi.fn();
    const { broadcaster } = setup({ onOtherCapture: met });

    for (const name of ['other-1', 'other-2', 'other-3']) {
      broadcaster.onOverlayMessage({ v: PROTOCOL_VERSION, t: 'frame', from: name, k: [] }, 1000);
    }

    expect(met).toHaveBeenCalledOnce();
    expect(broadcaster.hasOtherCapture()).toBe(true);
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

    expect(broadcast).not.toHaveBeenCalled();
  });
});
