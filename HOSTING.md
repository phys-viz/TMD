# Cloudflare classroom pilot

TMD uses the same deployment pattern as Arc Tactics: a Worker serves public assets and each challenge room has its own SQLite-backed Durable Object. TMD is a separate project named `tmd-classroom`; Arc Tactics is unchanged.

Pilot URL: https://tmd-classroom.morristown-randolph.workers.dev

## Deploy on Windows

Requires Node.js 22 or newer. From this folder:

```powershell
npm install --include=dev
npm test
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
- Live updates use server-sent events with heartbeats and automatic browser reconnection. Test them on the actual school network.
- Challenge mass is entered as 1–10%, matching Solo Lab. Damping starts at zero. Different preview designs intentionally retain their varied damping values.

## Pilot rehearsal

1. Use 2–3 pairs on school devices and a teacher/projector browser.
2. Create a room; join and recreate assigned dimensions in Solo Lab.
3. Submit, revise, refresh, and reconnect. Check both assignment and submission.
4. From a student browser, verify teacher actions are unavailable.
5. Lock, start, and check the ten-second alert, sound, synchronized City motion, and completed rubble ending.
6. Test Replay and a second room. Note confusing inputs and connection problems.
7. Run the 12-pair preview before the full launch.

Leaderboards and the shared five-minute countdown are still proposed features.

## Local development

`npm start` runs the Node prototype on port 3000 with memory-only rooms. `npm run dev` runs the Cloudflare runtime on port 8787 with locally persisted rooms under .wrangler. These are separate room stores.

References: https://developers.cloudflare.com/durable-objects/get-started/ and https://developers.cloudflare.com/workers/static-assets/
