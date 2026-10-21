import test from 'node:test';
import assert from 'node:assert/strict';
import Plan from '../plan.js';

function makeState() {
  return {
    version: 1,
    settings: { startDate: '2026-10-19', gluteBridge: 'machine', bodyWeightKg: null },
    weeks: {}, sessions: [], active: null
  };
}

function addSession(st, date, dayKey, phase, exId, sets, opts = {}) {
  const info = Plan.weekForDate(st.settings.startDate, date);
  const ex = {
    exId, setup: opts.setup || '', pain: !!opts.pain,
    sets: sets.map(([kg, reps, rir, done]) => ({ kg, reps, rir, done: done !== false }))
  };
  st.sessions.push({
    id: `${date}-${dayKey}-${st.sessions.length}`,
    date, week: info.week || 0, dayKey, phase,
    startedAt: `${date}T10:0${st.sessions.length}:00`, finishedAt: `${date}T11:00:00`,
    exercises: [ex]
  });
}

const MAX3 = [[40, 12, 2], [40, 12, 2], [40, 12, 2]];

test('周次：起始日、+7 天、跨月、跨年、预览与复盘', () => {
  assert.equal(Plan.weekForDate('2026-10-19', '2026-10-19').week, 1);
  assert.equal(Plan.weekForDate('2026-10-19', '2026-10-26').week, 2);
  assert.equal(Plan.weekForDate('2026-10-19', '2026-11-02').week, 3);
  assert.equal(Plan.weekForDate('2026-12-28', '2027-01-04').week, 2);
  const pre = Plan.weekForDate('2026-10-19', '2026-10-18');
  assert.equal(pre.kind, 'preview');
  assert.equal(pre.daysUntil, 1);
  assert.equal(Plan.weekForDate('2026-10-19', '2026-11-30').kind, 'review');
  assert.equal(Plan.weekForDate('2026-10-19', '2026-11-29').kind, 'active');
  assert.equal(Plan.weekForDate('2026-10-19', '2026-11-29').week, 6);
});

test('组数：适应 2、完整按训练日、减量向上取整', () => {
  assert.equal(Plan.setsFor('pulldown', 'adapt'), 2);
  assert.equal(Plan.setsFor('pulldown', 'adapt'), 2);
  assert.equal(Plan.setsFor('pulldown', 'full', Plan.fullSetsFor('mon', 'pulldown')), 3);
  assert.equal(Plan.setsFor('pulldown', 'deload', Plan.fullSetsFor('mon', 'pulldown')), 2);
  assert.equal(Plan.setsFor('row', 'deload', Plan.fullSetsFor('mon', 'row')), 1);
  assert.equal(Plan.setsFor('legPress', 'full', Plan.fullSetsFor('fri', 'legPress')), 2);
  assert.equal(Plan.setsFor('legPress', 'deload', Plan.fullSetsFor('fri', 'legPress')), 1);
});

test('周总量：完整 51、适应 46、分类不混算', () => {
  const t = Plan.weekTotals({ gluteBridge: 'machine' });
  assert.equal(t.full, 51);
  assert.equal(t.adapt, 46);
  assert.deepEqual([t.mon, t.tue, t.thu, t.fri], [14, 11, 14, 12]);
  const c = Plan.categoryTotals({ gluteBridge: 'machine' });
  assert.equal(c['背'], 12);
  assert.equal(c['侧平举'], 8);
  assert.equal(c['腿举'], 5);
  assert.equal(c['腿弯举'], 4);
  assert.equal(c['胸'], 4);
  assert.equal(c['核心'], 2);
});

test('双进阶：同重量连续两次全部达标 → increase；一次 → keep', () => {
  const st = makeState();
  addSession(st, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  addSession(st, '2026-10-26', 'mon', 'full', 'pulldown', MAX3);
  const r = Plan.analyzeProgression(st, 'mon', 'pulldown', 'full');
  assert.equal(r.status, 'increase');
  assert.equal(r.streak, 2);
  assert.match(r.suggestion, /最小一档/);

  const one = makeState();
  addSession(one, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  assert.equal(Plan.analyzeProgression(one, 'mon', 'pulldown', 'full').status, 'keep');
});

test('重量变化：同一次内任意一组不同 → 不达标；跨次换重 → 从新重量重新计', () => {
  const mixed = makeState();
  addSession(mixed, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  addSession(mixed, '2026-10-26', 'mon', 'full', 'pulldown', [[40, 12, 2], [42.5, 12, 2], [40, 12, 2]]);
  const a = Plan.analyzeProgression(mixed, 'mon', 'pulldown', 'full');
  assert.equal(a.streak, 0);
  assert.equal(a.status, 'keep');

  const changed = makeState();
  addSession(changed, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  addSession(changed, '2026-10-26', 'mon', 'full', 'pulldown', [[42.5, 12, 2], [42.5, 12, 2], [42.5, 12, 2]]);
  assert.equal(Plan.analyzeProgression(changed, 'mon', 'pulldown', 'full').streak, 1);
});

test('任一组低于次数上限 → 不算达标', () => {
  const st = makeState();
  addSession(st, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  addSession(st, '2026-10-26', 'mon', 'full', 'pulldown', [[40, 12, 2], [40, 10, 2], [40, 12, 2]]);
  const r = Plan.analyzeProgression(st, 'mon', 'pulldown', 'full');
  assert.equal(r.streak, 0);
  assert.equal(r.status, 'keep');
});

test('加重后低于次数下限 → return，并给出上一重量', () => {
  const st = makeState();
  addSession(st, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  addSession(st, '2026-10-26', 'mon', 'full', 'pulldown', [[45, 6, 1], [45, 6, 1], [45, 6, 1]]);
  const r = Plan.analyzeProgression(st, 'mon', 'pulldown', 'full');
  assert.equal(r.status, 'return');
  assert.match(r.suggestion, /40 kg/);
});

test('pain=true → pain，本周不再给加重建议', () => {
  const st = makeState();
  addSession(st, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  addSession(st, '2026-10-26', 'mon', 'full', 'pulldown', MAX3, { pain: true });
  const r = Plan.analyzeProgression(st, 'mon', 'pulldown', 'full');
  assert.equal(r.status, 'pain');
  assert.doesNotMatch(r.suggestion, /最小一档/);

  const weekPain = makeState();
  addSession(weekPain, '2026-10-26', 'mon', 'full', 'pulldown', MAX3, { pain: true });
  addSession(weekPain, '2026-10-27', 'mon', 'full', 'pulldown', MAX3);
  assert.equal(Plan.analyzeProgression(weekPain, 'mon', 'pulldown', 'full').status, 'pain');
});

test('setup 改变 → 重新积累', () => {
  const st = makeState();
  addSession(st, '2026-10-19', 'mon', 'full', 'pulldown', MAX3, { setup: '座椅3档 / 宽握' });
  addSession(st, '2026-10-26', 'mon', 'full', 'pulldown', MAX3, { setup: '座椅5档 / 窄握' });
  const r = Plan.analyzeProgression(st, 'mon', 'pulldown', 'full');
  assert.equal(r.streak, 1);
  assert.equal(r.status, 'keep');
});

test('适应期 2 组与完整期 3 组不混算', () => {
  const st = makeState();
  addSession(st, '2026-10-19', 'mon', 'adapt', 'pulldown', [[40, 12, 3], [40, 12, 3]]);
  addSession(st, '2026-10-26', 'mon', 'adapt', 'pulldown', [[40, 12, 3], [40, 12, 3]]);
  assert.equal(Plan.analyzeProgression(st, 'mon', 'pulldown', 'adapt').status, 'increase');
  const full = Plan.analyzeProgression(st, 'mon', 'pulldown', 'full');
  assert.equal(full.streak, 0);
  assert.equal(full.status, 'keep');
});

test('自重动作 → bodyweight；自重臀桥连续两次 ≥20 → load-optional', () => {
  const st = makeState();
  addSession(st, '2026-10-23', 'fri', 'adapt', 'crunch', [[0, 12, 3], [0, 12, 3]]);
  addSession(st, '2026-10-30', 'fri', 'adapt', 'crunch', [[0, 12, 3], [0, 12, 3]]);
  assert.equal(Plan.analyzeProgression(st, 'fri', 'crunch', 'adapt').status, 'bodyweight');

  const g = makeState();
  addSession(g, '2026-10-23', 'fri', 'adapt', 'gluteBodyweight', [[0, 20, 2], [0, 20, 2]]);
  addSession(g, '2026-10-30', 'fri', 'adapt', 'gluteBodyweight', [[0, 20, 2], [0, 20, 2]]);
  const r = Plan.analyzeProgression(g, 'fri', 'gluteBodyweight', 'adapt');
  assert.equal(r.status, 'load-optional');
  assert.equal(r.streak, 2);
});

test('缺组 / 未勾选完成 → 不算达标，也不写 0', () => {
  const st = makeState();
  addSession(st, '2026-10-19', 'mon', 'full', 'pulldown', MAX3);
  addSession(st, '2026-10-26', 'mon', 'full', 'pulldown', [[40, 12, 2], [40, 12, 2], [40, 12, 2, false]]);
  const entries = Plan.exerciseEntries(st, 'mon', 'pulldown');
  assert.equal(entries[0].summary.completed, 2);
  assert.equal(entries[0].summary.planned, 3);
  assert.equal(Plan.analyzeProgression(st, 'mon', 'pulldown', 'full').streak, 0);
});

test('周阶段：未确认保持适应；确认后可完整或减量', () => {
  const st = makeState();
  assert.equal(Plan.getWeekPhase(st, 3), 'adapt');
  st.weeks['3'] = { status: 'full', confirmedAt: 'x', stable: true, noPain: true, recovered: true };
  assert.equal(Plan.getWeekPhase(st, 3), 'full');
  st.weeks['4'] = { status: 'deload', confirmedAt: 'x', stable: true, noPain: true, recovered: true };
  assert.equal(Plan.getWeekPhase(st, 4), 'deload');
});
