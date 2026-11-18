/**
 * Debounced auto-save for admin controls: call run(fn) on every change and only the last one
 * within `delay` ms is sent. `status` drives <SaveStatus>.
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function saver(delay = 400) {
	const st = $state<{ status: SaveState }>({ status: 'idle' });
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		get status() {
			return st.status;
		},
		run(fn: () => Promise<unknown>) {
			st.status = 'saving';
			clearTimeout(timer);
			timer = setTimeout(async () => {
				try {
					await fn();
					st.status = 'saved';
					setTimeout(() => st.status === 'saved' && (st.status = 'idle'), 1500);
				} catch {
					st.status = 'error';
				}
			}, delay);
		}
	};
}
