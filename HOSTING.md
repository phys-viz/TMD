# Cloudflare classroom pilot

TMD uses the same deployment pattern as Arc Tactics: a Worker serves public assets and each challenge room has its own SQLite-backed Durable Object. TMD is a separate project named `tmd-classroom`; Arc Tactics is unchanged.

Pilot URL: https://tmd-classroom.morristown-randolph.workers.dev

## Deploy on Windows

Requires Node.js 22 or newer. From this folder:

```powershell
npm install --include=dev
npm test
npm run test:worker
npm run deploy:check
npx wrangler login
npm run deploy
```

You can skip login if Wrangler is already signed into the correct account. Deploy prints the real HTTPS URL; use that same URL on teacher and student devices. No custom domain or manually created database is required. Deployment creates the room binding from wrangler.jsonc. Check your existing Cloudflare account plan and usage limits before using it with a full class.

## Room behavior

- The Teacher tab opens a password form. Teacher access is enforced by the server for creating rooms and for Lock, Start, and Replay. Teacher sessions last eight hours; use **Lock teacher access** when finished.
- The initial teacher password is in the local `.teacher-password.txt` file, excluded from Git. Cloudflare stores it as the `TEACHER_PASSWORD` secret. The password is never shipped in website assets. Local development reads the same secret from `.dev.vars` (also excluded from Git).
- Teacher controls require a private room key stored in the creator's browser. A room code lets students join but does not allow Lock, Start, or Replay. Public room state does not include the key.
- Refreshing the teacher browser restores its last room. Clearing browser storage loses the teacher key; create a new room if that happens. Use the same browser profile for teaching and projecting.
- Students rejoin with the room code in the same browser; their private token preserves the assignment and submission. Use anonymous pair names.
- Rooms and per-tower scoring samples are saved and survive Worker restarts and redeployments. Rooms expire after 24 hours.
- Browsers receive server-sent events with heartbeats and automatic reconnection. The hosted Worker bridges those streams to hibernatable WebSockets in the room Durable Object. Browser keepalives run in the Worker, so idle rooms can sleep while clients stay connected. Node development continues to use its existing SSE server. Test live updates on the actual school network.
- Start and Replay persist and broadcast the alert before scoring. A one-time room alarm prepares the results during the countdown; pending jobs survive room hibernation/restart. Once scores are ready, the room returns to its 24-hour expiration alarm. Slow preparation holds the map with “Preparing city…” and adjusts the common shaking start time; no recurring preparation timer is used. See the [Cloudflare Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/).
- Challenge mass is entered as 1–10%, matching Solo Lab. Damping starts at zero. Different preview designs intentionally retain their varied damping values.

## Pilot rehearsal

1. Use 2–3 pairs on school devices and a teacher/projector browser.
2. Create a room; join and recreate assigned dimensions in Solo Lab.
3. Submit, revise, refresh, and reconnect. Check both assignment and submission.
4. From a student browser, verify teacher actions are unavailable.
5. Lock and start. Verify that the teacher's map appears before the Start request finishes and joined student tabs switch to City before scores arrive. Check the shared countdown, a “Preparing city…” hold if needed, sound, synchronized City motion, and the completed rubble ending.
6. Test Replay, then Unlock for revisions. Change difficulty and strength using Next round settings and Apply settings. Verify students receive the new scenario without rejoining, their towers and submitted designs stay unchanged, and the next quake uses the applied settings. Verify changes are unavailable while locked or running. Test a second room.
7. Run the 12-pair preview before the full launch.

City includes four metric-specific leaderboards with survivor eligibility and a separate collapse status. Verify that the mass board shows percentages, damping shows dimensionless values, and the time/sway boards show their own units for surviving and collapsed towers.

## Local development

`npm start` runs the Node prototype on port 3000 with memory-only rooms. `npm run dev` runs the Cloudflare runtime on port 8787 with locally persisted rooms under .wrangler. These are separate room stores.

`npm run test:worker` starts an isolated local Cloudflare runtime with a temporary test password and room store. It runs the room API checks, including connected clients remaining idle before receiving new updates, reconnection, and deletion notifications. It stops the test runtime and removes its temporary room store afterward.

## Room service daily limit

Cloudflare can reject room requests with `Exceeded allowed duration in Durable Objects free tier.` This is an account-level daily usage limit, even when the website and teacher login still work. The former room SSE heartbeat timer kept Durable Objects awake while rooms were idle. The hosted backend now uses the WebSocket Hibernation API and keeps browser SSE heartbeats outside the room object.

Exhausted daily allowances reset at 00:00 UTC (8 p.m. Eastern during daylight saving time). Deploying the efficiency fix does not replenish usage already consumed. Affected requests receive a clear daily-limit message until the allowance resets. The error handler catches rejected room lookups as well as creation requests and logs the route and backend error, excluding request bodies, headers, and cookies.

References: https://developers.cloudflare.com/durable-objects/get-started/, https://developers.cloudflare.com/workers/static-assets/, https://developers.cloudflare.com/durable-objects/best-practices/websockets/, and https://developers.cloudflare.com/durable-objects/platform/pricing/
