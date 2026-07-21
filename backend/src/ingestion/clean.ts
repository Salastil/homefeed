// Feed content (RSS/API) frequently arrives as raw HTML — sometimes double-escaped,
// sometimes not. Rendered as plain text (which is how ContentItem.summary/body get
// displayed for passthrough articles), unstripped tags show up literally as "<p>...".
// This converts it to clean, readable plain text: block-level tags become paragraph
// breaks, everything else is stripped, and HTML entities are decoded.

const BLOCK_END_TAGS = /<\/(p|div|h[1-6]|li|ul|ol|blockquote|pre|tr)\s*>/gi;
const BREAK_TAGS = /<br\s*\/?>/gi;
const LIST_ITEM_START = /<li[^>]*>/gi;

// Whole elements to drop entirely — tag AND content, not just the tag. Script/style
// are the ad-injection case (e.g. Freestar/Google ad-slot JS showing up as plain text
// once only the tags were stripped). Figure/figcaption/time cover image captions and
// their machine-readable timestamps, which duplicate what the frontend already shows
// via its own "Image via {source}" treatment and "Published Xd ago" — not something
// worth surfacing twice, especially not as a raw ISO string in the middle of the body.
const REMOVE_ENTIRELY = /<(script|style|noscript|iframe|figure|figcaption|time)\b[^>]*>[\s\S]*?<\/\1>/gi;

// Belt-and-suspenders for malformed feeds where ad JS leaks in without proper <script>
// tags at all (happens with some feed generators). Matches on common ad-network call
// signatures rather than trying to generally detect "is this line JavaScript."
const STRAY_AD_SCRIPT_LINE = /^.*(freestar|googletag|adsbygoogle|\.push\(function|newAdSlots|fsAdCount|querySelectorAll\(["'`]\.).*$/gim;

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	mdash: '—',
	ndash: '–',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“'
};

function decodeEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
		.replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** Strips HTML tags and decodes entities, preserving paragraph/list structure as blank-line breaks. */
export function cleanHtml(input: string | null | undefined): string {
	if (!input) return '';

	let text = input;

	// Some feeds double-escape (e.g. "&lt;p&gt;") — decode once up front so tag
	// stripping below actually sees the tags rather than their escaped form.
	if (/&lt;\/?[a-z]/i.test(text)) {
		text = decodeEntities(text);
	}

	// Drop whole elements (script/style/figure/etc.) before any other processing —
	// stripping just the tags and leaving their content behind is exactly what let
	// ad-network JS and duplicate image captions leak into article bodies.
	text = text.replace(REMOVE_ENTIRELY, '');
	text = text.replace(STRAY_AD_SCRIPT_LINE, '');

	text = text.replace(LIST_ITEM_START, '\n• ');
	text = text.replace(BREAK_TAGS, '\n');
	text = text.replace(BLOCK_END_TAGS, '\n\n');
	text = text.replace(/<[^>]+>/g, ''); // strip all remaining tags (links, spans, code, strong, etc.)
	text = decodeEntities(text);

	text = text
		.replace(/[ \t]+/g, ' ')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return text;
}

/** Truncates cleaned text to a summary-appropriate length without cutting mid-word. */
export function toSummary(cleaned: string, maxLength = 400): string {
	const singleLine = cleaned.replace(/\n+/g, ' ').trim();
	if (singleLine.length <= maxLength) return singleLine;
	const truncated = singleLine.slice(0, maxLength);
	return truncated.slice(0, truncated.lastIndexOf(' ')) + '…';
}
