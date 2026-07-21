import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node — this is a self-hosted app (see the "self-hosted" masthead tag),
			// meant to run as a standalone Node server behind a reverse proxy (e.g. Nginx
			// Proxy Manager) rather than on a specific platform like Vercel/Netlify/Cloudflare,
			// which is what adapter-auto is for. See frontend/README.md "Deploying behind a
			// reverse proxy" for the env vars (ORIGIN, PORT, etc.) this needs at runtime.
			adapter: adapter()
		})
	]
});
