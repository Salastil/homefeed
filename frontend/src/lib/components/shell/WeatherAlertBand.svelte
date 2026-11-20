<script lang="ts">
	/**
	 * Active NWS alerts across the top of the weather page (issue #1, layout C): the alert
	 * being shown in full, and - when there are several - a chip per alert underneath. It's a
	 * carousel: every ROTATE_MS it moves to the next alert (most serious first), pausing while
	 * the pointer is over it or "What to do" is open; a chip jumps straight to its alert.
	 * Fixed height for a given number of alerts - "What to do" opens over the page instead of
	 * pushing it down.
	 */
	import type { WeatherAlert } from '$lib/types';
	import { clock } from '$lib/live.svelte';
	import { alertCountdown, alertLevel, alertWindow, sortAlerts } from '$lib/weatherAlerts';

	let { alerts }: { alerts: WeatherAlert[] } = $props();

	const ROTATE_MS = 10_000;
	const sorted = $derived(sortAlerts(alerts));
	let index = $state(0);
	const a = $derived(sorted[Math.min(index, sorted.length - 1)]);
	let open = $state(false);
	let hovering = $state(false);
	let startedAt = $state(Date.now());
	let now = $state(Date.now());
	const LABEL = { warning: 'Warning', watch: 'Watch', advisory: 'Advisory', statement: 'Statement' };

	$effect(() => {
		if (sorted.length < 2) return;
		const id = setInterval(() => {
			now = Date.now();
			if (hovering || open) {
				startedAt = now - Math.min(now - startedAt, ROTATE_MS - 1000);
				return;
			}
			if (now - startedAt >= ROTATE_MS) {
				index = (index + 1) % sorted.length;
				startedAt = now;
			}
		}, 250);
		return () => clearInterval(id);
	});
	const go = (i: number) => {
		index = i;
		startedAt = Date.now();
		open = false;
	};
	const progress = $derived(sorted.length > 1 ? Math.min(1, (now - startedAt) / ROTATE_MS) : 0);
</script>

{#if a}
	{@const lv = alertLevel(a)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<section class="band lv-{lv}" class:multi={sorted.length > 1} onmouseenter={() => (hovering = true)} onmouseleave={() => (hovering = false)}>
		<span class="ic">
			<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
		</span>
		<div class="what">
			<div class="k"><span class="lvl">{LABEL[lv]}</span><span class="by">{a.senderName ?? 'National Weather Service'}</span></div>
			<b>{a.event}</b>
			<div class="when">{alertWindow(a, clock.now)} · <em>{alertCountdown(a, clock.now)}</em></div>
		</div>
		<p class="desc">{a.description ?? a.headline}</p>
		<div class="side">
			{#if a.instruction}<button class="todo" onclick={() => (open = !open)} aria-expanded={open}>What to do {open ? '▴' : '▾'}</button>{/if}
		</div>
		{#if sorted.length > 1}
			<div class="chips">
				<span class="also">{sorted.length} alerts</span>
				{#each sorted as x, i (x.id)}
					<button class="chip lv-{alertLevel(x)}" class:on={i === index} onclick={() => go(i)}>
						<i></i>{x.event}<em>{alertWindow(x, clock.now)}</em>
						{#if i === index}<span class="cp" style:width="{progress * 100}%"></span>{/if}
					</button>
				{/each}
			</div>
		{/if}
		{#if open && a.instruction}
			<div class="pop">
				<b>What to do · {a.event}</b>
				<p>{a.instruction}</p>
				{#if a.areaDesc}<span>Areas: {a.areaDesc}</span>{/if}
			</div>
		{/if}
	</section>
{/if}

<style>
	.lv-warning {
		--lv: #e5484d;
	}
	.lv-watch {
		--lv: #f08c3c;
	}
	.lv-advisory {
		--lv: #e0b030;
	}
	.lv-statement {
		--lv: #3fa9dc;
	}
	.band {
		position: relative;
		flex: none;
		display: grid;
		grid-template-columns: 40px 380px minmax(0, 1fr) auto;
		grid-template-rows: 84px;
		column-gap: 18px;
		align-items: center;
		padding: 0 16px 0 16px;
		border-radius: 11px;
		border: 1px solid color-mix(in srgb, var(--lv) 55%, var(--bd));
		background: linear-gradient(90deg, color-mix(in srgb, var(--lv) 22%, var(--s1)), color-mix(in srgb, var(--lv) 6%, var(--s1)) 55%);
		box-shadow: inset 4px 0 0 var(--lv);
	}
	/* With several alerts the chips sit on a second row inside the same band. */
	.band.multi {
		grid-template-rows: 84px 40px;
	}
	.ic {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: var(--lv);
		background: color-mix(in srgb, var(--lv) 18%, transparent);
	}
	/* Three lines with room between them: issuer, event, window. */
	.what {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.k {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 18px;
		font-size: 11.5px;
		color: var(--tx3);
	}
	.lvl {
		flex: none;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		line-height: 16px;
		color: var(--lv);
		border: 1px solid color-mix(in srgb, var(--lv) 60%, transparent);
		border-radius: 4px;
		padding: 0 6px;
	}
	.what b {
		display: block;
		font-family: var(--serif);
		font-size: 20px;
		font-weight: 600;
		line-height: 1.15;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.when {
		font-size: 12px;
		line-height: 16px;
		color: var(--tx2);
		white-space: nowrap;
	}
	.when em {
		font-style: normal;
		color: var(--lv);
		font-weight: 600;
	}
	.desc {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--tx2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.side {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.todo {
		font-size: 12px;
		padding: 5px 11px;
		border-radius: 7px;
		border: 1px solid color-mix(in srgb, var(--lv) 55%, var(--bd));
		background: transparent;
		color: var(--tx);
		white-space: nowrap;
	}
	.chips {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 40px;
		border-top: 1px solid color-mix(in srgb, var(--lv) 30%, var(--bd));
		overflow: hidden;
	}
	.also {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--tx3);
		margin: 0 4px 0 58px;
		white-space: nowrap;
	}
	.chip {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		padding: 3px 11px;
		border-radius: 99px;
		border: 1px solid color-mix(in srgb, var(--lv) 45%, var(--bd));
		background: transparent;
		color: var(--tx2);
		white-space: nowrap;
	}
	.chip i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--lv);
	}
	.chip em {
		font-style: normal;
		font-size: 11px;
		color: var(--tx3);
	}
	/* The carousel timer: fills under the current alert's chip. */
	.cp {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		background: var(--lv);
	}
	.chip.on {
		color: var(--tx);
		background: color-mix(in srgb, var(--lv) 20%, transparent);
		border-color: var(--lv);
	}
	/* Stacked: one 42px row per alert. */
	.pop {
		position: absolute;
		right: 12px;
		top: calc(100% + 6px);
		z-index: 20;
		width: 440px;
		padding: 12px 14px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--lv) 55%, var(--bd));
		background: var(--s1);
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
		font-size: 12.5px;
	}
	.pop p {
		margin: 6px 0 8px;
		line-height: 1.5;
	}
	.pop span {
		font-size: 11.5px;
		color: var(--tx3);
	}
</style>
