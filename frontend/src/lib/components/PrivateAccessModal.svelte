<script lang="ts">
	import { loginPrivateAccess } from '$lib/privateAccess';

	let { onClose, onSuccess }: { onClose: () => void; onSuccess: () => void } = $props();

	let password = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function submit() {
		if (!password || loading) return;
		loading = true;
		error = null;
		try {
			await loginPrivateAccess(password);
			onSuccess();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()} role="presentation">
	<div
		class="modal"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-label="Private access login"
		tabindex="-1"
	>
		<h2>Private access</h2>
		<p class="hint">Enter the password to unlock private categories.</p>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<!-- svelte-ignore a11y_autofocus -->
			<input type="password" placeholder="Password" bind:value={password} autofocus />
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<div class="actions">
				<button type="button" class="secondary" onclick={onClose}>Cancel</button>
				<button type="submit" disabled={loading || !password}>{loading ? 'Checking…' : 'Unlock'}</button>
			</div>
		</form>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}
	.modal {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 20px;
		width: 100%;
		max-width: 320px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
	}
	h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 6px;
	}
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 0 0 14px;
	}
	input {
		width: 100%;
		margin-bottom: 10px;
	}
	.error {
		font-size: 12px;
		color: var(--text-danger);
		margin: 0 0 10px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.secondary {
		background: transparent;
		border: 0.5px solid var(--border);
		color: var(--text-secondary);
	}
</style>
