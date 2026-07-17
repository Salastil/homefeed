const STORAGE_KEY = 'homefeed:theme';

type Theme = 'light' | 'dark';

let theme = $state<Theme>('light');

export function getTheme(): Theme {
	return theme;
}

export function initTheme() {
	if (typeof localStorage === 'undefined') return;
	const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
	if (stored === 'light' || stored === 'dark') {
		theme = stored;
	} else {
		theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}
	applyTheme();
}

export function toggleTheme() {
	theme = theme === 'light' ? 'dark' : 'light';
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, theme);
	}
	applyTheme();
}

function applyTheme() {
	if (typeof document !== 'undefined') {
		document.documentElement.setAttribute('data-theme', theme);
	}
}

export function isDark(): boolean {
	return theme === 'dark';
}
