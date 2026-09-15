import { computeAuth } from './auth';
import { foreignVersion, envelope, parseMessage, type OverlayMessage } from '../protocol/messages';

/**
 * `unreachable` and `disconnected` are both failures, and deliberately not the
 * same one: the first means OBS never answered — its WebSocket server is off,
 * or the browser is holding back local network access — while the second means
 * a working connection went away. The status bar has to say what to do, and
 * those are two different things to do (spec §11).
 */
export type ObsStatus =
  'idle' | 'connecting' | 'identified' | 'auth-failed' | 'unreachable' | 'disconnected';

/** Port obs-websocket listens on out of the box. Configurable in OBS (spec §6.1). */
export const DEFAULT_OBS_PORT = 4455;
/** Highest port number a TCP URL can carry. Beyond it, `new WebSocket` throws. */
export const MAX_PORT = 65535;

/** Delay before the first retry. It doubles with every failure that follows. */
export const RETRY_BASE_MS = 500;
/**
 * Ceiling on the backoff. Five seconds is the compromise: it divides the retry
 * traffic by two hundred and fifty against no spacing at all, and it is still
 * short enough that reopening OBS feels like it just reconnects.
 */
export const RETRY_MAX_MS = 5000;

/** obs-websocket 5.x close code for a refused authentication. */
const AUTH_FAILED_CODE = 4009;

/** EventSubscription.General: contains CustomEvent. */
export const EVENT_GENERAL = 1;
/** EventSubscription.Scenes: CurrentProgramSceneChanged, which the capture page follows. */
export const EVENT_SCENES = 1 << 2;
/**
 * EventSubscription.Transitions: SceneTransitionStarted, which fires on the
 * first frame of a scene change where CurrentProgramSceneChanged waits for the
 * last one. The capture page follows the early signal (spec §4).
 */
export const EVENT_TRANSITIONS = 1 << 4;

export interface ObsResponse {
  ok: boolean;
  /** obs-websocket RequestStatus code — 100 on success, 0 when no answer ever came. */
  code: number;
  data: Record<string, unknown>;
}

/** What a request gets when nobody can answer it: not identified, or the socket went. */
const NO_ANSWER: ObsResponse = { ok: false, code: 0, data: {} };

/** Falls back to the default rather than build a URL the constructor rejects. */
export function normalizePort(value: unknown): number {
  const port = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  if (typeof port !== 'number' || !Number.isInteger(port)) return DEFAULT_OBS_PORT;
  return port > 0 && port <= MAX_PORT ? port : DEFAULT_OBS_PORT;
}

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  /** Receives a CloseEvent, exactly like the browser API: the code is a field
   * of the event, never an argument of its own. */
  onclose: ((event: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
}

export interface ObsClientOptions {
  url: string;
  password: string;
  onStatus(status: ObsStatus): void;
  onMessage(message: OverlayMessage): void;
  /**
   * An overlay on a protocol version we cannot read — almost always one
   * left open across a deployment. Diagnosis only; nothing is processed.
   */
  onForeignVersion?(version: number): void;
  /**
   * The EventSubscription mask sent at Identify. General alone by default: the
   * overlay pages need nothing but CustomEvent, and every extra bit is traffic
   * OBS pushes to every one of them for nothing. The capture page adds Scenes.
   */
  eventSubscriptions?: number;
  /**
   * Every event that is not a CustomEvent, raw. Scene changes arrive here.
   * The transport does not interpret them: what a scene change *means* is the
   * capture page's business, and the overlay never asks for any.
   */
  onEvent?(eventType: string, eventData: Record<string, unknown>): void;
  socketFactory?(url: string): SocketLike;
}

export interface ObsClient {
  /** Opens now, clearing any backoff: the caller carries new credentials. */
  connect(): void;
  /**
   * Reopens when the socket is closed, no more often than the backoff allows.
   *
   * `now` is the timestamp of the keyboard report that triggered the call. The
   * spacing is measured on those, never on a timer: a background tab throttles
   * timers to one minute, which would make the retry stop happening exactly
   * when the overlay is live and the page is not being looked at (spec §2.2).
   */
  ensureConnected(now: number): void;
  /**
   * Sends a message, and says whether it actually left. Nothing goes out before
   * identification, and the caller has to know: an emitter that took a dropped
   * frame for a delivered one would deduplicate against a state the far end
   * never received.
   */
  broadcast(message: OverlayMessage): boolean;
  /**
   * Sends a request and resolves with its answer. Never rejects: not
   * identified, or a socket that closes first, both resolve `ok: false` with
   * code 0. Callers have one failure to handle, not two shapes of it.
   */
  request(requestType: string, requestData?: Record<string, unknown>): Promise<ObsResponse>;
  close(): void;
  readonly status: ObsStatus;
}

/**
 * Compile-time proof that our socket interface describes the browser API and
 * not merely our own double. Reading the close code as a bare argument used to
 * report every refused password as an unreachable server; these lines turn that
 * class of mistake into a build error.
 *
 * Both aliases are unused by design — being accepted by the compiler *is* the
 * assertion. Whoever adds a linter should exempt them rather than delete them.
 */
type AcceptsBrowserEvent<E, H extends (event: E) => void> = H;
type _CloseIsFaithful = AcceptsBrowserEvent<CloseEvent, NonNullable<SocketLike['onclose']>>;
type _MessageIsFaithful = AcceptsBrowserEvent<MessageEvent, NonNullable<SocketLike['onmessage']>>;

export function createObsClient(options: ObsClientOptions): ObsClient {
  const factory =
    options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);

  let socket: SocketLike | null = null;
  let status: ObsStatus = 'idle';
  /** True once this socket got its Identified: separates the two failures. */
  let identified = false;
  /** Failed attempts in a row. Sets the backoff, cleared by any success. */
  let attempts = 0;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;

  let nextRequestId = 1;
  const pending = new Map<string, (response: ObsResponse) => void>();

  /**
   * Answers everything still waiting, negatively. Called wherever the socket
   * is given up: a promise left hanging would hold its caller — the sources
   * scan, say — for the rest of the session.
   */
  function settlePending() {
    for (const resolve of pending.values()) resolve(NO_ANSWER);
    pending.clear();
  }

  function retryDelay() {
    if (attempts === 0) return 0;
    return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
  }

  /** What a socket going away means, depending on how far it got. */
  function lostConnection(): ObsStatus {
    return identified ? 'disconnected' : 'unreachable';
  }

  function setStatus(next: ObsStatus) {
    if (status === next) return;
    status = next;
    options.onStatus(next);
  }

  function send(payload: unknown) {
    socket?.send(JSON.stringify(payload));
  }

  /**
   * Writes to one named socket rather than to whichever is current. Anything
   * that crosses an `await` must use this: the socket can be replaced while a
   * digest is being computed, and an Identify answering the previous challenge
   * would earn a 4009 — auth-failed reported on a correct password.
   */
  function sendTo(target: SocketLike, payload: unknown) {
    target.send(JSON.stringify(payload));
  }

  /** Drops a socket and its handlers, so no late event can speak for it. */
  function discard(target: SocketLike) {
    target.onopen = null;
    target.onclose = null;
    target.onerror = null;
    target.onmessage = null;
  }

  async function identify(
    hello: { authentication?: { challenge: string; salt: string } },
    target: SocketLike,
  ) {
    const data: Record<string, unknown> = {
      rpcVersion: 1,
      eventSubscriptions: options.eventSubscriptions ?? EVENT_GENERAL,
    };
    if (hello.authentication) {
      data.authentication = await computeAuth(
        options.password,
        hello.authentication.salt,
        hello.authentication.challenge,
      );
    }
    if (socket !== target) return;
    sendTo(target, { op: 1, d: data });
  }

  function handle(raw: string, target: SocketLike) {
    let payload: { op?: number; d?: Record<string, unknown> };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload.op === 0) {
      identify((payload.d ?? {}) as Parameters<typeof identify>[0], target).catch(() => {
        // `crypto.subtle` only exists in a secure context: over plain HTTP on a
        // LAN address — an OBS browser source pointed at http://<ip>:8080 —
        // the digest throws. Swallowing it would leave the client stuck on
        // `connecting` forever, with no signal and nothing retrying.
        if (socket !== target) return;
        fail('unreachable');
      });
      return;
    }
    if (payload.op === 2) {
      identified = true;
      attempts = 0;
      setStatus('identified');
      return;
    }
    if (payload.op === 7) {
      const id = payload.d?.requestId;
      if (typeof id !== 'string') return;
      const resolve = pending.get(id);
      if (!resolve) return;
      pending.delete(id);
      const result = (payload.d?.requestStatus ?? {}) as { result?: boolean; code?: number };
      resolve({
        ok: result.result === true,
        code: typeof result.code === 'number' ? result.code : 0,
        data: (payload.d?.responseData as Record<string, unknown> | undefined) ?? {},
      });
      return;
    }
    if (payload.op === 5 && payload.d?.eventType !== 'CustomEvent') {
      if (typeof payload.d?.eventType === 'string') {
        options.onEvent?.(
          payload.d.eventType,
          (payload.d.eventData as Record<string, unknown> | undefined) ?? {},
        );
      }
      return;
    }
    if (payload.op === 5 && payload.d?.eventType === 'CustomEvent') {
      const message = parseMessage(payload.d.eventData);
      if (message) {
        options.onMessage(message);
        return;
      }
      // Unreadable, and worth saying so. `foreignVersion` answers only for
      // our own envelope, so another application on the same bus stays
      // silent rather than sending someone to reload a page of theirs.
      const version = foreignVersion(payload.d.eventData);
      if (version !== null) options.onForeignVersion?.(version);
    }
  }

  /** Gives up on the current socket, leaving the client ready to try again. */
  function fail(reason: ObsStatus) {
    if (socket) {
      discard(socket);
      socket.close();
      socket = null;
    }
    settlePending();
    setStatus(reason);
  }

  function openSocket() {
    if (socket) return;
    setStatus('connecting');
    identified = false;

    let next: SocketLike;
    try {
      next = factory(options.url);
    } catch {
      // The WebSocket constructor throws on a malformed URL — an out-of-range
      // port typed into the OBS browser source is enough. Left unhandled, it
      // escapes the caller and stops the overlay from mounting at all.
      setStatus('unreachable');
      return;
    }
    socket = next;

    // Every handler checks that it still speaks for the live socket: a browser
    // fires onclose well after close() returns, and a stale event would
    // otherwise tear down the connection that replaced it.
    next.onmessage = (event) => {
      if (socket !== next) return;
      handle(event.data, next);
    };
    next.onerror = () => {
      if (socket !== next) return;
      // onerror fires before onclose when OBS is killed. Reporting the generic
      // failure here would win the race and hide the accurate one.
      setStatus(lostConnection());
    };
    next.onclose = (event) => {
      if (socket !== next) return;
      socket = null;
      settlePending();
      setStatus(event?.code === AUTH_FAILED_CODE ? 'auth-failed' : lostConnection());
    };
  }

  return {
    connect() {
      attempts = 0;
      lastAttemptAt = Number.NEGATIVE_INFINITY;
      openSocket();
    },
    ensureConnected(now) {
      // A refused password will be refused again: retrying on every report
      // would hammer OBS ~50 times a second for nothing. Only an explicit
      // connect(), carrying a new password, clears this.
      if (status === 'auth-failed') return;
      if (socket) return;
      if (now - lastAttemptAt < retryDelay()) return;

      lastAttemptAt = now;
      attempts += 1;
      openSocket();
    },
    broadcast(message) {
      if (status !== 'identified') return false;
      // A constant requestId: we never await a reply to BroadcastCustomEvent,
      // and correlating replies we ignore would buy nothing.
      send({
        op: 6,
        d: {
          requestType: 'BroadcastCustomEvent',
          requestId: 'he',
          requestData: { eventData: envelope(message) },
        },
      });
      return true;
    },
    request(requestType, requestData = {}) {
      if (status !== 'identified') return Promise.resolve(NO_ANSWER);
      // `r` + counter: never collides with the constant 'he' the broadcast uses.
      const requestId = `r${nextRequestId++}`;
      return new Promise((resolve) => {
        pending.set(requestId, resolve);
        send({ op: 6, d: { requestType, requestId, requestData } });
      });
    },
    close() {
      fail('idle');
    },
    get status() {
      return status;
    },
  };
}
