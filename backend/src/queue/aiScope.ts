import type { Category, ContentItem, GlobalSettings, Source } from '../storage/db/types.js';

/**
 * Which items skip the AI writer because of the column they land in: a category with its
 * "AI rewrite" switch off, or the built-in General column (sources with no board column)
 * while settings.generalAiRewrite is off. Mirrors how the board sorts sources into columns
 * (api/admin.ts boardOverview): a source in no board category - "Top stories" is retired
 * and doesn't count - is General's. The Wire column needs no check here, since X and
 * Telegram posts always publish directly by source type.
 */
export function columnAiOff(settings: GlobalSettings, categories: Category[], sourcesById: Map<string, Source>): (item: ContentItem) => boolean {
	const disabled = new Set(categories.filter((c) => c.disableAi).map((c) => c.name.toLowerCase()));
	const board = new Set(categories.map((c) => c.name.toLowerCase()).filter((n) => n !== 'top stories'));
	return (item) => {
		const leading = (sourcesById.get(item.sourceId)?.category ?? []).map((c) => c.split(':')[0].trim().toLowerCase());
		if (leading.some((n) => disabled.has(n))) return true;
		return !settings.generalAiRewrite && !leading.some((n) => board.has(n));
	};
}
