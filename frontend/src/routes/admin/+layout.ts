// The admin API key lives in this browser's localStorage (see adminAuth.ts), which
// is only reachable from client-side code — a server-rendered `load` function
// running on the Node server during SSR has no access to it and couldn't attach it
// to a cross-origin request. Disabling SSR here means all admin data fetching
// happens in the actual browser instead, where the stored key is available.
export const ssr = false;
