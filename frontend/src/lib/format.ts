export function timeAgo(iso: string): string {
	const diffMs = Date.now() - new Date(iso).getTime();
	const mins = Math.round(diffMs / 60000);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return `${days}d ago`;
}

/** "05/31/2025 - 05:34 PM" — the original feed publish time (or synthesis time for merged articles), alongside the relative timeAgo(). */
export function exactTime(iso: string): string {
	const d = new Date(iso);
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	const yyyy = d.getFullYear();
	let hours = d.getHours();
	const minutes = String(d.getMinutes()).padStart(2, '0');
	const ampm = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12 || 12;
	return `${mm}/${dd}/${yyyy} - ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

/** Roughly the first N sentences of a plain-text body — enough to give a sense of the article without reading it. */
export function excerpt(body: string, sentenceCount = 2): string {
	const singleLine = body.replace(/\s+/g, ' ').trim();
	const sentences = singleLine.match(/[^.!?]+[.!?]+/g) ?? [singleLine];
	return sentences.slice(0, sentenceCount).join(' ').trim();
}

/** PoE currency values span many orders of magnitude (e.g. 0.00002749 to 4856) — a fixed decimal count alone reads badly across that range. */
export function formatPoeValue(value: number): string {
	if (value === 0) return '0';
	if (value >= 100) return value.toFixed(0);
	if (value >= 1) return value.toFixed(2);
	if (value >= 0.01) return value.toFixed(3);
	return value.toPrecision(2);
}

/**
 * A pair's inverse-direction % change isn't the negation of the forward change (that's only
 * an approximation) — it's the reciprocal-return identity: if rate went from `old` to `new`,
 * forward change = (new-old)/old, and inverse change = (1/new - 1/old)/(1/old) = (old-new)/new
 * = -change/(1+change/100). Derivable from the forward change alone, no extra data needed.
 */
export function invertChangePercent(change: number | null): number | null {
	if (change === null) return null;
	return -change / (1 + change / 100);
}
