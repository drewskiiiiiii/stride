// Running-specific strength and mobility session generator. Deterministic.

const EX = [
  // id, name, focus, equipment needed (any of), level, prescription, cue
  { id: 'squat', name: 'Bodyweight squat', focus: 'lower', equip: ['none'], level: 1, reps: 12, cue: 'Sit back, chest tall, knees track over toes.' },
  { id: 'goblet', name: 'Goblet squat', focus: 'lower', equip: ['dumbbells', 'kettlebell'], level: 1, reps: 10, cue: 'Hold the weight at your chest, sit between your heels.' },
  { id: 'backsquat', name: 'Barbell back squat', focus: 'lower', equip: ['gym'], level: 2, reps: 6, cue: 'Brace, controlled descent, drive up through mid-foot.' },
  { id: 'rdl-bw', name: 'Single-leg hip hinge (bodyweight)', focus: 'single-leg', equip: ['none'], level: 1, reps: 8, perSide: true, cue: 'Hinge from the hip, long line from head to back heel.' },
  { id: 'rdl', name: 'Romanian deadlift', focus: 'glute', equip: ['dumbbells', 'kettlebell', 'gym'], level: 1, reps: 10, cue: 'Soft knees, push hips back, flat back.' },
  { id: 'sl-rdl', name: 'Single-leg Romanian deadlift', focus: 'single-leg', equip: ['dumbbells', 'kettlebell'], level: 2, reps: 8, perSide: true, cue: 'Square hips, slow lowering, stand tall at the top.' },
  { id: 'split', name: 'Split squat', focus: 'single-leg', equip: ['none', 'dumbbells'], level: 1, reps: 10, perSide: true, cue: 'Drop the back knee straight down, front shin near vertical.' },
  { id: 'bulgarian', name: 'Bulgarian split squat', focus: 'single-leg', equip: ['none', 'dumbbells', 'kettlebell', 'gym'], level: 2, reps: 8, perSide: true, cue: 'Rear foot on a bench, control the descent.' },
  { id: 'stepup', name: 'Step-up', focus: 'single-leg', equip: ['none', 'dumbbells'], level: 1, reps: 10, perSide: true, cue: 'Drive through the top foot, no push from the bottom leg.' },
  { id: 'lunge-rev', name: 'Reverse lunge', focus: 'single-leg', equip: ['none', 'dumbbells', 'kettlebell'], level: 1, reps: 10, perSide: true, cue: 'Step back softly, keep the torso upright.' },
  { id: 'bridge', name: 'Glute bridge', focus: 'glute', equip: ['none'], level: 1, reps: 15, cue: 'Squeeze glutes at the top, ribs down.' },
  { id: 'sl-bridge', name: 'Single-leg glute bridge', focus: 'glute', equip: ['none'], level: 2, reps: 10, perSide: true, cue: 'Keep hips level, pause at the top.' },
  { id: 'hipthrust', name: 'Hip thrust', focus: 'glute', equip: ['dumbbells', 'gym'], level: 2, reps: 10, cue: 'Shoulders on a bench, chin tucked, full hip extension.' },
  { id: 'monster', name: 'Banded lateral walk', focus: 'glute', equip: ['bands'], level: 1, reps: 12, perSide: true, cue: 'Band above knees, stay low, toes forward.' },
  { id: 'clam', name: 'Side-lying clamshell', focus: 'prevention', equip: ['none', 'bands'], level: 1, reps: 15, perSide: true, cue: 'Heels together, rotate the knee open without rolling back.' },
  { id: 'calf', name: 'Calf raise', focus: 'calf', equip: ['none', 'dumbbells'], level: 1, reps: 15, cue: 'Full range — slow 3-second lower.' },
  { id: 'sl-calf', name: 'Single-leg calf raise', focus: 'calf', equip: ['none', 'dumbbells'], level: 2, reps: 12, perSide: true, cue: 'On a step edge, full stretch at the bottom.' },
  { id: 'soleus', name: 'Bent-knee calf raise', focus: 'calf', equip: ['none', 'dumbbells'], level: 1, reps: 15, cue: 'Knees bent ~30°, targets the soleus.' },
  { id: 'plank', name: 'Front plank', focus: 'core', equip: ['none'], level: 1, hold: 40, cue: 'Straight line from shoulders to heels, breathe.' },
  { id: 'sideplank', name: 'Side plank', focus: 'core', equip: ['none'], level: 1, hold: 30, perSide: true, cue: 'Hips high, stacked feet or staggered.' },
  { id: 'deadbug', name: 'Dead bug', focus: 'core', equip: ['none'], level: 1, reps: 10, perSide: true, cue: 'Lower back pressed into the floor, move slowly.' },
  { id: 'birddog', name: 'Bird dog', focus: 'core', equip: ['none'], level: 1, reps: 8, perSide: true, cue: 'Reach long, no hip rotation.' },
  { id: 'pallof', name: 'Pallof press', focus: 'core', equip: ['bands', 'gym'], level: 1, reps: 10, perSide: true, cue: 'Resist rotation, press straight out.' },
  { id: 'copenhagen', name: 'Copenhagen plank (short lever)', focus: 'prevention', equip: ['none'], level: 2, hold: 20, perSide: true, cue: 'Top knee on a bench, lift hips — adductor strength.' },
  { id: 'sl-balance', name: 'Single-leg balance reach', focus: 'prevention', equip: ['none'], level: 1, reps: 8, perSide: true, cue: 'Reach forward, side and back while balancing.' },
  { id: 'tibialis', name: 'Tibialis raise', focus: 'prevention', equip: ['none'], level: 1, reps: 15, cue: 'Back against a wall, lift toes toward shins.' },
  { id: 'pogo', name: 'Pogo hops', focus: 'calf', equip: ['none'], level: 2, reps: 20, cue: 'Quick, stiff ankles, minimal ground contact.' },
];

const MOBILITY = [
  { id: 'catcow', name: 'Cat–cow', sec: 45, cue: 'Move slowly through the spine.' },
  { id: 'worldsgreatest', name: "World's greatest stretch", sec: 60, perSide: true, cue: 'Lunge, elbow to instep, rotate and reach up.' },
  { id: 'hipflexor', name: 'Half-kneeling hip-flexor stretch', sec: 45, perSide: true, cue: 'Tuck the pelvis, squeeze the back glute.' },
  { id: 'hamstring', name: 'Supine hamstring stretch', sec: 45, perSide: true, cue: 'Strap or towel around the foot, knee soft.' },
  { id: 'pigeon', name: 'Pigeon / figure-4 stretch', sec: 60, perSide: true, cue: 'Breathe into the hip, no forcing.' },
  { id: 'calfwall', name: 'Wall calf stretch', sec: 40, perSide: true, cue: 'Straight knee then bent knee.' },
  { id: 'thoracic', name: 'Open-book thoracic rotation', sec: 45, perSide: true, cue: 'Knees stacked, follow your hand with your eyes.' },
  { id: 'adductor', name: 'Adductor rock-back', sec: 45, perSide: true, cue: 'One leg out to the side, rock hips back.' },
  { id: 'ankle', name: 'Knee-to-wall ankle mobility', sec: 40, perSide: true, cue: 'Drive knee over toes, heel down.' },
  { id: 'legswing', name: 'Leg swings (front/back & side)', sec: 60, cue: 'Hold a wall, relaxed swings.' },
  { id: 'childpose', name: "Child's pose", sec: 60, cue: 'Long exhale, sink the hips back.' },
  { id: 'quad', name: 'Side-lying quad stretch', sec: 40, perSide: true, cue: 'Knees together, gentle hip push.' },
];

const FOCUS_ORDER = ['single-leg', 'glute', 'calf', 'core', 'lower', 'prevention', 'single-leg', 'core'];

function eligible(ex, equipment, level) {
  const eq = equipment && equipment.length ? equipment : ['none'];
  const ok = ex.equip.some((e) => e === 'none' || eq.includes(e));
  return ok && ex.level <= level;
}

/**
 * Build a strength session.
 * @param {object} o {equipment:[], experience:'beginner'|..., minutes, index, light}
 */
export function buildStrengthSession(o) {
  const level = ['beginner', 'returning'].includes(o.experience) ? 1 : 2;
  const minutes = o.minutes || 25;
  const nEx = minutes <= 15 ? 4 : minutes <= 25 ? 5 : minutes <= 35 ? 6 : 7;
  const sets = o.light ? 1 : minutes <= 15 ? 2 : level === 1 ? 2 : 3;
  const restSec = 45;
  const pool = EX.filter((e) => eligible(e, o.equipment, level));
  const chosen = [];
  const rot = o.index || 0;
  for (let i = 0; chosen.length < nEx && i < FOCUS_ORDER.length * 2; i++) {
    const focus = FOCUS_ORDER[i % FOCUS_ORDER.length];
    const opts = pool.filter((e) => e.focus === focus && !chosen.includes(e));
    if (!opts.length) continue;
    // prefer equipment-loaded versions, rotate deterministically
    opts.sort((a, b) => (b.equip.includes('none') ? 0 : 1) - (a.equip.includes('none') ? 0 : 1) || a.id.localeCompare(b.id));
    chosen.push(opts[(rot + i) % opts.length]);
  }
  const steps = [{ kind: 'warmup', label: 'Warm-up: easy movement', measure: 'time', value: 240, zone: null, cue: 'March in place, leg swings, bodyweight squats — get warm.' }];
  const exercises = [];
  chosen.forEach((ex, idx) => {
    const presc = ex.hold ? `${ex.hold}s hold${ex.perSide ? ' each side' : ''}` : `${ex.reps} reps${ex.perSide ? ' each side' : ''}`;
    exercises.push({ name: ex.name, sets, presc, cue: ex.cue, focus: ex.focus });
    for (let s = 1; s <= sets; s++) {
      steps.push({
        kind: 'exercise', label: `${ex.name}`, detail: `Set ${s}/${sets} · ${presc}`,
        measure: ex.hold ? 'time' : 'manual', value: ex.hold ? ex.hold * (ex.perSide ? 2 : 1) + (ex.perSide ? 5 : 0) : null,
        cue: ex.cue,
      });
      const last = idx === chosen.length - 1 && s === sets;
      if (!last) steps.push({ kind: 'rest', label: 'Rest', measure: 'time', value: restSec, cue: '' });
    }
  });
  const estSec = 240 + chosen.reduce((t, ex) => t + sets * ((ex.hold ? ex.hold * (ex.perSide ? 2 : 1) : (ex.reps * (ex.perSide ? 2 : 1)) * 3) + restSec), 0);
  return { steps, exercises, estSec };
}

export function buildMobilitySession(o = {}) {
  const minutes = o.minutes || 15;
  const rot = o.index || 0;
  const list = [];
  let t = 0;
  for (let i = 0; i < MOBILITY.length && t < minutes * 60; i++) {
    const m = MOBILITY[(rot * 3 + i) % MOBILITY.length];
    const dur = m.sec * (m.perSide ? 2 : 1);
    list.push(m);
    t += dur + 10;
  }
  const steps = [];
  const exercises = [];
  list.forEach((m) => {
    if (m.perSide) {
      steps.push({ kind: 'exercise', label: `${m.name} — left`, measure: 'time', value: m.sec, cue: m.cue });
      steps.push({ kind: 'exercise', label: `${m.name} — right`, measure: 'time', value: m.sec, cue: m.cue });
    } else steps.push({ kind: 'exercise', label: m.name, measure: 'time', value: m.sec, cue: m.cue });
    steps.push({ kind: 'rest', label: 'Transition', measure: 'time', value: 10, cue: '' });
    exercises.push({ name: m.name, presc: `${m.sec}s${m.perSide ? ' each side' : ''}`, cue: m.cue });
  });
  steps.pop();
  return { steps, exercises, estSec: steps.reduce((a, s) => a + (s.value || 0), 0) };
}

export const EQUIPMENT_OPTIONS = [
  { id: 'none', label: 'Bodyweight only' },
  { id: 'bands', label: 'Resistance bands' },
  { id: 'dumbbells', label: 'Dumbbells' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'gym', label: 'Full gym' },
];
