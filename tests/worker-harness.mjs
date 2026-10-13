import worker from '../src/worker.mjs';
export { ChallengeRoom } from '../src/worker.mjs';

// Fault injection is confined to this test entry point, never the deployed one.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/test/quota' || url.pathname === '/test/backend-error') {
      const message = url.pathname === '/test/quota' ?
        'Exceeded allowed duration in Durable Objects free tier.' : 'Test backend failure';
      url.pathname = request.method === 'POST' ? '/api/rooms' : '/api/rooms/ABCDEF';
      return worker.fetch(new Request(url, request), {
        ...env, ROOMS: { getByName: () => ({ fetch: async () => { throw new Error(message); } }) }
      });
    }
    return worker.fetch(request, env);
  }
};
