# Tuned Mass Damper Skyscraper Lab and City Challenge

## Goal

Build a browser-based physics simulation for freshman STEM students who have learned the simple-pendulum equation, `T = 2π√(L/g)`. They investigate resonance and tune a pendulum mass damper inside a skyscraper. After solo exploration, a teacher can run a shared city challenge: each student submits a damper design for their own tower, and the class watches all towers respond to the same simulated earthquake.

Create a working, attractive prototype that we can test and revise. Favor clear behavior and honest physics over elaborate art. Students typically use Chromebooks; the teacher projects the city view. Avoid requiring student accounts or collection of personal information; use display names or nicknames.

## Student learning sequence

1. **Find a building's natural period.** With the ground still and the damper absent, pull the roof sideways and release it. Display a time graph and let students measure successive peaks. Offer an optional measurement aid, but do not reveal the period before they have a chance to measure it.
2. **Find resonance.** Drive the base sinusoidally at selectable periods. Vary the period and compare sustained roof sway. Make the building's resonance visible without allowing unbounded growth.
3. **Predict and test a damper.** Students calculate `L = g(T/2π)^2` from the building period, install a pendulum near the top, and test lengths around their prediction. The damper is free to swing relative to the building and exerts a reaction force on it.
4. **Improve robustness.** Unlock damper mass and resistance/damping. Compare designs at several earthquake periods around the building's resonance, not solely one frequency. Show that a lightly damped absorber can shift/split the response peaks.
5. **City challenge.** Students receive varied, reasonably comparable towers. They have a teacher-set design window to test and submit a final TMD. The teacher starts a common earthquake whose period is chosen from a disclosed range; everyone watches the city respond. Show survival, peak sway, and improvement versus the *same tower without a TMD*.

## Physical model and scientific integrity

- Represent the building's dominant lateral mode as a lumped building mass connected to the moving ground by a spring and dashpot. Represent the TMD as a pendulum hung from that building mass. Numerically integrate the **coupled** equations, including reaction on the building; do not animate independent motions or use a cosmetic reduction factor.
- The preferred model uses horizontal roof displacement `x`, base displacement `y`, pendulum angle `θ` from vertical, building mass `M`, bob mass `m`, building stiffness `k`, building viscous damping `c`, length `L`, and pivot/bob damping `b`. For a massless rod, one consistent set of equations is:

  ` (M + m)ẍ + mL(θ̈ cosθ − θ̇² sinθ) + c(ẋ − ẏ) + k(x − y) = 0 `

  ` Lθ̈ + ẍ cosθ + g sinθ + (b/(mL))θ̇ = 0 `

  Derive and solve the coupled accelerations together at each integration step. The exact damping convention can differ if documented and dimensionally consistent. Use a stable time integrator and sufficiently small internal steps. Check undriven decay, approximate small-angle periods, near-resonant amplification, and damper influence.
- Ground motion for the challenge is an **idealized constant-frequency sinusoidal base displacement**, smoothly ramped up. Label it as such; real earthquakes are not single-frequency sinusoids. Display base amplitude and period/frequency with units. A challenge may use a seeded selection from the announced period range so every building sees exactly the same motion and replay is reproducible.
- A building's no-damper small-amplitude period is `2π√(M/k)`. Assigning varied tower periods and masses should set `k` consistently. Expose student controls as physical choices: pendulum length, bob mass, and resistance; building properties vary by scenario. Avoid an unexplained arbitrary frequency slider for the building.
- Define the graph's principal sway as `x − y`, the roof position **relative to its foundation**. Show the ground trace separately. For scoring, use a steady or late-window peak relative sway as well as an overall structural-limit check; label each measure clearly. Do not let a short run or transient startup unfairly decide a result.
- Tune ranges to keep physically meaningful pendulum lengths and swing angles. If a very tall building requires a long pendulum, show a scaled cutaway and report actual length numerically; do not imply the drawing is to scale. Guard against singular/unphysical settings. If the pendulum reaches a range where the model is implausible, constrain settings or explain the approximation.
- Structural failure is a **game rule**, not a detailed structural analysis: establish and display a sway/drift threshold and a clear persistence or damage rule. Do not claim to predict real-world collapse. Make results reproducible from submitted settings and scenario parameters. A damper can occasionally worsen response at an off-tuned frequency; do not force every installation to help.

## Controls and display

**Solo lab:** choose a building scenario or seed; pull/release roof; set earthquake period and amplitude; toggle TMD; set pendulum length. Unlock bob mass and damper resistance for advanced investigation. Provide play/pause/reset, readable values and units, roof-versus-time graph, measured or calculated peak sway, and comparison with a no-TMD baseline. A frequency-response sweep is a desirable second view: show roof amplitude versus driving period with and without the selected damper. Keep the pendulum equation visible; place coupled-model details in an expandable explanation.

**Student challenge:** join with room code and nickname; receive a tower and its parameters; test within the design window; submit or revise until lock; see a clear submission state. No student can trigger the earthquake or change settings after lock. Reconnection should recover the assigned tower and submitted settings using a simple session token stored locally. Keep the classroom interface suitable for roughly 24 students.

**Teacher/projector view:** create room, configure design time, period range, amplitude, and scenario seed; start/lock/replay the challenge. Show named towers in a city skyline, animated from the same simulation. Show a timer and eventual status (standing, damaged, or failed) plus an accessible table/leaderboard of measured outcomes. Collapse animation should be dramatic but readable; show why a tower failed in its result details.

## Challenge fairness and scoring

- Generate varied tower masses and natural periods, but keep their baseline challenge difficulty comparable. Assign towers deterministically from a room seed. The teacher may assign scenarios or allow choices later; the first prototype can assign them automatically.
- The teacher announces the earthquake **period range**, not the exact draw. At lock, the app chooses one common period within that range using a seed; all towers experience identical ground acceleration/displacement history. A later iteration can add multiple waves.
- Compute each tower's no-TMD counterfactual under the same ground motion. Show `improvement = 100 × (baseline peak sway − designed peak sway)/baseline peak sway`, allowing negative values. Survival is based on an openly shown drift/damage rule. Rank surviving towers by improvement and then peak sway, or use a transparent score with those components. Display both raw and normalized results so students can discuss fairness.
- Do not use chance, hidden modifiers, or cosmetic collapse logic in the outcome. Provide post-event graphs of roof sway and pendulum motion, plus the assigned period and submitted settings. Permit replay of the same earthquake and optional what-if testing after the scored round.

## Implementation approach

Use a lightweight web app. A client-side simulation engine can power the solo lab and animation; the room service must authoritatively store scenarios, submissions, teacher lock/start events, earthquake seed, and final results. Ensure all clients render the same deterministic scenario; preferably calculate official results on the server or verify that clients match a canonical run. Use a simple room-code real-time transport (WebSockets or an equivalent). Pick a practical stack that runs locally and can later be hosted; document local start commands and deployment needs. Do not depend on blocked external CDNs for core classroom operation.

Build in vertical slices: (1) credible solo simulation and graphs; (2) scenario variation and comparisons; (3) room join/submission/teacher controls; (4) city playback and results. Keep the physics engine independently testable from the UI. Provide a small set of meaningful numerical checks, including pendulum period, undamped/no-drive behavior, resonance with building damping, improvement near a tuned case, and reproducible challenge results. Run the app and inspect the main student and projector views before handing it back.

## First-prototype acceptance criteria

- A student can determine a tower period, calculate and enter a pendulum length, and observe coupled tower and pendulum motion under ground excitation.
- Changing earthquake period visibly changes response; a tuned damper substantially reduces sway for at least a representative near-resonance setup, while mistuning can perform worse.
- The graphs and readouts use defined quantities, sensible units, and consistent physics; the city uses the same model as the lab.
- A teacher can create a room and launch a round; approximately 24 student clients can join, receive varied towers, submit designs, and watch one synchronized city event with reproducible results.
- The result screen shows survival rule, no-TMD baseline, actual peak sway, percent improvement, and earthquake period. Students can explain why their design succeeded or failed.

## Open for iteration

Visual style, exact parameter ranges, damage threshold, time budget, scoring weights, hosting provider, and whether later rounds have several earthquake waves should be tuned after trying the prototype with the teacher. Start with sensible documented defaults and a teacher configuration panel rather than blocking implementation on these choices.
