<script lang="ts">
  import { clockTime, groupRuns, type JournalEntry } from './journal';
  import type { StreamReading } from './probe';
  import { copyToClipboard } from './clipboard';
  import { obsProbeHint, type ObsProbeStatus } from './settings';
  import type { HalcyonSource } from './sources';
  import type { AttentionItem } from './attention';
  import { Check, Copy } from './icons';
  import HelpText from './HelpText.svelte';

  /**
   * The panel a bug report is written from (spec §11, §12.3), in three parts
   * since 2026-11-06 (boards OBS-Diagnostics, Editor-Diagnostics):
   *
   * - **Needs attention** — what is going on now and asks for a gesture, each
   *   line with the gesture. Only these light the gear's dot.
   * - **Status** — the Halcyon sources OBS lists, and Reload.
   * - **Activity** — the journal, newest first, repeats folded.
   *
   * The tools a report needs (live reading, raw report, background probe, a
   * test connection, the build) follow, under their own heading: the boards
   * do not draw them, and nothing in the plan retires them.
   */
  let {
    entries,
    logText,
    readings,
    snapshot,
    capturing,
    probing,
    probe,
    obsProbe,
    sources,
    attention,
    onCaptureRaw,
    onToggleProbe,
    onTestObs,
    onReloadSources,
    onUseAuto,
    onChangeFont,
  }: {
    entries: readonly JournalEntry[];
    /**
     * Called on the click, never on render: building it walks the whole
     * journal, and this component redraws with the frame.
     */
    logText: () => string;
    /**
     * A function, so that nothing is computed while the panel is shut. The
     * reading follows the frame — sixty times a second — and a closed panel
     * must not make the capture page compete with its own broadcast.
     */
    readings: () => readonly { id: number; label: string; travel: number; active: boolean }[];
    snapshot: string | null;
    capturing: boolean;
    probing: boolean;
    probe: StreamReading | null;
    /** What a throwaway connection to OBS answered, or null if never asked. */
    obsProbe: ObsProbeStatus | null;
    /** Our sources as OBS lists them, or null while nobody has looked. */
    sources: HalcyonSource[] | null;
    /** What needs a gesture now (`needsAttention`). */
    attention: readonly AttentionItem[];
    onCaptureRaw: () => void;
    onToggleProbe: () => void;
    onTestObs: () => void;
    onReloadSources: () => Promise<number>;
    /** Gives the keyboard layout back to the detection. */
    onUseAuto: () => void;
    /** Takes someone to Global style › Label, where the font is chosen. */
    onChangeFont: () => void;
  } = $props();

  /**
   * Idle, done, or failed — never a bare boolean.
   *
   * "Copied" over an empty clipboard is worse than no button at all: the
   * person walks away, pastes nothing, and blames the paste. It never re-armed
   * either, so a second copy gave no feedback whatever. Timers are banned on
   * this page, so the reset rides the blur.
   */
  let copyState = $state<'idle' | 'done' | 'failed'>('idle');

  async function copy() {
    // The build and the browser go with it. They are the two facts a reader
    // needs before the first line, and the two nobody thinks to paste — the
    // user agent in particular names OBS's embedded Chromium (spec §2.1).
    const header = `Halcyon ${__BUILD__}\n${navigator.userAgent}\n\n`;
    copyState = (await copyToClipboard(navigator, header + logText())) ? 'done' : 'failed';
  }

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  /** Five lines, then "Show all": the rest is one click away, never in the way. */
  const SHOWN = 5;
  const runs = $derived(groupRuns(entries));
  let showAll = $state(false);
  const visible = $derived(showAll ? runs : runs.slice(0, SHOWN));

  const ACTIONS: Record<AttentionItem['action'], string> = {
    'use-auto': 'Use auto',
    'change-font': 'Change font',
  };
  function act(action: AttentionItem['action']) {
    if (action === 'use-auto') onUseAuto();
    else onChangeFont();
  }

  /**
   * Read once per render, not twice: `readings` walks every configured key on
   * every call (task 16), and the template needs it for the empty check and
   * for the `{#each}`. This component only exists while the panel is open.
   */
  const currentReadings = $derived(readings());
</script>

<div class="body">
  <section class="part" aria-labelledby="diag-attention">
    <h3 id="diag-attention">Needs attention</h3>
    {#if attention.length === 0}
      <p class="line good" data-all-good>
        <span class="tick" aria-hidden="true"><Check size={16} /></span>
        All good
      </p>
    {:else}
      {#each attention as item (item.id)}
        <p class="line" data-attention={item.action}>
          <span class="dot warn" aria-hidden="true"></span>
          <span class="text">{item.text}</span>
          <button
            type="button"
            class="he-btn-tertiary"
            data-action={item.action}
            onclick={() => act(item.action)}
          >
            {ACTIONS[item.action]}
          </button>
        </p>
      {/each}
    {/if}
  </section>

  {#if sources !== null}
    <section class="part" aria-labelledby="diag-status">
      <h3 id="diag-status">Status</h3>
      <p class="line sources" data-sources>
        <span class="dot" class:ok={sources.length > 0} aria-hidden="true"></span>
        {#if sources.length === 0}
          <span class="text">No Halcyon source in OBS.</span>
        {:else}
          <span class="text">
            Halcyon sources in OBS:
            {#each sources as source, i (source.name)}
              <span data-source
                ><span class="name">{source.name}</span>{#if source.scenes.length > 0}<span
                    class="hosts">{` (${source.scenes.join(', ')})`}</span
                  >{/if}</span
              >{i < sources.length - 1 ? ', ' : ''}
            {/each}
          </span>
        {/if}
        <button
          type="button"
          class="he-btn-tertiary"
          data-reload-sources
          onclick={() => void onReloadSources()}
        >
          Reload
        </button>
      </p>
    </section>
  {/if}

  <hr />

  <section class="part" aria-labelledby="diag-activity">
    <div class="head">
      <h3 id="diag-activity">Activity</h3>
      <button
        type="button"
        class="he-btn-tertiary"
        data-action="copy"
        onclick={copy}
        onblur={() => (copyState = 'idle')}
        title={copyState === 'failed' ? 'Select the lines below and copy them by hand' : undefined}
      >
        <Copy size={14} />
        {copyState === 'done' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy log'}
      </button>
    </div>
    {#if runs.length === 0}
      <p class="line empty">Nothing has happened worth writing down.</p>
    {:else}
      <ul class="log">
        {#each visible as run (run.id)}
          <li data-kind={run.kind}>
            <span class="at">{clockTime(run.time)}</span>
            <span class="text">{run.message}</span>
            {#if run.count > 1}<span class="times" data-count>×{run.count}</span>{/if}
          </li>
        {/each}
      </ul>
      {#if !showAll && runs.length > SHOWN}
        <button
          type="button"
          class="he-btn-tertiary show-all"
          data-action="show-all"
          onclick={() => (showAll = true)}
        >
          Show all ({runs.length})
        </button>
      {/if}
    {/if}
  </section>

  <hr />

  <section class="part tools" aria-labelledby="diag-tools">
    <h3 id="diag-tools">Tools</h3>

    <!-- The one place a raw travel value is shown. The overlay never displays
         a number, on purpose — see "Deliberate deviations". -->
    <h4>Live reading</h4>
    {#if currentReadings.length === 0}
      <p class="empty">No keys configured.</p>
    {:else}
      <ul class="readings">
        {#each currentReadings as reading (reading.id)}
          <li data-reading={reading.id} data-active={reading.active}>
            <span class="label">{reading.label}</span>
            <span class="mono">#{reading.id}</span>
            <span class="travel">{reading.travel}</span>
            <span class="dot" aria-hidden="true"></span>
          </li>
        {/each}
      </ul>
    {/if}

    <h4>Raw report</h4>
    <button type="button" class="he-btn-secondary" data-action="capture" onclick={onCaptureRaw}>
      {capturing ? 'Waiting for a key' : 'Capture raw report'}
    </button>
    {#if snapshot}
      <pre data-snapshot>{snapshot}</pre>
    {/if}

    <h4>Background stream</h4>
    <div class="he-with-help tool">
      <button type="button" class="he-btn-secondary" data-action="probe" onclick={onToggleProbe}>
        {probing ? 'Stop probe' : 'Start background probe'}
      </button>
      <HelpText>
        Start it, switch to the game, and keep typing. Chrome throttles timers in a background tab;
        the keyboard stream should not follow.
      </HelpText>
    </div>
    {#if probe}
      <ul class="readings">
        <li><span class="label">Reports</span><span class="travel">{probe.reports}</span></li>
        <li>
          <span class="label">Widest gap</span><span class="travel">{probe.maxGapMs} ms</span>
        </li>
        <li>
          <span class="label">Watched for</span><span class="travel">{seconds(probe.sinceMs)}</span>
        </li>
      </ul>
    {/if}

    <h4>OBS connection</h4>
    <div class="he-with-help tool">
      <button type="button" class="he-btn-secondary" data-action="test-obs" onclick={onTestObs}>
        Test OBS connection
      </button>
      <HelpText>
        Opens a second, temporary connection with the port and password as typed. OBS will show two
        clients for a moment; nothing is sent through it.
      </HelpText>
    </div>
    {#if obsProbe}
      <p class="mono" data-obs-probe>{obsProbeHint(obsProbe)}</p>
    {/if}

    <h4>This build</h4>
    <p class="mono" data-build>Halcyon {__BUILD__}</p>
    <p class="mono agent">{navigator.userAgent}</p>
  </section>
</div>

<style>
  .body {
    display: flex;
    flex-direction: column;
    font: var(--he-font);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .part {
    display: flex;
    flex-direction: column;
    padding-block-end: 6px;
  }
  /* The parts' titles: capitals, spaced, quiet (board OBS-Diagnostics). */
  h3 {
    margin: 0;
    padding: 12px 14px 6px;
    font-size: var(--he-size-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--he-text-muted);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-inline-end: 14px;
  }
  hr {
    inline-size: 100%;
    block-size: 1px;
    margin: 4px 0 0;
    border: none;
    background: var(--he-border);
  }

  .line {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 4px 14px;
    line-height: 1.5;
  }
  .line .text {
    flex: 1;
    min-inline-size: 0;
  }
  [data-attention] .text {
    color: var(--he-text);
  }
  .good {
    align-items: center;
    color: var(--he-text);
  }
  .tick {
    display: inline-grid;
    color: var(--he-ok);
  }
  .dot {
    flex: none;
    inline-size: 7px;
    block-size: 7px;
    margin-block-start: 6px;
    border-radius: 50%;
    background: var(--he-text-muted);
  }
  .dot.warn {
    background: var(--he-warn);
  }
  .dot.ok {
    background: var(--he-ok);
  }
  .sources .name {
    color: var(--he-text);
  }

  /* Five lines, then the list scrolls inside 200 px once Show all opens it. */
  .log {
    max-block-size: 200px;
    overflow-y: auto;
    margin: 0;
    padding: 0 0 4px;
    list-style: none;
  }
  .log li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 3px 14px;
    line-height: 1.5;
  }
  .log .text {
    flex: 1;
    min-inline-size: 0;
  }
  .at,
  .times,
  .mono,
  pre,
  .readings li {
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .at {
    flex: none;
  }
  .times {
    flex: none;
    padding: 0 5px;
    border: 1px solid var(--he-border);
    border-radius: var(--he-radius);
    background: var(--he-surface-low);
  }
  .show-all {
    align-self: flex-start;
    margin: 6px 14px 6px;
  }
  .empty {
    margin: 0;
  }

  .tools {
    gap: 6px;
    align-items: flex-start;
    padding-inline: 14px;
    padding-block-end: 14px;
  }
  .tools h3 {
    padding-inline: 0;
  }
  h4 {
    margin: 8px 0 0;
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-text);
  }
  .tools .he-btn-secondary {
    block-size: 28px;
  }
  /* The button keeps its width; the sentence under it takes the line. */
  .tool {
    justify-items: start;
  }
  .mono {
    margin: 0;
    line-height: 1.45;
  }
  .agent {
    /* A user agent is one long unbreakable token; without this it widens the
       whole panel rather than wrapping. */
    overflow-wrap: anywhere;
  }
  .readings {
    inline-size: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .readings li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .readings .label {
    inline-size: 5.5rem;
    font-weight: 600;
  }
  .readings .travel {
    margin-left: auto;
    color: var(--he-text);
  }
  .readings .dot {
    inline-size: 6px;
    block-size: 6px;
    margin: 0;
    background: var(--he-border-hover);
  }
  .readings li[data-active='true'] .dot {
    background: var(--he-accent);
  }
  pre {
    inline-size: 100%;
    box-sizing: border-box;
    margin: 0;
    padding: 7px 9px;
    overflow-x: auto;
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
  }
</style>
