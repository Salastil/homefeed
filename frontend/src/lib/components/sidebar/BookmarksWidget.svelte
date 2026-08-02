<script lang="ts">
	import type { Bookmark } from '$lib/types';

	let { bookmarks, columns = 1 }: { bookmarks: Bookmark[]; columns?: 1 | 2 | 3 } = $props();
</script>

<div class="widget">
	<span class="title">Bookmarks</span>
	{#if bookmarks.length > 0}
		<div class="list" class:grid={columns > 1} style:grid-template-columns={columns > 1 ? `repeat(${columns}, 1fr)` : undefined}>
			{#each bookmarks as bookmark (bookmark.id)}
				<a class="row" href={bookmark.url} target="_blank" rel="noopener noreferrer">{bookmark.name}</a>
			{/each}
		</div>
	{:else}
		<p class="empty">No bookmarks yet</p>
	{/if}
</div>

<style>
	.widget {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
	}
	.title {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.list {
		display: flex;
		flex-direction: column;
		margin-top: 8px;
	}
	.list.grid {
		display: grid;
		gap: 6px;
	}
	.row {
		font-size: 13px;
		padding: 6px 0;
		border-top: 0.5px solid var(--border);
		color: inherit;
	}
	.row:first-child {
		border-top: none;
	}
	.list.grid .row {
		border-top: none;
		padding: 6px 8px;
		background: var(--surface-2);
		border-radius: var(--radius);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row:hover {
		color: var(--text-accent);
	}
	.empty {
		font-size: 12px;
		color: var(--text-muted);
		margin: 8px 0 0;
	}
</style>
