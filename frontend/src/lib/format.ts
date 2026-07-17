export function timeAgo(iso: string): string {
	const diffMs = Date.now() - new Date(iso).getTime();
	const mins = Math.round(diffMs / 60000);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return `${days}d ago`;
}
