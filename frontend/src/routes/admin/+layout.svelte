<script lang="ts">
	import { goto } from '$app/navigation';
	import { logout } from '$lib/adminApi';

	let { children } = $props();

	async function handleLogout() {
		await logout();
		await goto('/admin/login');
	}
</script>

<div class="admin-shell">
	<div class="page admin-inner">
		<div class="top-row">
			<a class="back" href="/">← Back to site</a>
			<button class="logout" onclick={handleLogout}>Log out</button>
		</div>
		{@render children()}
	</div>
</div>

<style>
	.admin-shell {
		min-height: 100vh;
	}
	.admin-inner {
		padding-top: 20px;
	}
	.top-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.back {
		font-size: 12px;
		color: var(--text-muted);
	}
	.logout {
		font-size: 12px;
		padding: 5px 10px;
		background: transparent;
		color: var(--text-muted);
	}
	.logout:hover {
		color: var(--text-primary);
		background: var(--surface-1);
	}
</style>
