/**
 * Generic live-data shape a widget's poll.run() can publish via
 * setKv(id, 'report', report) (see storage/db/widgetKv.ts) for the sidebar's generic
 * report card to render — see api/public.ts's GET /api/widget/:id/report, registered once
 * at startup so it works for any widget id including ones uploaded after boot, with zero
 * per-widget route registration (sidesteps Fastify's "no routes after listen()" limit).
 */
export interface WidgetReport {
	title: string;
	headline?: { value: string; delta?: string } | null;
	rows?: { label: string; value: string }[];
	updatedAt: string | null;
}
