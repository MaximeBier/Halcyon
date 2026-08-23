import { PROTOCOL_VERSION } from '../protocol/messages';
import { resolve } from '../config/resolve';
import type { OverlayConfig } from '../config/schema';
import type { OverlayMessage } from '../protocol/messages';
import type { ObsClient } from '../transport/obs';
import type { OverlayRegistry } from './overlays';

export interface ConfigBroadcaster {
  onOverlayMessage(message: OverlayMessage, now: number): void;
  /** Call after every change to the editing configuration. */
  publish(config: OverlayConfig): void;
  onIdentified(): void;
  /**
   * Whether another capture page has been heard broadcasting.
   *
   * A flag and not a count, because the count is not knowable: a page draws a
   * fresh name every time it loads, so one tab reloaded three times is three
   * names here and one page out there. Reporting "3 other capture pages" would
   * be the same class of lie as the overlay total this protocol version was
   * opened to fix.
   *
   * Never comes back down. A capture page speaks only when something moves, so
   * its silence says nothing — and the silence is exactly the calm in which one
   * edits a layout, while the other page stands ready to answer the next hello
   * with its own. An expiring warning would be absent precisely then.
   */
  hasOtherCapture(): boolean;
}

/**
 * Keeps the overlays informed of the configuration, and the registry informed
 * of the overlays.
 *
 * Both duties live together because they are driven by the same three
 * messages, and separating them would mean reading the presence protocol
 * twice — with two chances of reading it differently. Noticing a second capture
 * page is the third duty, for the same reason: this is the one place that reads
 * every message coming off the bus.
 */
export function createConfigBroadcaster(options: {
  obs: Pick<ObsClient, 'broadcast'>;
  current(): OverlayConfig;
  registry: OverlayRegistry;
  /** This page's own name, signed onto everything it sends. */
  from: string;
  /**
   * Called the first time another capture page is heard, and once only.
   *
   * Once per *session*, not once per rival name: a reloaded tab is a new name,
   * and the journal holds two hundred lines before it starts dropping the
   * oldest. Someone reloading a second page while setting OBS up would push the
   * decode anomalies out of the report with news of themselves.
   */
  onOtherCapture?(): void;
}): ConfigBroadcaster {
  let heardAnother = false;

  function send(config: OverlayConfig) {
    options.obs.broadcast({
      v: PROTOCOL_VERSION,
      t: 'config',
      from: options.from,
      config: resolve(config),
    });
  }

  return {
    onOverlayMessage(message, now) {
      if (message.t === 'config' || message.t === 'frame') {
        // Sent by this page and handed straight back: obs-websocket delivers a
        // broadcast to every client, the sender included. Whether it does or
        // not, the comparison is the same — one case discards our own, the
        // other never meets them.
        if (message.from === options.from) return;
        if (!heardAnother) {
          heardAnother = true;
          options.onOtherCapture?.();
        }
        // Nothing is sent in reply. Two pages answering each other's
        // configurations would loop, and the overlay would flip between two
        // layouts as fast as the bus allows.
        return;
      }
      if (message.t === 'bye') {
        options.registry.forget(message.id);
        return;
      }
      if (message.t !== 'hello' && message.t !== 'beat') return;

      options.registry.seen(message.id, now, message.browser);
      // An OBS started after Chrome must not wait for the next setting change.
      // A reloaded overlay arrives under a new id and holds nothing, so this
      // fires again for it — deduplicating here would leave it blank.
      if (message.t === 'hello') send(options.current());
    },
    publish(config) {
      send(config);
    },
    onIdentified() {
      // Nothing left while the socket was down, and the overlays on the other
      // side may have been waiting the whole time.
      send(options.current());
    },
    hasOtherCapture() {
      return heardAnother;
    },
  };
}
