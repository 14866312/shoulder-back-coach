(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Plan = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var APP_ID = 'shoulder-back-coach';
  var VERSION = 1;
  var STORAGE_KEY = 'shoulderBackCoach.v1';
  var DAY_KEYS = ['mon', 'tue', 'thu', 'fri'];

  var EXERCISES = {
    pulldown: { id: 'pulldown', name: '高位下拉', sets: 3, repsMin: 8, repsMax: 12, restSec: 150, bodyweight: false, perSide: false, muscle: '背' },
    row: { id: 'row', name: '胸支撑器械划船', sets: 2, repsMin: 10, repsMax: 12, restSec: 150, bodyweight: false, perSide: false, muscle: '背' },
    straightArm: { id: 'straightArm', name: '直臂下压', sets: 2, repsMin: 12, repsMax: 15, restSec: 90, bodyweight: false, perSide: false, muscle: '背' },
    dbBench: { id: 'dbBench', name: '哑铃平板卧推', sets: 3, repsMin: 8, repsMax: 12, restSec: 150, bodyweight: false, perSide: false, muscle: '胸' },
    lateral: { id: 'lateral', name: '哑铃侧平举', sets: 3, repsMin: 12, repsMax: 20, restSec: 90, bodyweight: false, perSide: false, muscle: '侧平举' },
    cableLateral: { id: 'cableLateral', name: '绳索侧平举', sets: 2, repsMin: 12, repsMax: 15, restSec: 90, bodyweight: false, perSide: false, muscle: '侧平举' },
    reverseFly: { id: 'reverseFly', name: '反向蝴蝶机', sets: 2, repsMin: 12, repsMax: 20, restSec: 90, bodyweight: false, perSide: false, muscle: '后束' },
    shoulderPress: { id: 'shoulderPress', name: '坐姿器械肩推', sets: 2, repsMin: 8, repsMax: 12, restSec: 150, bodyweight: false, perSide: false, muscle: '肩推' },
    legPress: { id: 'legPress', name: '腿举', sets: 3, repsMin: 10, repsMax: 15, restSec: 150, bodyweight: false, perSide: false, muscle: '腿举' },
    legCurl: { id: 'legCurl', name: '坐姿腿弯举', sets: 3, repsMin: 10, repsMax: 15, restSec: 90, bodyweight: false, perSide: false, muscle: '腿弯举' },
    dbCalf: { id: 'dbCalf', name: '哑铃站姿提踵', sets: 2, repsMin: 12, repsMax: 20, restSec: 90, bodyweight: false, perSide: false, muscle: '提踵' },
    pushdown: { id: 'pushdown', name: '绳索下压', sets: 2, repsMin: 10, repsMax: 15, restSec: 90, bodyweight: false, perSide: false, muscle: '三头' },
    biceps: { id: 'biceps', name: '哑铃弯举', sets: 2, repsMin: 10, repsMax: 15, restSec: 90, bodyweight: false, perSide: true, muscle: '二头' },
    gluteMachine: { id: 'gluteMachine', name: '臀桥机', sets: 2, repsMin: 10, repsMax: 15, restSec: 150, bodyweight: false, perSide: false, muscle: '臀桥' },
    gluteBodyweight: { id: 'gluteBodyweight', name: '自重臀桥', sets: 2, repsMin: 12, repsMax: 20, restSec: 150, bodyweight: true, perSide: false, muscle: '臀桥' },
    crunch: { id: 'crunch', name: '卷腹', sets: 2, repsMin: 10, repsMax: 15, restSec: 60, bodyweight: true, perSide: false, muscle: '核心' }
  };

  var DAYS = {
    mon: { key: 'mon', label: '周一', title: '上肢A', focus: '背宽优先', theme: '上肢A · 背宽优先', exercises: ['pulldown', 'row', 'straightArm', 'lateral', 'reverseFly', 'dbBench'] },
    tue: { key: 'tue', label: '周二', title: '下肢A＋手臂', focus: '下肢为主', theme: '下肢A · 手臂', exercises: ['legPress', 'legCurl', 'dbCalf', 'pushdown', 'biceps'] },
    thu: { key: 'thu', label: '周四', title: '上肢B', focus: '肩宽优先', theme: '上肢B · 肩宽优先', exercises: ['row', 'pulldown', 'lateral', 'cableLateral', 'reverseFly', 'dbBench'] },
    fri: { key: 'fri', label: '周五', title: '下肢B＋手臂＋核心', focus: '下肢与核心', theme: '下肢B · 手臂＋核心', exercises: ['legPress', 'legCurl', 'gluteMachine', 'pushdown', 'biceps', 'crunch'] }
  };

  var DAY_SETS = {
    mon: { pulldown: 3, row: 2, straightArm: 2, lateral: 3, reverseFly: 2, dbBench: 2 },
    tue: { legPress: 3, legCurl: 2, dbCalf: 2, pushdown: 2, biceps: 2 },
    thu: { row: 3, pulldown: 2, lateral: 3, cableLateral: 2, reverseFly: 2, dbBench: 2 },
    fri: { legPress: 2, legCurl: 2, gluteMachine: 2, gluteBodyweight: 2, pushdown: 2, biceps: 2, crunch: 2 }
  };

  // 旧版本记录里可能出现已经被替换/删除的动作 id，保留名称以便历史记录仍能读懂。
  var LEGACY_EXERCISES = {
    incline: { id: 'incline', name: '上斜器械推胸', bodyweight: false, perSide: false, muscle: '胸' },
    calf: { id: 'calf', name: '器械提踵', bodyweight: false, perSide: false, muscle: '提踵' },
    deadbug: { id: 'deadbug', name: '死虫式', bodyweight: true, perSide: true, muscle: '核心' }
  };
  // 旧版本里被替换掉的器械动作 → 现在的平替；进行中的训练按这个迁移，
  // 历史记录则原样保留（用 LEGACY_EXERCISES 的名字显示）。
  var LEGACY_REPLACEMENT = { incline: 'dbBench', calf: 'dbCalf', deadbug: null };

  function fullSetsFor(dayKey, exId) {
    var map = DAY_SETS[dayKey];
    return map && map[exId] ? map[exId] : (EXERCISES[exId] ? EXERCISES[exId].sets : 0);
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function resolveExercise(id) { return EXERCISES[id] || LEGACY_EXERCISES[id] || null; }

  function setsFor(exOrId, phase, fullSets) {
    var ex = typeof exOrId === 'string' ? EXERCISES[exOrId] : exOrId;
    if (!ex) return 0;
    var full = fullSets || ex.sets;
    if (phase === 'full') return full;
    if (phase === 'deload') return Math.ceil(full / 2);
    return 2;
  }

  function repsLabel(ex) {
    var base = ex.repsMin + '–' + ex.repsMax;
    return ex.perSide ? '每侧 ' + base : base;
  }

  function getDayPlan(dayKey, phase, settings) {
    var day = DAYS[dayKey];
    if (!day) return null;
    var p = phase === 'full' || phase === 'deload' ? phase : 'adapt';
    var useBodyweightGlute = settings && settings.gluteBridge === 'bodyweight';
    var plan = day.exercises.map(function (id) {
      var useId = id === 'gluteMachine' && useBodyweightGlute ? 'gluteBodyweight' : id;
      var ex = EXERCISES[useId];
      return {
        id: ex.id, name: ex.name, plannedSets: setsFor(ex, p, fullSetsFor(dayKey, useId)), repsMin: ex.repsMin,
        repsMax: ex.repsMax, repsLabel: repsLabel(ex), restSec: ex.restSec,
        bodyweight: ex.bodyweight, perSide: ex.perSide, muscle: ex.muscle,
        phase: p
      };
    });
    return { key: day.key, label: day.label, title: day.title, focus: day.focus, theme: day.theme, phase: p, exercises: plan };
  }

  function dayTotal(dayKey, phase, settings) {
    var p = getDayPlan(dayKey, phase, settings);
    return p ? p.exercises.reduce(function (n, ex) { return n + ex.plannedSets; }, 0) : 0;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function parseDate(str) {
    if (typeof str !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function formatDate(dt) {
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  function todayISO(now) { return formatDate(now || new Date()); }

  function dayNumber(dt) {
    return Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000;
  }

  function diffDays(a, b) { return Math.round(dayNumber(b) - dayNumber(a)); }

  function addDays(dt, n) {
    var d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  function dayKeyForDate(dt) {
    var w = dt.getDay();
    if (w === 1) return 'mon';
    if (w === 2) return 'tue';
    if (w === 4) return 'thu';
    if (w === 5) return 'fri';
    return null;
  }

  function isMonday(str) {
    var d = parseDate(str);
    return !!d && d.getDay() === 1;
  }

  function weekForDate(startDateStr, dateStr) {
    var start = parseDate(startDateStr);
    var date = parseDate(dateStr);
    if (!start || !date) return { kind: 'invalid', week: 0, dayKey: null };
    var diff = diffDays(start, date);
    var dayKey = dayKeyForDate(date);
    if (diff < 0) {
      return { kind: 'preview', week: 0, daysUntil: -diff, date: dateStr, dayKey: dayKey, startDate: startDateStr };
    }
    var week = Math.floor(diff / 7) + 1;
    if (week > 6) {
      return { kind: 'review', week: 6, elapsedWeeks: 6, date: dateStr, dayKey: dayKey, startDate: startDateStr };
    }
    return { kind: 'active', week: week, weekDay: diff % 7, date: dateStr, dayKey: dayKey, startDate: startDateStr };
  }

  function nextTraining(startDateStr, fromDateStr) {
    var start = parseDate(startDateStr);
    var from = parseDate(fromDateStr);
    if (!start || !from) return null;
    for (var i = 0; i <= 7; i++) {
      var d = addDays(from, i);
      var info = weekForDate(startDateStr, formatDate(d));
      if (info.kind !== 'active') continue;
      if (info.dayKey) return { date: formatDate(d), dayKey: info.dayKey, week: info.week, daysAhead: i };
    }
    return null;
  }

  function weekRange(startDateStr, week) {
    var start = parseDate(startDateStr);
    if (!start || week < 1 || week > 6) return null;
    var first = addDays(start, (week - 1) * 7);
    return { start: formatDate(first), end: formatDate(addDays(first, 6)) };
  }

  var PHASES = ['adapt', 'full', 'deload'];

  function getWeekPhase(state, week) {
    var rec = state && state.weeks ? state.weeks[String(week)] : null;
    if (rec && (rec.status === 'full' || rec.status === 'deload')) return rec.status;
    return 'adapt';
  }

  function phaseLabel(phase) {
    if (phase === 'full') return '完整';
    if (phase === 'deload') return '减量';
    return '适应';
  }

  function weekTotals(settings) {
    var result = { mon: 0, tue: 0, thu: 0, fri: 0, full: 0, adapt: 0, deload: 0 };
    DAY_KEYS.forEach(function (k) {
      result[k] = dayTotal(k, 'full', settings);
      result.full += result[k];
      result.adapt += dayTotal(k, 'adapt', settings);
      result.deload += dayTotal(k, 'deload', settings);
    });
    return result;
  }

  function categoryTotals(settings) {
    var out = {};
    DAY_KEYS.forEach(function (k) {
      getDayPlan(k, 'full', settings).exercises.forEach(function (ex) {
        var key = ex.muscle;
        out[key] = (out[key] || 0) + ex.plannedSets;
      });
    });
    return out;
  }

  var SUGGESTIONS = {
    new: '第一次做，从轻重量试起，保留 2–3 次余力',
    increase: '下次加最小一档（器械一格或最小配重片），仍从下限次数开始',
    return: '下次退回上一次重量',
    pain: '停止诱发疼痛的动作；反复或持续不适应评估',
    bodyweight: '保持自重，先做到每组上限并控制节奏',
    loadOptional: '可加少量负重，先复核动作控制'
  };

  function roundKg(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  function formatKg(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (Math.round(Number(n) * 10) / 10).toString() + ' kg';
  }

  function doneSets(ex) {
    return (ex && ex.sets ? ex.sets : []).filter(function (s) {
      return s && s.done === true && Number.isFinite(Number(s.reps)) && Number(s.reps) >= 1;
    });
  }

  function summarizeEntry(session, ex, dayKey) {
    var sets = doneSets(ex);
    var weights = sets.map(function (s) { return roundKg(s.kg || 0); });
    var reps = sets.map(function (s) { return Number(s.reps); });
    var rirs = sets.map(function (s) { return s.rir === '' || s.rir === null || s.rir === undefined ? null : Number(s.rir); });
    var validRirs = rirs.filter(function (r) { return r !== null && Number.isFinite(r); });
    var minKg = weights.length ? Math.min.apply(null, weights) : null;
    var maxKg = weights.length ? Math.max.apply(null, weights) : null;
    return {
      date: session.date, week: session.week, phase: session.phase,
      setup: (ex.setup || '').trim(), pain: ex.pain === true,
      sets: sets.slice(), completed: sets.length, planned: setsFor(ex.exId, session.phase, fullSetsFor(dayKey || session.dayKey, ex.exId)),
      weights: weights, reps: reps, rirs: rirs,
      kg: minKg !== null && Math.abs(maxKg - minKg) < 0.01 ? minKg : null,
      minKg: minKg, maxKg: maxKg,
      minRir: validRirs.length === sets.length && sets.length ? Math.min.apply(null, validRirs) : null,
      minReps: reps.length ? Math.min.apply(null, reps) : null,
      maxReps: reps.length ? Math.max.apply(null, reps) : null,
      sameWeight: minKg !== null && Math.abs(maxKg - minKg) < 0.01
    };
  }

  function exerciseEntries(state, dayKey, exId) {
    var out = [];
    ((state && state.sessions) || []).forEach(function (session) {
      if (session.dayKey !== dayKey) return;
      (session.exercises || []).forEach(function (ex) {
        if (ex.exId !== exId) return;
        if (doneSets(ex).length < 1) return;
        out.push({ session: session, ex: ex, summary: summarizeEntry(session, ex, session.dayKey) });
      });
    });
    out.sort(function (a, b) {
      if (a.session.date !== b.session.date) return a.session.date < b.session.date ? 1 : -1;
      return String(b.session.startedAt || '').localeCompare(String(a.session.startedAt || ''));
    });
    return out;
  }

  function qualified(entry, meta) {
    var s = entry.summary;
    if (s.completed !== s.planned) return false;
    if (s.pain) return false;
    if (!s.sameWeight) return false;
    if (s.reps.length !== s.planned) return false;
    if (s.reps.some(function (r) { return r < meta.repsMax; })) return false;
    if (s.minRir === null || s.minRir < 2) return false;
    return true;
  }

  function bodyweightLoadStreak(entries, meta, phase) {
    var refSetup = entries[0].summary.setup;
    var n = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], s = e.summary;
      if (e.session.phase !== phase) break;
      if (s.setup !== refSetup) break;
      if (s.pain || s.completed !== s.planned) break;
      if (s.reps.length !== s.planned || s.reps.some(function (r) { return r < 20; })) break;
      n++;
    }
    return n;
  }

  function baseResult(status, suggestion, last, streak, extra) {
    var r = { status: status, suggestion: suggestion, last: last || null, streak: streak || 0 };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  function analyzeProgression(state, dayKey, exId, todayPhase) {
    var meta = EXERCISES[exId];
    if (!meta) return baseResult('new', SUGGESTIONS.new, null, 0);
    var entries = exerciseEntries(state, dayKey, exId);
    if (!entries.length) return baseResult('new', SUGGESTIONS.new, null, 0);

    var mostRecent = entries[0];
    var last = mostRecent.summary;
    var phase = todayPhase || mostRecent.session.phase;
    if (phase !== 'full' && phase !== 'deload') phase = 'adapt';

    var painThisWeek = entries.some(function (e) {
      return e.session.week === mostRecent.session.week && e.summary.pain;
    });
    if (last.pain || painThisWeek) {
      return baseResult('pain', SUGGESTIONS.pain, last, 0, { referenceWeight: null });
    }

    if (meta.bodyweight) {
      if (exId === 'gluteBodyweight') {
        var loadStreak = bodyweightLoadStreak(entries, meta, phase);
        if (loadStreak >= 2) {
          return baseResult('load-optional', SUGGESTIONS.loadOptional, last, loadStreak, { referenceWeight: 0 });
        }
      }
      return baseResult('bodyweight', SUGGESTIONS.bodyweight, last, 0, { referenceWeight: 0 });
    }

    var refWeight = last.kg !== null ? last.kg : last.maxKg;
    var previous = null;
    for (var i = 1; i < entries.length; i++) {
      if (entries[i].summary.setup === last.setup) { previous = entries[i]; break; }
    }
    if (previous && last.maxKg !== null && previous.summary.maxKg !== null &&
        last.maxKg > previous.summary.maxKg + 0.001 &&
        last.reps.some(function (r) { return r < meta.repsMin; })) {
      var back = previous.summary.kg !== null ? previous.summary.kg : previous.summary.maxKg;
      return baseResult('return', '下次退回 ' + formatKg(back), last, 0, { referenceWeight: back });
    }

    var streak = 0;
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j], s = e.summary;
      if (e.session.phase !== phase) break;
      if (s.setup !== last.setup) break;
      if (!qualified(e, meta)) break;
      if (s.kg === null || refWeight === null || Math.abs(s.kg - refWeight) > 0.01) break;
      streak++;
    }

    if (streak >= 2) {
      return baseResult('increase', SUGGESTIONS.increase, last, streak, { referenceWeight: refWeight });
    }
    return baseResult('keep', '保持 ' + formatKg(refWeight) + '，先把每组做到上限次数', last, streak, { referenceWeight: refWeight });
  }

  function getLastSetup(state, dayKey, exId) {
    var entries = exerciseEntries(state, dayKey, exId);
    return entries.length ? entries[0].summary.setup : '';
  }

  function getLastSummary(state, dayKey, exId) {
    var entries = exerciseEntries(state, dayKey, exId);
    return entries.length ? entries[0].summary : null;
  }

  return {
    APP_ID: APP_ID, VERSION: VERSION, STORAGE_KEY: STORAGE_KEY,
    DAY_KEYS: DAY_KEYS, DAYS: DAYS, EXERCISES: EXERCISES, LEGACY_EXERCISES: LEGACY_EXERCISES,
    LEGACY_REPLACEMENT: LEGACY_REPLACEMENT, SUGGESTIONS: SUGGESTIONS,
    clone: clone, parseDate: parseDate, formatDate: formatDate, todayISO: todayISO,
    addDays: addDays, diffDays: diffDays, dayKeyForDate: dayKeyForDate, isMonday: isMonday,
    weekForDate: weekForDate, nextTraining: nextTraining, weekRange: weekRange,
    resolveExercise: resolveExercise, setsFor: setsFor, fullSetsFor: fullSetsFor, repsLabel: repsLabel,
    getDayPlan: getDayPlan, dayTotal: dayTotal, weekTotals: weekTotals,
    categoryTotals: categoryTotals, getWeekPhase: getWeekPhase, phaseLabel: phaseLabel,
    analyzeProgression: analyzeProgression, getLastSetup: getLastSetup,
    getLastSummary: getLastSummary, formatKg: formatKg, roundKg: roundKg,
    summarizeEntry: summarizeEntry, exerciseEntries: exerciseEntries, qualified: qualified
  };
});
