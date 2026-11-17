/**
 * Weather alert display helpers. NWS names its products by kind - a Warning (act now), a
 * Watch (be ready), an Advisory (be careful) or a Statement - and that, more than the
 * "severity" field, is what people read, so it picks the colour.
 */
import type { WeatherAlert } from './types';

export type AlertLevel = 'warning' | 'watch' | 'advisory' | 'statement';

export function alertLevel(a: Pick<WeatherAlert, 'event' | 'severity'>): AlertLevel {
	const e = a.event.toLowerCase();
	if (e.endsWith('warning') || e.includes('emergency')) return 'warning';
	if (e.endsWith('watch')) return 'watch';
	if (e.endsWith('advisory')) return 'advisory';
	return ['extreme', 'severe'].includes(a.severity.toLowerCase()) ? 'warning' : 'statement';
}

const ORDER: AlertLevel[] = ['warning', 'watch', 'advisory', 'statement'];
/** Most serious first. */
export function sortAlerts<T extends Pick<WeatherAlert, 'event' | 'severity'>>(alerts: T[]): T[] {
	return [...alerts].sort((a, b) => ORDER.indexOf(alertLevel(a)) - ORDER.indexOf(alertLevel(b)));
}

/** "Tonight 1 AM – Wed 9 AM": a day word only when the day changes from today. */
export function alertWindow(a: Pick<WeatherAlert, 'onset' | 'ends' | 'expires'>, now: number): string {
	const end = a.ends ?? a.expires;
	const fmt = (iso: string) => {
		const d = new Date(iso);
		const today = new Date(now);
		const time = d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
		if (d.toDateString() === today.toDateString()) return d.getHours() >= 18 || d.getHours() < 5 ? `tonight ${time}` : `today ${time}`;
		const tomorrow = new Date(now + 86_400_000);
		if (d.toDateString() === tomorrow.toDateString() && d.getHours() < 5) return `tonight ${time}`;
		return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
	};
	if (!a.onset || new Date(a.onset).getTime() <= now) return `in effect until ${fmt(end)}`;
	return `${fmt(a.onset)} – ${fmt(end)}`;
}

/** "starts in 11 hr" / "ends in 4 hr" for the alert's next change. */
export function alertCountdown(a: Pick<WeatherAlert, 'onset' | 'ends' | 'expires'>, now: number): string {
	const on = a.onset ? new Date(a.onset).getTime() : 0;
	const end = new Date(a.ends ?? a.expires).getTime();
	const span = (ms: number) => {
		const m = Math.max(1, Math.round(ms / 60_000));
		return m < 60 ? `${m} min` : `${Math.round(m / 60)} hr`;
	};
	return on > now ? `starts in ${span(on - now)}` : `ends in ${span(end - now)}`;
}
