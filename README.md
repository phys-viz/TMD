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

- A short visible ground-motion pulse starts the building oscillating.
- After the pulse, the foundation stops and students observe free motion.
- The building animation and graph are driven by the same numerical simulation state.
- The graph shows roof sway relative to the foundation and supports fixed time ranges, A/B cursor clicks, Latest, and Full.
- Difficulty modes:
  - Easy: no danger-zone collapse.
  - Medium: collapse after 3.0 s accumulated beyond the danger sway limit.
  - Hard: collapse after 2.5 s accumulated beyond the danger sway limit.
- Danger time starts only after the pulse ends.
- Danger time is based on visible roof sway, not hidden velocity/envelope values.
- The current danger sway threshold is 0.20 m.
- The TMD mass range is 1-10% of the building mass.
- Two hydraulic dampers act in parallel. At damping 0, they disappear. At damping 1, the pendulum is locked.
- Thermal energy is calculated from damping power and shown live.
- Wall impacts are simulated from bob position and radius. Impacts affect the subsequent motion and count as hits.

## Physics Notes

The building is modeled as a single dominant lateral mode: one lumped roof mass connected to the moving foundation by a spring and modest dashpot.

The pendulum TMD is coupled to the building motion and integrated numerically in `public/physics.js`. The building stiffness is calculated from the chosen natural period:

```text
k = M * (2*pi/T)^2
```

Students calculate tuned pendulum length from:

```text
T = 2*pi*sqrt(L/g)
L = g*(T/2*pi)^2
```

Hydraulic damping removes mechanical energy from pendulum motion. The damping coefficient is:

```text
b = damper_count * damping_setting * 2*m*sqrt(g*L)
```

Thermal power is:

```text
P = b * thetaDot^2
```

Each timestep adds:

```text
thermal_energy += P * dt
```

So zero damping produces no thermal energy, and locked damping produces no thermal energy because the pendulum does not move.

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
- `TMD_Skyscraper_Simulation_Codex_Brief.md` - original project brief.

## Deployment Notes

The solo lab can be converted into a static-only version if needed.

The current full prototype uses `server.js` for teacher/student rooms, in-memory room state, and live updates. That works locally as a Node app. For production hosting, use a Node-friendly host or port the room logic to the hosting platform's serverless/state model.
