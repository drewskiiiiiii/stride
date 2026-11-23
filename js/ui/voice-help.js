// Voice Coach troubleshooting: an honest test (did speech actually start?) and a checklist.
import { esc, icon, toast, openSheet } from './dom.js';
import { prefs } from '../core/storage.js';
import { audio } from '../services/audio-coach.js';

const TEST_LINE = 'Voice coach check. Interval 1 of 5. 800 metres.';

/** Speak a test line inside the user's tap, then report whether speech really started. */
export function testVoice({ onResult } = {}) {
  audio.unlock();
  audio.beep({ times: 2, force: true });
  audio.vibrate([150]);
  const sent = audio.say(TEST_LINE, { force: true, cat: 'transitions', prio: 3 });
  const check = () => {
    const d = audio.diagnostics();
    const e = d.log.find((x) => x.text === TEST_LINE);
    const ok = !!e && (e.status === 'speaking' || e.status === 'done');
    const msg = !sent || !d.speech ? 'This browser can’t speak. Open Stride in Safari (iPhone) or Chrome (Android).'
      : ok ? 'Voice is working. If you still can’t hear it, raise the media volume and check the Silent switch.'
      : e?.status === 'sent' ? 'Still waiting for the speech engine…'
      : `The phone didn’t play speech (${e?.error || e?.status || 'no response'}). See Voice troubleshooting.`;
    onResult ? onResult(ok, msg, d) : toast(msg, 4200);
    return ok;
  };
  setTimeout(check, 2600);
}

function checklist(d) {
  const p = prefs.get();
  const row = (good, title, body) => `<div class="setting"><span style="flex:none;color:${good ? 'var(--good,#34c759)' : '#f5a524'}">${icon(good ? 'check' : 'alert', 'sm')}</span><div class="grow"><div class="t">${title}</div><div class="s">${body}</div></div></div>`;
  const off = Object.entries(d.categories).filter(([, v]) => !v).map(([k]) => k);
  const ios = d.platform === 'ios';
  return [
    row(d.speech, 'Speech available', d.speech ? `${d.voices || 'Default'} voice${d.voices === 1 ? '' : 's'} on this device${d.voiceName ? ` · using ${esc(d.voiceName)}` : ''}` : 'This browser has no speech engine. Use Safari on iPhone or Chrome on Android.'),
    row(d.enabled, 'Voice Coach is on', d.enabled ? 'Spoken coaching is enabled.' : 'It’s switched off — the “Voice off” pill on the workout screen also mutes it.'),
    row(!off.length, 'Announcement types', off.length ? `Turned off: ${off.join(', ')}.` : 'All announcement types are on.'),
    row(p.cueLevel !== 'minimal', 'Announcement frequency', p.cueLevel === 'minimal' ? 'Minimal — you’ll only hear interval changes, safety messages and the finish. Easy runs can be silent for a long time.' : `${p.cueLevel === 'detailed' ? 'Detailed' : 'Standard'} — regular cues during the workout.`),
    row(!d.failStreak, 'Recent announcements played', d.failStreak ? `The last ${d.failStreak} announcement${d.failStreak > 1 ? 's' : ''} didn’t play (${esc(d.lastFail?.reason || 'unknown')}). Tap “Test voice” to re-enable speech.` : d.lastOk ? `Last spoken ${new Date(d.lastOk).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'Nothing spoken yet this session.'),
    ios ? row(d.session !== 'ambient', 'Ring/Silent switch', d.session === 'ambient' ? 'Quiet mixing mode is on, so iOS mutes the coach when your phone is on silent. Turn it off in Music & Voice Coach.' : 'The coach plays even with the phone on silent. Use the side buttons while it speaks to set the volume.') : '',
    row(true, 'Keep Stride on screen', ios ? 'iPhone suspends web apps when the screen locks or you switch apps, so the coach goes quiet. Keep Stride open; timing catches up when you return.' : 'Some Android battery savers pause the page with the screen off. Allow Chrome to run in the background for best results.'),
  ].join('');
}

const STATUS = { done: 'Spoken', speaking: 'Speaking', sent: 'Sent', queued: 'Queued', retrying: 'Retrying', failed: 'Didn’t play', error: 'Error', skipped: 'Not spoken' };

export function openVoiceHelp() {
  const body = () => {
    const d = audio.diagnostics();
    const log = d.log.length ? d.log.map((e) => `<div class="setting"><div class="grow"><div class="t small">${esc(e.text)}</div><div class="s tiny">${new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · ${STATUS[e.status] || e.status}${e.why ? ` — ${esc(e.why)}` : ''}${e.error ? ` (${esc(e.error)})` : ''}</div></div></div>`).join('') : '<div class="setting"><div class="grow s small muted">No announcements yet. Start a workout or tap Test voice.</div></div>';
    return `<h2 style="margin:0 0 4px">Voice troubleshooting</h2>
      <p class="small muted" style="margin:0 0 12px">Tap Test voice — it re-enables speech and tells you whether the phone actually played it.</p>
      <button class="btn primary block" data-vh="test">${icon('volume', 'sm')} Test voice</button>
      <div class="tiny" data-vh="result" style="margin:8px 0 4px;min-height:1em"></div>
      <div class="list">${checklist(d)}</div>
      <div class="section-title"><h2>Recent announcements</h2></div>
      <div class="list">${log}</div>`;
  };
  openSheet(`<div data-vh="root">${body()}</div>`, {
    onMount: (sh) => {
      const bind = () => {
        sh.querySelector('[data-vh="test"]').onclick = () => {
          sh.querySelector('[data-vh="result"]').textContent = 'Speaking…';
          testVoice({ onResult: (ok, msg) => { sh.querySelector('[data-vh="root"]').innerHTML = body(); bind(); sh.querySelector('[data-vh="result"]').textContent = msg; sh.querySelector('[data-vh="result"]').style.color = ok ? 'var(--good,#34c759)' : '#f5a524'; } });
        };
      };
      bind();
    },
  });
}
