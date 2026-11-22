import type { Category, ContentItem, GlobalSettings, Source } from '../storage/db/types.js';

/**
 * Which items the AI writer leaves alone, by the column they land on. Mirrors how the board
 * sorts sources into columns (api/admin.ts boardOverview): a source in no board category
 * ("Top stories" is retired and doesn't count) feeds Wire if it posts (X, Telegram) and
 * General otherwise.
 *
 * - YouTube videos always publish as they are.
 * - Posts publish as posted unless they're in Wire and Wire's AI rewrite is on. Posts in a
 *   category column stay as posted whatever that column's switch says.
 * - Articles skip the writer when their category's AI rewrite is off, or when they're in
 *   General and General's is off.
 */
export function aiScope(settings: GlobalSettings, categories: Category[], sourcesById: Map<string, Source>) {
	const disabled = new Set(categories.filter((c) => c.disableAi).map((c) => c.name.toLowerCase()));
	const board = new Set(categories.map((c) => c.name.toLowerCase()).filter((n) => n !== 'top stories'));
	const leadingOf = (source: Source | undefined) => (source?.category ?? []).map((c) => c.split(':')[0].trim().toLowerCase());
	const isPost = (source: Source | undefined) => source?.type === 'nitter' || source?.type === 'telegram';

	/** Sources whose items always publish directly, by type: YouTube, and posts outside a rewritten Wire. */
	const directSourceIds = new Set(
		[...sourcesById.values()]
			.filter((s) => s.type === 'youtube' || (isPost(s) && !(settings.wireAiRewrite && !leadingOf(s).some((n) => board.has(n)))))
			.map((s) => s.id)
	);

	/** Articles whose column has AI rewrite off. */
	const columnAiOff = (item: ContentItem): boolean => {
		const source = sourcesById.get(item.sourceId);
		const leading = leadingOf(source);
		if (leading.some((n) => disabled.has(n))) return true;
		return !isPost(source) && !settings.generalAiRewrite && !leading.some((n) => board.has(n));
	};

	return { directSourceIds, columnAiOff };
}
