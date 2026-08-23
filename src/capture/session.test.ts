import { PROTOCOL_VERSION } from '../protocol/messages';
import { describe, it, expect, vi } from 'vitest';
import { createCaptureSession } from './session';
import type { FrameKey } from '../protocol/messages';
import { entry, report } from '../test/fixtures';

function setup() {
  const broadcast = vi.fn(() => true);
  const keys: FrameKey[][] = [];
  const anomalies: unknown[] = [];
  const session = createCaptureSession({
    obs: { broadcast, ensureConnected: vi.fn() } as never,
    from: 'me',
    onKeys: (k) => keys.push(k),
    onAnomaly: (a) => anomalies.push(a),
  });
  return { session, broadcast, keys, anomalies };
}

describe('createCaptureSession', () => {
  it('broadcasts one frame per decoded report', () => {
    const { session, broadcast } = setup();

    session.handleReport(report(entry(174, 0x50, 996, 0x01)), 0);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[174, 996, 1]],
    });
  });

  it('transmits actuation even at partial travel', () => {
    const { session, broadcast } = setup();

    session.handleReport(report(entry(30, 0x16, 300, 0x00)), 0);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[30, 300, 0]],
    });
  });

  it('feeds the local preview with the very same keys', () => {
    const { session, keys } = setup();

    session.handleReport(report(entry(174, 0x50, 996, 0x01)), 0);

    expect(keys).toEqual([[[174, 996, 1]]]);
  });

  it('surfaces decode anomalies without broadcasting an unknown entry', () => {
    const { session, broadcast, anomalies } = setup();

    session.handleReport(report(entry(30, 0x16, 500, 0x02)), 0);

    expect(anomalies).toEqual([{ kind: 'unknown-low-bits', index: 30, field: (500 << 6) | 0x02 }]);
    expect(broadcast).toHaveBeenCalledWith({ v: PROTOCOL_VERSION, t: 'frame', from: 'me', k: [] });
  });

  it('retries the OBS connection on every report: event-driven, timer-free', () => {
    const ensureConnected = vi.fn();
    const session = createCaptureSession({
      obs: { broadcast: vi.fn(), ensureConnected } as never,
      from: 'me',
      onKeys: () => {},
      onAnomaly: () => {},
    });

    session.handleReport(report(entry(1, 0x04, 10, 0x00)), 0);

    expect(ensureConnected).toHaveBeenCalled();
  });

  it('hands the report timestamp over, so the retries can be spaced out', () => {
    const ensureConnected = vi.fn();
    const session = createCaptureSession({
      obs: { broadcast: vi.fn(), ensureConnected } as never,
      from: 'me',
      onKeys: () => {},
      onAnomaly: () => {},
    });

    session.handleReport(report(entry(1, 0x04, 10, 0x00)), 1234);

    expect(ensureConnected).toHaveBeenCalledWith(1234);
  });
});

describe('createCaptureSession — throughput', () => {
  it('sacrifices an intermediate variation but never the return to rest', () => {
    const { session, broadcast } = setup();

    session.handleReport(report(entry(174, 0x50, 400, 0x00)), 0);
    session.handleReport(report(entry(174, 0x50, 410, 0x00)), 1);
    session.handleReport(report(entry(174, 0x50, 0, 0x00)), 2);

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenLastCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[174, 0, 0]],
    });
  });

  it('sacrifices the same frames for the preview as for the broadcast', () => {
    // Flipped on 2026-08-23. The preview used to receive every report, on the
    // theory that a local screen deserves the full stream. At up to a thousand
    // reports a second, each one rebuilt the scene and touched the DOM of a
    // background tab nobody was looking at — precisely while the same machine
    // was encoding the stream. The preview now rides its own emitter, keeping
    // the cap and the guarantees at the extremities alike.
    const { session, keys } = setup();

    session.handleReport(report(entry(174, 0x50, 400, 0x00)), 0);
    session.handleReport(report(entry(174, 0x50, 410, 0x00)), 1);

    expect(keys).toEqual([[[174, 400, 0]]]);
  });

  it('caps the preview at the frame interval over a raw-rate stream', () => {
    const { session, broadcast, keys } = setup();

    // A thousand reports in one second, each a small change: a key being
    // wiggled. The cycle stays clear of every cap-bypassing branch — no
    // actuation, no rest, no bottom, and steps well under TRAVEL_STEP.
    for (let i = 0; i < 1000; i += 1) {
      session.handleReport(report(entry(174, 0x50, 300 + (i % 90), 0x00)), i);
    }

    expect(keys.length).toBeGreaterThan(50);
    expect(keys.length).toBeLessThan(70);
    // Same machinery, same inputs, same decisions: the preview and the
    // broadcast sacrifice the very same frames.
    expect(keys.length).toBe(broadcast.mock.calls.length);
  });

  it('never starves the preview of an actuation change', () => {
    const { session, keys } = setup();

    session.handleReport(report(entry(174, 0x50, 400, 0x00)), 0);
    session.handleReport(report(entry(174, 0x50, 500, 0x01)), 1);

    expect(keys).toEqual([[[174, 400, 0]], [[174, 500, 1]]]);
  });

  it('never starves the preview of the return to rest', () => {
    // The guarantee the raw feed provided by brute force, kept by
    // construction: the rest branch bypasses the cap, so a key can no more
    // freeze half-pressed on the preview than it can on air (spec §6.2).
    const { session, keys } = setup();

    session.handleReport(report(entry(174, 0x50, 400, 0x00)), 0);
    session.handleReport(report(entry(174, 0x50, 410, 0x00)), 1);
    session.handleReport(report(entry(174, 0x50, 0, 0x00)), 2);

    expect(keys).toEqual([[[174, 400, 0]], [[174, 0, 0]]]);
  });

  it('carries the selected keys only', () => {
    const broadcast = vi.fn(() => true);
    const session = createCaptureSession({
      obs: { broadcast, ensureConnected: vi.fn() } as never,
      from: 'me',
      onKeys: () => {},
      onAnomaly: () => {},
      selectedIds: () => [174],
    });

    session.handleReport(report(entry(174, 0x50, 100, 0x00), entry(9, 0x1a, 900, 0x01)), 0);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[174, 100, 0]],
    });
  });

  it('reports the rate of the frame it has just sent, not the previous one', () => {
    // The preview and the rate are drawn side by side. Reading the rate before
    // the emission always showed the previous value — zero on the first report.
    const rates: number[] = [];
    const session = createCaptureSession({
      obs: { broadcast: vi.fn(() => true), ensureConnected: vi.fn() } as never,
      from: 'me',
      onKeys: () => rates.push(session.rateAt(0)),
      onAnomaly: () => {},
    });

    session.handleReport(report(entry(174, 0x50, 400, 0x00)), 0);

    expect(rates).toEqual([1]);
  });
});

describe('createCaptureSession — an overlay announcing itself', () => {
  it('sends the current state, even though the overlay has changed nothing', () => {
    const { session, broadcast } = setup();
    session.handleReport(report(entry(174, 0x50, 400, 0x00)), 0);
    broadcast.mockClear();

    session.resend(1);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[174, 400, 0]],
    });
  });

  it('sends a rest frame when nothing is pressed, rather than nothing at all', () => {
    // A keyboard at rest sends no report, so an overlay opened at that moment
    // would otherwise stay blank until someone types.
    const { session, broadcast } = setup();

    session.resend(0);

    expect(broadcast).toHaveBeenCalledWith({ v: PROTOCOL_VERSION, t: 'frame', from: 'me', k: [] });
  });
});

describe('createCaptureSession — a connection that dropped', () => {
  it('resends the state the overlay never received', () => {
    // The milestone 2 review: OBS dies while a key is held, the release frame
    // is dropped by broadcast, and nothing follows it because nothing is being
    // touched. The overlay used to keep the half-pressed key for good.
    let live = true;
    const broadcast = vi.fn(() => live);
    const session = createCaptureSession({
      obs: { broadcast, ensureConnected: vi.fn() } as never,
      from: 'me',
      onKeys: () => {},
      onAnomaly: () => {},
    });

    session.handleReport(report(entry(174, 0x50, 700, 0x01)), 0);
    live = false;
    session.handleReport(report(entry(174, 0x50, 0, 0x00)), 1);
    live = true;
    broadcast.mockClear();

    session.handleReport(report(entry(174, 0x50, 0, 0x00)), 2);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[174, 0, 0]],
    });
  });
});

describe('createCaptureSession — what learning reads', () => {
  it('reports the raw entries before the configuration filters them', () => {
    // Learning has to see a key that is not configured yet — that is the whole
    // point — so it cannot read the frame, which carries only configured keys.
    const seen: number[] = [];
    const session = createCaptureSession({
      obs: { broadcast: vi.fn(() => true), ensureConnected: vi.fn() } as never,
      from: 'me',
      onKeys: () => {},
      onAnomaly: () => {},
      selectedIds: () => [],
      onEntries: (entries) => seen.push(...entries.map((e) => e.index)),
    });

    session.handleReport(report(entry(174, 0x50, 900, 0x01)), 0);

    expect(seen).toEqual([174]);
  });

  it('keeps the raw entries at full rate while the preview is capped', () => {
    // The learner watches for a rise on a key that may not be configured yet;
    // a sacrificed frame must never hide a report from it.
    const seen: number[][] = [];
    const keys: FrameKey[][] = [];
    const session = createCaptureSession({
      obs: { broadcast: vi.fn(() => true), ensureConnected: vi.fn() } as never,
      from: 'me',
      onKeys: (k) => keys.push(k),
      onAnomaly: () => {},
      onEntries: (entries) => seen.push(entries.map((e) => e.index)),
    });

    session.handleReport(report(entry(174, 0x50, 400, 0x00)), 0);
    session.handleReport(report(entry(174, 0x50, 410, 0x00)), 1);

    expect(seen).toEqual([[174], [174]]);
    expect(keys).toEqual([[[174, 400, 0]]]);
  });

  it('reports the entries even on a report that produces an empty frame', () => {
    const seen: number[] = [];
    const session = createCaptureSession({
      obs: { broadcast: vi.fn(() => true), ensureConnected: vi.fn() } as never,
      from: 'me',
      onKeys: () => {},
      onAnomaly: () => {},
      selectedIds: () => [9],
      onEntries: (entries) => seen.push(...entries.map((e) => e.index)),
    });

    session.handleReport(report(entry(174, 0x50, 900, 0x01)), 0);

    expect(seen).toEqual([174]);
  });
});

describe('createCaptureSession — an overlay beating', () => {
  it('answers the beat by redelivering the current frame', () => {
    // Deduplication makes an idle capture and a dead one indistinguishable
    // from the overlay's side: both go silent. The answer to the beat is what
    // tells them apart, and it is event-driven — a WebSocket message reaches a
    // background tab where a timer would be throttled (spec §10).
    const { session, broadcast } = setup();
    session.handleReport(report(entry(174, 0x50, 400, 0x01)), 0);
    broadcast.mockClear();

    session.pulse(2000);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[174, 400, 1]],
    });
  });

  it('answers at most once per refresh interval, however many overlays beat', () => {
    const { session, broadcast } = setup();
    session.handleReport(report(entry(174, 0x50, 400, 0x01)), 0);
    broadcast.mockClear();

    session.pulse(2000);
    session.pulse(2500);

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('stays silent while the traffic itself is fresh', () => {
    const { session, broadcast } = setup();
    session.handleReport(report(entry(174, 0x50, 400, 0x01)), 2000);
    broadcast.mockClear();

    session.pulse(2001);

    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('createCaptureSession — the keyboard going away', () => {
  it('pushes a rest frame immediately: an unplugged key never sends its release', () => {
    const { session, broadcast } = setup();
    session.handleReport(report(entry(174, 0x50, 700, 0x01)), 0);
    broadcast.mockClear();

    session.rest(1);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [],
    });
  });

  it('carries the configured keys at zero rather than an empty frame', () => {
    const broadcast = vi.fn(() => true);
    const session = createCaptureSession({
      obs: { broadcast, ensureConnected: vi.fn() } as never,
      from: 'me',
      onKeys: () => {},
      onAnomaly: () => {},
      selectedIds: () => [174],
    });
    session.handleReport(report(entry(174, 0x50, 700, 0x01)), 0);
    broadcast.mockClear();

    session.rest(1);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [[174, 0, 0]],
    });
  });

  it('shows the rest frame locally as well as on air', () => {
    // The unplug must reach the preview through the same door as the
    // broadcast: without it the editor keeps drawing a key the keyboard can
    // no longer release.
    const { session, keys } = setup();
    session.handleReport(report(entry(174, 0x50, 700, 0x01)), 0);

    session.rest(1);

    expect(keys).toEqual([[[174, 700, 1]], []]);
  });

  it('answers later beats with the rest frame, not the one before the unplug', () => {
    const { session, broadcast } = setup();
    session.handleReport(report(entry(174, 0x50, 700, 0x01)), 0);
    session.rest(1);
    broadcast.mockClear();

    session.pulse(5000);

    expect(broadcast).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: 'frame',
      from: 'me',
      k: [],
    });
  });
});
