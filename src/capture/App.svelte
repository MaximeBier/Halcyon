<script lang="ts">
  import { untrack } from 'svelte';
  import { createKeyboardLink, type KeyboardStatus } from '../keyboard/device';
  import {
    createObsClient,
    DEFAULT_OBS_PORT,
    MAX_PORT,
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
    sourceState,
    createObsProbe,
    type ObsProbeStatus,
  } from './settings';
  import { createOverlayRegistry } from './overlays';
  import { createConfigBroadcaster } from './broadcast';
  import { newPageId } from '../protocol/identity';
  import { learnKeys } from './learn';
  import { keysOutside, pickedFromList, removeKey, removeKeys, surfaceOf } from './layout';
  import { loadLayoutMap, resolveLayout, type LayoutMapLike } from '../keyboard/labels';
  import { detectedLabelFor, setLayoutOverride } from '../config/edit';
  import { createAxisSuggester } from './suggest';
  import { hasGlobalOverrides, hasOverrides, resolve } from '../config/resolve';
  import { recommendedSize } from '../view/scene';
  import KeyLearner from './KeyLearner.svelte';
  import LayoutEditor from './LayoutEditor.svelte';
  import StylePanel from './StylePanel.svelte';
  import { createProfileStore, exportProfile, importConfig } from '../config/storage';
  import { importedProfileName, profileFileName } from './profile-file';
  import type { OverlayConfig } from '../config/schema';
  import StatusBar from './StatusBar.svelte';
  import Wizard from './Wizard.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import Collapsible from './Collapsible.svelte';
  import Gated from './Gated.svelte';
  import Unsupported from './Unsupported.svelte';
  import { copyToClipboard } from './clipboard';
  import { createJournal, describeAnomaly, hexDump, type JournalEntry } from './journal';
  import { createStreamProbe, type StreamReading } from './probe';
  import {
    loadStatus,
    nextStep,
    saveStatus,
    showsResume,
    showsWizard,
    stepNumber,
    type WizardStatus,
  } from './wizard';
  import ProfileBar from './ProfileBar.svelte';
  import StartupPopover from './StartupPopover.svelte';
  import Toast from './Toast.svelte';
  import {
    deletionToast,
    importedToast,
    importFailedToast,
    loadToast,
    profileDeletedToast,
    profileStatus,
    READ_FAILED,
    type Health,
    type Notice,
  } from './notice';
  import { createHistory } from './history';
  import type { DecodeAnomaly } from '../keyboard/decode';
  import type { FrameKey } from '../protocol/messages';

  const storage = browserStorage();

  let settings = $state(loadSettings(storage));
  let keyboardStatus = $state<KeyboardStatus>('disconnected');
  /** The product name of the keyboard that answered, for the wizard's first step. */
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

  /**
   * What the open profile is worth, kept past the toast that announced it.
   *
   * The two are not redundant (spec §16.6): the toast says something just
   * happened, this says what we are looking at — hours later, when the only
   * question left is why there are four keys instead of six.
   */
  let health = $state<Health>({
    problem: opened.problem,
    dropped: opened.dropped,
    from: 'load',
  });

  /** The passing half. Replaced, never queued: the last thing said is the one that matters. */
  let toast = $state<Notice | null>(loadToast(opened.problem));

  /**
   * The pile behind the door (`history.ts`), mirrored into two flags because
   * the pile is plain data: the two header buttons need to follow it, and
   * nothing else here polls.
   */
  const history = createHistory<OverlayConfig>();
  let canUndo = $state(false);
  let canRedo = $state(false);
  /**
   * What the hidden status line beside the buttons reads out.
   *
   * A dedicated region rather than the toast: ten Ctrl+Z in a row would queue
   * ten toasts, while this replaces itself in silence. Polite, never
   * assertive — it follows, it does not interrupt (the KeyLearner rule).
   */
  let announced = $state('');

  let learning = $state(false);
  /** The label of the last key learned, which the wizard's third step confirms. */
  let lastKey = $state<string | null>(null);

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
   * Written the first time everything works, whether the wizard was followed
   * or skipped. Without it, an OBS restart the next evening reopens a setup
   * that was finished weeks ago — `nextStep` reads the world, not history.
   */
  $effect(() => {
    if (step === 'done' && setup !== 'done') remember('done');
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
    canUndo = history.canUndo();
    canRedo = history.canRedo();
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
    canUndo = history.canUndo();
    canRedo = history.canRedo();
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

  /** What the profile menu shows permanently, under the list (spec §16.6). */
  const status = $derived(profileStatus(profile, config.keys.length, health));
  const statusWarn = $derived(health.problem !== null || health.dropped > 0);

  /**
   * Opens a profile, and puts the overlay on it.
   *
   * The broadcast is not optional: OBS is showing the previous profile's keys
   * and nothing about switching would reach it otherwise.
   */
  function openProfile(name: string) {
    profiles.select(name);
    profile = name;
    profileNames = profiles.list();

    const next = profiles.load(name);
    health = { problem: next.problem, dropped: next.dropped, from: 'load' };
    config = next.config;
    // Both name keys of the profile being left. Two profiles can share a matrix
    // index, so a stale selection does not merely look wrong — "Delete 3
    // selected keys" would act on a set nobody chose in this profile.
    selectedIds = [];
    keysAnchor = null;
    lastKey = null;
    // A pile that survived the switch would make Ctrl+Z rewrite a document
    // that is no longer on screen — inside OBS. Renaming keeps it: the name
    // changed, not the content this pile remembers.
    history.clear();
    canUndo = false;
    canRedo = false;
    broadcaster.publish(config);

    return loadToast(next.problem);
  }

  function switchProfile(name: string) {
    toast = openProfile(name);
  }

  function createProfile(name: string) {
    // `create` returns the name it really took: asking for one that exists
    // gets "Apex 2" rather than the layout that was already there.
    const created = profiles.create(name);
    openProfile(created);
    toast = { tone: 'success', message: `Profile “${created}” created` };
  }

  function duplicateProfile() {
    // Saved first: `duplicate` copies what is in storage, and the difference
    // would be exactly whatever has not been written yet.
    profiles.save(profile, config);
    const copy = profiles.duplicate(profile);
    openProfile(copy);
    toast = { tone: 'success', message: `Duplicated to “${copy}”` };
  }

  function renameProfile(name: string) {
    // Nothing is loaded or broadcast: the configuration did not change, only
    // the name it is filed under. Reopening it here would push an identical
    // profile back at OBS for no reason.
    if (!profiles.rename(profile, name)) {
      toast = { tone: 'error', message: `A profile named “${name}” already exists` };
      return;
    }

    profile = name;
    profileNames = profiles.list();
    toast = { tone: 'success', message: `Renamed to “${name}”` };
  }

  function removeProfile() {
    const gone = profile;
    // Snapshotted before `openProfile` moves `config` on to whatever opens
    // next: `config` is a rune, so reading it from the Undo closure below —
    // pressed seconds or minutes later — would hand back today's profile
    // instead of the one that just left.
    const deletedConfig = config;
    profiles.remove(gone);
    openProfile(profiles.active());
    toast = profileDeletedToast(gone, () => {
      // `importFrom` is the store's own door for landing a configuration
      // beside the others without overwriting one — the exact collision
      // handling `freeName` gives every import, reused rather than
      // reimplemented: a same-named profile created between the delete and
      // this click gets the resurrection suffixed onto it instead of erased.
      openProfile(profiles.importFrom(gone, deletedConfig));
    });
  }

  /**
   * What the gate over "Add key" offers to press.
   *
   * Without permission the missing thing is a *click* — WebHID has nothing to
   * hang its prompt on until one arrives — so the gate has to offer one. This
   * is the only place left doing so once the setup wizard is gone for good,
   * and dropping it in the task 27 rewrite left the page with no way at all to
   * grant access. On an unsupported browser nothing is offered: a button that
   * cannot help is how someone presses it four times.
   *
   * One label for every status it is offered in, not one per status: the
   * click always calls the same `requestPermission()`, which always opens the
   * same HID picker — potentially empty. "Rescan devices" used to promise an
   * automatic look the code never performs.
   */
  const keyboardAction = 'Choose device…';

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
  let urlCopied = $state<'idle' | 'done' | 'failed'>('idle');

  /** The panel's own reveal — the wizard's is gone once the setup is done. */
  let revealed = $state(false);

  async function copyUrl() {
    const copied = await copyToClipboard(navigator, url);
    urlCopied = copied ? 'done' : 'failed';
    // The journal is what goes into a bug report. A line claiming the URL
    // was copied when it was not sends whoever reads it down the wrong path.
    note(
      'user',
      copied
        ? 'Overlay URL copied.'
        : 'Overlay URL could not be copied — select the field and copy it by hand.',
    );
  }

  function downloadProfile() {
    // `exportProfile` and not `exportConfig`: the file carries the profile's
    // name, so importing it elsewhere lands under the name it left under
    // rather than under whatever the browser called the download.
    const blob = new Blob([exportProfile(profile, config)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href,
      download: profileFileName(profile),
    });
    link.click();
    URL.revokeObjectURL(href);
  }

  async function importProfile(file: File) {
    let text: string;
    try {
      // `File.text()` rejects when the file moved, changed, or sat on a volume
      // that went away between the picker closing and the read. Unhandled, the
      // rejection belongs to nobody: no message, and nothing to retry against.
      text = await file.text();
    } catch {
      toast = READ_FAILED;
      return;
    }

    const result = importConfig(text);
    // Nothing is lost on a failure: the open profile is untouched, and the
    // toast is the only thing that changes. The permanent line still describes
    // what is actually loaded.
    if (!result.ok) {
      toast = importFailedToast(result.reason);
      return;
    }

    // A profile of its own, and never the open one. Until 2026-08-24 this
    // called `updateConfig`, which wrote the imported keys straight into
    // whatever profile happened to be loaded — the single gesture in the
    // application that could destroy a layout with nothing to undo it.
    const requestedName = importedProfileName(text, file.name);
    // Judged against the list as it stood *before* the import, and against
    // the same nameless fallback `freeName` applies to `requestedName` — a
    // nameless import comparing itself against '' would call it a collision
    // only once a profile happened to be named "" too, which never happens,
    // instead of the "Profile" it will actually land beside.
    const before = profiles.list();
    const collidedWith = requestedName || 'Profile';
    const collided = before.includes(collidedWith);

    const landed = profiles.importFrom(requestedName, result.config);
    openProfile(landed);
    // After `openProfile`, which sets `health` from a re-read of what we have
    // just written — where the dropped count is zero, because the keys were
    // dropped on the way in and the stored file no longer has them. The count
    // worth showing is the one from the import.
    health = { problem: null, dropped: result.dropped, from: 'import' };

    // No collision: exactly the toast this feature always showed, no action
    // attached (spec's constat — the free-name path never changes).
    toast = collided
      ? importedToast(landed, result.dropped, {
          name: collidedWith,
          run: () => {
            // `replaceFrom` refuses if `collidedWith` stopped existing between
            // the toast appearing and this click (renamed, removed elsewhere)
            // — nothing to reopen or clean up in that case, and the click has
            // already dismissed the toast regardless (see Toast.svelte).
            if (!profiles.replaceFrom(collidedWith, landed, result.config)) return;
            openProfile(collidedWith);
            // Same override as above, and for the same reason: a fresh read
            // of what `replaceFrom` just wrote reports zero dropped keys.
            health = { problem: null, dropped: result.dropped, from: 'import' };
          },
        })
      : importedToast(landed, result.dropped);
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
      // Read from the result, not from the report: the label is the layout's
      // business, and the wizard's third step names the key it just saw.
      const before = config.keys.map((key) => key.id);
      lastKey = next.keys.filter((key) => !before.includes(key.id)).at(-1)?.label ?? null;
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
  The three zones of mockup board `6d`: a 50 px header, the stage, and a 300 px
  panel. Nothing here is a pile of collapsibles any more — the folds live in the
  panel's footer, where §9.3 still governs them.
-->
<!-- On the window, not the stage: the history covers the whole document —
     styles and imports included — so the shortcut has to work wherever the
     hands happen to be. -->
<svelte:window onkeydown={onHistoryKey} />

<div class="app">
  <header class="bar">
    <StatusBar
      keyboard={keyboardStatus}
      obs={obsStatus}
      {rate}
      overlays={listeners}
      {otherCapture}
      onPickDevice={() => link.requestPermission()}
      onRetryObs={reconnect}
    />

    <!-- Document-level controls, next to the only other document control on
         this bar — the profile menu. In the header because it is the one zone
         visible in every state of the page: wizard up, folds shut, popover
         gone — and the first need for undo comes when the selection has just
         disappeared, so nothing anchored to it can carry the button. -->
    <div class="edits">
      <button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo} onclick={undo}>↶</button>
      <button aria-label="Redo" title="Redo · Ctrl+Y" disabled={!canRedo} onclick={redo}>↷</button>
      <!-- The spoken half of the two buttons: it follows, it never interrupts. -->
      <p class="sr" role="status">{announced}</p>
    </div>

    <!-- In the header for the same reason undo is: the guide must be findable
         from every state of the page, and it anchors to nothing on the stage. -->
    <StartupPopover />

    {#if canResume}
      <!-- Amber, and in the header: findable long after the card was put
           aside, from any screen (board 6f). -->
      <button class="resume" onclick={() => remember('open')}>
        <span class="dot" aria-hidden="true"></span>
        Resume setup · {stepNumber(step)}/3
      </button>
    {/if}

    <ProfileBar
      names={profileNames}
      active={profile}
      keyCount={(name) => profiles.keyCount(name)}
      {status}
      {statusWarn}
      onSelect={switchProfile}
      onCreate={createProfile}
      onDuplicate={duplicateProfile}
      onRename={renameProfile}
      onRemove={removeProfile}
      onExport={downloadProfile}
      onImport={importProfile}
    />
  </header>

  <!-- Above the setup card, and outside the panels: what cannot work here is
       the page, not one of its sections. It shows itself or nothing. -->
  <Unsupported keyboard={keyboardStatus} />

  <div class="split">
    <main class="stage">
      {#if wizardOpen}
        <!-- On the stage, not beside it: the setup is an orchestration of the
             editor, not a second interface (spec §9.1). -->
        <div class="setup" class:banner={step === 'keys'}>
          <Wizard
            {step}
            keyboard={keyboardStatus}
            device={keyboardName}
            obs={obsStatus}
            overlaysInObs={listeners.inObs}
            {settings}
            {url}
            bind:learning
            added={lastKey}
            onAllowKeyboard={() => link.requestPermission()}
            onReconnect={reconnect}
            onSkip={() => remember('skipped')}
          />
        </div>
      {/if}

      <!-- The same component OBS renders, from the same resolved shape — with
           the editor decorations on, which the broadcast never gets. -->
      <!-- `learningBanner` is suppressed for exactly the one step where
           Wizard.svelte already draws the same banner over this same flag
           (board 6c) — every other moment learning is armed, wizard or not,
           the stage carries its own. -->
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
        learningBanner={learning && !(wizardOpen && step === 'keys')}
        {wizardOpen}
      />
    </main>

    <aside class="panel">
      <section class="block">
        <Gated
          available={keyboardStatus === 'connected'}
          reason={keyboardHint(keyboardStatus)}
          action={keyboardStatus === 'unsupported' ? null : keyboardAction}
          onAction={() => link.requestPermission()}
        >
          <KeyLearner bind:learning onCancel={() => (learning = false)} />
        </Gated>
      </section>

      <!-- Before the style panel, as the lot of 2026-08-21 has it: while
           nothing works yet, the overlay URL is what one comes here for. -->
      <section class="block">
        <!-- The note counts only the overlays in OBS: this fold is about the
             browser source, and a tab opened to check the overlay works
             answers a different question. -->
        <Collapsible
          id="obs"
          title="OBS browser source"
          note={listeners.inObs > 0 ? `${listeners.inObs} in OBS` : null}
          defaultOpen
          {storage}
        >
          <Gated available={obsStatus === 'identified'} reason="Available once OBS is connected">
            <div class="url">
              <input readonly value={url} aria-label="Overlay URL for OBS" />
              <button
                class="link"
                onclick={copyUrl}
                onblur={() => (urlCopied = 'idle')}
                title={urlCopied === 'failed' ? 'Select the field and copy it by hand' : undefined}
              >
                {urlCopied === 'done' ? 'Copied' : urlCopied === 'failed' ? 'Failed' : 'Copy'}
              </button>
            </div>

            {#if config.keys.length > 0}
              <p class="figure">
                <span>Recommended source size</span>
                <span class="value">{size.width} × {size.height} px</span>
              </p>
            {/if}

            <p class="state">
              <span class="dot" data-live={listeners.inObs > 0} aria-hidden="true"></span>
              {sourceState(listeners)}
            </p>
          </Gated>

          <!-- Not in the mockup, which shows only the URL here and leaves the
               two fields to the wizard. They have to stay reachable once the
               setup is done and the wizard is gone for good. -->
          <label class="field">
            Port
            <input
              type="number"
              min="1"
              max={MAX_PORT}
              bind:value={settings.port}
              onchange={reconnect}
            />
          </label>
          <label class="field">
            Password
            <!-- The wizard's reveal, repeated here: this is the field one
                 comes back to weeks later, when the password OBS generated is
                 long forgotten. -->
            <span class="secret">
              <input
                type={revealed ? 'text' : 'password'}
                bind:value={settings.password}
                onchange={reconnect}
              />
              <button type="button" onclick={() => (revealed = !revealed)}>
                {revealed ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>
          <p class="fine">
            Stored in this browser and carried in the URL above. Anyone with access to this machine
            can read it.
          </p>
        </Collapsible>
      </section>

      <!-- Global appearance. Per-key overrides live in the popover the editor
           anchors to the selection, never here (spec §16.4). -->
      <section class="block">
        <!-- Open on a first run, unlike the per-key block in the popover. The
             contents of this one *is* what someone came to the section for;
             the popover's is the exception, and its header already says
             whether this key has any. -->
        <Collapsible
          id="style"
          title="Global style · all keys"
          modified={styled}
          defaultOpen
          {storage}
        >
          <StylePanel {config} onChange={updateConfig} />
        </Collapsible>
      </section>

      <section class="block keys-block">
        <Collapsible id="keys" title="Keys" note={String(config.keys.length)} defaultOpen {storage}>
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

      <footer class="foot">
        <!-- Deliberately last and discreet: an edge case that matters only when
             detection got it wrong (spec §16.4, §8.6). -->
        <Collapsible
          id="layout"
          title="Keyboard layout"
          note={config.layoutOverride === 'auto' ? 'Auto' : config.layoutOverride.toUpperCase()}
          modified={config.layoutOverride !== 'auto'}
          {storage}
        >
          <select
            aria-label="Keyboard layout"
            value={config.layoutOverride}
            onchange={(event) =>
              updateConfig(
                setLayoutOverride(
                  config,
                  event.currentTarget.value as OverlayConfig['layoutOverride'],
                  layout,
                ),
              )}
          >
            <option value="auto">Auto — detected</option>
            <option value="azerty">AZERTY</option>
            <option value="qwerty">QWERTY</option>
            <option value="qwertz">QWERTZ</option>
          </select>
          <p class="fine">Only affects displayed labels · capture is layout-independent.</p>
        </Collapsible>

        <Collapsible
          id="diagnostics"
          title="Diagnostics"
          note={toReport > 0 ? log.length + ' · ' + toReport + ' to report' : String(log.length)}
          {storage}
        >
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
        </Collapsible>
      </footer>
    </aside>
  </div>
</div>

<Toast notice={toast} onDismiss={() => (toast = null)} />

<style>
  .app {
    display: flex;
    flex-direction: column;
    block-size: 100vh;
    font: var(--he-font, 400 16px system-ui, sans-serif);
    color: var(--he-text, #dde1e9);
    background: var(--he-bg, #0e1015);
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 22px;
    /* A floor, not a lock: StatusBar's rival-capture alert forces its own line
       (`.rival { flex-basis: 100% }`), and a run of pills wraps on a narrow
       window the same way. Either would have overflowed or overlapped the
       stage below under a fixed `block-size` — the one message meant to be
       seen is the one that would have been unreadable. */
    min-block-size: var(--he-header-height, 62px);
    padding: 0 22px;
    border-block-end: 1px solid var(--he-border, #1b1e27);
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
    font-size: var(--he-size-md, 16px);
    color: var(--he-text, #dde1e9);
    background: none;
    border: 1px solid var(--he-border-popover, #262b3a);
    border-radius: var(--he-radius-control, 5px);
    cursor: pointer;
  }
  .edits button:disabled {
    /* The same figure Gated dims with: one vocabulary for "not available". */
    opacity: 0.4;
    cursor: default;
  }
  .edits button:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
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
    font-size: var(--he-size-md, 16px);
    font-weight: 600;
    color: var(--he-override, #d9a05b);
    background: none;
    border: 1px solid var(--he-override, #d9a05b);
    border-radius: var(--he-radius-control, 5px);
    padding: 5px 11px;
    cursor: pointer;
  }
  .resume .dot {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-override, #d9a05b);
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
    background: var(--he-stage, #0b0d11);
  }
  /* Over the editor, because the setup is walking someone through it. The
     third step is a banner at the top instead: a card in the middle would
     cover the very keys it is asking for (board 6c). */
  .setup {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    /* The wrapper spans the stage so the card can be centred in it; without
       this it would also swallow every click meant for the keys underneath. */
    pointer-events: none;
  }
  .setup > :global(*) {
    pointer-events: auto;
  }
  /* The third step is a banner at the top: a card in the middle would cover
     the very keys the step is asking for (board 6c). */
  .setup.banner {
    align-items: start;
    padding-block-start: 52px;
  }

  .panel {
    flex: none;
    inline-size: var(--he-panel-width, 380px);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-inline-start: 1px solid var(--he-border, #1b1e27);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 10px 18px;
    border-block-end: 1px solid var(--he-border, #1b1e27);
  }
  /* The one section worth the leftover room: folding the others is what this
     is for. */
  .keys-block {
    flex: 1;
    min-block-size: 0;
    overflow-y: auto;
  }
  .foot {
    margin-block-start: auto;
    display: flex;
    flex-direction: column;
    padding: 11px 18px;
    border-block-start: 1px solid var(--he-border, #1b1e27);
    background: var(--he-stage, #0b0d11);
  }

  .url {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
  }
  .url input {
    flex: 1;
    min-inline-size: 0;
    border: none;
    background: none;
    padding: 0;
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    font-size: var(--he-size-xs, 14px);
    color: var(--he-text-faint, #5a5f70);
    text-overflow: ellipsis;
  }
  .link {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-sm, 15px);
    font-weight: 600;
    color: var(--he-accent, #7c9eff);
  }
  .link:hover {
    color: var(--he-accent-hover, #a5bcff);
  }
  .link:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 2px;
  }

  .figure,
  .state,
  .fine {
    margin: 0;
    font-size: var(--he-size-xs, 14px);
    color: var(--he-text-faint, #5a5f70);
    line-height: 1.45;
  }
  .figure {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 9px;
    background: var(--he-surface, #151823);
    border-radius: var(--he-radius, 4px);
  }
  .figure .value {
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    font-size: var(--he-size-xs, 14px);
    color: var(--he-text, #dde1e9);
  }
  .state {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .state .dot {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-border-hover, #3a4054);
  }
  .state .dot[data-live='true'] {
    background: var(--he-ok, #4caf7d);
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--he-size-sm, 15px);
    color: var(--he-text-muted, #8b90a0);
    padding-block: 3px;
  }
  .secret {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .secret input {
    min-inline-size: 0;
    flex: 1;
  }
  .secret button {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-xs, 14px);
    color: var(--he-accent, #7c9eff);
  }
  .secret button:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 2px;
  }
  .field input {
    inline-size: 8rem;
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    font-size: var(--he-size-sm, 15px);
    color: var(--he-text, #dde1e9);
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    padding: 4px 7px;
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
    gap: 8px;
    padding: 5px 9px;
    border-radius: var(--he-radius, 4px);
    font-size: var(--he-size-md, 16px);
  }
  .keys li:hover {
    background: var(--he-surface, #151823);
  }
  .keys li.selected {
    background: var(--he-surface, #151823);
  }
  .pick {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-inline-size: 0;
    cursor: pointer;
  }
  .pick:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 2px;
  }
  .label {
    font-weight: 600;
    min-inline-size: 2.5rem;
  }
  .mode {
    font-size: var(--he-size-xs, 14px);
    color: var(--he-text-faint, #5a5f70);
  }
  /* One class for both tags: they are the same mark, and the words are what
     separate a style override from a name someone typed. */
  .customized {
    font-size: var(--he-size-xs, 14px);
    color: var(--he-override, #d9a05b);
    white-space: nowrap;
  }
  /* Red where the override tag is amber: an override is a choice, and this is
     a key nobody can see. */
  .offscreen {
    font-size: var(--he-size-xs, 14px);
    font-weight: 600;
    color: var(--he-danger, #e06c5b);
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
    color: var(--he-text-faint, #5a5f70);
    opacity: 0;
  }
  .keys li:hover .trash,
  .trash:focus-visible {
    opacity: 1;
  }
  .trash:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 2px;
  }

  select {
    font: inherit;
    font-size: var(--he-size-md, 16px);
    color: var(--he-text, #dde1e9);
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    padding: 4px 6px;
  }
</style>
