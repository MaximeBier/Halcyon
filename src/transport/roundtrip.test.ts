import { PROTOCOL_VERSION } from '../protocol/messages';
import { describe, it, expect, vi } from 'vitest';
import { createObsClient } from './obs';
import { createOverlayRegistry } from '../capture/overlays';
import { defaultConfig } from '../config/schema';
import { resolve } from '../config/resolve';
import { buildScene } from '../view/scene';
import type { OverlayMessage } from '../protocol/messages';
import { FakeSocket, entry, report } from '../test/fixtures';
import { createCaptureSession } from '../capture/session';

/**
 * Relays BroadcastCustomEvent between two clients the way obs-websocket does.
 *
 * Every other test drives a single client against a socket double. This one
 * covers what neither of them can: a frame leaving the capture and reaching
 * the overlay through a relay. It exists because when that path went silent in
 * the real setup, nothing told us whether the fault was ours — this test
 * answers that question in a second.
 */
class FakeServer {
  private clients: FakeSocket[] = [];

  /** Connects a socket and greets it, the way obs-websocket opens a session. */
  attach(socket: FakeSocket) {
    this.clients.push(socket);
    const relay = this;
    // The shared double records what it is handed; the relay reads it back and
    // answers, which is what turns two clients into a conversation.
    const sent = socket.send.bind(socket);
    socket.send = (data: string) => {
      sent(data);
      relay.receive(socket, data);
    };
    queueMicrotask(() => socket.receive({ op: 0, d: { rpcVersion: 1 } }));
  }

  receive(from: FakeSocket, raw: string) {
    const payload = JSON.parse(raw);
    if (payload.op === 1) {
      from.receive({ op: 2, d: { negotiatedRpcVersion: 1 } });
      return;
    }
    if (payload.op === 6 && payload.d.requestType === 'BroadcastCustomEvent') {
      for (const client of this.clients) {
        client.receive({
          op: 5,
          d: { eventType: 'CustomEvent', eventData: payload.d.requestData.eventData },
        });
      }
    }
  }
}

function spawnClient(server: FakeServer, onMessage: (m: OverlayMessage) => void) {
  return createObsClient({
    url: 'ws://localhost:4455',
    password: '',
    onStatus: () => {},
    onMessage,
    socketFactory: () => {
      const socket = new FakeSocket();
      server.attach(socket);
      return socket;
    },
  });
}

describe('capture to overlay round trip', () => {
  it('delivers a frame broadcast by the capture to the overlay', async () => {
    const server = new FakeServer();
    const received: OverlayMessage[] = [];

    const capture = spawnClient(server, () => {});
    const overlay = spawnClient(server, (m) => received.push(m));
    capture.connect();
    overlay.connect();

    await vi.waitFor(() => expect(capture.status).toBe('identified'));
    await vi.waitFor(() => expect(overlay.status).toBe('identified'));

    capture.broadcast({ v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[174, 996, 1]] });

    expect(received).toEqual([
      { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[174, 996, 1]] },
    ]);
  });

  it('lets the capture count two overlays from their heartbeats', async () => {
    // The relay echoes every broadcast back to its sender, which is the worst
    // case: nobody knows whether obs-websocket does. If the capture counted
    // indiscriminately, its own frame would show up as a third listener here.
    const server = new FakeServer();
    const registry = createOverlayRegistry();

    const capture = spawnClient(server, (m) => {
      if (m.t === 'hello' || m.t === 'beat') registry.seen(m.id, 1000, m.browser);
    });
    const first = spawnClient(server, () => {});
    const second = spawnClient(server, () => {});
    capture.connect();
    first.connect();
    second.connect();

    await vi.waitFor(() => expect(second.status).toBe('identified'));

    first.broadcast({ v: PROTOCOL_VERSION, t: 'hello', id: 'first', browser: false });
    second.broadcast({ v: PROTOCOL_VERSION, t: 'beat', id: 'second', browser: false });
    capture.broadcast({ v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [] });

    expect(registry.counts(1000).inObs).toBe(2);
  });

  it('counts one overlay across a reload, not two', async () => {
    // What a reload looks like on the wire: the page says goodbye, comes back
    // under a new id, and beats again. Ten of those in a row is what adjusting
    // an overlay looks like, and without the goodbye it read as eleven.
    const server = new FakeServer();
    const registry = createOverlayRegistry();

    const capture = spawnClient(server, (m) => {
      if (m.t === 'hello' || m.t === 'beat') registry.seen(m.id, 1000, m.browser);
      if (m.t === 'bye') registry.forget(m.id);
    });
    const overlay = spawnClient(server, () => {});
    capture.connect();
    overlay.connect();

    await vi.waitFor(() => expect(overlay.status).toBe('identified'));

    for (let reload = 0; reload < 10; reload++) {
      overlay.broadcast({ v: PROTOCOL_VERSION, t: 'hello', id: `run-${reload}`, browser: false });
      overlay.broadcast({ v: PROTOCOL_VERSION, t: 'bye', id: `run-${reload}` });
    }
    overlay.broadcast({ v: PROTOCOL_VERSION, t: 'hello', id: 'run-final', browser: false });

    expect(registry.counts(1000).inObs).toBe(1);
  });
});

describe('capture to overlay round trip - the configuration', () => {
  it('delivers a resolved configuration the overlay can render', async () => {
    const server = new FakeServer();
    const received: OverlayMessage[] = [];

    const capture = spawnClient(server, () => {});
    const overlay = spawnClient(server, (m) => received.push(m));
    capture.connect();
    overlay.connect();
    await vi.waitFor(() => expect(overlay.status).toBe('identified'));

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
    capture.broadcast({
      v: PROTOCOL_VERSION,
      t: 'config',
      from: 'capture-a',
      config: resolve(config),
    });

    const delivered = received.find((m) => m.t === 'config');
    if (delivered?.t !== 'config') throw new Error('the configuration never arrived');

    // Survived parseMessage, which now validates the whole shape.
    expect(buildScene(delivered.config, []).keys).toHaveLength(1);
  });

  it('drops a configuration message that would break the render', async () => {
    // Any client authenticated on the same obs-websocket can emit under our
    // key. Before validation, `keys: 'nope'` reached buildScene and threw.
    const server = new FakeServer();
    const received: OverlayMessage[] = [];

    const attacker = spawnClient(server, () => {});
    const overlay = spawnClient(server, (m) => received.push(m));
    attacker.connect();
    overlay.connect();
    await vi.waitFor(() => expect(overlay.status).toBe('identified'));

    attacker.broadcast({
      v: PROTOCOL_VERSION,
      t: 'config',
      from: 'an-attacker',
      config: { keys: 'nope' } as never,
    });

    expect(received.some((m) => m.t === 'config')).toBe(false);
  });
});

describe('capture to overlay round trip - staying fresh', () => {
  it('answers an overlay beat by redelivering a frame nothing else would repeat', async () => {
    // The emitter deduplicates, so a held key goes silent on the wire — and a
    // silent capture looks exactly like a dead one. The beat is what tells
    // them apart: a live capture answers it with the frame it already sent.
    const server = new FakeServer();
    const received: OverlayMessage[] = [];

    const captureClient = spawnClient(server, (m) => {
      if (m.t === 'beat') session.pulse(3000);
    });
    const session = createCaptureSession({
      obs: captureClient,
      from: 'capture-a',
      onKeys: () => {},
      onAnomaly: () => {},
    });
    const overlay = spawnClient(server, (m) => received.push(m));
    captureClient.connect();
    overlay.connect();
    await vi.waitFor(() => expect(captureClient.status).toBe('identified'));
    await vi.waitFor(() => expect(overlay.status).toBe('identified'));

    session.handleReport(report(entry(174, 0x50, 700, 0x01)), 0);
    overlay.broadcast({ v: PROTOCOL_VERSION, t: 'beat', id: 'ov', browser: false });

    expect(received.filter((m) => m.t === 'frame')).toEqual([
      { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[174, 700, 1]] },
      { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[174, 700, 1]] },
    ]);
  });
});
