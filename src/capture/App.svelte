<script lang="ts">
  import { untrack } from 'svelte';
  import { createKeyboardLink, type KeyboardStatus } from '../keyboard/device';
  import {
    createObsClient,
    DEFAULT_OBS_PORT,
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
    keyboardHint,
    createObsProbe,
    type ObsProbeStatus,
  } from './settings';
  import { createOverlayRegistry } from './overlays';
  import { createConfigBroadcaster } from './broadcast';
  import { newPageId } from '../protocol/identity';
  import { learnedByStopPress, learnKeys } from './learn';
  import { keysOutside, pickedFromList, removeKey, removeKeys, surfaceOf } from './layout';
  import { loadLayoutMap, resolveLayout, type LayoutMapLike } from '../keyboard/labels';
  import { detectedLabelFor, setLayoutOverride } from '../config/edit';
  import { createAxisSuggester } from './suggest';
  import { hasGlobalOverrides, hasOverrides, resolve } from '../config/resolve';
  import { recommendedSize } from '../view/scene';
  import KeyLearner from './KeyLearner.svelte';
  import LayoutEditor from './LayoutEditor.svelte';
  import StylePanel from './StylePanel.svelte';
  import { createProfileStore } from '../config/storage';
  import type { OverlayConfig } from '../config/schema';
  import StatusBar from './StatusBar.svelte';
  import Wizard from './Wizard.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import Collapsible from './Collapsible.svelte';
  import Unsupported from './Unsupported.svelte';
  import { copyToClipboard } from './clipboard';
  import { createJournal, describeAnomaly, hexDump, type JournalEntry } from './journal';
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
  import Sheet from './Sheet.svelte';
  import StartupPopover from './StartupPopover.svelte';
  import { runsStandalone, watchInstall, type InstallWatch } from './startup';
  import Toast from './Toast.svelte';
  import { deletionToast, loadToast, type Notice } from './notice';
  import { createHistory } from './history';
  import { createProfileActions } from './profile-actions';
  import type { DecodeAnomaly } from '../keyboard/decode';
  import type { FrameKey } from '../protocol/messages';

  const storage = browserStorage();

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

  let rate = $state(0);
  /**
   * How many overlays are listening, and from where.
   *
   * Two figures rather than one since 2026-08-23: opening `overlay.html` in a
   * tab to check that it works is an overlay, so the total could no longer say
   * whether the one in OBS was among them (spec §16.7).
   */
  let listeners = $state({ inObs: 0, inBrowser: 0 });

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
   * A flag rather than a count, since a page reloaded is a page renamed; once
   * true it stays true, see `ConfigBroadcaster.hasOtherCapture`.
   */
  let otherCapture = $state(false);

  /**
   * Everything worth writing down, for the report nobody can write blind
   * (spec §11). Mirrored into state because the journal is plain data: it is
   * appended to from four event handlers and read by one panel.
   */
  const journal = createJournal();
  let log = $state<readonly JournalEntry[]>([]);
  /** §9.3: a fold says in its header when what it hides is ours to fix. */
  const toReport = $derived(log.filter((entry) => entry.kind === 'bug').length);

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
    const next = overlays.counts(performance.now());
    if (next.inObs !== listeners.inObs || next.inBrowser !== listeners.inBrowser) {
      listeners = next;
    }
  }

  // An empty number field binds to null, and `ws://localhost:null` throws
  // inside the WebSocket constructor. The displayed URL has to survive that
  // half-typed state too, so it reads the normalized port rather than the field.
  let port = $derived(normalizePort(settings.port));
  let url = $derived(overlayUrl(location.origin, { port, password: settings.password }));

  function createClient(): ObsClient {
    return createObsClient({
      url: `ws://localhost:${untrack(() => port)}`,
      password: untrack(() => settings.password),
      onStatus: (s) => {
        obsStatus = s;
        note('user', `OBS: ${s}.`);
        // Nothing left while the socket was down, and an overlay on the other
        // side may have been waiting the whole time.
        if (s === 'identified') broadcaster.onIdentified();
        if (s !== 'identified') {
          // Nobody is reachable through a dead socket, and expiry is only
          // computed on read: a count left standing would never come down.
          overlays.clear();
          refreshOverlays();
          // Same for the rate. Its window ages on keyboard reports, so with
          // nobody typing the last good figure would stay on screen — a
          // throughput advertised beside a dot saying the link is dead. No
          // frame is leaving, and zero is simply the truth.
          rate = 0;
        }
      },
      onForeignVersion: (version) => {
        // Almost always an overlay left open across a deployment. It goes
        // quiet with nothing to say why, which is the whole reason this line
        // exists (spec §11).
        note('user', `An overlay is running protocol v${version}; reload it.`);
      },
      onMessage: (message) => {
        // Presence and configuration are both driven by these three messages,
        // so one place reads them (spec §6).
        broadcaster.onOverlayMessage(message, performance.now());
        // The rate ages here as well as on reports. The keyboard speaks only
        // on change, so once someone stops typing nothing advances the window
        // and the last figure stayed on screen for good. An overlay beats
        // every two seconds; that is the clock this page is allowed to have,
        // because it arrives as an event rather than from a timer.
        rate = session.rateAt(performance.now());
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
    onOtherCapture: () => {
      otherCapture = true;
      // In the journal as well as in the status bar, and worded differently on
      // purpose: the bar tells someone what to do, this line timestamps it, for
      // the report written hours later about an overlay that changed on its own.
      note('user', 'Another capture page was heard broadcasting.');
    },
  });

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

  /** See `clipboard.ts`: the copy can silently not happen, and used to lie. */
  async function copyUrl(): Promise<boolean> {
    const copied = await copyToClipboard(navigator, url);
    // The journal is what goes into a bug report. A line claiming the URL
    // was copied when it was not sends whoever reads it down the wrong path.
    note(
      'user',
      copied
        ? 'Overlay URL copied.'
        : 'Overlay URL could not be copied — select the field and copy it by hand.',
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
      // A synchronous reading, not a timer, and taken inside the report
      // handler — so it is the report's own moment to within microseconds.
      rate = session.rateAt(performance.now());
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
      keyboardStatus = status;
      keyboardName = name;
      note('user', name === null ? `Keyboard: ${status}.` : `Keyboard: ${status} (${name}).`);
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
{#snippet brand()}
  {#if standalone}
    <span class="brand">
      <img class="mark" src="/logo/halcyon-logo.svg" width="22" height="22" alt="" />
      <span class="wordmark">HALCYON</span>
    </span>
  {:else}
    <a class="brand" href="/" title="Halcyon home page">
      <img class="mark" src="/logo/halcyon-logo.svg" width="22" height="22" alt="" />
      <span class="wordmark">HALCYON</span>
    </a>
  {/if}
{/snippet}

<div class="app">
  {#if wizardOpen}
    <!-- The setup has the page to itself (board 4a): the mark, and the card.
         Nothing else is mounted — the stage cannot be worked on until the
         keyboard answers, and the setup exists to get it there. -->
    <header class="bar">
      {@render brand()}
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
        onAllowKeyboard={() => link.requestPermission()}
        onReconnect={reconnect}
        onSkip={() => remember('skipped')}
      />
    </div>
  {:else}
    <header class="bar">
      <!-- The mark and the name, so the window is recognisable in a taskbar
         full of Chrome. Decorative: the page's name is in the title. -->
      {@render brand()}

      <!-- The OBS pill is the whole OBS interface (board 3a): its popover
         carries the URL, the recommended size and the two credentials the
         sidebar fold used to. The size is only quoted once there is a key to
         pack — an empty layout has no size worth giving a browser source. -->
      <StatusBar
        keyboard={keyboardStatus}
        device={keyboardName}
        obs={obsStatus}
        {rate}
        overlays={listeners}
        {otherCapture}
        {url}
        size={config.keys.length > 0 ? size : null}
        {settings}
        onPickDevice={() => link.requestPermission()}
        onRetryObs={reconnect}
        onCopyUrl={copyUrl}
      />

      <!-- Document-level controls. In the header because it is the one zone
         visible in every state of the page: wizard up, folds shut, popover
         gone — and the first need for undo comes when the selection has just
         disappeared, so nothing anchored to it can carry the button. -->
      <div class="edits">
        <button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo} onclick={undo}>↶</button
        >
        <button aria-label="Redo" title="Redo · Ctrl+Y" disabled={!canRedo} onclick={redo}>↷</button
        >
        <!-- The spoken half of the two buttons: it follows, it never interrupts. -->
        <p class="sr" role="status">{announced}</p>
      </div>

      <!-- In the header for the same reason undo is: the guide must be findable
         from every state of the page, and it anchors to nothing on the stage. -->
      <StartupPopover {standalone} {install} onInstall={installApp} />

      {#if canResume}
        <!-- Amber, and in the header: findable long after the card was put
           aside, from any screen (board 6f). -->
        <button class="resume" onclick={() => remember('open')}>
          <span class="dot" aria-hidden="true"></span>
          Resume setup · {stepNumber(step)}/3
        </button>
      {/if}

      <!-- Last, and the rarest: the layout override, the device picker, the
         door to Diagnostics and the build (board 3a). -->
      <SettingsMenu
        layout={config.layoutOverride}
        {toReport}
        onLayout={(value) => updateConfig(setLayoutOverride(config, value, layout))}
        onPickDevice={() => link.requestPermission()}
        onDiagnostics={() => (diagnosticsOpen = true)}
      />
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
        reason={keyboardHint(keyboardStatus)}
        onCancel={() => (learning = false)}
      />
    </ProfileBar>

    <!-- Above the setup card, and outside the panels: what cannot work here is
       the page, not one of its sections. It shows itself or nothing. -->
    <Unsupported keyboard={keyboardStatus} />

    <div class="split">
      <main class="stage">
        <!-- The same component OBS renders, from the same resolved shape — with
           the editor decorations on, which the broadcast never gets. -->
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
        />
      </main>

      <aside class="panel">
        <!-- Global appearance. Per-key overrides live in the popover the editor
           anchors to the selection, never here (spec §16.4). -->
        <section class="block">
          <!-- Open on a first run, unlike the per-key block in the popover: this
             fold shows the three group headers (board 3a), and the groups
             themselves start shut — so open, it costs three lines. -->
          <Collapsible id="style" title="Global style" modified={styled} defaultOpen {storage}>
            <StylePanel {config} onChange={updateConfig} />
          </Collapsible>
        </section>

        <section class="block keys-block">
          <Collapsible
            id="keys"
            title="Keys"
            note={String(config.keys.length)}
            defaultOpen
            {storage}
          >
            {#if config.keys.length === 0}
              <p class="fine">No keys yet.</p>
            {:else}
              <ul class="keys">
                {#each config.keys as key (key.id)}
                  <li class:selected={selectedIds.includes(key.id)}>
                    <!-- The row is the only thing that can reach an off-screen
                       key (spec §16.5): its handle is clipped away with the
                       stage overflow. So the row selects — plain, ctrl-toggle,
                       shift-range — and a double click opens the popover,
                       which already folds itself back inside the stage. -->
                    <button
                      class="pick"
                      aria-pressed={selectedIds.includes(key.id)}
                      onclick={(event) => pickKey(key.id, event)}
                      ondblclick={() => editor?.open(key.id)}
                    >
                      <span class="label">{key.label}</span>
                      <span class="mode">{key.mode}</span>
                      {#if offscreen.includes(key.id)}
                        <!-- Before the override tag: this one says the key cannot
                           be seen at all, which outranks how it is painted. -->
                        <span
                          class="offscreen"
                          title="Not on the work surface: widen the window, or lower the key size in the global style"
                        >
                          off screen
                        </span>
                      {/if}
                      <!-- Same amber, same shape as the override tag beside it: at a
                         glance the two say one thing — this key was customized. The
                         words separate them for whoever reads on, because the ways
                         back differ: "Reset to global" for a style, "Reset to
                         detected" for a name.

                         A typed label is the one customization that is invisible on
                         the key itself. Four arrows drawn as a clean cluster, one of
                         them Right Ctrl wearing a down arrow, and nothing on screen
                         to say which. -->
                      {#if detectedLabelFor(key, activeLayout) !== null}
                        <span
                          class="customized"
                          title="Renamed by hand · this is not the name its position produces"
                        >
                          renamed
                        </span>
                      {/if}
                      {#if hasOverrides(key)}<span class="customized">override</span>{/if}
                    </button>
                    <button
                      class="trash"
                      aria-label={'Delete ' + key.label}
                      onclick={() => updateConfig(removeKey(config, key.id))}
                    >
                      <!-- Replaces the trash-can emoji this button used to hold —
                         the one coloured glyph in an otherwise monochrome,
                         tokenized UI, since Windows renders it in full colour
                         regardless of theme. `currentColor` ties this one to the
                         button's own text colour instead, and the name someone
                         hears from a screen reader lives on the button above,
                         not on this decoration. -->
                      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                        <path
                          d="M3.5 4.5h9M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6M6.5 7.3v4M9.5 7.3v4"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </button>
                  </li>
                {/each}
              </ul>

              {#if selectedIds.length > 1}
                <button
                  class="link"
                  onclick={() => {
                    updateConfig(removeKeys(config, selectedIds));
                    selectedIds = [];
                  }}
                >
                  Delete {selectedIds.length} selected keys
                </button>
              {/if}
            {/if}
          </Collapsible>
        </section>
      </aside>
    </div>
  {/if}

  {#if diagnosticsOpen}
    <!-- Over the stage, from the ⚙ menu (board 3a). Mounted only while open,
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
        onCaptureRaw={() => (capturing = true)}
        onToggleProbe={toggleProbe}
        onTestObs={testObs}
      />
    </Sheet>
  {/if}
</div>

<Toast notice={toast} onDismiss={() => (toast = null)} />

<style>
  .app {
    /* The Diagnostics sheet anchors to the page, under the header's edge. */
    position: relative;
    display: flex;
    flex-direction: column;
    block-size: 100vh;
    font: var(--he-font);
    color: var(--he-text);
    background: var(--he-bg);
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 18px;
    /* A floor, not a lock: StatusBar's rival-capture alert forces its own line
       (`.rival { flex-basis: 100% }`), and a run of pills wraps on a narrow
       window the same way. Either would have overflowed or overlapped the
       stage below under a fixed `block-size` — the one message meant to be
       seen is the one that would have been unreadable. */
    min-block-size: var(--he-header-height);
    padding: 0 20px;
    border-block-end: 1px solid var(--he-border);
  }
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
    outline-offset: 3px;
    border-radius: var(--he-radius);
  }
  .mark {
    display: block;
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
  .edits button {
    inline-size: 28px;
    block-size: 28px;
    font: inherit;
    font-size: var(--he-size-md);
    color: var(--he-text);
    background: none;
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-control);
    cursor: pointer;
  }
  .edits button:disabled {
    /* The same figure the Add key button dims with: one vocabulary for "not
       available". */
    opacity: 0.4;
    cursor: default;
  }
  .edits button:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
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
  .resume {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: inherit;
    font-size: var(--he-size-md);
    font-weight: 600;
    color: var(--he-override);
    background: none;
    border: 1px solid var(--he-override);
    border-radius: var(--he-radius-control);
    padding: 5px 11px;
    cursor: pointer;
  }
  .resume .dot {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-override);
  }

  .split {
    flex: 1;
    display: flex;
    min-block-size: 0;
  }

  .stage {
    flex: 1;
    position: relative;
    min-inline-size: 0;
    background: var(--he-stage);
  }
  /* The setup alone on the page (board 4a): the card centred on the same
     dotted ground the stage will draw once it takes over. */
  .welcome {
    flex: 1;
    min-block-size: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background-color: var(--he-bg);
    background-image: radial-gradient(var(--he-surface) 1px, transparent 1px);
    background-size: 22px 22px;
  }

  .panel {
    flex: none;
    inline-size: var(--he-panel-width);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-inline-start: 1px solid var(--he-border);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 16px;
    border-block-end: 1px solid var(--he-border);
  }
  /* The one section worth the leftover room: folding the others is what this
     is for. */
  .keys-block {
    flex: 1;
    min-block-size: 0;
    overflow-y: auto;
  }
  .link {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-sm);
    font-weight: 600;
    color: var(--he-accent);
  }
  .link:hover {
    color: var(--he-accent-hover);
  }
  .link:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }

  .fine {
    margin: 0;
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
    line-height: 1.45;
  }

  .keys {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .keys li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--he-radius);
    font-size: var(--he-size-xs);
  }
  .keys li:hover {
    background: var(--he-surface);
  }
  .keys li.selected {
    background: var(--he-surface);
  }
  .pick {
    all: unset;
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-inline-size: 0;
    cursor: pointer;
  }
  .pick:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }
  .label {
    font-weight: 700;
    color: var(--he-text);
    min-inline-size: 24px;
  }
  .mode {
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
  /* One class for both tags: they are the same mark, and the words are what
     separate a style override from a name someone typed. */
  .customized {
    font-size: var(--he-size-xs);
    color: var(--he-override);
    white-space: nowrap;
  }
  /* Red where the override tag is amber: an override is a choice, and this is
     a key nobody can see. */
  .offscreen {
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-danger);
    white-space: nowrap;
  }
  .trash {
    all: unset;
    margin-left: auto;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* The glyph itself is 15px; this pads the hit target out to roughly 24px
       square, which the bare emoji never had — a click a hair off the glyph
       used to land on the row underneath it instead. */
    padding: 4.5px;
    color: var(--he-text-faint);
    opacity: 0;
  }
  .keys li:hover .trash,
  .trash:focus-visible {
    opacity: 1;
  }
  .trash:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }
</style>
