<script lang="ts">
	let { status }: { status: 'idle' | 'saving' | 'saved' | 'error' } = $props();
</script>

{#if status === 'saving'}
	<span class="status saving">Saving…</span>
{:else if status === 'saved'}
	<span class="status saved">✓ Saved</span>
{:else if status === 'error'}
	<span class="status error">Save failed</span>
{/if}

<style>
	.status {
		font-size: 12px;
	}
	.saving {
		color: var(--text-muted);
	}
	.saved {
		color: var(--text-success);
	}
	.error {
		color: var(--text-danger);
	}
</style>
