import { describe, it, expect } from 'vitest';
import { envelope, foreignVersion, parseMessage, PROTOCOL_VERSION } from './messages';
import { resolve } from '../config/resolve';
import { defaultConfig } from '../config/schema';

/** A config the shape check accepts, so a rejection can only be about `from`. */
const aConfig = resolve(defaultConfig());

describe('protocol envelope', () => {
  it('wraps a message under the heOverlay key', () => {
    expect(envelope({ v: PROTOCOL_VERSION, t: 'hello', id: 'test', browser: false })).toEqual({
      heOverlay: { v: PROTOCOL_VERSION, t: 'hello', id: 'test', browser: false },
    });
  });

  it('reads back a wrapped message', () => {
    const parsed = parseMessage({
      heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[174, 996, 1]] },
    });

    expect(parsed).toEqual({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'capture-a',
      k: [[174, 996, 1]],
    });
  });

  it('ignores an unknown protocol version', () => {
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION + 1, t: 'hello', id: 'a', browser: false } }),
    ).toBeNull();
  });

  it('ignores an unknown message type', () => {
    expect(parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'yolo' } })).toBeNull();
  });

  it('carries, in hello and beat, whether the overlay sits in a browser', () => {
    // Opening overlay.html to check that it works took the count from 1 to 2,
    // and the figure was not wrong — that page *is* an overlay. It became
    // useless the instant one used it: no way left to tell whether the one in
    // OBS was in there. So presence carries where it comes from (spec §16.7).
    for (const t of ['hello', 'beat'] as const) {
      expect(
        parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t, id: 'a', browser: true } }),
      ).toEqual({ v: PROTOCOL_VERSION, t, id: 'a', browser: true });
    }
  });

  it('refuses a hello or beat that does not say where it is', () => {
    // A trust boundary, and a missing flag would count as `false` — reporting
    // an overlay in OBS that nobody can see.
    expect(parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'hello', id: 'a' } })).toBeNull();
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'beat', id: 'a', browser: 'yes' } }),
    ).toBeNull();
  });

  it('asks nothing of bye but the id', () => {
    // It says who is leaving, and where it was makes no difference to that.
    expect(parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'bye', id: 'abc' } })).toEqual({
      v: PROTOCOL_VERSION,
      t: 'bye',
      id: 'abc',
    });
  });

  // Without this the capture page would register an overlay keyed `undefined`:
  // one phantom listener, counted forever, and never expiring in step with any
  // real one. The status bar would then claim someone is watching.
  it('rejects an overlay message with no usable id', () => {
    expect(parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'beat' } })).toBeNull();
    expect(parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'hello', id: 42 } })).toBeNull();
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'hello', id: '', browser: false } }),
    ).toBeNull();
    // A bye is the one that removes a listener, so an unchecked id here would
    // let anyone on the same obs-websocket blank the count.
    expect(parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'bye' } })).toBeNull();
  });

  // Any obs-websocket client can emit a CustomEvent, so this is a trust
  // boundary, not our own input. A frame without `k` would set the overlay's
  // key list to undefined, and the very next render would throw — killing the
  // overlay for the rest of the stream.
  it('rejects a malformed frame instead of trusting its shape', () => {
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a' } }),
    ).toBeNull();
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: 'nope' },
      }),
    ).toBeNull();
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[174, 996]] },
      }),
    ).toBeNull();
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[174, 996, 7]] },
      }),
    ).toBeNull();
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [['a', 996, 1]] },
      }),
    ).toBeNull();
  });

  it('accepts an empty frame: every key released is a legitimate frame', () => {
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [] } }),
    ).toEqual({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'capture-a',
      k: [],
    });
  });

  it('rejects a config message that carries no object', () => {
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'config', from: 'capture-a' } }),
    ).toBeNull();
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'config', from: 'capture-a', config: 'nope' },
      }),
    ).toBeNull();
  });

  // Twenty capture tabs left open all broadcast onto the same bus, and the
  // overlay obeys whichever spoke last. Nothing in the protocol used to say who
  // had spoken, so no page could tell its own configuration from a stranger's —
  // the failure where both sides look perfectly correct.
  it('carries the name of the capture page that sent a frame or a config', () => {
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-b', k: [] },
      }),
    ).toMatchObject({ from: 'capture-b' });
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'config', from: 'capture-b', config: aConfig },
      }),
    ).toMatchObject({ from: 'capture-b' });
  });

  // Required, never defaulted. A missing name would have to read as somebody,
  // and reading as "me" is the worst of the two: the page would file a rival's
  // broadcast under its own and go on reporting that it is alone.
  it('rejects a frame or a config that does not say who sent it', () => {
    expect(parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'frame', k: [] } })).toBeNull();
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: '', k: [] } }),
    ).toBeNull();
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 42, k: [] } }),
    ).toBeNull();
    expect(
      parseMessage({ heOverlay: { v: PROTOCOL_VERSION, t: 'config', config: aConfig } }),
    ).toBeNull();
  });

  it('ignores a foreign payload', () => {
    expect(parseMessage({ someOtherApp: { hello: true } })).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage('hello')).toBeNull();
  });
});

describe('a frame is numbers the renderer will divide by', () => {
  // Shape was hardened in milestone 1, finiteness was not. NaN survives the
  // scene's clamp — Math.min(1, Math.max(0, NaN)) is NaN — and reaches the SVG
  // as height="NaN".
  it('rejects a travel that is not a finite number', () => {
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[1, Number.NaN, 0]] },
      }),
    ).toBeNull();
    expect(
      parseMessage({
        heOverlay: {
          v: PROTOCOL_VERSION,
          t: 'frame',
          from: 'capture-a',
          k: [[1, Number.POSITIVE_INFINITY, 0]],
        },
      }),
    ).toBeNull();
  });

  it('rejects an identifier that is not a finite number', () => {
    expect(
      parseMessage({
        heOverlay: { v: PROTOCOL_VERSION, t: 'frame', from: 'capture-a', k: [[Number.NaN, 10, 0]] },
      }),
    ).toBeNull();
  });
});

describe('naming a version we cannot read', () => {
  it('returns the version of a message plainly meant for us', () => {
    expect(foreignVersion({ heOverlay: { v: 7, t: 'hello' } })).toBe(7);
  });

  it('says nothing about a message at our own version', () => {
    expect(
      foreignVersion({ heOverlay: { v: PROTOCOL_VERSION, t: 'hello', id: 'a', browser: false } }),
    ).toBeNull();
  });

  it('says nothing about another application entirely', () => {
    // OBS carries everyone's custom events. Reporting "an overlay is on
    // protocol v3" because some other tool broadcast its own envelope would
    // send someone reloading a page that was never ours.
    expect(foreignVersion({ someOtherApp: { v: 3 } })).toBeNull();
    expect(foreignVersion({ heOverlay: 'not an object' })).toBeNull();
    expect(foreignVersion(null)).toBeNull();
    expect(foreignVersion(42)).toBeNull();
  });

  it('says nothing when the envelope carries no version at all', () => {
    expect(foreignVersion({ heOverlay: { t: 'hello' } })).toBeNull();
    expect(foreignVersion({ heOverlay: { v: 'one', t: 'hello' } })).toBeNull();
  });

  it('reports a version older than ours as readily as a newer one', () => {
    // An overlay left open across a deployment is the common case, and it is
    // behind, not ahead. Only answering for the future would miss it.
    expect(foreignVersion({ heOverlay: { v: 0, t: 'hello' } })).toBe(0);
  });
});
