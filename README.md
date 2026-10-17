# Tuned Mass Damper Skyscraper Lab

Browser prototype for a freshman STEM tuned mass damper investigation. Students measure a tower's natural period, calculate a pendulum length, tune damping, and observe whether the building settles after a short earthquake pulse.

The project also includes an early teacher/student/city challenge mode, but the solo lab is the most polished part right now.

## Run Locally

Requires Node.js 22 or newer.

```bash
npm.cmd start
```

Open:

```text
http://localhost:3000
```

## Preview a Class

Open the Teacher tab, choose earthquake settings, and click **Preview 12-pair class**. This creates a separate demo room with 12 submitted pair designs, ranging from tuned TMDs to mistuned, loose, locked, and bare towers. Click **Start earthquake** for a 10-second cartoon Morristown earthquake alert with expanding ripples and a short warning siren (toggle Sound on/off in City), followed by city shaking, settling, and the final aftermath/results. **Replay** repeats the whole sequence. No student logins are needed. City towers share the student simulation renderer, including glass bodies, teal roofs, pendulums, hydraulic dampers, and animated collapse that finishes in ground-level rubble, with tower heights scaled for the skyline.

Joined students switch to City automatically when the teacher starts or replays a quake, including the alert countdown. The cartoon map uses simplified [U.S. Census state outlines](https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2025/State_County/MapServer/9), with New Jersey highlighted and the Morristown callout separated from the Atlantic Ocean label. All map assets are served locally.

Start opens the teacher's alert immediately and announces the quake to students before calculating scores. The server prepares the skyline during the shared ten-second countdown. If preparation runs longer, the map holds with “Preparing city…”; completed results receive a shared two-second lead-in when needed. The hosted backend uses a one-time persistent alarm for this work, then returns to its normal expiration alarm, preserving idle-room hibernation. Replay uses the same sequence.

Each leaderboard displays its own metric: settling time (s), danger time (s), TMD mass (% of tower mass), or damping. Easy uses peak sway (m) instead of danger time. Collapsed towers retain those metrics with a separate “Collapsed” status; bare towers show “No TMD” on mass/damping boards. Only surviving eligible designs receive medals; failed towers remain at the bottom, ordered by survival time.

## Test

```bash
npm.cmd test
npm.cmd run test:worker
```

## Current Prototype

- The compact top bar contains only the lab title and view tabs; the introductory sentence is removed, giving the saved vertical space to the tower views.

- Solo tower setup uses editable height (170-350 m) and mass (7.5-15 million kg), plus a Random tower button. The student seed field and tower information/Reveal panel have been removed.
- Taller or heavier solo towers have longer natural periods through a documented classroom calibration, bounded to 4.8-7.0 seconds. Students use a stopwatch after the ground stops; the period and calculated pendulum length are not revealed or filled in when changing towers.
- Height changes subtly move the roof in the schematic; mass changes thicken the structural columns. Changing tower settings resets the trial and preserves the student's TMD settings.
- Compare two towers uses identical height, mass, earthquake, and difficulty with separate TMD controls to the left of each tower. Tower A initially has its TMD off; Tower B retains the student's current design. Start, Pause, and Reset apply to both; changing either design resets both trials. A failed tower does not stop its counterpart.
- Comparison spreads two tower columns across the available width, with TMD controls to the left of each tower and a separate sway graph below it. Each graph shows only its tower (teal for A, blue for B), with independent time windows and measurement cursors and matching sway scales. The columns stack on narrow screens. Solo also places its graph beneath the tower. Leaving Compare retains the original TMD design.
TMD controls sit in a narrow vertical panel matching the tower identity to the left of each tower, with Install TMD, Length (m), Mass (%), and synchronized damping slider/numeric inputs. In Compare, leave a clear gap between Tower A's graphic and Tower B's controls. Each graph aligns directly beneath its tower graphic, with the TMD panel in the separate left column. Compare groups have a 64 px gap on wide screens, with the complete Tower A group shifted 12 px left. Split recovered vertical space between taller towers and taller graphs. On narrow screens, controls move above the tower. Compare towers use matching teal A and blue B badges, roofs, TMD panel borders, headings, and slider accents. Solo uses teal. Roofs span the outer wall edges, including column thickness. Remove Model notes without a replacement help dialog; the teacher supplies equations. Use bold Building sway (m) labels and bold axis values. Easy is the initial Solo and teacher setup difficulty, including when a browser restores older form values. Selected difficulty text is white. Teacher earthquake setup and difficulty panels match Solo styling; the classroom playback panel uses a neutral background, one plain status line, a blue next-action button, and white secondary buttons, and Delete room sits to the right of Open room.
- The four elapsed-time/danger/thermal-energy/hit cards have been removed. A failed tower's graph identifies its failure cause, with an accessible status announcement. The solo thermal-energy display is deferred.
- Gentle, Moderate, and Strong earthquake buttons start the building oscillating with a fixed 3.0-second ground shake. These are simplified classroom settings, not earthquake magnitudes.
- A live message marks when ground shaking ends so students can measure the natural period with the TMD off.
- After the pulse, the foundation stops and students observe free motion.
- The building animation and graph are driven by the same numerical simulation state.
- The graph shows roof sway relative to the foundation and supports two numbered time cursors. Edit the start and end time labels directly on its bottom axis, pressing Enter or clicking away to apply, or Escape to cancel. Both plots default to 0–120 seconds. The y-axis is labeled Building sway (m) horizontally, the danger-zone label is centered, and plot headings and cursor instructions are omitted; cursor help remains on hover. Separate Graph start/end fields and Latest/Full buttons are removed.
- Difficulty modes:
  - Easy: no danger-zone collapse.
  - Medium: collapse at 3.00 s accumulated beyond the danger sway limit.
  - Hard: collapse at 2.50 s accumulated beyond the danger sway limit.
- Danger time starts only after the pulse ends and failure occurs when the limit is reached. The lab uses an internal shared clock without elapsed-time or danger-time cards; graph times and classroom settling results use hundredths. A compact danger-time badge sits inside the upper-right corner of each plot on Medium/Hard, displaying completed hundredths against that mode's limit (for example, 1.23 / 2.50 s). Counters remain independent in Compare, disappear on Easy, and reset with the trial; they add no plot or tower height.
- The danger-zone checkbox is disabled on Easy and enabled on Medium/Hard. Danger labels follow the center of their visible shaded bands, shrinking or hiding when a band is too narrow for readable text.
- Danger time is based on visible roof sway, not hidden velocity/envelope values.
- Each tower has a visible game sway threshold: round(0.20 * max(1, (6 / natural_period)^2), 2) m, displayed in the student challenge readout. This balances the shorter-period scenarios while retaining a common classroom earthquake; it is a classroom game rule, not a structural prediction.
- The TMD mass range is 1-10% of the building mass.
- Two hydraulic dampers act in parallel. The compact slider and two-decimal numeric field stay synchronized. At damping 0, the dampers disappear. Resistance increases nonlinearly above 0.8, progressively restricting motion and approaching a true lock at exactly 1.00. A locked bob still adds its mass to the tower; it is not equivalent to removing the TMD.
- Earthquake amplitude settings are Gentle 0.18 m, Moderate 0.62 m, and Strong 0.65 m (waveform coefficients, not magnitudes or exact peak ground displacements). Moderate is calibrated so the default tower needs a useful TMD design to survive Medium.
- Strong/Hard is calibrated for a tuned 8% mass TMD, leaving the 10% maximum as reserve. Successful designs remain sensitive to damping and length.
- Hydraulic cylinder housings have a fixed visual length; their piston rods slide as the bob moves. Housings are mounted directly on the moving columns, and their mounting plates follow the column angle. Contact detection uses the same bob, housing-tip, and column surfaces as the drawing, without an invisible safety margin or display clamp. Integration locates the first surface contact within its timestep. The tower fails at contact, then holds the visible impact pose with a marker for 0.45 s before the collapse animation. The schematic uses 2.5× angular magnification and 15 pixels per meter of pendulum length, bounded to 45–190 pixels, preserving useful designs below maximum mass.
- Thermal energy is calculated from damping power; its solo numeric display is deferred. Hydraulic cylinder colors warm smoothly from gray toward a muted red over a broader heat range; calculated heat is unchanged.
- Wall impacts are simulated from bob position and radius. The first wall hit collapses that tower on every difficulty, including Easy, and its graph identifies the failure cause. Official challenge scoring also fails a design at its first wall hit and stops that design's simulation there.

## Physics Notes

The building is modeled as a single dominant lateral mode: one lumped roof mass connected to the moving foundation by a spring and modest dashpot.

The pendulum TMD is coupled to the building motion and integrated numerically in `public/physics.js`. The building stiffness is calculated from the chosen natural period:

```text
k = M * (2*pi/T)^2
```

For editable solo towers, define `q = sqrt((H/170 m) * (M/7.5 million kg))` and `q_max = sqrt((350/170) * (15/7.5))`. Assign `T = 4.8 s + 2.2 s * (q - 1)/(q_max - 1)` and a fixed building damping ratio of 0.005 (0.5% of critical damping). This is a classroom calibration that makes both dimensions matter while keeping stopwatch measurements practical, not a real skyscraper period formula. The classroom challenge assigns random whole-meter heights and masses rounded to 0.1 million kg from the teacher's scenario seed. Assigned towers use this same Solo Lab calibration, so entering their dimensions recreates identical physics. The Student tab hides period and calculated length, starts length and mass fields blank and damping at zero, and asks pairs to investigate in Solo Lab before submitting. Reconnecting preserves the assignment and restores only their own submitted settings. Pairs without a submission are tested without a TMD.

Students calculate tuned pendulum length from:

```text
T = 2*pi*sqrt(L/g)
L = g*(T/2*pi)^2
```

Hydraulic damping removes mechanical energy from pendulum motion. The damping coefficient is:

```text
resistance(d) = d                              for 0 <= d <= 0.8
resistance(d) = 0.8 + (d - 0.8)/(5*(1 - d))    for 0.8 < d < 1
b = damper_count * resistance(d) * 2*m*sqrt(g*L)
```

Thermal power is:

```text
P = b * thetaDot^2
```

Each timestep adds:

```text
thermal_energy += P * dt
```

The resistance curve matches the original mapping and slope at 0.8 and grows without bound as the setting approaches 1. At exactly 1, the pendulum is constrained to vertical and the tower's moving mass is `M + m`, with its original stiffness and building damping. Zero damping produces no thermal energy, and locked damping produces no hydraulic thermal energy because the pendulum does not move. Increasing resistance toward lock can reduce heat dissipation and TMD effectiveness as relative motion disappears.

Internal steps remain at most 0.004 s. Settings through 0.8 use RK4; higher resistance uses an exponential midpoint method in horizontal momentum and pendulum angular velocity, including the integrated damping heat. This avoids numerical instability near the lock endpoint while approaching the same attached-mass motion. Mechanical energy includes both horizontal and vertical bob velocity.

## GitHub Workflow

If this folder is not already a Git repository:

```bash
git init
git add .
git commit -m "Initial TMD skyscraper lab prototype"
```

Create an empty repository on GitHub, then connect and push:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git branch -M main
git push -u origin main
```

On another computer:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
cd YOUR-REPO-NAME
npm.cmd start
```

Then open `http://localhost:3000`.

## Project Structure

- `public/index.html` - app shell and controls.
- `public/styles.css` - visual styling and layout.
- `public/app.js` - browser UI, canvas drawing, live lab, and city view.
- `public/physics.js` - deterministic physics model and scoring helpers.
- `server.js` - local Node server and prototype multiplayer room API.
- `tests/physics.test.js` - physics regression tests.
- `TMD_Skyscraper_Simulation_Codex_Brief.md` - maintained project brief with current classroom scope, behavior, and future extensions.

## Deployment Notes

The solo lab can be converted into a static-only version if needed.

The current full prototype uses `server.js` for teacher/student rooms, in-memory room state, and live updates. That works locally as a Node app. For production hosting, use a Node-friendly host or port the room logic to the hosting platform's serverless/state model.

Solo and comparison testing start at damping 0. New challenge submissions also start at 0; reconnecting retains the group's submitted damping. City labels display the entered group name in full (up to 24 characters), fitted beneath its tower.

## Cloudflare hosting

See [HOSTING.md](HOSTING.md) for deployment and the classroom pilot. `npm run dev` runs the Cloudflare Worker locally; `npm run test:worker` tests its room API and idle live connections; `npm run deploy:check` checks the build without publishing; `npm run deploy` publishes the Worker and assets. Persistent rooms expire after 24 hours. Teacher actions require the creator's private browser key. Hosted live updates use hibernatable room WebSockets bridged to browser SSE, allowing idle rooms to sleep without disconnecting clients. Exhausted Cloudflare daily allowances reset at 00:00 UTC; the service reports this limit explicitly.

City draws straight schematic columns at skyline height, with hydraulic mounts attached to them. The roof and pendulum assembly use uniform scaling, preserving roof proportions and pendulum rod length through the swing. Solo practice and official scoring share the same advanceTrial integration and danger/collision rules; scoring ends at the first failure and preserves its contact pose.

Teachers can reuse the same room across rounds. Unlock for revisions, choose difficulty and earthquake strength under **Earthquake and difficulty** in Room setup, then **Apply settings** before locking or starting. Students retain their identities, assigned towers, and submitted designs. Applying settings clears previous results and announces the new scenario to connected clients. Changes are teacher-only and rejected while locked or running. The classroom banner reads **JOIN CODE** above the large room code.

Solo, Compare, and student design controls explicitly connect the acronym to the design choices: T - Tuning (length in meters), M - Mass (percentage of tower mass), and D - Damping. These labels add no controls or calculated tuning answers. Hydraulic heating visuals are unchanged.

When Install TMD is unchecked, disable that tower's length, mass, damping number, and damping slider, retaining their values for reinstallation. Compare panels enable independently. Remove static explanations under earthquake settings; keep short live shaking/stopped feedback and essential unsaved/error messages. Brief earthquake/difficulty help appears on hover or keyboard focus and dismisses with Escape, with accessible control descriptions.
