import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';

/**
 * A widget's own lifecycle hooks — deliberately all-optional (unlike
 * ingestion/adapters/base.ts's SourceAdapter, which has one mandatory fetch()) because
 * unlike source adapters, widgets don't share a common downstream table or data shape
 * to normalize into; each is a self-contained module that opts into only what it needs.
 */
export interface WidgetPlugin {
	/** Stable id — also the table-name (`widget_<id>_*`) and directory-name namespace. Validated on install: /^[a-z0-9-]{1,40}$/ */
	id: string;
	displayName: string;
	version: string;

	/** Widget-owned schema. Must be idempotent (CREATE TABLE IF NOT EXISTS style), same contract as the host's own migrate(). */
	migrate?(db: DatabaseSync): void;

	/** Self-reported table names, for the uninstall safety-net sweep — belt-and-suspenders alongside the widget_<id>_ naming convention (see widgets/sweep.ts). */
	ownedTables?: string[];

	/** Host owns the setInterval/enable-gating (see queue/scheduler.ts); the plugin just does the fetch-and-persist work. */
	poll?: { intervalMs: number; run(): Promise<void> };

	/** Called once at load time (startup, or immediately after a live upload). Admin routes registered here are auto-gated by the existing X-Api-Key preHandler (see api/auth.ts), since it matches on any /api/admin/* path. */
	registerPublicRoutes?(app: FastifyInstance): void;
	registerAdminRoutes?(app: FastifyInstance): void;

	/** Best-effort cleanup, called before the host's safety-net sweep on delete. Should not assume its own migrate() succeeded or that external APIs are reachable — the sweep is the real guarantee, this is just an extension point. */
	uninstall?(db: DatabaseSync): void;
}
