<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { login } from '$lib/adminApi';

	let apiKey = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		loading = true;
		try {
			await login(apiKey);
			const redirectTo = $page.url.searchParams.get('redirectTo') || '/admin/settings';
			await goto(redirectTo);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Login failed';
		} finally {
			loading = false;
		}
	}
</script>

<div class="wrap">
	<form onsubmit={handleSubmit}>
		<span class="title">Admin login</span>
		<p class="hint">
			Find the API key printed in your backend server's console output when it starts up. It's
			generated fresh every restart, so check there again if this one stops working.
		</p>

		<label class="field-label" for="apiKey">API Key</label>
		<input id="apiKey" type="password" bind:value={apiKey} autocomplete="off" />

		{#if error}<div class="error">{error}</div>{/if}

		<button type="submit" class="primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
	</form>
</div>

<style>
	.wrap {
		display: flex;
		justify-content: center;
		padding-top: 60px;
	}
	form {
		width: 280px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.title {
		font-family: var(--font-voice);
		font-size: 22px;
		font-weight: 500;
		margin-bottom: 8px;
	}
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		line-height: 1.5;
		margin: 0 0 4px;
	}
	.field-label {
		font-size: 11px;
		color: var(--text-muted);
	}
	input {
		width: 100%;
		margin-bottom: 4px;
	}
	.primary {
		margin-top: 8px;
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.error {
		font-size: 12px;
		color: var(--text-danger);
	}
</style>
