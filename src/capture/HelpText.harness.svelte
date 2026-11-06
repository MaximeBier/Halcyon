<script lang="ts">
  import HelpText from './HelpText.svelte';

  let { text }: { text: string } = $props();
</script>

<HelpText>{text}</HelpText>
