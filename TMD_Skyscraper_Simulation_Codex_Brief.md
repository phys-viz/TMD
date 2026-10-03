# Tuned Mass Damper Skyscraper Lab and City Challenge

## Goal and current teaching scope

Build a browser-based simulation for freshman STEM students studying skyscrapers and tuned mass dampers (TMDs) in the context of earthquakes. Students use a building's measured natural period and the simple-pendulum equation, `T = 2π√(L/g)`, to predict a useful pendulum length, then investigate mass and damping.

The initial investigation focuses on **natural period and TMD tuning**. An earthquake starts the motion; students do not need to analyze the forcing, select an earthquake frequency, or vary its duration. After the ground stops, students measure the tower's free oscillations.

Create a working, attractive prototype that we can test and revise. Favor clear behavior and honest physics over elaborate art. Students typically use Chromebooks; the teacher projects the city view. Use nicknames and room codes rather than requiring student accounts.

This is a maintained project brief. The requirements below replace the original pull/release and selectable-frequency sequence for the introductory lab. Advanced resonance investigations remain possible future extensions.

## Student learning sequence

1. **Start an earthquake with the TMD off.** Select Gentle, Moderate, or Strong and press Start earthquake. The ground shakes for a fixed 3.0 seconds, then stops. Moderate is the default strength. Easy mode supports an initial measurement trial without danger-zone collapse.
2. **Measure the building's natural period.** Measure after the ground stops, with the TMD absent. Use several complete cycles and divide their total time by the number of cycles. Provide roof-sway-versus-time data and A/B graph cursors. Keep the building's period hidden until students choose Reveal. The ground-stopped message tells students when measurement can begin.
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

- **Easy:** disable danger-zone collapse. Disable the Show danger zone checkbox and show danger time as Off. Preserve the user's checkbox preference when switching back to Medium or Hard.
- **Medium:** fail when accumulated danger time reaches **3.00 seconds**.
- **Hard:** fail when accumulated danger time reaches **2.50 seconds**.
- Danger time begins only after ground shaking ends. Accumulate it while the absolute roof displacement relative to the foundation exceeds the tower's game sway limit. Time is cumulative, not necessarily consecutive; do not accumulate it from a hidden velocity or amplitude envelope.
- Give each generated tower a visible, deterministic game sway limit. The current calibration is `round(0.20 × max(1, (6 s / T)²), 2) m`, where `T` is its natural period. Across the current 4.8–7.0 second period range, limits are approximately 0.20–0.31 m. This balances shorter-period towers under a common earthquake. It is a game calibration, not a structural formula.
- Display the assigned sway limit in solo and student tower readouts. Use that same limit for the danger graphics, live failure logic, and official results.
- Hard/Strong must have useful designs **below the 10% mass maximum**. The current regression suite verifies survival at 8% mass, a length calculated from natural period, and damping 0.25 across 48 towers from two seeds. The corresponding no-TMD runs fail. Preserve meaningful sensitivity to length, mass, and damping; do not guarantee that every design succeeds.
- Display elapsed time, accumulated danger time, and settling results to **hundredths of a second**. Show completed hundredths for danger time so it cannot round up to the failure limit before failure. Live and scored runs must fail when the limit is reached, with a small numerical tolerance for floating-point arithmetic.

## Physical model and scientific integrity

- Model the building's dominant lateral mode as a lumped roof mass attached to moving ground by a spring and modest dashpot. Model the TMD as a pendulum attached to that mass. Numerically integrate the **coupled** equations, including the pendulum's reaction on the building. Do not animate independent motions or apply a cosmetic sway-reduction factor.
- Use horizontal roof displacement `x`, base displacement `y`, pendulum angle `θ` from vertical, building mass `M`, bob mass `m`, building stiffness `k`, viscous building damping `c`, pendulum length `L`, and pendulum damping `b`. For a massless rod, one consistent preferred convention is:

  `(M + m)ẍ + mL(θ̈ cosθ − θ̇² sinθ) + c(ẋ − ẏ) + k(x − y) = 0`

  `Lθ̈ + ẍ cosθ + g sinθ + (b/(mL))θ̇ = 0`

  Derive and solve the coupled accelerations together. Document the damping convention and its units; keep damping and energy conventions dimensionally consistent. Use a stable integrator and small internal steps. The prototype uses RK4 with internal steps no larger than 0.004 seconds.
- Set building stiffness consistently from the assigned natural period: `k = M(2π/T)²`. Generated tower periods are currently 4.8–7.0 seconds, and masses are 7.5–15 million kg. Do not expose an arbitrary building-frequency slider in the introductory lab.
- Define principal sway as `x − y`: roof position **relative to its foundation**. Drive the tower animation, graph, danger rule, and results from the same simulation state.
- Keep the pendulum equation and its inverse available in model notes. Use a schematic cutaway with actual length reported numerically; do not imply the drawing is to scale. Current length controls cover 0.7–18 m, and TMD mass covers 1–10% of building mass.
- Two hydraulic dampers act in parallel. At damping 0, remove them visually and generate no hydraulic thermal energy. At damping 1, show the pendulum locked and generate no hydraulic thermal energy from pendulum motion. Intermediate settings permit motion and dissipate energy.
- Each hydraulic cylinder housing has a **fixed visual length**. Only the piston rod extends or retracts as the bob moves. Leave enough room in the schematic for the housing and rod; do not shrink the housing based on instantaneous bob distance. Visual clearance constraints must not modify the physical simulation.
- Simulate wall impacts using bob offset, bob radius, wall clearance, and restitution. Record hit counts and severity. Do not count impact losses as hydraulic thermal energy.
- A damper can worsen a response under some settings. Preserve that possibility rather than forcing every installation to help.

## Controls and display

**Solo lab:** choose a tower seed or generate a new tower; select earthquake strength and difficulty; start, pause, or reset; toggle the TMD; adjust length, mass percentage, and damping. Provide a roof-sway graph with adjustable time range, Latest and Full actions, and A/B cursors for measuring period. Retain the optional period reveal and the live thermal-energy, danger-time, and hit readouts.

Use separate labeled panels with strong visual separation: **orange Earthquake**, **purple Difficulty**, and **blue TMD**. Give them colored headers, borders, and spacing. Selected buttons should match their section color. Preserve keyboard operation and visible focus indicators; headings and borders should distinguish groups in addition to color.

**Student challenge:** join by room code and nickname, receive a tower with its game sway limit, and submit or revise a design before lock. Reconnection should recover the assigned tower and submitted settings using a locally stored session token. Teacher-owned lock/start behavior and submission state must remain clear. The classroom mode is an early prototype and needs further classroom testing.

**Teacher/projector view:** configure scenario seed, design time, earthquake strength, difficulty, run duration, and the existing structural-limit setting. Start, lock, and replay the challenge. Display a shared city skyline and an accessible results table. Show the same ground motion for every tower while applying each tower's declared game sway tolerance.

## Challenge scoring

- Assign tower properties deterministically from the room seed. Use identical design parameters and ground motion for reproducible replay.
- Calculate a no-TMD counterfactual for each tower under the same earthquake. The current implementation defines improvement by settling time: `100 × (baseline settling time − designed settling time) / baseline settling time`, allowing negative values.
- Settling time is currently the final time outside a ±0.06 m sway band after the shake. A value at the end of the run can mean the tower has not settled within the observation window; it should not be presented as a guaranteed settling time.
- Current city ranking prioritizes standing towers, then lower settling time, fewer wall hits, and lower peak sway. Results include status, settling time, peak sway, hits, thermal energy, and submitted settings. Baseline/improvement presentation remains a classroom-mode enhancement target.
- Danger failure uses the declared sway threshold and cumulative time rule. Official scoring also includes the existing peak-sway structural-limit check and wall-hit damage classification. Keep those rules documented and consistent with displayed outcomes.
- Do not use random outcomes, hidden design bonuses, or cosmetic collapse decisions. A stronger damper must succeed through the coupled dynamics and openly shown game rules.

## Implementation and validation

Use the current lightweight Node.js app: `public/index.html`, `public/styles.css`, and `public/app.js` for the browser; `public/physics.js` for shared deterministic physics; `server.js` for static files, in-memory rooms, live events, and official classroom results. Core classroom operation must not depend on external CDNs.

Run locally with `npm.cmd start` on Windows (`npm start` on other systems), then open `http://localhost:3000`. Run checks with `npm.cmd test` (`npm test` elsewhere). The test command includes physics and rendering regressions.

Maintain meaningful checks for period relationships, ground stopping, damping/thermal behavior, impacts, deterministic replay, danger timing, successful and unsuccessful TMD designs, cylinder geometry, hundredths display, and Easy-mode checkbox behavior. Recalibration must test multiple tower seeds, retain successful designs below maximum mass, and reject no-TMD or poorly chosen representative designs.

Keep this brief and README aligned with agreed classroom behavior. Commit and push project changes so a second computer can obtain them through Git. Current rooms are in memory; production classroom hosting and state persistence remain future work.

## Current acceptance criteria

- Students can trigger a brief earthquake, measure natural period after the ground stops with the TMD off, calculate a pendulum length, and test the TMD under the same earthquake.
- Students can investigate length, mass, and damping without needing to analyze the earthquake waveform or choose its frequency/duration.
- Earthquake, Difficulty, and TMD controls are visually distinct and accessible. Time readouts use hundredths, and Easy disables the danger-zone checkbox.
- The hydraulic housing stays rigid as the rod slides. The graph and tower reflect the same coupled simulation.
- Medium/Moderate requires a useful design on the default tower, and Hard/Strong has successful designs below the mass cap across representative tower scenarios. Failure occurs at the openly stated danger limit.
- The prototype can create rooms, assign varied towers, accept designs, and replay a common earthquake with reproducible results. Classroom synchronization, results presentation, and approximately 24-client operation require further validation before classroom rollout.

## Future extensions

After students understand natural period and TMD tuning, consider sustained excitation, frequency sweeps, split resonance peaks, more realistic recorded or multi-wave earthquakes, richer baseline comparisons, and production hosting. These are later investigations, not requirements for the introductory earthquake controls.

Continue tuning parameter ranges, game tolerances, time budgets, and scoring from teacher trials. Revisit the documented presets and regression cases whenever the agreed learning goals or game behavior change.
