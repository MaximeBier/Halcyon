<script lang="ts">
  import { ListChecks, Redo2, Undo2 } from './icons';
  import { fitHeader, type Fold } from './header-fold';
  import { untrack, tick } from 'svelte';
  import { createKeyboardLink, type KeyboardStatus } from '../keyboard/device';
  import {
    createObsClient,
    DEFAULT_OBS_PORT,
    EVENT_GENERAL,
    EVENT_SCENES,
    EVENT_TRANSITIONS,
    normalizePort,
    type ObsClient,
    type ObsStatus,
  } from '../transport/obs';
  import { createCaptureSession } from './session';
  import {
    loadSettings,
    saveSettings,
    overlayUrl,
    browserStorage,
    createObsProbe,
    type ObsProbeStatus,
  } from './settings';
  import { createOverlayRegistry } from './overlays';
  import { createConfigBroadcaster } from './broadcast';
  import { newPageId } from '../protocol/identity';
  import { learnedByStopPress, learnKeys } from './learn';
  import { keysOutside, pickedFromList, removeKey, removeKeys, surfaceOf } from './layout';
  import { loadLayoutMap, resolveLayout, type LayoutMapLike } from '../keyboard/labels';
  import { setLayoutOverride } from '../config/edit';
  import { createAxisSuggester } from './suggest';
  import { hasGlobalOverrides, resolve } from '../config/resolve';
  import { recommendedSize } from '../view/scene';
  import KeyLearner from './KeyLearner.svelte';
  import Tooltip from './Tooltip.svelte';
  import LayoutEditor from './LayoutEditor.svelte';
  import StylePanel from './StylePanel.svelte';
  import KeyList from './KeyList.svelte';
  import { needsAttention } from './attention';
  import { provideInstalledFonts } from './installed-fonts-state.svelte';
  import { createProfileStore } from '../config/storage';
  import type { OverlayConfig } from '../config/schema';
  import StatusBar from './StatusBar.svelte';
  import Wizard from './Wizard.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import Unsupported from './Unsupported.svelte';
  import { copyToClipboard } from './clipboard';
  import {
    createJournal,
    describeAnomaly,
    hexDump,
    keyboardLine,
    obsLine,
    type JournalEntry,
  } from './journal';
  import { createStreamProbe, type StreamReading } from './probe';
  import {
    completesSetup,
    handsOverToEditor,
    loadStatus,
    nextStep,
    saveStatus,
    showsResume,
    showsWizard,
    stepNumber,
    type WizardStatus,
  } from './wizard';
  import ProfileBar from './ProfileBar.svelte';
  import SettingsMenu from './SettingsMenu.svelte';
  import ObsPopover from './ObsPopover.svelte';
  import Sheet from './Sheet.svelte';
  import StartupPopover from './StartupPopover.svelte';
  import { runsStandalone, watchInstall, type InstallWatch } from './startup';
  import Toast from './Toast.svelte';
  import { deletionToast, loadToast, type Notice } from './notice';
  import { createHistory } from './history';
  import { createProfileActions } from './profile-actions';
  import SceneLinks from './SceneLinks.svelte';
  import { sceneRows } from './scenes';
  import { createSceneFollower, type SceneFollower, type SceneState } from './scene-follow';
  import { reloadLog, reloadSources, scanSources, type HalcyonSource } from './sources';
  import type { DecodeAnomaly } from '../keyboard/decode';
  import type { FrameKey, MissingFont } from '../protocol/messages';

  const storage = browserStorage();
  /** The global panel, which Diagnostics' Change font opens at its Label group. */
  let stylePanel = $state<{ reveal(group: 'label'): void } | null>(null);

  let settings = $state(loadSettings(storage));
  let keyboardStatus = $state<KeyboardStatus>('disconnected');
  /** The product name of the keyboard that answered: the keyboard pill, and the wizard's first step. */
  let keyboardName = $state<string | null>(null);
  let obsStatus = $state<ObsStatus>('idle');
  let frame = $state<readonly FrameKey[]>([]);

  const profiles = createProfileStore(storage);
  // Read once, before the rune: this is the startup value, not a subscription.
  const openedName = profiles.active();
  let profile = $state(openedName);
  let profileNames = $state(profiles.list());

  const opened = profiles.load(openedName);
  let config = $state(opened.config);

  /** Replaced, never queued: the last thing said is the one that matters. */
  let toast = $state<Notice | null>(loadToast(opened.problem));

  /**
   * The pile behind the door (`history.ts`) holds no runes of its own — it
   * is plain data, like the rest of this module — so the two header buttons
   * cannot read it directly and expect Svelte to notice when it moves.
   * `historyVersion` is the one signal every mutation bumps (see
   * `history.version()`); `canUndo` and `canRedo` below both key off it and
   * nothing else, so there is exactly one point of truth for whether the
   * pile changed, however many places changed it.
   */
  const history = createHistory<OverlayConfig>();
  let historyVersion = $state(history.version());
  const canUndo = $derived.by(() => {
    void historyVersion;
    return history.canUndo();
  });
  const canRedo = $derived.by(() => {
    void historyVersion;
    return history.canRedo();
  });
  /**
   * What the hidden status line beside the buttons reads out.
   *
   * A dedicated region rather than the toast: ten Ctrl+Z in a row would queue
   * ten toasts, while this replaces itself in silence. Polite, never
   * assertive — it follows, it does not interrupt (the KeyLearner rule).
   */
  let announced = $state('');

  let learning = $state(false);
  /**
   * The last key learned, and when — plain data, read only when learning
   * stops. Learning fires below the firmware's actuation on purpose
   * (`LEARN_TRAVEL_THRESHOLD`), so the Escape pressed to stop the capture is
   * learned by the analog stream *before* its `keydown` stops anything. That
   * key was never asked for; the effect below takes it back.
   */
  let lastLearned: { id: number; usage: number; at: number } | null = null;

  $effect(() => {
    if (learning) return;
    if (!learnedByStopPress(lastLearned, performance.now())) return;
    takeBack(lastLearned!.id);
    lastLearned = null;
  });

  /**
   * Removes a key learned by mistake, through the undo pile rather than
   * around it: the add is the top of the pile, so popping it leaves no
   * add-then-remove pair for Ctrl+Z to walk back through. If something else
   * has moved the pile since — it cannot within the grace window, but the
   * pile is checked rather than trusted — the key is removed the ordinary
   * way instead.
   */
  function takeBack(id: number) {
    const previous = history.undo(config);
    if (previous === null) return;
    const onlyThatKey =
      previous.keys.length === config.keys.length - 1 &&
      !previous.keys.some((key) => key.id === id) &&
      previous.keys.every((key) => config.keys.includes(key));
    if (onlyThatKey) {
      restore(previous);
      return;
    }
    history.redo(previous);
    updateConfig(removeKey(config, id));
  }

  let selectedIds = $state<number[]>([]);
  /**
   * Where the next shift-range in the keys list reaches from (spec §16.5).
   *
   * A key id, not an index: rows shift when keys are deleted, and
   * `pickedFromList` already treats a deleted anchor as none at all.
   */
  let keysAnchor = $state<number | null>(null);
  /** The stage component, for the list's door into its popover. */
  let editor = $state<ReturnType<typeof LayoutEditor>>();

  function pickKey(id: number, event: MouseEvent) {
    // `detail` is 0 when the activation came from the keyboard: Enter has no
    // double click to follow it up with, so it opens the popover directly —
    // the same door Enter is on a stage handle.
    if (event.detail === 0) {
      editor?.open(id);
      keysAnchor = id;
      return;
    }
    const pick = pickedFromList(
      config.keys.map((key) => key.id),
      selectedIds,
      keysAnchor,
      id,
      { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
    );
    selectedIds = pick.ids;
    keysAnchor = pick.anchor;
  }
  /**
   * The editor's stage, in pixels — measured there, read here.
   *
   * Learning a key places it, and a placement has to land on the work surface
   * (task 31). This page cannot measure a stage it does not own, so the box
   * comes back out of the editor and both sides derive the surface from it.
   */
  let stageBox = $state({ width: 0, height: 0 });
  let layout = $state<LayoutMapLike | null>(null);
  void loadLayoutMap(navigator).then((map) => (layout = map));

  // What the labels are actually read from: the explicit choice always beats
  // detection, which is the only reason the choice exists (spec §8.6).
  const activeLayout = $derived(resolveLayout(config.layoutOverride, layout));

  // The packed size, which is the only one worth quoting: the raw box has an
  // empty top and left by construction (spec §5.4).
  const size = $derived(recommendedSize(resolve(config)));

  /**
   * The keys that are off the work surface, and therefore off the screen.
   *
   * The stage does not scroll, so the surface is all there is: a key out here
   * is drawn nowhere, and **this list is the only thing that can say it
   * exists**. Three ways out need no mistake at all — shrinking the window,
   * raising `unit` (the surface is measured in key units, so it shrinks too),
   * importing a profile with distant coordinates.
   *
   * Nothing is claimed before the stage has been measured: unmeasured, the
   * surface falls back to its 12 × 8 floor, which most layouts overflow, and
   * every load would mark half the keys on its first frame. The honest answer
   * then is that nothing is known yet.
   */
  const offscreen = $derived(
    stageBox.width > 0 && stageBox.height > 0
      ? keysOutside(config, surfaceOf(stageBox, config.style.unit))
      : [],
  );

  const suggester = createAxisSuggester();

  /**
   * Bumped when the suggester learns something, and read by the list below.
   *
   * Its three sets are plain data, so nothing about them is reactive. Polling
   * them on every report is not an option either: reports arrive at up to a
   * thousand a second and the answer changes perhaps twice a session.
   */
  let observed = $state(0);

  /**
   * The configured keys the suggester currently speaks for.
   *
   * Derived, never cached — and that is the fix for a real defect. The first
   * version kept a snapshot refreshed only when the suggester learned
   * something, which lost exactly the keys that matter: adding a key means
   * pressing it, so it reaches full travel *before* it exists in
   * `config.keys`. The refresh then filtered a list without it, and every
   * later press taught the suggester nothing new — so it never spoke again.
   * Reading `config` here means the list also follows a key being added.
   */
  const suggestedIds = $derived.by(() => {
    void observed;
    return config.keys.map((key) => key.id).filter((id) => suggester.suggests(id));
  });

  /**
   * How many overlays are listening, and from where.
   *
   * Two figures rather than one since 2026-08-23: opening `overlay.html` in a
   * tab to check that it works is an overlay, so the total could no longer say
   * whether the one in OBS was among them (spec §16.7).
   */
  let listeners = $state({ inObs: 0, inBrowser: 0 });
  /** Families the live overlays say they cannot draw (Diagnostics, and the ⚙ dot). */
  let missingFonts = $state<MissingFont[]>([]);

  // One reading of the fonts installed here, for the global panel and the key
  // popover alike: a permission granted in one is granted in the other.
  provideInstalledFonts();

  /** The scene table as the follower last reported it; mirrored into a rune for the popover. */
  let sceneState = $state<SceneState>({ scenes: null, live: null, links: [] });
  /** Our browser sources as OBS listed them at the last scan, or null while not connected. */
  let sources = $state<HalcyonSource[] | null>(null);
  /** The one-shot auto-reload of spec §2.3: once per session, whatever the version heard. */
  let reloadedForForeign = false;

  /**
   * This page's own name, signed onto every `config` and every `frame` it
   * sends. Drawn once, and never again: a second draw would make the page a
   * stranger to its own broadcast.
   */
  const captureId = newPageId('capture');
  /**
   * Whether another capture page has been heard broadcasting.
   *
   * Tabs left open all publish onto the same bus, and the overlay obeys
   * whichever spoke last — a fault in which every page looks entirely correct.
   * A flag rather than a count, and one that comes back down: the other pages
   * answer every overlay beat, so three beats of silence, or a `gone`, and
   * they are no longer counted — see `ConfigBroadcaster.hasOtherCapture`.
   * Written by the broadcaster's transitions, never read back from it.
   */
  let otherCapture = $state(false);

  /**
   * Everything worth writing down, for the report nobody can write blind
   * (spec §11). Mirrored into state because the journal is plain data: it is
   * appended to from four event handlers and read by one panel.
   */
  const journal = createJournal();
  let log = $state<readonly JournalEntry[]>([]);
  /**
   * What Diagnostics asks someone to look at (spec §11): a font the PC running
   * OBS lacks — the overlay draws on, in Archivo, and nothing on air would
   * ever say so — and a layout forced by hand. These light the gear's dot;
   * the journal, read under Activity, does not.
   */
  const attention = $derived(needsAttention(config.layoutOverride, missingFonts));

  function note(kind: 'user' | 'bug', message: string) {
    journal.add(kind, message, performance.now());
    log = journal.entries();
  }

  /**
   * The live reading — a function, not a derived value.
   *
   * It follows `frame`, which the session's preview emitter caps at sixty a
   * second — a bound the session enforces, not a figure the keyboard happens
   * to respect. Passed as a
   * function, it is only ever called from inside the fold's body, so a shut
   * fold reads no frame at all and the capture page never competes with its
   * own broadcast over a list nobody can see.
   */
  function readings() {
    return config.keys.map((key) => {
      const seen = frame.find(([id]) => id === key.id);
      return { id: key.id, label: key.label, travel: seen?.[1] ?? 0, active: seen?.[2] === 1 };
    });
  }

  let capturing = $state(false);
  let snapshot = $state<string | null>(null);
  /** The Diagnostics sheet, opened from the ⚙ menu and nowhere else. */
  let diagnosticsOpen = $state(false);

  /**
   * Whether this page runs in the installed window. Read once: a page does
   * not move between a tab and an app window while it is open.
   */
  const standalone = runsStandalone(globalThis.matchMedia?.bind(globalThis));
  /**
   * Chrome's install prompt, held from the first moment of the page (see
   * `watchInstall`): the guide that spends it is not mounted while the setup
   * wizard has the page, and the prompt fires once.
   */
  let install = $state<InstallWatch>({ prompt: null, installed: false });
  watchInstall(window, (next) => (install = next));

  async function installApp() {
    const held = install.prompt;
    // Cleared before the ask, not after: the browser allows one call ever, and
    // a second click during the dialog must find no button to press.
    install = { ...install, prompt: null };
    await held?.prompt();
  }

  /**
   * A probe on the report stream, never on a clock (global constraint 1).
   * Its reading is refreshed on emitted frames rather than on reports: reports
   * arrive at up to a thousand a second, and re-rendering at that rate is the
   * stutter this page exists to avoid.
   */
  const streamProbe = createStreamProbe();
  let probing = $state(false);
  let probeReading = $state<StreamReading | null>(null);

  function toggleProbe() {
    if (streamProbe.running) streamProbe.stop(performance.now());
    else streamProbe.start(performance.now());
    probing = streamProbe.running;
    probeReading = streamProbe.reading();
    note('user', probing ? 'Background probe started.' : 'Background probe stopped.');
  }

  /**
   * A throwaway connection, opened to answer one question: are the port and
   * password as typed good, *now*?
   *
   * Separate from the live client on purpose. That one carries a reconnection
   * backoff, so after a few failures it answers "not yet" rather than "no" —
   * which is the wrong answer to someone who has just retyped a password.
   *
   * The guard against two of these running at once, and against one left open
   * forever by a server that never finishes its handshake, lives in
   * `createObsProbe` (`settings.ts`) rather than here — both are pure enough
   * to unit-test with a fake socket, which a `<script>` block wired straight
   * to component state is not.
   */
  let obsProbe = $state<ObsProbeStatus | null>(null);

  const obsProbeRunner = createObsProbe({
    connectOptions: () => ({ url: `ws://localhost:${port}`, password: settings.password }),
    onStatus: (status) => {
      obsProbe = status;
      if (status && status !== 'testing') note('user', `OBS probe: ${status}.`);
    },
  });

  function testObs() {
    obsProbeRunner.run();
  }

  const overlays = createOverlayRegistry();

  let setup = $state<WizardStatus>(loadStatus(storage));
  const step = $derived(
    nextStep({
      keyboard: keyboardStatus,
      obs: obsStatus,
      overlaysInObs: listeners.inObs,
      keyCount: config.keys.length,
    }),
  );
  const wizardOpen = $derived(showsWizard(setup, step));
  const canResume = $derived(showsResume(setup, step));

  /**
   * Written down the moment the keys are reached, whether the wizard was
   * followed or skipped (`completesSetup`). Without it, an OBS restart the
   * next evening reopens a setup that was finished weeks ago — `nextStep`
   * reads the world, not history.
   *
   * From the open wizard, reaching the keys is the wizard handing over
   * (board 4a): it closes, and the editor opens with the capture already
   * armed onto an empty stage that says what to press. Read before the write,
   * since the write is what makes it false.
   */
  $effect(() => {
    if (!completesSetup(setup, step)) return;
    const handingOver = handsOverToEditor(setup, step);
    remember('done');
    if (handingOver) learning = true;
  });

  function remember(status: WizardStatus) {
    setup = status;
    saveStatus(storage, status);
  }

  /**
   * A synchronous reading, not a timer: allowed on the capture page.
   *
   * Called on every emitted frame (60/s) and every overlay message, so a
   * fresh object assigned whether or not the count moved would invalidate
   * every derived that reads `listeners` for no reason, sixty times a
   * second. `OverlayCounts` is two numbers — comparing them by hand is
   * cheap where a deep-equal (or a JSON round trip) would not be, and is the
   * whole reason this stays a plain `if` rather than some general-purpose
   * helper.
   */
  function refreshOverlays() {
    const now = performance.now();
    const missing = overlays.missingFonts(now);
    // Compared as text for the reason the counts are compared by hand below.
    if (JSON.stringify(missing) !== JSON.stringify(missingFonts)) missingFonts = missing;
    const next = overlays.counts(now);
    if (next.inObs !== listeners.inObs || next.inBrowser !== listeners.inBrowser) {
      // An overlay in OBS saying hello is a source that was not there at the
      // last scan: the bus event *is* the moment the count changed, which is
      // how the row keeps up with OBS without a timer (constraint 1).
      const appeared = next.inObs > listeners.inObs;
      listeners = next;
      if (appeared) void scanObsSources();
    }
  }

  // An empty number field binds to null, and `ws://localhost:null` throws
  // inside the WebSocket constructor. The displayed URL has to survive that
  // half-typed state too, so it reads the normalized port rather than the field.
  let port = $derived(normalizePort(settings.port));
  let url = $derived(overlayUrl(location.origin, { port, password: settings.password }));

  // Declared before the client, assigned after `profileActions`: the client
  // only reaches it from callbacks that cannot run before `connect()`.
  let sceneFollower: SceneFollower;

  /** `scanSources` on this page's origin: a dev tab never touches production sources. */
  async function scanObsSources() {
    // The scan is a dozen sequential requests; OBS can go away, or the client
    // be rebuilt on a new password, before the last one answers. A result
    // from a connection that no longer exists must not land in the row that
    // says what OBS has *now*.
    const client = obs;
    const found = await scanSources((type, data) => client.request(type, data), location.origin);
    if (client !== obs || client.status !== 'identified') return;
    sources = found;
  }

  /** Shared by the OBS popover, Diagnostics, and the foreign-protocol path. */
  async function reloadObsSources(): Promise<number> {
    // Always look again first. A click on Reload is also a "look again", and
    // the wizard connects OBS *before* the source exists, so a count frozen
    // at identify would read 0 for the whole first session. It also covers
    // the foreign-protocol path firing before the first scan answered: press
    // nothing then and the session never retries.
    await scanObsSources();
    const found = sources ?? [];
    const reloaded = await reloadSources(
      (type, data) => obs.request(type, data),
      found.map((s) => s.name),
    );
    note('user', reloadLog(reloaded, found.length));
    return reloaded;
  }

  function createClient(): ObsClient {
    return createObsClient({
      url: `ws://localhost:${untrack(() => port)}`,
      password: untrack(() => settings.password),
      // Scenes for the late signal, Transitions for the early one: the profile
      // has to change with the first frame of the fade, not the last (spec §4).
      eventSubscriptions: EVENT_GENERAL | EVENT_SCENES | EVENT_TRANSITIONS,
      onEvent: (type, data) => sceneFollower.onEvent(type, data),
      onStatus: (s) => {
        obsStatus = s;
        note('user', obsLine(s));
        // Nothing left while the socket was down, and an overlay on the other
        // side may have been waiting the whole time.
        if (s === 'identified') {
          broadcaster.onIdentified();
          void sceneFollower.refresh();
          void scanObsSources();
        }
        if (s !== 'identified') {
          sceneFollower.disconnected();
          sources = null;
          // Nobody is reachable through a dead socket, and expiry is only
          // computed on read: a count left standing would never come down.
          overlays.clear();
          refreshOverlays();
          // The other capture pages likewise. Quietly: they went nowhere, and
          // the first beat after reconnecting hears them again.
          broadcaster.onDisconnected();
          otherCapture = false;
        }
      },
      onForeignVersion: (version) => {
        // Almost always an overlay left open across a deployment. Since
        // 2026-09-15 the page reloads the sources itself, once: OBS can be
        // told to, and asking someone to do it by hand was the one step of
        // the diagnosis the page could not do for them (spec §2.3).
        if (reloadedForForeign) {
          note('user', `An overlay is running protocol v${version}; reload it.`);
          return;
        }
        reloadedForForeign = true;
        void reloadObsSources().then((reloaded) => {
          note(
            'user',
            reloaded > 0
              ? `An overlay ran protocol v${version}. Sources reloaded.`
              : `An overlay is running protocol v${version}; reload it.`,
          );
        });
      },
      onMessage: (message) => {
        // Presence and configuration are both driven by these three messages,
        // so one place reads them (spec §6).
        broadcaster.onOverlayMessage(message, performance.now());
        // The probe's figure ages on the same clock. With the preview capped,
        // a stream the configuration filters out entirely no longer calls
        // `onKeys`, and the reading would sit still while the probe runs.
        if (probing) probeReading = streamProbe.reading();
        // Spec §6: a fresh overlay holds nothing, and the emitter would
        // otherwise deduplicate its way to a blank page until the next
        // keystroke.
        if (message.t === 'hello') session.resend(performance.now());
        // Every beat gets the current frame back (throttled): a capture that
        // answers is one the overlay may keep trusting, and one that stops —
        // closed, crashed, tab discarded — leaves the overlay free to fall
        // back to rest instead of drawing a dead page's last key on air.
        if (message.t === 'beat') session.pulse(performance.now());
        refreshOverlays();
      },
    });
  }

  let obs: ObsClient = createClient();

  const broadcaster = createConfigBroadcaster({
    obs: { broadcast: (message) => obs.broadcast(message) },
    current: () => config,
    registry: overlays,
    from: captureId,
    onRivals: (present) => {
      otherCapture = present;
      // In the journal as well as in the status bar, and worded differently on
      // purpose: the bar tells someone what to do, this line timestamps it, for
      // the report written hours later about an overlay that changed on its own.
      // Both transitions, so the report also says when the fight ended.
      note(
        'user',
        present
          ? 'Another capture page was heard broadcasting.'
          : 'The other capture pages are gone. Configuration resent.',
      );
    },
  });

  // A reload draws a new name, so leaving in silence would have the other
  // pages count the departed page next to the one replacing it for three more
  // beats. `pagehide` rather than `beforeunload`, as on the overlay: it also
  // fires when the page is frozen into the back/forward cache, and it is the
  // event browsers actually guarantee.
  addEventListener('pagehide', () => broadcaster.leave());

  /**
   * Credentials are persisted and the client rebuilt, never patched: url and
   * password are read once, when the socket opens. A password typed after the
   * client was built is the milestone 1 defect that made authentication
   * impossible to satisfy.
   */
  function reconnect() {
    settings.port = port;
    saveSettings(storage, settings);
    obs.close();
    obs = createClient();
    obs.connect();
  }

  /**
   * The one door every configuration change goes through — learning, moving,
   * styling, mode. Persisting without broadcasting, or the reverse, is the
   * failure this shape makes unwritable. The undo pile hangs on the same
   * hinge, so no change can escape it either.
   */
  function updateConfig(next: OverlayConfig) {
    // The reference is the contract: helpers hand back the same object to say
    // "nothing changed", and what did not change deserves no undo entry, no
    // write and no broadcast.
    if (next === config) return;
    // Read before the pile moves; the toast's Undo is the ordinary undo.
    const deleted = deletionToast(config, next, undo);
    history.push(config);
    apply(next);
    historyVersion = history.version();
    if (deleted) toast = deleted;
  }

  /** The door's second half, shared with undo and redo: write, save, broadcast. */
  function apply(next: OverlayConfig) {
    config = next;
    profiles.save(profile, config);
    broadcaster.publish(config);
  }

  function undo() {
    const previous = history.undo(config);
    // Only the shortcut arrives here empty — the button is disabled — and the
    // sighted answer (a greyed-out button) deserves its spoken counterpart.
    if (previous === null) {
      announced = 'Nothing to undo';
      return;
    }
    restore(previous);
    announced = 'Change undone';
  }

  function redo() {
    const next = history.redo(config);
    if (next === null) {
      announced = 'Nothing to redo';
      return;
    }
    restore(next);
    announced = 'Change redone';
  }

  function restore(state: OverlayConfig) {
    apply(state);
    historyVersion = history.version();
    // Pruned, never guessed at: the popover already closes itself when its
    // selection is gone, and a selection of keys that no longer exist would
    // hand "Delete N selected keys" a set nobody chose.
    selectedIds = selectedIds.filter((id) => config.keys.some((key) => key.id === id));
  }

  function onHistoryKey(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const wantsUndo = key === 'z' && !event.shiftKey;
    const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
    if (!wantsUndo && !wantsRedo) return;
    // A field's own history comes first: Ctrl+Z over a half-typed label is the
    // field's native undo, and no preventDefault either — the field must
    // receive the keystroke untouched. (A value already committed on blur is
    // undone by Ctrl+Z *outside* the field, which is the expected reading.)
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    // Mid-gesture the draft still holds the old layout, and its commit on
    // release would write right over whatever was just restored.
    if (editor?.gesturing()) return;
    event.preventDefault();
    if (wantsUndo) undo();
    else redo();
  }

  /**
   * The profile CRUD — open / create / duplicate / rename / remove / import /
   * download — lives in `profile-actions.ts`: one coherent unit (store,
   * toast, history.clear, broadcast) that touches App's runes only
   * through the getters and setters handed in here. This component owns the
   * reactivity; the module owns the sequencing.
   */
  const profileActions = createProfileActions({
    store: profiles,
    broadcaster,
    current: () => ({ profile, config }),
    setProfile: (name) => (profile = name),
    setConfig: (next) => (config = next),
    setProfileNames: (names) => (profileNames = names),
    setToast: (notice) => (toast = notice),
    resetSelection: () => {
      selectedIds = [];
      keysAnchor = null;
    },
    clearHistory: () => {
      history.clear();
      historyVersion = history.version();
    },
    download: (fileName, content) => {
      const blob = new Blob([content], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href, download: fileName });
      link.click();
      URL.revokeObjectURL(href);
    },
    // Closures, evaluated at the click: `sceneFollower` is assigned just below.
    onRenamed: (from, to) => sceneFollower.profileRenamed(from, to),
    onRemoved: (name) => sceneFollower.profileRemoved(name),
  });

  // `openProfile` may post a `loadToast`, which `setToast` then replaces with
  // the scene toast: wanted, the second is the more useful of the two.
  sceneFollower = createSceneFollower({
    request: (type, data) => obs.request(type, data),
    storage,
    profiles: () => profileNames,
    currentProfile: () => profile,
    openProfile: (name) => {
      const notice = profileActions.openProfile(name);
      toast = notice;
      // The scene toast replaces this one on screen a moment later; a profile
      // that failed to load has to survive that, so the journal keeps it.
      if (notice) note('user', notice.message);
    },
    setToast: (notice) => (toast = notice),
    note: (message) => note('user', message),
    onChange: (state) => (sceneState = state),
  });

  /**
   * The one caller that needs `openProfile`'s return value: every other
   * action decides its own toast, but a plain switch has none of its own to
   * show beyond whatever `openProfile` found wrong with the profile it
   * opened.
   */
  function switchProfile(name: string) {
    toast = profileActions.openProfile(name);
  }

  /**
   * Whether the global style has been touched at all — §9.3's marker.
   *
   * Not applied to the port and password, which the fold above once carried:
   * a password is mandatory for the thing to work, so the dot would be lit
   * from the first minute and for ever. A marker that is always on says
   * nothing, and teaches people to stop reading markers.
   */
  const styled = $derived(hasGlobalOverrides(config.style));

  /**
   * How far the header folds to stay on one line (`header-fold.ts`, board
   * Editor-HeaderNarrow): measured against the header as drawn, so the longer
   * error pills fold it sooner. Refitted when the window changes the header's
   * width (observed — the header's own size does not move with the fold, so
   * the observer never feeds itself) and when what the pills say changes.
   * A newer fit makes an older one stop where it stands.
   */
  /**
   * The middle of the stage, in viewport pixels, for the toast to centre on
   * (spec §16.6): where the keys are laid out, the side panel left out. Side
   * by side that is left of the window's middle; stacked, the stage spans the
   * window and the two agree. Observed, never a timer; `null` without a stage.
   */
  let stageEl = $state<HTMLElement | null>(null);
  let toastCenter = $state<number | null>(null);
  $effect(() => {
    const el = stageEl;
    if (!el) {
      toastCenter = null;
      return;
    }
    const measure = () => {
      const box = el.getBoundingClientRect();
      toastCenter = box.left + box.width / 2;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  /**
   * The OBS pill's popover, the whole OBS interface since board 3a, and what
   * opened it: the pill, or Settings › OBS connection. One popover, two ways
   * in, and it hangs from the one that was clicked (board Editor-Settings).
   */
  let obsOpen = $state<'pill' | 'settings' | null>(null);

  let fold = $state<Fold>(1);
  let bar = $state<HTMLElement | null>(null);
  let lead = $state<HTMLElement | null>(null);
  let fitting = 0;
  async function refit() {
    if (!bar || !lead) return;
    const run = ++fitting;
    await fitHeader(
      async (next) => {
        if (run !== fitting) return;
        fold = next;
        await tick();
      },
      () =>
        run === fitting &&
        !!bar &&
        !!lead &&
        (lead.scrollWidth > lead.clientWidth ||
          bar.scrollWidth > bar.clientWidth ||
          // The run of pills may shrink (to be cut at 5 and 7): squeezed, it
          // spilled under Resume inside the left block, which itself did not
          // overflow. A child spilling out of its own box is an overflow too.
          [...lead.children].some((child) => child.scrollWidth > child.clientWidth + 1)),
    );
  }
  $effect(() => {
    if (!bar) return;
    const observer = new ResizeObserver(() => void refit());
    observer.observe(bar);
    // A face that lands after the first measure changes the words' width, not
    // the bar's: no resize announces it, and the header stayed folded for
    // nothing, or spilled, until the window moved.
    const onFonts = () => void refit();
    document.fonts?.addEventListener('loadingdone', onFonts);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', onFonts);
    };
  });
  // What the pills say: "OBS disconnected" or a second capture page is wider
  // than "OBS", and folds the header sooner.
  $effect(() => {
    void [keyboardStatus, keyboardName, obsStatus, otherCapture, canResume];
    untrack(() => void refit());
  });

  /** See `clipboard.ts`: the copy can silently not happen, and used to lie. */
  async function copyUrl(): Promise<boolean> {
    const copied = await copyToClipboard(navigator, url);
    // The journal is what goes into a bug report. A line claiming the URL
    // was copied when it was not sends whoever reads it down the wrong path.
    note(
      'user',
      copied
        ? 'Overlay URL copied.'
        : 'Overlay URL could not be copied. Select the URL and copy it by hand.',
    );
    return copied;
  }

  /**
   * One warning per anomaly kind and per session. A wrong assumption about
   * report length would otherwise emit `bad-length` on every single report —
   * hundreds a second, enough to lock up the devtools. The readable log is
   * task 26.
   */
  const warned = new Set<DecodeAnomaly['kind']>();

  function warnOnce(anomaly: DecodeAnomaly) {
    if (warned.has(anomaly.kind)) return;
    warned.add(anomaly.kind);
    note('bug', describeAnomaly(anomaly));
  }

  const session = createCaptureSession({
    // Indirection through the current client: the session outlives any single
    // connection, and keeps working across a port or password change.
    obs: {
      broadcast: (message) => obs.broadcast(message),
      ensureConnected: (now) => obs.ensureConnected(now),
    },
    from: captureId,
    // Only the configured keys travel: the overlay filters nothing (spec §6).
    selectedIds: () => config.keys.map((key) => key.id),
    onEntries: (entries) => {
      // Before the learning guard: a key is watched from the moment it is
      // seen, not from the moment someone happens to be adding one.
      if (suggester.observe(entries)) observed += 1;
      if (!learning) return;
      // The same surface the editor draws on, derived from the same box and
      // the same unit: a key learned onto a surface the stage does not have
      // would land where nobody can reach it.
      const next = learnKeys(config, entries, activeLayout, surfaceOf(stageBox, config.style.unit));
      // The mode is never closed here: it stays armed until it is stopped, so
      // a whole layout can be captured in one pass. `learnKeys` hands the same
      // configuration back when a report adds nothing — a key held down, or
      // one already placed — which is what keeps the thousands of reports a
      // single press produces from reaching `updateConfig`.
      if (next === config) return;
      // Read from the result, not from the report: what was added is the
      // layout's business, and the Escape guard above needs the usage.
      const before = config.keys.map((key) => key.id);
      const added = next.keys.filter((key) => !before.includes(key.id)).at(-1);
      if (added) lastLearned = { id: added.id, usage: added.usage, at: performance.now() };
      updateConfig(next);
    },
    onKeys: (k) => {
      frame = k;
      // Refreshed here, not in the report handler: this runs at the emission
      // rate, which is bounded, and nothing about the figures needs to be
      // fresher than what the eye can read.
      if (probing) probeReading = streamProbe.reading();
      // Expiry is computed on read, so an overlay that went away only stops
      // being counted once something asks. Without this it would linger until
      // another overlay beats — and if it was the only one, forever.
      refreshOverlays();
    },
    onAnomaly: warnOnce,
  });

  const link = createKeyboardLink({
    hid: navigator.hid,
    onReport: (data, timestamp) => {
      // The only place the raw bytes exist. Latched once: an unknown keyboard
      // is identified from one report, and rewriting it a thousand times a
      // second would leave nothing readable on screen.
      if (capturing) {
        snapshot = hexDump(data);
        capturing = false;
        note('user', 'Raw report captured.');
      }
      streamProbe.observe(timestamp);
      session.handleReport(data, timestamp);
    },
    onStatus: (status, name) => {
      // Read before the assignment below overwrites it: only a keyboard that
      // was connected can have left a key mid-press. A key unplugged that way
      // never sends its own release, so the rest frame goes out on its behalf
      // — without it the overlay draws the key pressed until the freshness
      // watch times the whole capture out.
      if (keyboardStatus === 'connected' && status !== 'connected') session.rest(performance.now());
      const previous = keyboardName;
      keyboardStatus = status;
      keyboardName = name;
      note('user', keyboardLine(status, name, previous));
    },
  });

  // Nothing to do on switching the machine on (spec §10): a keyboard already
  // authorised resumes without a gesture, and the credentials come from the
  // previous session.
  void link.resume();
  obs.connect();
</script>

<!--
  The four zones of board `3a`: a 54 px header, the profile tabs, the stage,
  and a 380 px panel. The rare settings live behind the header's ⚙ rather
  than in a footer under the panel, where §9.3 still governs what the gear
  says about them.
-->
<!-- On the window, not the stage: the history covers the whole document —
     styles and imports included — so the shortcut has to work wherever the
     hands happen to be. -->
<svelte:window onkeydown={onHistoryKey} />

<!-- The mark and the name, so the window is recognisable in a taskbar full of
     Chrome — and the way back to the home page from a tab. Not a link inside
     the installed app: an app window has no home page to go back to, and a
     click there would swap the capture for a landing page mid-stream. -->
<!-- The word goes first when the header runs short (board Editor-HeaderNarrow);
     the mark stays, and the setup's header, which has the page to itself,
     keeps both. -->
{#snippet brand(word: boolean)}
  {#if standalone}
    <span class="brand">
      <img class="mark" src="/logo/halcyon-logo.svg" width="22" height="22" alt="" />
      {#if word}<span class="wordmark">HALCYON</span>{/if}
    </span>
  {:else}
    <Tooltip text="Halcyon home page">
      {#snippet children()}
        <a class="brand" href="/" aria-label="Halcyon home page">
          <img class="mark" src="/logo/halcyon-logo.svg" width="22" height="22" alt="" />
          {#if word}<span class="wordmark">HALCYON</span>{/if}
        </a>
      {/snippet}
    </Tooltip>
  {/if}
{/snippet}

<div class="app" class:workspace={!wizardOpen}>
  {#if wizardOpen}
    <!-- The setup has the page to itself (board 4a): the mark, and the card.
         Nothing else is mounted — the stage cannot be worked on until the
         keyboard answers, and the setup exists to get it there. -->
    <header class="bar">
      {@render brand(true)}
    </header>

    <!-- What cannot work here is the page, not one of its sections. It shows
         itself or nothing. -->
    <Unsupported keyboard={keyboardStatus} />

    <div class="welcome">
      <Wizard
        {step}
        keyboard={keyboardStatus}
        device={keyboardName}
        obs={obsStatus}
        overlaysInObs={listeners.inObs}
        {settings}
        {url}
        size={config.keys.length > 0 ? size : null}
        onAllowKeyboard={() => link.requestPermission()}
        onReconnect={reconnect}
        onSkip={() => remember('skipped')}
      />
    </div>
  {:else}
    <!-- Two blocks that never break inside (board Main, noteFluid): what the
         page is and what it is connected to on the left, what one does with it
         on the right. Too narrow for one line, the right block goes under,
         whole, aligned right. -->
    <header class="bar" data-fold={fold} bind:this={bar}>
      <div class="lead" bind:this={lead}>
        <!-- The mark and the name, so the window is recognisable in a taskbar
         full of Chrome. Decorative: the page's name is in the title. -->
        {@render brand(fold === 1)}

        <!-- The OBS pill is the whole OBS interface (board 3a): its popover
         carries the URL, the recommended size and the two credentials the
         sidebar fold used to. The size is only quoted once there is a key to
         pack — an empty layout has no size worth giving a browser source. -->
        <StatusBar
          keyboard={keyboardStatus}
          device={keyboardName}
          obs={obsStatus}
          overlays={listeners}
          {otherCapture}
          {url}
          size={config.keys.length > 0 ? size : null}
          {settings}
          sources={sources === null ? null : sources.length}
          onPickDevice={() => link.requestPermission()}
          onRetryObs={reconnect}
          onCopyUrl={copyUrl}
          onReloadSources={reloadObsSources}
          squeeze={fold >= 5}
          squeezeObs={fold >= 5}
          dots={fold >= 7}
          bind:obsOpen
        />

        {#if canResume}
          <!-- Amber, and in the header: findable long after the card was put
           aside, from any screen (board 6f). With the pills, on the left, and
           folding with the header (board Editor-HeaderNarrow): shorter at the
           fourth step, an icon at the sixth — its full name on hover then. -->
          <Tooltip
            text={fold >= 6
              ? `Resume setup · ${stepNumber(step)}/3`
              : fold >= 4
                ? 'Resume setup'
                : null}
          >
            {#snippet children()}
              <button
                class="resume"
                class:compact={fold >= 6}
                aria-label={fold >= 6 ? `Resume setup · ${stepNumber(step)}/3` : undefined}
                onclick={() => remember('open')}
              >
                {#if fold >= 6}
                  <ListChecks size={16} aria-hidden="true" />
                {:else if fold >= 4}
                  Setup · {stepNumber(step)}/3
                {:else}
                  Resume setup · {stepNumber(step)}/3
                {/if}
              </button>
            {/snippet}
          </Tooltip>
        {/if}
      </div>

      <div class="tools">
        <!-- Document-level controls. In the header because it is the one zone
         visible in every state of the page: wizard up, folds shut, popover
         gone — and the first need for undo comes when the selection has just
         disappeared, so nothing anchored to it can carry the button. -->
        <div class="edits">
          <!-- Icon buttons, named for a screen reader by their label and for
             the eye by the tooltip (board Editor-Tooltip), with the shortcut
             `onHistoryKey` binds (board OBS-5e-Header). -->
          <Tooltip text="Undo · Ctrl+Z">
            {#snippet children()}
              <button class="he-icon-btn" aria-label="Undo" disabled={!canUndo} onclick={undo}
                ><Undo2 size={16} /></button
              >
            {/snippet}
          </Tooltip>
          <Tooltip text="Redo · Ctrl+Y">
            {#snippet children()}
              <button class="he-icon-btn" aria-label="Redo" disabled={!canRedo} onclick={redo}
                ><Redo2 size={16} /></button
              >
            {/snippet}
          </Tooltip>
          <!-- The spoken half of the two buttons: it follows, it never interrupts. -->
          <p class="sr" role="status">{announced}</p>
        </div>

        <!-- Left of the startup guide (board 5e): the one setting someone comes
         back to after adding a scene in OBS, findable without the gear. -->
        <SceneLinks
          obs={obsStatus}
          rows={sceneRows(sceneState.scenes, sceneState.links, sceneState.live)}
          profiles={profileNames}
          onOpen={() => void sceneFollower.refresh()}
          onLink={(uuid, name) => sceneFollower.link(uuid, name)}
          onUnlink={(uuid) => sceneFollower.unlink(uuid)}
          compact={fold >= 3}
        />

        <!-- In the header for the same reason undo is: the guide must be findable
         from every state of the page, and it anchors to nothing on the stage. -->
        <StartupPopover {standalone} {install} onInstall={installApp} compact={fold >= 3} />

        <!-- Last, and the rarest: the layout override, the device picker, the
         door to Diagnostics and the build (board 3a). -->
        <SettingsMenu
          layout={config.layoutOverride}
          toCheck={attention.length}
          onLayout={(value) => updateConfig(setLayoutOverride(config, value, layout))}
          onPickDevice={() => link.requestPermission()}
          onDiagnostics={() => (diagnosticsOpen = true)}
          onCopyUrl={copyUrl}
          obsConnected={obsStatus === 'identified'}
          onObs={() => (obsOpen = 'settings')}
          obsOpen={obsOpen === 'settings'}
          onObsClose={() => (obsOpen = null)}
        >
          {#snippet obsPanel(close)}
            <ObsPopover
              obs={obsStatus}
              overlays={listeners}
              {url}
              size={config.keys.length > 0 ? size : null}
              {settings}
              sources={sources === null ? null : sources.length}
              onReconnect={reconnect}
              onCopy={copyUrl}
              onReload={reloadObsSources}
              onClose={close}
              align="end"
            />
          {/snippet}
        </SettingsMenu>
      </div>
    </header>

    <!-- A row of its own under the header (board 3a): every profile in view,
       switching is one click. The open profile's count is read live — it
       moves with every key learned — where the others' come from storage,
       which nothing can change while they are not on screen. -->
    <ProfileBar
      names={profileNames}
      active={profile}
      keyCount={(name) => (name === profile ? config.keys.length : profiles.keyCount(name))}
      onSelect={switchProfile}
      onCreate={profileActions.createProfile}
      onDuplicate={profileActions.duplicateProfile}
      onRename={profileActions.renameProfile}
      onRemove={profileActions.removeProfile}
      onExport={profileActions.downloadProfile}
      onImport={profileActions.importProfile}
    >
      <!-- At the right end of the profile row, where the room was empty: the
         one control someone comes to the page for. Inert without a keyboard,
         and saying why on hover; the keyboard pill is where the picker is. -->
      <KeyLearner
        bind:learning
        disabled={keyboardStatus !== 'connected'}
        onCancel={() => (learning = false)}
      />
    </ProfileBar>

    <!-- Above the setup card, and outside the panels: what cannot work here is
       the page, not one of its sections. It shows itself or nothing. -->
    <Unsupported keyboard={keyboardStatus} />

    <div class="split">
      <main class="stage" bind:this={stageEl}>
        <!-- The same component OBS renders, from the same resolved shape — with
           the editor's handles over it, which the broadcast never gets. -->
        <LayoutEditor
          bind:this={editor}
          {config}
          {frame}
          bind:selectedIds
          bind:stageBox
          onChange={updateConfig}
          {storage}
          layout={activeLayout}
          suggestAxis={selectedIds.length === 1 && suggestedIds.includes(selectedIds[0]!)}
          onDismissSuggestion={() => {
            // Proposing a mode for a heterogeneous group would mean nothing, so
            // the suggestion is single-selection only — and so is dismissing it.
            suggester.dismiss(selectedIds[0]!);
            observed += 1;
          }}
          bind:learning
          learningBanner={learning}
          onCopyUrl={copyUrl}
        />
      </main>

      <aside class="panel">
        <!-- Global appearance. Per-key overrides live in the popover the editor
           anchors to the selection, never here (spec §16.4). -->
        <!-- Neither block folds any more (board Main): each title stays put and
             what is under it scrolls on its own, so the key list is never
             pushed out of reach by an unfolded style group (spec §16.12). -->
        <section class="block style-block" aria-labelledby="style-title">
          <h2 class="block-title" id="style-title">
            Global style
            {#if styled}
              <!-- Not a colour on the title: a dot survives being read by
                   someone who cannot tell its colour from grey. -->
              <Tooltip text="Differs from the defaults">
                {#snippet children()}
                  <span class="modified" data-modified></span>
                {/snippet}
              </Tooltip>
            {/if}
          </h2>
          <div class="scroll">
            <StylePanel bind:this={stylePanel} {config} onChange={updateConfig} />
          </div>
        </section>

        <section class="block keys-block" aria-labelledby="keys-title">
          <h2 class="block-title" id="keys-title">
            Keys
            <Tooltip text={`${config.keys.length} key${config.keys.length === 1 ? '' : 's'}`}>
              {#snippet children()}
                <span class="count">{config.keys.length}</span>
              {/snippet}
            </Tooltip>
          </h2>
          <div class="scroll">
            <KeyList
              keys={config.keys}
              {selectedIds}
              {offscreen}
              onPick={pickKey}
              onEdit={(id) => editor?.open(id)}
              onDelete={(id) => {
                updateConfig(removeKey(config, id));
                selectedIds = selectedIds.filter((selected) => selected !== id);
              }}
              onDeleteSelected={() => {
                updateConfig(removeKeys(config, selectedIds));
                selectedIds = [];
              }}
            />
          </div>
        </section>
      </aside>
    </div>
  {/if}
</div>

{#if diagnosticsOpen}
  <!-- Over the stage, from the ⚙ menu (board 3a), and outside `.app`: a
     fixed panel inside a container could be held to it rather than to the
     window. Mounted only while open,
       for the reason the footer fold used `{#if}`: a shut panel has to cost
       nothing, and `readings()` walks every key on every frame. -->
  <Sheet title="Diagnostics" onClose={() => (diagnosticsOpen = false)}>
    <Diagnostics
      entries={log}
      logText={() => journal.asText()}
      {readings}
      {snapshot}
      {capturing}
      {probing}
      probe={probeReading}
      {obsProbe}
      {sources}
      {attention}
      onCaptureRaw={() => (capturing = true)}
      onUseAuto={() => updateConfig(setLayoutOverride(config, 'auto', layout))}
      onChangeFont={async () => {
        // Diagnostics first, out of the way, then the font choice itself.
        diagnosticsOpen = false;
        await tick();
        stylePanel?.reveal('label');
      }}
      onToggleProbe={toggleProbe}
      onTestObs={testObs}
      onReloadSources={reloadObsSources}
    />
  </Sheet>
{/if}

<Toast notice={toast} onDismiss={() => (toast = null)} center={toastCenter} />

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    /* A floor, not a lock (spec §16.9): under ~940 px the panel drops below
       the stage and the page scrolls down to it. The container the layout
       measures itself against is the mount point around this (app.css), so
       the page's own scrollbar never makes it guess wrong about which layout
       it is in — and so this element can be styled by it. */
    min-block-size: 100vh;
    font: var(--he-font);
    color: var(--he-text);
    background: var(--he-bg);
  }

  .bar {
    flex: none;
    display: flex;
    /* One line at every width (board Editor-HeaderNarrow): short of room it
       folds by steps (`fold`), never onto a second line. */
    flex-wrap: nowrap;
    align-items: center;
    gap: 18px;
    min-block-size: var(--he-header-height);
    box-sizing: border-box;
    padding: 8px 20px;
    border-block-end: 1px solid var(--he-border);
  }
  /* What the page is and what it talks to: the mark, the pills, Resume
     setup. Never broken inside; it gives way first, the keyboard name cut
     last (StatusBar). */
  .lead {
    flex: 1 1 auto;
    min-inline-size: 0;
    display: flex;
    align-items: center;
    gap: 18px;
  }
  /* What one does here. Never broken inside either; short of room, it goes
     under the lead, whole, and the auto margin keeps it on the right. */
  .tools {
    flex: none;
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    gap: 18px;
  }
  /* The quiet words ("Link OBS scenes", "Start with Windows") sit 18 px from
     their neighbours (board OBS-5e-Header): their padding is for the hover
     face alone, which spills past the words (board OBS-5e-ButtonStates)
     instead of pushing them apart. The 28 px icon of a folded header keeps
     its own box. */
  .tools :global(.he-btn-quiet:not(.compact)) {
    margin-inline: -10px;
  }
  /* Neither block sets `white-space`: it is inherited, and the popovers that
     hang from the pills and the actions (OBS, Link OBS scenes, Start with
     Windows, ⚙) would never wrap a sentence again. A flex row does not break
     on its own; what holds words keeps them on one line itself. */
  .brand {
    flex: none;
    display: inline-flex;
    align-items: center;
    /* Tighter between the mark and the name than to the pills: the two are
       one sign. */
    gap: 14px;
    color: var(--he-text);
    text-decoration: none;
  }
  a.brand:hover .wordmark {
    color: var(--he-accent);
  }
  a.brand:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: var(--he-radius);
  }
  .mark {
    display: block;
    flex: none;
  }
  .wordmark {
    font-size: var(--he-size-md);
    font-weight: 800;
    letter-spacing: 0.05em;
  }
  .edits {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* The KeyLearner recipe: present for the reader, absent from the layout. */
  .sr {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* "To finish", on Link OBS scenes' gauge in its "to set up" state, in amber
     (board Editor-HeaderNarrow): an unfinished setup is something to look at. */
  .resume {
    flex: none;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    block-size: 28px;
    padding: 0 11px;
    font: var(--he-font);
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-warn);
    background: none;
    border: 1px solid var(--he-warn);
    border-radius: var(--he-radius);
    cursor: pointer;
    transition: background-color var(--he-state-transition);
  }
  .resume:hover {
    background: color-mix(in srgb, var(--he-warn) 10%, transparent);
  }
  .resume:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }
  /* The sixth step: the icon alone, a 28 px square — the text's width gone. */
  .resume.compact {
    inline-size: 28px;
    padding: 0;
  }

  /* Stage and panel side by side, the panel wrapping under the stage when
     the window has less than the two of them (spec §16.9): the flex bases are
     the breakpoint. */
  .split {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    min-block-size: 0;
  }

  .stage {
    flex: 999 1 var(--he-stage-min-size);
    /* A grid of one cell, so the editor's `block-size: 100%` resolves against
       a real height even when only the floor below sets it (stacked layout).
       `minmax(0, 1fr)` both ways, never `auto`: the drawing is an <svg> as
       wide as the keys reach, and an `auto` track would not shrink below it —
       on a narrowing window the stage spilled over the panel instead of
       clipping its keys, which the Keys list then names as off the surface. */
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    position: relative;
    min-inline-size: 0;
    /* Its floor, stacked or side by side: 560, where the popover unfolded
       keeps its Reset and Delete. Stacked, never the window's height — the
       panel shows under the stage at once, Global style readable without
       scrolling (the board); the page scrolls from there. Side by side, the
       row stretches it (below). */
    min-block-size: var(--he-stage-min-size);
    background: var(--he-stage);
  }
  /* Side by side, the page is exactly the window and the row takes what the
     header and the tabs leave of it — on one line or two, with no height of
     theirs written down (`100vh − 104px` was wrong the moment the header
     wrapped). The panel scrolls inside the row; without a height here a long
     panel stretched the whole page, the stage with it. Never under 560: past
     that, the page scrolls. Stacked, the page scrolls instead. The editor
     only: the setup card keeps the page it needs. After `.split` and every
     rule it overrides: a container query does not outrank them. */
  @container app (min-width: 940px) {
    .app.workspace {
      block-size: 100vh;
    }
    .split {
      flex: 1 1 0;
      min-block-size: var(--he-stage-min-size);
    }
  }

  /* The setup alone on the page (board 4a): the card centred on the same
     dotted ground the stage draws once it takes over (LayoutEditor.svelte). */
  .welcome {
    flex: 1;
    min-block-size: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background-color: var(--he-stage);
    background-image: radial-gradient(var(--he-border) 1px, transparent 1px);
    background-size: 26px 26px;
  }

  .panel {
    /* Border included in the 380, so 560 + 380 is exactly where it wraps. */
    flex: 1 1 var(--he-panel-width);
    box-sizing: border-box;
    min-inline-size: 0;
    max-block-size: 100%;
    display: flex;
    flex-direction: column;
    border-inline-start: 1px solid var(--he-border);
  }
  /* 16 px on the left; on the right 6 px, plus the 10 px lane the scrollbar
     keeps whether or not it shows — 16 again, and no jump when a group opens
     far enough to need it. */
  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 6px 12px 16px;
  }
  .keys-block {
    padding-block-start: 12px;
    border-block-start: 1px solid var(--he-border);
  }
  .block-title {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 10px 0 0;
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-text);
  }
  .modified {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-accent);
  }
  .count {
    margin-inline-start: auto;
    font-weight: 400;
    color: var(--he-text-muted);
  }
  .scroll {
    min-block-size: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  /* Side by side, the panel is as tall as the window allows and each block
     scrolls under its own title. The key list keeps its floor (200 px): the style
     groups give way first, being the ones folded most of the time. Stacked,
     neither has a height to keep to, and the page scrolls. Its width is the
     token, never more: the stage takes every pixel the window adds. */
  @container app (min-width: 940px) {
    .panel {
      max-inline-size: var(--he-panel-width);
    }
    .style-block {
      flex: 0 1 auto;
      min-block-size: 0;
    }
    .keys-block {
      flex: 1 1 0;
      min-block-size: var(--he-panel-list-min-size);
    }
  }
</style>
