<script lang="ts">
  import { buildScene } from './scene';
  import type { ResolvedConfig } from '../config/schema';
  import type { FrameKey } from '../protocol/messages';

  let {
    config,
    frame,
    decorations = false,
    pack = false,
  }: {
    config: ResolvedConfig;
    frame: readonly FrameKey[];
    /**
     * Cues reserved for the editor: dashed border and AXIS label.
     * False by default - the overlay must never display them (spec 16.3).
     */
    decorations?: boolean;
    /**
     * Pull the keys into the top-left corner (spec §5.4). On for the
     * broadcast, off for the editor, whose handles are positioned from the
     * raw coordinates and would drift away from a packed drawing.
     */
    pack?: boolean;
  } = $props();

  const scene = $derived(buildScene(config, frame, { pack }));

  /**
   * Prefix for the clip path ids, unique to this instance of the component.
   *
   * A fixed id would collide the moment two views share a page — which the
   * capture page is meant to do, the editor beside a packed preview — and the
   * second view's fills would then clip against the first view's key. Right
   * only by accident, and silently wrong the rest of the time.
   */
  const uid = $props.id();
</script>

<svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`}>
  {#each scene.keys as key (key.id)}
    <g opacity={key.opacity}>
      <rect x={key.x} y={key.y} width={key.w} height={key.h} rx={key.radius} fill={key.baseFill} />
      <!-- Clipped to the key, and carrying **no radius of its own**.
           SVG clamps `rx` to half the width, so a barely-started fill six
           pixels wide was rounded by three where the key was rounded by eight,
           and its corners stood outside the key's own. No radius on the fill
           can fix that: the fill is not the shape being rounded. The clip also
           keeps the fill square where it stops in mid-key, which a radius drew
           as a notch. -->
      <rect
        x={key.fill.x}
        y={key.fill.y}
        width={key.fill.w}
        height={key.fill.h}
        fill={key.fill.color}
        clip-path={`url(#${uid}-${key.id})`}
      />
      <rect
        x={key.x + 0.5}
        y={key.y + 0.5}
        width={Math.max(0, key.w - 1)}
        height={Math.max(0, key.h - 1)}
        rx={key.radius}
        fill="none"
        stroke={key.borderColor}
        stroke-dasharray={decorations && key.axis ? '3 2' : undefined}
      />
      <!-- `paint-order` puts the outline under the glyph rather than over it,
           so the stroke thickens the letter outward instead of eating into it.
           One fixed label colour, readable on any fill. -->
      <text
        x={key.x + key.w / 2}
        y={key.y + key.h / 2}
        text-anchor="middle"
        dominant-baseline="middle"
        fill={key.labelFill}
        stroke={key.labelOutline}
        stroke-width={key.labelOutlineWidth}
        stroke-linejoin="round"
        paint-order="stroke fill"
        font-family={key.fontFamily}
        font-weight={key.fontWeight}
        font-size={key.fontSize}
      >
        {key.label}
      </text>
      <!-- A definition rather than a drawing, so it sits at the end where it
           does not interrupt the painting order — and inside the key's own
           group, next to the geometry it repeats. -->
      <clipPath id={`${uid}-${key.id}`}>
        <rect x={key.x} y={key.y} width={key.w} height={key.h} rx={key.radius} />
      </clipPath>

      {#if decorations && key.axis}
        <text
          x={key.x + key.w - 4}
          y={key.y + 9}
          text-anchor="end"
          fill={key.labelFill}
          font-family={key.fontFamily}
          font-size="8"
          opacity="0.75"
        >
          AXIS
        </text>
      {/if}
    </g>
  {/each}
</svg>
