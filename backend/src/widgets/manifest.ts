const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const RESERVED_IDS = new Set(['weather', 'stocks', 'bookmarks', 'poe2']);
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export interface WidgetManifest {
	id: string;
	displayName: string;
	version: string;
	/** Relative path within `files` to the ESM entry point, e.g. "index.mjs" — a default export satisfying WidgetPlugin. */
	entry: string;
	/** Optional relative path within `files` to a pre-built browser JS bundle (plain vanilla JS, not raw Svelte source — see widgets/registry.ts's frontend-loading notes) exporting a default `{ mount(container, ctx) }`. Served from /widget-assets/<id>/* and dynamic-import()ed by the sidebar's DynamicWidgetSlot. Omit for a widget with no custom UI — it falls back to the generic report card. */
	frontendEntry?: string;
}

// Upload body shape: { manifest, files: { "index.mjs": "<source text>", ... } } — plain
// JSON rather than a literal zip, so no archive/multipart dependency is needed (see
// widgets/install.ts). Returns a human-readable error string, or null if valid.
export function validateManifest(manifest: unknown, files: unknown): string | null {
	if (!manifest || typeof manifest !== 'object') return 'manifest is required';
	const m = manifest as Record<string, unknown>;
	if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) return 'manifest.id must match /^[a-z0-9-]{1,40}$/';
	if (RESERVED_IDS.has(m.id)) return `id "${m.id}" is reserved for a built-in widget`;
	if (typeof m.displayName !== 'string' || !m.displayName.trim()) return 'manifest.displayName is required';
	if (typeof m.version !== 'string' || !m.version.trim()) return 'manifest.version is required';
	if (typeof m.entry !== 'string' || !m.entry.trim()) return 'manifest.entry is required';
	if (m.frontendEntry !== undefined && (typeof m.frontendEntry !== 'string' || !m.frontendEntry.trim())) {
		return 'manifest.frontendEntry must be a non-empty string when present';
	}

	if (!files || typeof files !== 'object' || Array.isArray(files)) return 'files must be a non-empty object';
	const entries = Object.entries(files as Record<string, unknown>);
	if (entries.length === 0) return 'files must be a non-empty object';
	if (!(m.entry in (files as Record<string, unknown>))) return `entry "${m.entry as string}" not found in files`;
	if (m.frontendEntry !== undefined && !(m.frontendEntry in (files as Record<string, unknown>))) {
		return `frontendEntry "${m.frontendEntry as string}" not found in files`;
	}

	let totalBytes = 0;
	for (const [relPath, content] of entries) {
		if (typeof content !== 'string') return `files["${relPath}"] must be a string`;
		if (relPath.startsWith('/') || relPath.split('/').some((seg) => seg === '..')) return `invalid file path "${relPath}"`;
		totalBytes += Buffer.byteLength(content, 'utf8');
	}
	if (totalBytes > MAX_TOTAL_BYTES) return `bundle exceeds ${MAX_TOTAL_BYTES}-byte limit`;

	return null;
}
