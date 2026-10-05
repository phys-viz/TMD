# Tuned Mass Damper Skyscraper Lab

Browser prototype for a freshman STEM tuned mass damper investigation. Students measure a tower's natural period, calculate a pendulum length, tune damping, and observe whether the building settles after a short earthquake pulse.

The project also includes an early teacher/student/city challenge mode, but the solo lab is the most polished part right now.

## Run Locally

Requires Node.js 18 or newer.

```bash
npm.cmd start
```

Open:

```text
http://localhost:3000
```

## Test

```bash
npm.cmd test
```

## Current Prototype

- The compact top bar contains only the lab title and view tabs; the introductory sentence is removed, giving the saved vertical space to the tower views.

- Solo tower setup uses editable height (170-350 m) and mass (7.5-15 million kg), plus a Random tower button. The student seed field and tower information/Reveal panel have been removed.
- Taller or heavier solo towers have longer natural periods through a documented classroom calibration, bounded to 4.8-7.0 seconds. Students use a stopwatch after the ground stops; the period and calculated pendulum length are not revealed or filled in when changing towers.
- Height changes subtly move the roof in the schematic; mass changes thicken the structural columns. Changing tower settings resets the trial and preserves the student's TMD settings.
- Compare two towers uses identical height, mass, earthquake, and difficulty with separate TMD controls above each tower. Tower A initially has its TMD off; Tower B retains the student's current design. Start, Pause, and Reset apply to both; changing either design resets both trials. A failed tower does not stop its counterpart.
- Comparison spreads two tower columns across the available width, with TMD controls above each tower and a separate sway graph below it. Each graph shows only its tower (teal for A, blue for B), with independent time windows and measurement cursors and matching sway scales. The columns stack on narrow screens. Solo also places its graph beneath the tower. Leaving Compare retains the original TMD design.
- TMD panels are centered and capped at 380 px wide, with the Tower A/B label, Install TMD, and narrow Length, Mass, and Damping fields in one row; the row wraps on narrow screens. The separate blue title bar is removed, leaving more height for the tower. Redundant tower and graph headings, wall-hit counts, and TMD-status rows are removed. Tower views use the reclaimed space and adapt to viewport height; graphs remain shallow. Length (m) and Mass (%) show units in their labels; TMD range notes are removed and bounds remain available on hover. Damping is dimensionless. The tower setup panel omits the stopwatch instruction box.
- The four elapsed-time/danger/thermal-energy/hit cards have been removed. A failed tower's graph identifies its failure cause, with an accessible status announcement. The solo thermal-energy display is deferred.
- Gentle, Moderate, and Strong earthquake buttons start the building oscillating with a fixed 3.0-second ground shake. These are simplified classroom settings, not earthquake magnitudes.
- A live message marks when ground shaking ends so students can measure the natural period with the TMD off.
- After the pulse, the foundation stops and students observe free motion.
- The building animation and graph are driven by the same numerical simulation state.
- The graph shows roof sway relative to the foundation and supports two numbered time cursors. Edit the start and end time labels directly on its bottom axis, pressing Enter or clicking away to apply, or Escape to cancel. Both plots default to 0–120 seconds. The y-axis is labeled sway horizontally, the danger-zone label is centered, and plot headings and cursor instructions are omitted; cursor help remains on hover. Separate Graph start/end fields and Latest/Full buttons are removed.
- Difficulty modes:
  - Easy: no danger-zone collapse.
  - Medium: collapse at 3.00 s accumulated beyond the danger sway limit.
  - Hard: collapse at 2.50 s accumulated beyond the danger sway limit.
- Danger time starts only after the pulse ends and failure occurs when the limit is reached. The lab uses an internal shared clock without elapsed-time or danger-time cards; graph times and classroom settling results use hundredths. A compact danger-time badge sits inside the upper-right corner of each plot on Medium/Hard, displaying completed hundredths against that mode's limit (for example, 1.23 / 2.50 s). Counters remain independent in Compare, disappear on Easy, and reset with the trial; they add no plot or tower height.
- The danger-zone checkbox is disabled on Easy and enabled on Medium/Hard. Danger labels follow the center of their visible shaded bands, shrinking or hiding when a band is too narrow for readable text.
- Danger time is based on visible roof sway, not hidden velocity/envelope values.
- Each tower has a visible game sway threshold: round(0.20 * max(1, (6 / natural_period)^2), 2) m, displayed in the solo model notes and student challenge readout. This balances the shorter-period scenarios while retaining a common classroom earthquake; it is a classroom game rule, not a structural prediction.
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

For editable solo towers, define `q = sqrt((H/170 m) * (M/7.5 million kg))` and `q_max = sqrt((350/170) * (15/7.5))`. Assign `T = 4.8 s + 2.2 s * (q - 1)/(q_max - 1)` and a fixed building damping ratio of 0.005 (0.5% of critical damping). This is a classroom calibration that makes both dimensions matter while keeping stopwatch measurements practical, not a real skyscraper period formula. The classroom challenge continues to assign towers deterministically from the teacher's scenario seed.

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
