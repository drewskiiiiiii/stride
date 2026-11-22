# Stride — Offline Running Coach (PWA)

A personal running coach that works fully offline after first load: onboarding assessment, a rule-based training-plan engine, an interactive calendar, guided interval workouts with voice cues and GPS, and progress analytics. No accounts, no servers, no AI calls. All data stays on the device (IndexedDB + localStorage).

## Deploy to GitHub Pages (≈3 minutes)

1. Create a new repository on GitHub (e.g. `stride`). It can be public or private (Pages on private repos needs a paid plan).
2. Upload **the contents of this folder** (so `index.html` sits at the repository root): **Add file → Upload files**, drag everything in, then commit.
3. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, then save.
4. After about a minute your app is live at `https://<username>.github.io/stride/`. HTTPS is automatic, and GPS, installation and offline mode all need it.
5. On your phone, open that URL once while online, then:
   - **iPhone (Safari):** Share → **Add to Home Screen**
   - **Android (Chrome):** ⋮ → **Install app**

   After that it runs with no connection.

**Updating:** when you change any file, bump `VERSION` in `service-worker.js` so installed copies download the new files. They apply the next time the app is opened.

**Local testing:** `python3 -m http.server 8000` in this folder, then open `http://localhost:8000` (localhost counts as a secure context).

## What's new in v2
- **Guided workouts.** A 10-second start countdown ("Workout starting in 10 seconds"). Live display of "Interval 3 of 5", remaining time or distance, target vs actual pace, average pace, speed and % complete.
  - Voice cues: "You have 200 metres remaining", "Recovery interval begins", halfway, and "Begin your cooldown".
  - Announcement level (Minimal / Standard / Detailed, with periodic updates every 1–10 minutes), plus volume and voice speed.
  - Control taps are debounced so a double tap can't skip two intervals.
- **Intelligent calendar.**
  - **Missed workouts:** when you miss one, the coach looks at your week's remaining runs, safe days, the next hard session, recovery needs, weekly mileage, the training phase and how important the session is. It then recommends one of: skip, move, a shorter version, reduce upcoming mileage, adjust the next long run, or leave the plan unchanged. Nothing changes until you tap Apply, and missed work is never crammed into the following days.
  - **Rescheduling:** drag and drop on desktop, long-press-and-drag on phones. Every move is checked for consecutive hard days, insufficient recovery, weekly mileage, long-run conflicts and taper conflicts.
  - **New adjustment types:** unavailable days (the week is reorganised around them), extra rest days, and temporary restrictions (easy-only or reduced volume).
  - **Change summaries:** every change shows what changed, why, which workouts moved, how weekly mileage changed, and whether the race target is still realistic. All changes are kept in a Change history.
- **Adaptive coaching.**
  - **After each workout:** a "Coach's take" compares each effort with its target and records effort (RPE) and how your legs feel.
  - **Trends:** over multiple sessions, per pace group, it flags consistently faster or slower running, improving interval pace, long-run endurance, consistency, and sessions cut short.
  - **Pace suggestions:** these change only one zone group (for example threshold) unless the evidence is broad, in which case the overall fitness score changes. You see old and new paces side by side, and can accept or reject. It needs at least three sessions, ignores outlier runs, and doesn't repeat a suggestion you've rejected.
  - **Assessments:** suggested every 6 weeks or more (never in a taper): 1-mile, 5K, or a controlled 30-minute threshold test.
  - **Daily check-in:** before hard sessions it asks about legs, fatigue, sleep and pain, then recommends one of: proceed, reduce, swap to an easy run, or rest. If you report pain, it recommends conservative training and a medical evaluation.
- **Data.**
  - **Versioning:** data is versioned (v2) with automatic migration, including for backups made by older versions.
  - **Import:** backups are validated first and shown as a preview, with duplicate detection and a choice between Merge and Replace.
  - **Backups:** you get a confirmation after each backup, plus a reminder if you haven't backed up in 3 weeks.
  - **Preferences** are mirrored to IndexedDB.
  - **Duplicate protection:** the same workout can't be saved twice.

## Architecture

```
index.html, manifest.webmanifest, service-worker.js
css/        styles.css (tokens, layout, components) · calendar.css · workout.css
js/app.js   bootstrap, hash router, global action dispatch
js/core/    dates · units · db (IndexedDB) · storage (localStorage prefs + live-session mirror) · store (state + persistence) · migrate (schema versions, backup validation/merge)
js/engine/  PURE, DOM-free, deterministic — unit-tested in Node
  vdot.js              Daniels–Gilbert VDOT model, race prediction, pace/HR/RPE zones
  assessment.js        fitness evaluation, goal catalogue, realism check, run–walk ladder
  workouts.js          workout builders (easy, long, tempo, cruise, intervals, reps, fartlek, hills, TT, race, run–walk)
  strength.js          running-specific strength & mobility session generator (equipment-aware)
  training-engine.js   periodised plan generator (phases, volume progression, recovery weeks, taper, scheduling)
  adjustments.js       move validation (recovery / long run / taper / mileage), regeneration merge, benchmarks
  scheduler.js         missed-workout analysis & options, change summaries (incl. race realism)
  performance.js       workout evaluation, multi-session trends, per-zone pace offsets, assessments, recovery check-in
js/services/ workout-session.js (timestamp-based timer state machine) · gps.js · audio-coach.js (speech, beeps, vibration, wake lock, notifications)
js/ui/      onboarding · preview · today · plan · calendar · dragdrop · progress · profile · live (workout mode) · coach · actions · adjust · charts · insights · format · dom
tests/run-tests.js   `node tests/run-tests.js` — 49 engine, scheduling, adaptive-coaching, timer and data tests
```

### How the plan engine works
- **Fitness:** best recent benchmark → VDOT, with a small penalty for results older than ~2 months. Without benchmarks the plan uses **RPE / effort cues** and schedules an early time trial instead of inventing paces. With only an easy pace, it sets easy-zone paces and leaves the rest effort-based.
- **New runners** who can't run 20 minutes continuously start with a 10-level run–walk ladder that ends at 30 minutes continuous.
- **Phases:** base → aerobic → speed & threshold → race-specific → peak → taper (+ post-race recovery for the half and marathon). Phase weights depend on goal, experience and finish-vs-performance orientation.
- **Volume:** starts at your current weekly distance. It grows 5 / 8 / 10 % a week (gradual / moderate / aggressive), capped at +8 km in any week. Every 4th week is a recovery week (every 3rd if you're 50+ or a new runner). The long run grows 1.0–2.4 km a week up to a cap set by the distance. Everything is also capped by the time you have each day.
- **Scheduling:** run days are spread as evenly as possible across the days you're available. Quality sessions are always at least 48 h from each other and from the long run, and the day after a hard session becomes a recovery run. Strength avoids the day before a key session.
- **Adjustments** (travel, illness, hold, recovery week, volume changes) are stored as inputs. The plan is regenerated deterministically from today, and completed, missed and user-added workouts are preserved. Missed sessions are never crammed into later days.
- **Pace updates:** time trials and races offer to recalibrate VDOT. After 4 or more structured workouts that are consistently faster or slower than target, the app suggests a ±1 VDOT change. It never changes paces on its own.

### Timer reliability
Elapsed time is always computed from `Date.now()` timestamps (start, pause total), never by counting intervals. Each tick checks how much time has passed and catches up through as many steps as needed, so throttled or backgrounded timers stay correct. The session is mirrored to localStorage every second and on `pagehide`. If the app was closed mid-workout, the next launch offers: resume excluding the gap, resume counting the gap, finish & save, or discard.

## Platform limitations (and what the app does instead)
| Limitation | Fallback |
|---|---|
| iOS Safari suspends JavaScript, audio and GPS when the screen locks or the app is backgrounded | Screen Wake Lock keeps the display on (iOS 16.4+). The timer recalculates from timestamps on return. If several steps passed, it says "Catching up" and announces only the current step. |
| Android Chrome throttles background timers | Same timestamp catch-up. Optional notifications announce phase changes while the app is in the background. |
| Browsers can't schedule offline reminders reliably | **Export to phone calendar** (.ics with 30-minute alerts) under Plan → Plan settings |
| No web vibration on iPhone | Audio beeps and voice cues |
| GPS needs HTTPS and permission. Accuracy varies under trees and between buildings | Points with accuracy worse than 50 m or speeds above 12 m/s are rejected. Treadmill and timer modes convert distance steps to time at target pace, and you can enter the real distance at the end |
| Storage can be evicted by the browser | `navigator.storage.persist()` is requested. Use **Profile → Export backup** regularly |

## Safety
Stride does not diagnose injuries or prescribe rehab. If you report current pain, the plan holds volume, removes hard sessions and advises a medical evaluation until you clear the flag in Profile.

Font: Inter (SIL Open Font License, bundled in `assets/fonts`).
