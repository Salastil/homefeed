<script lang="ts">
	/**
	 * Embeddings & tags: the embedding model storylines and tagging run on, and how tags are
	 * merged and expired. Cheap on CPU, so it works with the AI writer off. The embedding
	 * server's address is under Connections.
	 */
	import type { AdminSettings, AiStatusBySlot, ModelCatalog } from '$lib/adminTypes';
	import { updateSettings } from '$lib/adminApi';
	import { saver } from '$lib/adminSaver.svelte';
	import SaveStatus from './SaveStatus.svelte';

	let { settings, models, aiStatus }: { settings: AdminSettings; models: ModelCatalog; aiStatus: AiStatusBySlot } = $props();

	// svelte-ignore state_referenced_locally
	let embedding = $state(settings.selectedModels.embedding);
	// svelte-ignore state_referenced_locally
	let dedup = $state(settings.tagDedupThreshold);
	// svelte-ignore state_referenced_locally
	let expiry = $state(settings.tagExpiryDays);
	const m = saver(0);
	const t = saver();
	const list = $derived(models.embedding.includes(embedding) || !embedding ? models.embedding : [embedding, ...models.embedding]);
</script>

<div class="adm">
	<div class="panel">
		<div class="ph"><span class="pt">Embedding model</span><span class="sp"></span><SaveStatus status={m.status} /></div>
		<p class="hint">
			Turns each article into numbers so similar ones can be found: storylines, tracked-item developments and tags all use it.
			{#if aiStatus.embedding.connected}<span class="ok">✓ Server connected · {aiStatus.embedding.host}:{aiStatus.embedding.port}</span>{:else}<span class="err">✕ Server unreachable</span>{/if}
			· <a href="/admin/settings?tab=connections#ai-servers">server address</a>
		</p>
		<select bind:value={embedding} onchange={() => m.run(() => updateSettings({ selectedModels: { ...settings.selectedModels, embedding } }))}>
			{#each list as x (x)}<option value={x}>{x}</option>{/each}
		</select>
	</div>

	<div class="panel">
		<div class="ph"><span class="pt">Tags</span><span class="sp"></span><SaveStatus status={t.status} /></div>
		<div class="grid2">
			<div>
				<span class="lbl">Merge tags this alike</span>
				<div class="slider">
					<input type="range" min="0.5" max="0.99" step="0.01" bind:value={dedup} oninput={() => t.run(() => updateSettings({ tagDedupThreshold: dedup }))} aria-label="Tag dedup threshold" />
					<b>{Number(dedup).toFixed(2)}</b>
				</div>
			</div>
			<label class="fld">
				<span class="lbl">Forget a tag after</span>
				<select bind:value={expiry} onchange={() => t.run(() => updateSettings({ tagExpiryDays: expiry }))}>
					{#each [7, 21, 60] as d (d)}<option value={d}>{d} days unused</option>{/each}
				</select>
			</label>
		</div>
	</div>
</div>
