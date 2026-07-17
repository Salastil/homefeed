// The admin section talks to a different origin (the backend) than the frontend
// itself. During SSR, the `load` function's fetch runs on the Node server, which has
// no access to the browser's cookie jar — it can't attach the session cookie to a
// cross-origin request. Disabling SSR here means all admin data fetching happens in
// the actual browser instead, where credentials: 'include' works correctly against
// whatever cookie the browser already holds from login.
export const ssr = false;
