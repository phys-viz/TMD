# Tuned Mass Damper Skyscraper Lab and City Challenge

## Goal and current teaching scope

Build a browser-based simulation for freshman STEM students studying skyscrapers and tuned mass dampers (TMDs) in the context of earthquakes. Students use a building's measured natural period and the simple-pendulum equation, `T = 2π√(L/g)`, to predict a useful pendulum length, then investigate mass and damping.

The initial investigation focuses on **natural period and TMD tuning**. An earthquake starts the motion; students do not need to analyze the forcing, select an earthquake frequency, or vary its duration. After the ground stops, students measure the tower's free oscillations.

Create a working, attractive prototype that we can test and revise. Favor clear behavior and honest physics over elaborate art. Students typically use Chromebooks; the teacher projects the city view. Use nicknames and room codes rather than requiring student accounts.

This is a maintained project brief. The requirements below replace the original pull/release and selectable-frequency sequence for the introductory lab. Advanced resonance investigations remain possible future extensions.

## Student learning sequence

1. **Start an earthquake with the TMD off.** Select Gentle, Moderate, or Strong and press Start earthquake. The ground shakes for a fixed 3.0 seconds, then stops. Moderate is the default strength. Easy mode supports an initial measurement trial without danger-zone collapse.
2. **Measure the building's natural period.** Measure after the ground stops, with the TMD absent. Students use a stopwatch to time several complete cycles and divide their total time by the number of cycles. Retain roof-sway-versus-time data and two numbered graph cursors as measurement tools. Keep the solo building's period hidden; remove the tower information panel and Reveal action. The ground-stopped message tells students when measurement can begin.
3. **Predict and test a damper.** Calculate `L = g(T/2π)^2`, install a pendulum near the top, and compare its effect under the same earthquake setting. Treat the calculated length as a starting prediction; students can test nearby lengths. Tower and pendulum motions must come from the coupled model.
4. **Investigate mass and damping.** Change one design variable at a time, replay the same earthquake, and compare the settling motion. Damping should have a useful middle range; simply selecting the maximum mass or maximum damping should not be the universal solution.
5. **City challenge.** After solo exploration, students submit designs for assigned towers within a teacher-set design window. The teacher locks designs and starts a shared earthquake. Everyone sees the same ground motion, with reproducible outcomes and a no-TMD comparison for each tower.

## Earthquake controls

- Replace pulse-size and pulse-duration inputs with **Gentle, Moderate, and Strong buttons**, with a clear selected state. Do not label these choices as Richter magnitudes.
- All three choices use the same fixed **3.0-second** waveform duration. Only strength changes. The current ground-displacement coefficients are Gentle **0.18 m**, Moderate **0.62 m**, and Strong **0.65 m**, shared by the solo and teacher controls through the physics module.
- These are simplified classroom scenarios, not real earthquake magnitude estimates. The coefficient is not the exact peak ground displacement because a smooth envelope multiplies the waveform.
- The current ground motion is one smoothly enveloped sinusoidal cycle: `y(t) = A sin(2πt/D) sin²(πt/D)` for `0 ≤ t ≤ D`, with `D = 3.0 s`. Ground displacement and velocity are zero after the shake. Keep this detail in model documentation; students do not need to analyze it.
- Place **Start earthquake, Pause, and Reset immediately below the strength buttons**. Use a brief status message during shaking and a clear ground-stopped message afterward.
- Preserve identical ground motion between a design and its no-TMD baseline, and between towers in a classroom event.

## Difficulty, failure, and fairness

Failure is an openly documented **game rule**, not a prediction of real structural collapse.

- **Easy:** disable danger-zone collapse and the Show danger zone checkbox. Preserve the user's checkbox preference when switching back to Medium or Hard. A pendulum wall hit still fails the tower.
- **Medium:** fail when accumulated danger time reaches **3.00 seconds**.
- **Hard:** fail when accumulated danger time reaches **2.50 seconds**.
- Danger time begins only after ground shaking ends. Accumulate it while the absolute roof displacement relative to the foundation exceeds the tower's game sway limit. Time is cumulative, not necessarily consecutive; do not accumulate it from a hidden velocity or amplitude envelope.
- Give each generated tower a visible, deterministic game sway limit. The current calibration is `round(0.20 × max(1, (6 s / T)²), 2) m`, where `T` is its natural period. Across the current 4.8–7.0 second period range, limits are approximately 0.20–0.31 m. This balances shorter-period towers under a common earthquake. It is a game calibration, not a structural formula.
- Display the assigned sway limit in the solo model notes and student challenge tower readout. Use that same limit for the danger graphics, live failure logic, and official results.
- Hard/Strong must have useful designs **below the 10% mass maximum**. The regression suite verifies survival at 8% mass, a length calculated from natural period, and damping 0.25 across 48 classroom towers from two seeds and representative editable solo towers. The corresponding no-TMD runs fail. Preserve meaningful sensitivity to length, mass, and damping; do not guarantee that every design succeeds.
- Remove the four elapsed-time, danger-time, thermal-energy, and hit metric cards from the solo lab. Keep time and danger accumulation internal. Graph times and classroom settling results use **hundredths of a second**. Live and scored runs must fail when the danger limit is reached, with a small numerical tolerance for floating-point arithmetic.
- **One pendulum wall hit fails the tower in every mode.** Show a compact wall-hit label below each drawing, highlight the first hit briefly, and identify the failure cause in its header. Stop the affected live tower immediately and animate its collapse. A surviving comparison tower keeps running. Defer the solo numeric thermal-energy display; continue calculating heat and coloring hydraulic housings from it.

## Physical model and scientific integrity

- Model the building's dominant lateral mode as a lumped roof mass attached to moving ground by a spring and modest dashpot. Model the TMD as a pendulum attached to that mass. Numerically integrate the **coupled** equations, including the pendulum's reaction on the building. Do not animate independent motions or apply a cosmetic sway-reduction factor.
- Use horizontal roof displacement `x`, base displacement `y`, pendulum angle `θ` from vertical, building mass `M`, bob mass `m`, building stiffness `k`, viscous building damping `c`, pendulum length `L`, and pendulum damping `b`. For a massless rod, one consistent preferred convention is:

  `(M + m)ẍ + mL(θ̈ cosθ − θ̇² sinθ) + c(ẋ − ẏ) + k(x − y) = 0`

  `Lθ̈ + ẍ cosθ + g sinθ + (b/(mL))θ̇ = 0`

  Derive and solve the coupled accelerations together. Document the damping convention and its units; keep damping and energy conventions dimensionally consistent. Use a stable integrator and small internal steps. The prototype uses RK4 with internal steps no larger than 0.004 seconds.
- Set building stiffness consistently from the assigned natural period: `k = M(2π/T)²`. Generated tower periods are currently 4.8–7.0 seconds, and masses are 7.5–15 million kg. Do not expose an arbitrary building-frequency slider in the introductory lab.
- Editable solo towers accept height `H = 170–350 m` and mass `M = 7.5–15 million kg`. Use the documented classroom calibration `q = sqrt((H/170) × (M/7.5e6))`, `q_max = sqrt((350/170) × (15/7.5))`, and `T = 4.8 + 2.2 × (q - 1)/(q_max - 1)` seconds. Taller or heavier towers have longer periods, always within the stopwatch-friendly 4.8–7.0 second range. Derive stiffness and viscous damping from this period and a fixed damping ratio of 0.0115. This mapping is a classroom rule, not a real structural prediction. Seeded classroom tower generation retains its existing calibration.
- Define principal sway as `x − y`: roof position **relative to its foundation**. Drive the tower animation, graph, danger rule, and results from the same simulation state.
- Keep the pendulum equation and its inverse available in model notes. Use a schematic cutaway with actual length reported numerically; do not imply the drawing is to scale. Current length controls cover 0.7–18 m, and TMD mass covers 1–10% of building mass.
- Two hydraulic dampers act in parallel. At damping 0, remove them visually and generate no hydraulic thermal energy. At damping 1, show the pendulum locked and generate no hydraulic thermal energy from pendulum motion. Intermediate settings permit motion and dissipate energy.
- Each hydraulic cylinder housing has a **fixed visual length**. Only the piston rod extends or retracts as the bob moves. Leave enough room in the schematic for the housing and rod; do not shrink the housing based on instantaneous bob distance. Visual clearance constraints must not modify the physical simulation.
- Simulate wall impacts using bob offset, bob radius, wall clearance, and restitution. Record hit counts and severity. The first physical hit is terminal in the lab and official challenge evaluation; stop the design's evaluated simulation at its first hit. Do not count impact losses as hydraulic thermal energy. Low TMD mass and zero damping can produce hits within the existing Strong earthquake preset; keep a regression for that case. The schematic limits displayed swing for hydraulic clearance, so show real impacts through the hit label and collapse.
- A damper can worsen a response under some settings. Preserve that possibility rather than forcing every installation to help.

## Controls and display

**Solo lab:** edit tower height (170–350 m) and mass (7.5–15 million kg), or choose **Random tower** to populate both fields. Remove the visible seed and tower information/Reveal panel. Committing a tower change resets the trial while retaining the student's TMD settings; never populate the pendulum length with a calculated answer when changing towers. Select earthquake strength and difficulty; start, pause, or reset; toggle the TMD; adjust length, mass percentage, and damping. Put TMD controls above the tower. Provide a roof-sway graph with adjustable time range, Latest and Full actions, and two numbered time cursors. Show a compact wall-hit label below the tower. Remove elapsed/danger metric cards and defer numeric thermal energy. Students measure period with a stopwatch after the ground stops.

**Compare mode:** duplicate the tower while sharing height, mass, earthquake strength, difficulty, ground motion, and simulation time. Tower A starts with no TMD and copies the current design parameters for later installation; Tower B retains the student's current TMD settings. Each tower has separate TMD controls directly above its drawing and its own wall-hit label and failure cause. Start, Pause, and Reset operate on both. Editing shared properties or either TMD resets both runs. Preserve both designs when toggling Compare and retain the original solo design on return. Use matching drawing scales and a single graph with shared axes, a solid teal Tower A trace, a dashed blue Tower B trace, and a labeled legend. Freeze each failed tower's physics independently, keep the surviving tower on the shared clock, and keep both foundations synchronized during the earthquake. Stack tower views on narrow screens.

Give tower setup its own labeled panel. Changes in height subtly raise or lower the drawn roof while keeping the foundation fixed. Changes in mass subtly thicken the structural columns. These are schematic cues; the numeric fields specify the actual settings. Hold tower settings fixed while comparing TMD designs.

Use taller graphics windows in both solo and Compare modes. In Compare, keep both towers side by side with the graph to their right on wider screens; move the graph below on smaller screens and stack towers on narrow screens. Give the graph title and time-cursor instructions separate lines so they remain readable.

Use separate labeled panels with strong visual separation: **orange Earthquake**, **purple Difficulty**, and **blue TMD**. Give them colored headers, borders, and spacing. Selected buttons should match their section color. Preserve keyboard operation and visible focus indicators; headings and borders should distinguish groups in addition to color.

**Student challenge:** join by room code and nickname, receive a tower with its game sway limit, and submit or revise a design before lock. Reconnection should recover the assigned tower and submitted settings using a locally stored session token. Teacher-owned lock/start behavior and submission state must remain clear. The classroom mode is an early prototype and needs further classroom testing.

**Teacher/projector view:** configure scenario seed, design time, earthquake strength, difficulty, run duration, and the existing structural-limit setting. Start, lock, and replay the challenge. Display a shared city skyline and an accessible results table. Show the same ground motion for every tower while applying each tower's declared game sway tolerance.

## Challenge scoring

- Assign tower properties deterministically from the room seed. Use identical design parameters and ground motion for reproducible replay.
- Calculate a no-TMD counterfactual for each tower under the same earthquake. The current implementation defines improvement by settling time: `100 × (baseline settling time − designed settling time) / baseline settling time`, allowing negative values.
- Settling time is currently the final time outside a ±0.06 m sway band after the shake. A value at the end of the run can mean the tower has not settled within the observation window; it should not be presented as a guaranteed settling time.
- Current city ranking prioritizes standing towers, then lower settling time, fewer wall hits, and lower peak sway. Results include status, settling time, peak sway, hits, thermal energy, and submitted settings. Baseline/improvement presentation remains a classroom-mode enhancement target.
- Danger failure uses the declared sway threshold and cumulative time rule. Official scoring also includes the existing peak-sway structural-limit check and immediate failure on the first wall hit. Keep those rules documented and consistent with displayed outcomes.
- Do not use random outcomes, hidden design bonuses, or cosmetic collapse decisions. A stronger damper must succeed through the coupled dynamics and openly shown game rules.

## Implementation and validation

Use the current lightweight Node.js app: `public/index.html`, `public/styles.css`, and `public/app.js` for the browser; `public/physics.js` for shared deterministic physics; `server.js` for static files, in-memory rooms, live events, and official classroom results. Core classroom operation must not depend on external CDNs.

Run locally with `npm.cmd start` on Windows (`npm start` on other systems), then open `http://localhost:3000`. Run checks with `npm.cmd test` (`npm test` elsewhere). The test command includes physics and rendering regressions.

Maintain meaningful checks for period relationships, measured free-motion periods across editable height/mass ranges, tower-control resets and preserved TMD settings, visible height/mass changes, synchronized comparison playback, independent TMD designs and failures, ground stopping, damping/thermal behavior, terminal impacts in every difficulty, deterministic replay, danger timing, successful and unsuccessful TMD designs, cylinder geometry, and Easy-mode checkbox behavior. Recalibration must test multiple tower seeds and representative editable towers, retain successful designs below maximum mass, and reject no-TMD or poorly chosen representative designs.

Keep this brief and README aligned with agreed classroom behavior. Commit and push project changes so a second computer can obtain them through Git. Current rooms are in memory; production classroom hosting and state persistence remain future work.

## Current acceptance criteria

- Students can set tower height and mass or randomize both, trigger a brief earthquake, measure natural period with a stopwatch after the ground stops with the TMD off, calculate a pendulum length, and test the TMD under the same earthquake. Solo periods stay within 4.8–7.0 seconds and remain hidden; tower appearance responds subtly to height and mass.
- Students can investigate length, mass, and damping without needing to analyze the earthquake waveform or choose its frequency/duration.
- Earthquake, Difficulty, and TMD controls are visually distinct and accessible. Graph and classroom result times use hundredths; the four lab metric cards are removed, and Easy disables the danger-zone checkbox.
- Compare mode runs identical towers with independent TMD settings, common playback controls, matching visual scales, and a shared graph. The first wall hit collapses only that tower, including on Easy, while its counterpart continues. Thermal-energy numbers remain deferred.
- The hydraulic housing stays rigid as the rod slides. The graph and tower reflect the same coupled simulation.
- Medium/Moderate requires a useful design on the default tower, and Hard/Strong has successful designs below the mass cap across representative tower scenarios. Failure occurs at the openly stated danger limit.
- The prototype can create rooms, assign varied towers, accept designs, and replay a common earthquake with reproducible results. Classroom synchronization, results presentation, and approximately 24-client operation require further validation before classroom rollout.

## Future extensions

After students understand natural period and TMD tuning, consider sustained excitation, frequency sweeps, split resonance peaks, more realistic recorded or multi-wave earthquakes, richer baseline comparisons, and production hosting. These are later investigations, not requirements for the introductory earthquake controls.

Continue tuning parameter ranges, game tolerances, time budgets, and scoring from teacher trials. Revisit the documented presets and regression cases whenever the agreed learning goals or game behavior change.
