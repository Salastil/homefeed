<script lang="ts">
	import type { AdminSettings, AiStatus, TelegramStatus } from '$lib/adminTypes';
	import { getBackendUrl, setBackendUrl } from '$lib/config';
	import {
		updateSettings,
		getAiStatus,
		saveTelegramCredentials,
		startTelegramLogin,
		verifyTelegramCode,
		verifyTelegramPassword,
		telegramLogout
	} from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let {
		settings,
		aiStatus: initialStatus,
		telegramStatus: initialTelegramStatus
	}: { settings: AdminSettings; aiStatus: AiStatus; telegramStatus: TelegramStatus } = $props();

	let backendUrl = $state(getBackendUrl());
	let backendSaved = $state(false);

	let aiHost = $state(settings.aiServiceHost);
	let aiPort = $state(settings.aiServicePort);
	let aiStatus = $state(initialStatus);
	let testing = $state(false);
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	function saveBackendUrl() {
		setBackendUrl(backendUrl);
		backendSaved = true;
		setTimeout(() => (backendSaved = false), 1500);
	}

	async function saveAiService() {
		status = 'saving';
		try {
			await updateSettings({ aiServiceHost: aiHost, aiServicePort: aiPort });
			aiStatus = await getAiStatus();
			status = 'saved';
			setTimeout(() => (status = 'idle'), 1500);
		} catch {
			status = 'error';
		}
	}

	async function testConnection() {
		testing = true;
		try {
			aiStatus = await getAiStatus();
		} finally {
			testing = false;
		}
	}

	// --- Telegram account ---
	let credentialsConfigured = $state(initialTelegramStatus.credentialsConfigured);
	let apiId = $state('');
	let apiHash = $state('');
	let apiCredsStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	type LoginPhase = 'disconnected' | 'phone-entry' | 'code-sent' | 'password-needed' | 'connected' | 'error';
	let loginPhase = $state<LoginPhase>(initialTelegramStatus.connected ? 'connected' : 'disconnected');
	let connectedPhone = $state(initialTelegramStatus.phone);
	let phoneNumber = $state('');
	let code = $state('');
	let password = $state('');
	let loginError = $state('');
	let loginBusy = $state(false);

	async function saveApiCredentials() {
		const idNum = Number(apiId);
		if (!idNum || !apiHash.trim()) return;
		apiCredsStatus = 'saving';
		try {
			await saveTelegramCredentials(idNum, apiHash.trim());
			credentialsConfigured = true;
			apiId = '';
			apiHash = '';
			apiCredsStatus = 'saved';
			setTimeout(() => (apiCredsStatus = 'idle'), 1500);
		} catch {
			apiCredsStatus = 'error';
		}
	}

	async function submitPhone() {
		loginBusy = true;
		loginError = '';
		try {
			await startTelegramLogin(phoneNumber.trim());
			loginPhase = 'code-sent';
		} catch (err) {
			loginError = (err as Error).message;
			loginPhase = 'error';
		} finally {
			loginBusy = false;
		}
	}

	async function submitCode() {
		loginBusy = true;
		loginError = '';
		try {
			const result = await verifyTelegramCode(code.trim());
			if (result.phase === 'connected') {
				connectedPhone = result.phone ?? phoneNumber.trim();
				loginPhase = 'connected';
			} else {
				loginPhase = 'password-needed';
			}
		} catch (err) {
			loginError = (err as Error).message;
			loginPhase = 'error';
		} finally {
			loginBusy = false;
		}
	}

	async function submitPassword() {
		loginBusy = true;
		loginError = '';
		try {
			const result = await verifyTelegramPassword(password);
			connectedPhone = result.phone ?? phoneNumber.trim();
			loginPhase = 'connected';
		} catch (err) {
			loginError = (err as Error).message;
			loginPhase = 'error';
		} finally {
			loginBusy = false;
		}
	}

	async function disconnectTelegram() {
		if (!confirm('Disconnect this Telegram account? Telegram sources will stop ingesting until you log in again.')) return;
		loginBusy = true;
		try {
			await telegramLogout();
		} finally {
			loginBusy = false;
			loginPhase = 'disconnected';
			connectedPhone = null;
			phoneNumber = '';
			code = '';
			password = '';
		}
	}

	function tryLoginAgain() {
		loginError = '';
		loginPhase = 'disconnected';
		code = '';
		password = '';
	}
</script>

<div class="panel">
	<div class="head">
		<span class="panel-title">Backend address</span>
		{#if backendSaved}<span class="saved-note">✓ Saved to this browser</span>{/if}
	</div>
	<p class="hint">
		Stored in this browser only — each device connecting to the admin panel sets its own
		backend address. Not synced across devices.
	</p>
	<div class="row">
		<input type="text" bind:value={backendUrl} placeholder="https://backend.homefeed.local:8443" />
		<button onclick={saveBackendUrl}>Save</button>
	</div>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">AI service connection</span>
		<SaveStatus {status} />
	</div>
	<p class="hint">
		Address of your self-hosted inference server (e.g. Ollama). This is a backend setting,
		shared across everyone using this admin panel.
	</p>
	<div class="row">
		<input type="text" bind:value={aiHost} placeholder="http://10.0.0.14" style="flex: 1" />
		<input type="text" bind:value={aiPort} placeholder="11434" style="width: 90px" />
		<button onclick={testConnection} disabled={testing}>{testing ? 'Testing…' : 'Test'}</button>
		<button class="primary" onclick={saveAiService}>Save</button>
	</div>
	<div class="status-row">
		{#if aiStatus.connected}
			<span class="connected">✓ Connected · {aiStatus.ramGB}GB RAM · GPU: {aiStatus.gpu}</span>
		{:else}
			<span class="disconnected">✕ Unreachable</span>
		{/if}
	</div>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">Telegram account</span>
		<SaveStatus status={apiCredsStatus} />
	</div>
	<p class="hint">
		Reading channels requires logging into a real Telegram account (not a bot), so it can see
		any public channel that account can see. Get an API ID/hash from
		<a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a> — a
		dedicated/secondary account is recommended over your primary one. Both are stored encrypted,
		never sent back to this browser.
	</p>
	<div class="row">
		<input type="text" inputmode="numeric" placeholder="API ID" bind:value={apiId} style="width: 120px" />
		<input type="text" placeholder="API Hash" bind:value={apiHash} style="flex: 1" />
		<button class="primary" onclick={saveApiCredentials} disabled={!apiId || !apiHash.trim()}>Save</button>
	</div>
	{#if credentialsConfigured}
		<div class="status-row"><span class="connected">✓ API credentials saved</span></div>
	{/if}

	<div class="login-section">
		{#if !credentialsConfigured}
			<p class="hint">Save your API ID and hash above before logging in.</p>
		{:else if loginPhase === 'connected'}
			<div class="status-row"><span class="connected">✓ Connected as {connectedPhone}</span></div>
			<button onclick={disconnectTelegram} disabled={loginBusy}>{loginBusy ? 'Disconnecting…' : 'Disconnect'}</button>
		{:else if loginPhase === 'error'}
			<div class="status-row"><span class="disconnected">✕ {loginError}</span></div>
			<button onclick={tryLoginAgain}>Try again</button>
		{:else if loginPhase === 'code-sent'}
			<p class="hint">Enter the login code Telegram just sent to {phoneNumber}.</p>
			<div class="row">
				<input type="text" placeholder="Login code" bind:value={code} />
				<button class="primary" onclick={submitCode} disabled={loginBusy || !code.trim()}>
					{loginBusy ? 'Verifying…' : 'Verify'}
				</button>
			</div>
		{:else if loginPhase === 'password-needed'}
			<p class="hint">This account has two-factor authentication enabled — enter its password.</p>
			<div class="row">
				<input type="password" placeholder="2FA password" bind:value={password} />
				<button class="primary" onclick={submitPassword} disabled={loginBusy || !password}>
					{loginBusy ? 'Verifying…' : 'Verify'}
				</button>
			</div>
		{:else}
			<div class="row">
				<input type="text" placeholder="Phone number, e.g. +15551234567" bind:value={phoneNumber} />
				<button class="primary" onclick={submitPhone} disabled={loginBusy || !phoneNumber.trim()}>
					{loginBusy ? 'Sending…' : 'Log in'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.panel-title {
		font-size: 13px;
		font-weight: 500;
	}
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 4px 0 12px;
	}
	.row {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
	}
	.row input {
		flex: 1;
	}
	.primary {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.saved-note {
		font-size: 12px;
		color: var(--text-success);
	}
	.status-row {
		font-size: 12px;
	}
	.connected {
		color: var(--text-success);
	}
	.disconnected {
		color: var(--text-danger);
	}
	.login-section {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 0.5px solid var(--border);
	}
	.login-section .hint {
		margin: 0 0 10px;
	}
</style>
