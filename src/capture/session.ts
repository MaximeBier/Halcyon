import { PROTOCOL_VERSION } from '../protocol/messages';
import { decodeAnalogReport, type AnalogEntry, type DecodeAnomaly } from '../keyboard/decode';
import { buildFrame, createFrameEmitter } from '../protocol/emit';
import type { FrameKey } from '../protocol/messages';
import type { ObsClient } from '../transport/obs';

export interface CaptureSessionOptions {
  obs: Pick<ObsClient, 'broadcast' | 'ensureConnected'>;
  /**
   * This page's own name, signed onto every frame.
   *
   * The frames of two capture pages are indistinguishable without it, and they
   * add up: twenty tabs reporting a hundred frames a second each showed the
   * overlay two thousand — more than the keyboard can possibly send.
   */
  from: string;
  /**
   * The local preview — capped at the frame interval, not the report rate.
   *
   * See the preview emitter in `createCaptureSession` for why; `onEntries`
   * below is the escape hatch for the one consumer that needs the raw stream.
   */
  onKeys(keys: FrameKey[]): void;
  onAnomaly(anomaly: DecodeAnomaly): void;
  /** Identifiers of the configured keys, or `null` to carry them all. */
  selectedIds?(): readonly number[] | null;
  /**
   * Raw decoded entries, before the configuration filters them.
   *
   * Learning reads these rather than the frame: the key being taught is by
   * definition not configured yet, so the frame does not carry it.
   */
  onEntries?(entries: readonly AnalogEntry[]): void;
}

export interface CaptureSession {
  /** Called synchronously from the `inputreport` handler. */
  handleReport(data: Uint8Array, timestamp: number): void;
  /**
   * Sends the current state to an overlay that has just announced itself.
   *
   * Spec §6 gives this as the reason the overlay speaks at all: without it, an
   * overlay opened after the capture waits for the next change. And the
   * emitter deduplicates, so waiting can mean forever — a keyboard at rest
   * sends no report, and a fresh overlay would stay blank.
   */
  resend(now: number): void;
  /**
   * Answers an overlay's beat by redelivering the current frame, throttled to
   * one per `REFRESH_INTERVAL_MS`.
   *
   * The emitter deduplicates, so a capture holding a steady state goes silent
   * on the wire — and from the overlay's side a silent capture and a dead one
   * look the same. This is the difference: a live capture answers every beat,
   * so an overlay that stops hearing frames knows it may fall back to rest.
   * Beat-driven rather than timed, because the beat arrives as a WebSocket
   * message, which a background tab receives unthrottled — the clock this
   * page is not allowed to own (spec §10).
   */
  pulse(now: number): void;
  /**
   * Replaces the current frame with rest and pushes it out immediately.
   *
   * For the keyboard being unplugged: a key that leaves mid-press can never
   * send its own release, so without this the overlay keeps drawing it
   * pressed until the freshness watch times it out — seconds of a frozen key
   * on air that one frame removes.
   */
  rest(now: number): void;
  /** Frames per second currently going out to OBS. */
  rateAt(now: number): number;
}

export function createCaptureSession(options: CaptureSessionOptions): CaptureSession {
  const emitter = createFrameEmitter();
  /**
   * The preview rides the same machinery as the broadcast, deliberately.
   *
   * It used to receive every report — up to a thousand a second, each one
   * rebuilding the scene and touching the DOM of a background tab nobody was
   * looking at, precisely while the same machine encodes the stream. A second
   * emitter caps it at the same sixty a second, and carries over the
   * guarantees that made the raw feed feel safe: actuation, rest and bottom
   * all bypass the cap, so the preview can no more freeze half-pressed than
   * the overlay can (spec §6.2). Timestamp-driven like everything else here:
   * a background tab throttles timers and rAF, never the reports (spec §10).
   */
  const preview = createFrameEmitter();
  let current: FrameKey[] = [];

  const deliver = (frame: FrameKey[]) =>
    options.obs.broadcast({ v: PROTOCOL_VERSION, t: 'frame', from: options.from, k: frame });

  /** Local delivery cannot fail, so the preview emitter never has to re-send. */
  const show = (frame: FrameKey[]) => {
    options.onKeys(frame);
    return true;
  };

  return {
    handleReport(data, timestamp) {
      const { entries, anomalies } = decodeAnalogReport(data);
      for (const anomaly of anomalies) options.onAnomaly(anomaly);
      options.onEntries?.(entries);

      current = buildFrame(entries, options.selectedIds?.() ?? null);

      // OBS connection recovery driven by keyboard events: immune to the
      // throttling of background timers (spec §10). The report timestamp is
      // what the client spaces its retries out on.
      options.obs.ensureConnected(timestamp);
      emitter.push(current, timestamp, deliver);

      // After the emission, not before: the preview and the rate are shown side
      // by side, and reading the rate first would always show the previous
      // frame's value — zero on the very first report.
      preview.push(current, timestamp, show);
    },
    resend(now) {
      emitter.reset();
      emitter.push(current, now, deliver);
    },
    pulse(now) {
      emitter.refresh(current, now, deliver);
    },
    rest(now) {
      // Through buildFrame, not a bare []: with a selection the rest frame
      // still names every configured key at zero, the shape the overlay is
      // promised (a missing key means zero, but only when nothing is selected).
      current = buildFrame([], options.selectedIds?.() ?? null);
      emitter.push(current, now, deliver);
      // The editor learns of the unplug the same instant the air does.
      preview.push(current, now, show);
    },
    rateAt(now) {
      return emitter.rateAt(now);
    },
  };
}
