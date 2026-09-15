import { PROTOCOL_VERSION } from '../protocol/messages';
import { REFRESH_INTERVAL_MS } from '../protocol/emit';
import { resolve } from '../config/resolve';
import { OVERLAY_TIMEOUT_MS, type OverlayRegistry } from './overlays';
import type { OverlayConfig } from '../config/schema';
import type { OverlayMessage } from '../protocol/messages';
import type { ObsClient } from '../transport/obs';

/**
 * How long a second capture page is counted after its last word.
 *
 * The same three missed beats as an overlay, and for the same reason: a rival
 * speaks on the overlay's beat (see `here` below), so its silence is measured
 * in the same unit. Its own `config` and `frame` count as words too — a page
 * being typed on never needs the beat to be heard.
 */
export const CAPTURE_TIMEOUT_MS = OVERLAY_TIMEOUT_MS;

export interface ConfigBroadcaster {
  onOverlayMessage(message: OverlayMessage, now: number): void;
  /** Call after every change to the editing configuration. */
  publish(config: OverlayConfig): void;
  onIdentified(): void;
  /**
   * Drops every rival. Nobody is reachable through a dead socket, and expiry
   * is only computed on read: a warning left standing there would never come
   * down on its own. Silent — no `onRivals` — because the rival has gone
   * nowhere and the journal already carries the line that says OBS did.
   */
  onDisconnected(): void;
  /** Says this page is leaving. For `pagehide`, the event browsers do fire. */
  leave(): void;
  /**
   * Whether another capture page has been heard within `CAPTURE_TIMEOUT_MS`.
   *
   * A flag and not a count. The count is knowable now that pages say `gone`
   * as they leave, but the instruction the status bar gives is the same for
   * one rival and for five, and the figure would only invite someone to
   * reconcile it against their tabs.
   *
   * It used to never come back down, because a capture page spoke only when
   * something moved and its silence said nothing. Since 2026-09-15 a page
   * answers every overlay beat with `here`, so silence means what it means
   * for an overlay: three beats without a word, and the page is gone.
   */
  hasOtherCapture(now: number): boolean;
}

/**
 * Keeps the overlays informed of the configuration, and the registry informed
 * of the overlays.
 *
 * Both duties live together because they are driven by the same three
 * messages, and separating them would mean reading the presence protocol
 * twice — with two chances of reading it differently. Noticing the other
 * capture pages is the third duty, for the same reason: this is the one place
 * that reads every message coming off the bus.
 */
export function createConfigBroadcaster(options: {
  obs: Pick<ObsClient, 'broadcast'>;
  current(): OverlayConfig;
  registry: OverlayRegistry;
  /** This page's own name, signed onto everything it sends. */
  from: string;
  /**
   * Called when the first rival is heard, and again when the last one is gone
   * — the two transitions, never the messages in between.
   *
   * Not once per rival name: a reloaded tab is a new name, and the journal
   * holds two hundred lines before it starts dropping the oldest. Someone
   * reloading a second page while setting OBS up would push the decode
   * anomalies out of the report with news of themselves.
   */
  onRivals?(present: boolean): void;
}): ConfigBroadcaster {
  /** When each other capture page was last heard, by name. */
  const rivals = new Map<string, number>();
  let hadRivals = false;
  let lastHereAt = Number.NEGATIVE_INFINITY;

  function send(config: OverlayConfig) {
    options.obs.broadcast({
      v: PROTOCOL_VERSION,
      t: 'config',
      from: options.from,
      config: resolve(config),
    });
  }

  /**
   * Prunes the rivals and acts on the transitions. Called on every message,
   * because the message *is* the clock: nothing here may own a timer
   * (spec §10), so a rival that fell silent is noticed with the next beat.
   */
  function assess(now: number): boolean {
    for (const [name, at] of rivals) if (now - at > CAPTURE_TIMEOUT_MS) rivals.delete(name);
    const present = rivals.size > 0;
    if (present === hadRivals) return present;
    hadRivals = present;
    // The overlay obeys whichever page spoke last, and the page that just left
    // may well be it. Resending takes the overlay back to this layout — the
    // "then reload" the warning used to ask for, done by the page itself.
    if (!present) send(options.current());
    options.onRivals?.(present);
    return present;
  }

  return {
    onOverlayMessage(message, now) {
      if (
        message.t === 'config' ||
        message.t === 'frame' ||
        message.t === 'here' ||
        message.t === 'gone'
      ) {
        // Sent by this page and handed straight back: obs-websocket delivers a
        // broadcast to every client, the sender included. Whether it does or
        // not, the comparison is the same — one case discards our own, the
        // other never meets them.
        if (message.from !== options.from) {
          if (message.t === 'gone') rivals.delete(message.from);
          else rivals.set(message.from, now);
        }
        // Nothing is sent in reply to a rival. Two pages answering each
        // other's configurations would loop, and the overlay would flip
        // between two layouts as fast as the bus allows.
        assess(now);
        return;
      }
      if (message.t === 'bye') {
        options.registry.forget(message.id);
        assess(now);
        return;
      }

      options.registry.seen(message.id, now, message.browser);
      // An OBS started after Chrome must not wait for the next setting change.
      // A reloaded overlay arrives under a new id and holds nothing, so this
      // fires again for it — deduplicating here would leave it blank.
      if (message.t === 'hello') send(options.current());
      // The beat is the one tick a capture page is allowed to speak on: it
      // arrives as a WebSocket message, which a background tab receives
      // unthrottled, where its own timers would slow to once a minute and
      // have every rival give it up for dead. Throttled like the frame pulse,
      // because four overlays are four beats every two seconds.
      if (message.t === 'beat' && now - lastHereAt >= REFRESH_INTERVAL_MS) {
        lastHereAt = now;
        options.obs.broadcast({ v: PROTOCOL_VERSION, t: 'here', from: options.from });
      }
      assess(now);
    },
    publish(config) {
      send(config);
    },
    onIdentified() {
      // Nothing left while the socket was down, and the overlays on the other
      // side may have been waiting the whole time.
      send(options.current());
    },
    onDisconnected() {
      rivals.clear();
      hadRivals = false;
    },
    leave() {
      options.obs.broadcast({ v: PROTOCOL_VERSION, t: 'gone', from: options.from });
    },
    hasOtherCapture(now) {
      return assess(now);
    },
  };
}
