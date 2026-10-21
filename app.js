(function () {
  'use strict';

  var P = window.Plan;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var state = null;
  var route = 'today';
  var logFilter = '';
  var toastTimer = null;
  var confirmCallback = null;
  var modalCleanup = null;
  var trainPlayer = null;
  var detailPlayer = null;
  var trainFigureId = null;
  var figureMode = 'correct';
  var figureFault = 1;
  var clockTimer = null;
  var restTimer = null;
  var restBeeped = false;
  var wakeLock = null;
  var summaryData = null;

  var DEFAULT_START = '2026-10-19';
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function today() { return P.todayISO(new Date()); }

  function defaultState() {
    return {
      version: 1,
      settings: { startDate: DEFAULT_START, gluteBridge: 'machine', bodyWeightKg: null },
      weeks: {}, sessions: [], active: null
    };
  }

  function normalizeState(obj) {
    var s = obj && typeof obj === 'object' ? obj : {};
    var settings = s.settings && typeof s.settings === 'object' ? s.settings : {};
    var start = P.isMonday(settings.startDate) ? settings.startDate : DEFAULT_START;
    var bw = Number(settings.bodyWeightKg);
    var active = s.active && typeof s.active === 'object' ? s.active : null;
    // 计划换了动作后，进行中的训练按平替迁移；已经保存的历史记录不动。
    if (active && Array.isArray(active.exercises) && P.LEGACY_REPLACEMENT) {
      var mapped = [];
      active.exercises.forEach(function (ex) {
        if (!ex || !ex.exId) return;
        if (Object.prototype.hasOwnProperty.call(P.LEGACY_REPLACEMENT, ex.exId)) {
          var to = P.LEGACY_REPLACEMENT[ex.exId];
          if (!to) return;
          ex.exId = to;
        }
        mapped.push(ex);
      });
      active.exercises = mapped;
      var cur = active.cursor && typeof active.cursor === 'object' ? active.cursor : { exIndex: 0, setIndex: 0 };
      cur.exIndex = Math.max(0, Math.min(Number(cur.exIndex) || 0, Math.max(0, mapped.length - 1)));
      cur.setIndex = Math.max(0, Number(cur.setIndex) || 0);
      active.cursor = cur;
      if (!mapped.length) active = null;
    }
    return {
      version: 1,
      settings: {
        startDate: start,
        gluteBridge: settings.gluteBridge === 'bodyweight' ? 'bodyweight' : 'machine',
        bodyWeightKg: Number.isFinite(bw) && bw > 0 && bw < 400 ? Math.round(bw * 10) / 10 : null
      },
      weeks: s.weeks && typeof s.weeks === 'object' && !Array.isArray(s.weeks) ? s.weeks : {},
      sessions: Array.isArray(s.sessions) ? s.sessions.filter(function (x) { return x && x.date && x.dayKey; }) : [],
      active: active
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(P.STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      setTimeout(function () { toast('本机记录读取失败，已从空数据开始'); }, 300);
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(P.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      toast('保存失败：手机存储空间可能已满');
      return false;
    }
  }

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('is-hidden'); }, 2600);
  }

  function openModal(html, onMount) {
    var layer = $('modalLayer');
    $('modalContent').innerHTML = html;
    layer.classList.remove('is-hidden');
    layer.setAttribute('aria-hidden', 'false');
    confirmCallback = null;
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    if (onMount) modalCleanup = onMount() || null;
  }

  function closeModal() {
    $('modalLayer').classList.add('is-hidden');
    $('modalLayer').setAttribute('aria-hidden', 'true');
    $('modalContent').innerHTML = '';
    confirmCallback = null;
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
  }

  function showAlert(title, body, button) {
    openModal('<h2>' + esc(title) + '</h2><p>' + body + '</p><div class="modal-actions"><button class="btn primary wide" data-action="close-modal">' + esc(button || '知道了') + '</button></div>');
  }

  function showConfirm(title, body, confirmText, onConfirm, danger) {
    openModal(
      '<h2>' + esc(title) + '</h2><p>' + body + '</p>' +
      '<div class="modal-actions"><button class="btn ghost" data-action="close-modal">取消</button>' +
      '<button class="btn ' + (danger ? 'danger-ghost' : 'primary') + '" data-action="modal-confirm">' + esc(confirmText || '确认') + '</button></div>'
    );
    confirmCallback = onConfirm;
  }

  function cnDate(dateStr) {
    var d = P.parseDate(dateStr);
    if (!d) return dateStr || '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
  }

  function weekInfo() {
    return P.weekForDate(state.settings.startDate, today());
  }

  function displayPhase(info) {
    if (info.kind === 'review') return 'full';
    if (info.kind === 'preview') return 'adapt';
    return P.getWeekPhase(state, info.week);
  }

  function phaseWord(phase) { return P.phaseLabel(phase); }

  function phaseBadge(info) {
    if (info.kind === 'preview') return '<span class="badge">未开始</span>';
    if (info.kind === 'review') return '<span class="badge accent">复盘</span>';
    var phase = displayPhase(info);
    return '<span class="phase-pill">' + phaseWord(phase) + '</span>';
  }

  function setTab() {
    $$('#tabbar .tab').forEach(function (btn) {
      var on = btn.getAttribute('data-route') === route;
      btn.classList.toggle('is-active', on);
      if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
  }

  function navigate(next, opts) {
    route = ['today', 'plan', 'log', 'settings'].indexOf(next) >= 0 ? next : 'today';
    if (location.hash !== '#' + route) history.replaceState(null, '', '#' + route);
    setTab();
    render();
    if (!opts || opts.scroll !== false) window.scrollTo(0, 0);
  }

  function render() {
    setTab();
    if (route === 'plan') renderPlan();
    else if (route === 'log') renderLog();
    else if (route === 'settings') renderSettings();
    else renderToday();
  }

  function exerciseMeta(exId) { return P.EXERCISES[exId] || (P.LEGACY_EXERCISES && P.LEGACY_EXERCISES[exId]) || null; }

  function allExerciseIds() {
    var seen = {}, out = [];
    P.DAY_KEYS.forEach(function (dayKey) {
      P.DAYS[dayKey].exercises.forEach(function (id) {
        if (!seen[id]) { seen[id] = true; out.push(id); }
      });
    });
    if (!seen.gluteBodyweight) out.push('gluteBodyweight');
    return out;
  }

  function findSession(dateStr, dayKey) {
    return state.sessions.find(function (s) { return s.date === dateStr && s.dayKey === dayKey; });
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return pad2(m) + ':' + pad2(s);
  }

  function durationText(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m === 0) return s + ' 秒';
    return m + ' 分' + (s ? ' ' + s + ' 秒' : '');
  }

  function proteinText(kg) {
    if (!kg) return '填写体重后自动计算';
    return Math.round(kg * 1.6) + '–' + Math.round(kg * 2.0) + ' g / 天（1.6–2.0 g/kg）';
  }

  function summaryKg(sets) {
    var weights = sets.map(function (s) { return Number(s.kg) || 0; });
    if (!weights.length) return null;
    var min = Math.min.apply(null, weights), max = Math.max.apply(null, weights);
    return Math.abs(max - min) < 0.01 ? min : weights;
  }

  function lastLine(dayKey, exId) {
    var last = P.getLastSummary(state, dayKey, exId);
    if (!last) return '上次：暂无记录';
    var meta = exerciseMeta(exId);
    var weight = meta && meta.bodyweight ? '自重' : (last.kg !== null ? P.formatKg(last.kg) : last.weights.join(' / ') + ' kg');
    return '上次：' + weight + ' × ' + last.reps.join(' / ') + '<span class="muted"> · ' + cnDate(last.date) + '</span>';
  }

  function weekConfirmCard(info) {
    if (info.week < 3) return '';
    var rec = state.weeks[String(info.week)];
    if (rec && (rec.status === 'full' || rec.status === 'deload') && rec.confirmedAt) {
      return '<section class="card week-card"><p class="eyebrow">本周恢复确认</p>' +
        '<h2 style="margin-top:5px">本周已确认 · ' + phaseWord(rec.status) + '组数</h2>' +
        '<p class="small muted" style="margin-top:6px">动作稳定：' + (rec.stable ? '是' : '否') + ' · 无关节不适：' + (rec.noPain ? '是' : '否') + ' · 恢复充分：' + (rec.recovered ? '是' : '否') + '</p>' +
        '<div class="btn-row" style="margin-top:14px"><button class="btn ghost wide" data-action="reset-week">修改本周安排</button></div></section>';
    }
    return '<section class="card week-card"><p class="eyebrow">本周恢复确认</p>' +
      '<h2 style="margin-top:5px">进入完整组数前先确认</h2>' +
      '<p class="small muted" style="margin-top:5px">三项都勾选后，本周才切换到完整组数；任一未确认则保持每动作 2 组。</p>' +
      '<label class="switch-row"><input type="checkbox" id="weekStable"><span class="box"></span><span>动作稳定</span></label>' +
      '<label class="switch-row"><input type="checkbox" id="weekNoPain"><span class="box"></span><span>无关节不适</span></label>' +
      '<label class="switch-row"><input type="checkbox" id="weekRecovered"><span class="box"></span><span>恢复充分</span></label>' +
      '<div class="btn-row" style="margin-top:10px"><button class="btn primary" data-action="confirm-week-full">确认完整组数</button>' +
      '<button class="btn ghost" data-action="confirm-week-deload">本周减量</button></div></section>';
  }

  function activeCard() {
    if (!state.active) return '';
    var a = state.active;
    var day = P.DAYS[a.dayKey];
    return '<section class="card"><p class="eyebrow">未完成训练</p>' +
      '<h2 style="margin-top:5px;font-size:20px">' + esc(day ? day.theme : '训练') + '</h2>' +
      '<p class="small muted" style="margin-top:5px">' + esc(cnDate(a.date)) + ' · 第 ' + a.week + ' 周 · ' + phaseWord(a.phase) + '</p>' +
      '<button class="btn primary wide" style="margin-top:14px" data-action="resume-training">继续上次训练</button></section>';
  }

  function trainingCard(info, phase) {
    var day = P.getDayPlan(info.dayKey, phase, state.settings);
    var total = day.exercises.reduce(function (n, ex) { return n + ex.plannedSets; }, 0);
    var restTotal = day.exercises.reduce(function (n, ex) { return n + ex.restSec * ex.plannedSets; }, 0);
    var estimate = Math.max(20, Math.round((restTotal + total * 45) / 60 / 5) * 5);
    var existing = findSession(today(), info.dayKey);
    return '<section class="card hero-card"><p class="eyebrow">' + esc(day.label) + ' · 第 ' + info.week + ' 周</p>' +
      '<h2>' + esc(day.theme) + '</h2>' +
      '<div class="hero-stats"><div><strong>' + day.exercises.length + '</strong><span>个动作</span></div>' +
      '<div><strong>' + total + '</strong><span>计划组数</span></div>' +
      '<div><strong>约 ' + estimate + '</strong><span>分钟</span></div></div>' +
      (existing ? '<p class="small muted" style="margin-bottom:12px">今天已有一次记录，再开始会先提示。</p>' : '') +
      '<button class="btn primary large wide" data-action="start-training">开始训练</button></section>';
  }

  function restDayCard() {
    var next = P.nextTraining(state.settings.startDate, today());
    var nextText = next ? '<p class="small muted" style="margin-top:8px">下次训练：' + esc(cnDate(next.date)) + ' · ' + esc(P.DAYS[next.dayKey].theme) + '</p>' : '';
    return '<section class="card hero-card"><p class="eyebrow">恢复日</p><h2>今天休息</h2>' +
      '<p class="small muted" style="margin-top:8px">散步、轻松活动，睡够。漏练不倒填、不连着补两堂，按原排期继续。</p>' + nextText + '</section>';
  }

  function reviewCard() {
    var sets = 0;
    state.sessions.forEach(function (s) {
      (s.exercises || []).forEach(function (ex) {
        sets += (ex.sets || []).filter(function (x) { return x.done; }).length;
      });
    });
    return '<section class="card hero-card"><p class="eyebrow">六周完成</p><h2>进入复盘模式</h2>' +
      '<p class="small muted" style="margin-top:8px">六周计划已结束。历史记录全部保留，可以查看完成情况或开始下一轮。</p>' +
      '<div class="stat-grid" style="margin-top:18px"><div class="stat"><strong>' + state.sessions.length + '</strong><span>训练次数</span></div>' +
      '<div class="stat"><strong>' + sets + '</strong><span>完成组数</span></div>' +
      '<div class="stat"><strong>6</strong><span>计划周数</span></div></div>' +
      '<button class="btn primary wide" data-action="next-round">开始下一轮</button>' +
      '<div class="btn-row" style="margin-top:9px"><button class="btn ghost wide" data-action="go-log">查看历史记录</button></div></section>';
  }

  function renderToday() {
    var info = weekInfo();
    var phase = displayPhase(info);
    var badgeRow = phaseBadge(info);
    if (info.kind === 'active') badgeRow = '<span class="badge accent">第 ' + info.week + ' / 6 周</span>' + badgeRow;
    var html = '<header class="page-head"><div><p class="hero-date">' + esc(cnDate(today())) + '</p><h1>今天</h1><div class="badge-row">' + badgeRow + '</div></div></header>';
    if (info.kind === 'preview') {
      html += '<section class="card hero-card"><p class="eyebrow">距开始</p><h2>' + info.daysUntil + ' 天后开始</h2>' +
        '<p class="small muted" style="margin-top:8px">计划从 ' + esc(cnDate(state.settings.startDate)) + ' 开始。前两周学动作、选重量，不做到力竭。</p></section>';
    } else if (info.kind === 'review') {
      html += reviewCard();
    } else {
      html += activeCard();
      html += weekConfirmCard(info);
      html += info.dayKey ? trainingCard(info, phase) : restDayCard();
    }
    $('view').innerHTML = '<div class="page">' + html + '</div>';
  }

  function renderPlan() {
    var info = weekInfo();
    var phase = displayPhase(info);
    var body = P.DAY_KEYS.map(function (dayKey, dayIndex) {
      var day = P.getDayPlan(dayKey, phase, state.settings);
      var total = day.exercises.reduce(function (n, ex) { return n + ex.plannedSets; }, 0);
      var rows = day.exercises.map(function (ex, exIndex) {
        return '<button class="exercise-row" data-action="exercise-detail" data-day="' + dayKey + '" data-ex="' + ex.id + '">' +
          '<span><span class="name">' + (exIndex + 1) + '. ' + esc(ex.name) + '</span>' +
          '<span class="meta">' + ex.plannedSets + ' 组 × ' + esc(ex.repsLabel) + ' 次 · 休息 ' + ex.restSec + ' 秒</span></span>' +
          '<span class="chev">›</span></button>';
      }).join('');
      return '<details class="card day-card" data-day-card="' + dayKey + '"><summary><span><span class="day-title">' + day.label + ' · ' + esc(day.title) + '</span>' +
        '<span class="day-sub">' + esc(day.theme) + ' · ' + total + ' 组</span></span></summary>' +
        '<div class="exercise-list">' + rows + '</div></details>';
    }).join('');
    var note = info.kind === 'preview' ? '计划尚未开始，以下按适应期 2 组预览。' : info.kind === 'review' ? '六周已结束，以下按完整阶段展示。' : '当前阶段：' + phaseWord(phase) + '。点动作可单独查看动画，不影响训练记录。';
    $('view').innerHTML = '<div class="page"><header class="page-head"><div><p class="hero-date">四天训练 · 三天恢复</p><h1>计划</h1><div class="badge-row">' + phaseBadge(info) + '</div></div></header>' +
      '<p class="small muted" style="margin:-6px 0 14px">' + esc(note) + '</p>' + body +
      '<section class="card" style="margin-top:14px"><p class="eyebrow">通用热身</p><p class="small" style="margin-top:7px">轻松单车或快走 5 分钟；当天第一个复合动作做 2–3 组递增热身；第一个推胸再做 1–2 组轻热身。热身不计入正式组。</p></section></div>';
  }

  function guideData(exId) {
    var g = window.GUIDES || {};
    return g[exId] || g.pulldown || null;
  }

  // 跟练页常驻的两条关键提示 + 一句要点，从结构化教学里派生，避免两处文案打架。
  function keyTips(g) {
    if (!g) return [];
    return [g.setup[1] || g.setup[0], g.steps[2] ? g.steps[2].text : g.steps[0].text];
  }

  function mistakeLine(m) {
    return '错误 ' + m.fault + ' · ' + m.tag + '：' + m.phenomenon;
  }

  function guideFolds(g) {
    if (!g) return '';
    return '<details><summary>器械设置<span class="fold-count">' + (g.setup.length + g.machineVariation.length) + ' 项</span></summary>' +
      '<div class="fold-body"><ul>' + g.setup.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<p class="fold-sub">器械差异</p><ul>' + g.machineVariation.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></details>' +
      '<details><summary>分步动作<span class="fold-count">' + g.steps.length + ' 步</span></summary>' +
      '<div class="fold-body"><ol>' + g.steps.map(function (s) { return '<li><b>' + esc(s.title) + '</b>：' + esc(s.text) + '</li>'; }).join('') + '</ol></div></details>' +
      '<details><summary>常见错误<span class="fold-count">' + g.mistakes.length + ' 个</span></summary>' +
      '<div class="fold-body"><ul class="mistake-list">' + g.mistakes.map(function (m) {
        return '<li><b>错误 ' + m.fault + ' · ' + esc(m.tag) + '</b>' +
          '<span><i>现象</i>' + esc(m.phenomenon) + '</span>' +
          '<span><i>为什么错</i>' + esc(m.why) + '</span>' +
          '<span><i>怎么改</i>' + esc(m.fix) + '</span>' +
          '<span><i>自检</i>' + esc(m.check) + '</span></li>';
      }).join('') + '</ul></div></details>' +
      '<details><summary>自检与安全<span class="fold-count">' + g.safety.length + ' 条</span></summary>' +
      '<div class="fold-body"><ul>' + g.safety.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></details>';
  }

  function guideOneLiner(g) {
    if (!g) return '';
    return '<div class="fold-body inline">' +
      '<p><b>器械设置</b>：' + esc(g.setup[0]) + '</p>' +
      '<p><b>分步</b>：' + esc(g.steps.map(function (s) { return s.title; }).join(' → ')) + '</p>' +
      '<p><b>常见错误</b>：' + esc(g.mistakes.map(function (m) { return m.tag; }).join('；')) + '</p>' +
      '<p><b>自检</b>：' + esc(g.safety[0]) + '</p></div>';
  }

  function openExerciseDetail(dayKey, exId) {
    var info = weekInfo();
    var phase = displayPhase(info);
    var day = P.getDayPlan(dayKey, phase, state.settings);
    var ex = day.exercises.find(function (x) { return x.id === exId; });
    if (!ex) return;
    var g = guideData(exId);
    var html = '<p class="eyebrow">' + esc(day.label) + ' · ' + esc(day.title) + '</p><h2>' + esc(ex.name) + '</h2>' +
      '<p class="small muted">' + ex.plannedSets + ' 组 × ' + esc(ex.repsLabel) + ' 次 · 组间休息 ' + ex.restSec + ' 秒</p>' +
      '<div class="detail-canvas-wrap"><canvas id="detailCanvas" width="960" height="600"></canvas></div>' +
      '<div class="segmented" id="detailToggle"><button class="is-active" data-detail-mode="correct">正确动作</button><button data-detail-mode="fault">错误示范</button></div>' +
      '<div class="fault-chips is-hidden" id="detailFaultChips">' + (window.FIGURES && window.FIGURES[exId] ? window.FIGURES[exId].faults.map(function (f, i) {
        return '<button data-fault-chip="' + (i + 1) + '">错误 ' + (i + 1) + ' · ' + esc(f) + '</button>';
      }).join('') : '') + '</div>' +
      '<p class="cue">' + esc(g ? g.tagline : '') + '</p>' +
      '<div class="open-all"><button class="link-btn" id="detailExpandAll">全部展开</button></div>' +
      '<div class="fold-group" id="detailFolds">' + guideFolds(g) + '</div>' +
      '<div class="modal-actions"><button class="btn ghost wide" data-action="close-modal">关闭</button></div>';
    openModal(html, function () {
      var canvas = $('detailCanvas');
      detailPlayer = window.Figures && window.Figures.createPlayer ? window.Figures.createPlayer(canvas, exId) : null;
      var allBtn = $('detailExpandAll');
      if (allBtn) {
        allBtn.addEventListener('click', function () {
          var open = allBtn.textContent === '全部展开';
          $$('#detailFolds details').forEach(function (d) { d.open = open; });
          allBtn.textContent = open ? '全部收起' : '全部展开';
        });
      }
      return function () { if (detailPlayer) detailPlayer.stop(); detailPlayer = null; };
    });
  }

  function doneSetCount(session) {
    return (session.exercises || []).reduce(function (n, ex) {
      return n + (ex.sets || []).filter(function (s) { return s.done; }).length;
    }, 0);
  }

  function doneExerciseCount(session) {
    return (session.exercises || []).filter(function (ex) {
      return (ex.sets || []).some(function (s) { return s.done; });
    }).length;
  }

  function setLine(ex, s) {
    var meta = exerciseMeta(ex.exId);
    var kg = meta && meta.bodyweight ? '自重' : ((Number(s.kg) || 0) + ' kg');
    var rir = (s.rir === null || s.rir === undefined || s.rir === '') ? '' : ' · RIR ' + s.rir;
    return kg + ' × ' + s.reps + rir;
  }

  function filterOptions(selected) {
    var opts = ['<option value="">全部记录</option>'];
    P.DAY_KEYS.forEach(function (dayKey) {
      P.DAYS[dayKey].exercises.forEach(function (exId) {
        var id = dayKey + ':' + exId;
        opts.push('<option value="' + id + '"' + (selected === id ? ' selected' : '') + '>' + P.DAYS[dayKey].label + ' · ' + esc(P.EXERCISES[exId].name) + '</option>');
      });
    });
    return opts.join('');
  }

  function renderLog() {
    var sorted = state.sessions.slice().sort(function (a, b) { return String(b.date + b.startedAt).localeCompare(String(a.date + a.startedAt)); });
    var filterDay = '', filterEx = '';
    if (logFilter && logFilter.indexOf(':') > 0) {
      filterDay = logFilter.split(':')[0];
      filterEx = logFilter.split(':')[1];
    }
    var list = sorted.filter(function (s) {
      if (!filterEx) return true;
      return s.dayKey === filterDay && (s.exercises || []).some(function (ex) { return ex.exId === filterEx && (ex.sets || []).some(function (x) { return x.done; }); });
    });
    var lastHtml = '';
    if (filterEx) {
      var last = P.getLastSummary(state, filterDay, filterEx);
      var meta = exerciseMeta(filterEx);
      lastHtml = '<section class="card" style="margin-bottom:14px"><p class="eyebrow">上次摘要</p>' +
        (last ? '<p style="margin-top:6px"><strong>' + (meta && meta.bodyweight ? '自重' : (last.kg !== null ? P.formatKg(last.kg) : last.weights.join(' / ') + ' kg')) + '</strong> × ' + last.reps.join(' / ') + '</p><p class="small muted">' + esc(cnDate(last.date)) + ' · ' + phaseWord(last.phase) + ' · 设置：' + esc(last.setup || '未填写') + '</p>' : '<p class="small muted" style="margin-top:6px">这个动作还没有记录。</p>') + '</section>';
    }
    var rows = list.map(function (s) {
      var day = P.DAYS[s.dayKey];
      var exCount = doneExerciseCount(s);
      var sets = doneSetCount(s);
      return '<button class="history-item" data-action="session-detail" data-id="' + esc(s.id) + '"><span><span class="date">' + esc(cnDate(s.date)) + '</span>' +
        '<span class="meta">' + esc(day ? day.theme : s.dayKey) + ' · 完成 ' + exCount + ' 个动作</span></span>' +
        '<span class="count">' + sets + ' 组</span></button>';
    }).join('');
    if (!rows) rows = '<div class="empty"><strong>还没有记录</strong>完成一次训练后，这里会按日期倒序保存。</div>';
    $('view').innerHTML = '<div class="page"><header class="page-head"><div><p class="hero-date">数据只存本机</p><h1>记录</h1></div></header>' +
      '<div class="card" style="padding:13px 14px;margin-bottom:14px"><label class="field" style="margin:0"><span>按训练日 + 动作筛选</span><select id="logFilter">' + filterOptions(logFilter) + '</select></label></div>' +
      '<div class="btn-row" style="margin-bottom:14px"><button class="btn ghost" data-action="export">导出备份</button><button class="btn ghost" data-action="import">导入备份</button></div>' +
      lastHtml + rows + '</div>';
  }

  function sessionDetail(sessionId) {
    var s = state.sessions.find(function (x) { return x.id === sessionId; });
    if (!s) return;
    var day = P.DAYS[s.dayKey];
    var rows = (s.exercises || []).map(function (ex) {
      var sets = (ex.sets || []).filter(function (x) { return x.done; });
      if (!sets.length) return '';
      var meta = exerciseMeta(ex.exId);
      return '<div class="log-detail-row"><span><span class="name">' + esc(meta ? meta.name : ex.exId) + '</span>' +
        (ex.pain ? '<span class="pain-flag">关节不适</span>' : '') + (ex.setup ? '<div class="small muted">设置：' + esc(ex.setup) + '</div>' : '') + '</span>' +
        '<span class="sets">' + sets.map(function (x) { return '<strong>' + esc(setLine(ex, x)) + '</strong>'; }).join('<br>') + '</span></div>';
    }).join('');
    var html = '<p class="eyebrow">' + esc(cnDate(s.date)) + ' · ' + phaseWord(s.phase) + '</p><h2>' + esc(day ? day.theme : '训练记录') + '</h2>' +
      '<p class="small muted" style="margin-bottom:12px">' + doneExerciseCount(s) + ' 个动作 · ' + doneSetCount(s) + ' 组</p>' +
      '<div class="card" style="padding:4px 14px">' + (rows || '<p class="small muted">没有完成组。</p>') + '</div>' +
      '<div class="modal-actions"><button class="btn ghost" data-action="close-modal">关闭</button><button class="btn danger-ghost" data-action="delete-session" data-id="' + esc(s.id) + '">删除这次记录</button></div>';
    openModal(html);
  }

  function deleteSession(sessionId) {
    showConfirm('删除这次记录？', '删除后无法恢复。建议先导出备份。', '删除', function () {
      state.sessions = state.sessions.filter(function (s) { return s.id !== sessionId; });
      saveState();
      closeModal();
      renderLog();
      toast('已删除这次记录');
    }, true);
  }

  function renderSettings() {
    var bw = state.settings.bodyWeightKg;
    $('view').innerHTML = '<div class="page"><header class="page-head"><div><p class="hero-date">本机设置</p><h1>设置</h1></div></header>' +
      '<section class="card"><p class="eyebrow">训练安排</p>' +
      '<label class="field"><span>起始日期 <small>只能选周一</small></span><input id="startDateInput" type="date" value="' + esc(state.settings.startDate) + '"></label>' +
      '<label class="field"><span>周五臀桥类型</span><select id="gluteSelect"><option value="machine"' + (state.settings.gluteBridge === 'machine' ? ' selected' : '') + '>臀桥机 · 10–15 次</option><option value="bodyweight"' + (state.settings.gluteBridge === 'bodyweight' ? ' selected' : '') + '>自重臀桥 · 12–20 次</option></select></label>' +
      '<label class="field"><span>体重 kg <small>可选，只用于蛋白质估算</small></span><input id="bodyWeightInput" type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="未填写" value="' + (bw ? bw : '') + '"></label>' +
      '<div class="setting-row" style="margin-top:6px"><div><div class="label">蛋白质参考</div><div class="desc" id="proteinRange">' + esc(proteinText(bw)) + '</div></div></div>' +
      '<button class="btn primary wide" style="margin-top:14px" data-action="save-settings">保存设置</button></section>' +
      '<section class="card"><p class="eyebrow">数据</p><p class="small muted" style="margin-top:5px">训练数据只保存在这台手机。换机或清理浏览器前请导出 JSON 备份。</p>' +
      '<div class="btn-row" style="margin-top:14px"><button class="btn ghost" data-action="export">导出备份</button><button class="btn ghost" data-action="import">导入备份</button></div>' +
      '<button class="btn danger-ghost wide" style="margin-top:9px" data-action="clear-all">清除全部数据</button></section>' +
      '<section class="card"><p class="eyebrow">关于</p><p style="margin-top:6px;font-weight:750">肩背教练 · 版本 1.2.0</p><p class="small muted" style="margin-top:5px">六周肩背优先训练计划。离线 PWA，无账号、无上传、无在线依赖。计划数值为固定训练框架，不替代医疗建议。</p></section></div>';
  }

  function saveSettingsFromForm() {
    var start = $('startDateInput').value;
    var glute = $('gluteSelect').value === 'bodyweight' ? 'bodyweight' : 'machine';
    var bwRaw = $('bodyWeightInput').value.trim();
    var bw = bwRaw === '' ? null : Number(bwRaw);
    if (!P.isMonday(start)) { toast('起始日期只能选周一'); return; }
    if (bw !== null && (!Number.isFinite(bw) || bw <= 0 || bw > 400)) { toast('体重请填 0–400 之间的数字'); return; }
    var changedStart = state.settings.startDate !== start;
    state.settings.startDate = start;
    state.settings.gluteBridge = glute;
    state.settings.bodyWeightKg = bw === null ? null : Math.round(bw * 10) / 10;
    if (changedStart) {
      state.weeks = {};
      if (state.active) {
        var info = P.weekForDate(start, state.active.date);
        if (info.kind === 'active') state.active.week = info.week;
      }
    }
    saveState();
    renderSettings();
    toast(changedStart ? '起始日已更新，周次已重算；历史记录保留' : '设置已保存');
  }

  function exportBackup() {
    var payload = { app: P.APP_ID, version: 1, exportedAt: new Date().toISOString(), data: state };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '肩背教练-备份-' + today().replace(/-/g, '') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('备份已导出');
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (err) { showAlert('导入失败', '文件不是有效的 JSON，原数据未改动。'); return; }
      if (!parsed || parsed.app !== P.APP_ID || parsed.version !== 1 || !parsed.data) {
        showAlert('导入失败', '备份格式或版本不匹配（需要肩背教练 version 1），原数据未改动。');
        return;
      }
      showConfirm('导入并覆盖？', '导入会用备份整体替换当前训练记录、设置和未完成训练。原数据不会自动保留，建议先导出当前备份。', '确认覆盖', function () {
        state = normalizeState(parsed.data);
        saveState();
        closeModal();
        logFilter = '';
        navigate('today');
        toast('备份已导入');
      }, true);
    };
    reader.onerror = function () { showAlert('导入失败', '无法读取这个文件，原数据未改动。'); };
    reader.readAsText(file);
  }

  function clearAllData() {
    showConfirm('清除全部数据？', '会删除所有训练记录、每周确认和未完成训练。历史无法恢复。', '继续', function () {
      showConfirm('再次确认清除', '这是第二次确认。清除后只能靠之前导出的 JSON 备份恢复。', '彻底清除', function () {
        state = defaultState();
        saveState();
        closeModal();
        navigate('today');
        toast('全部数据已清除');
      }, true);
    }, true);
  }

  function mondayOf(dateStr) {
    var d = P.parseDate(dateStr);
    var back = (d.getDay() + 6) % 7;
    return P.formatDate(P.addDays(d, -back));
  }

  function startNextRound() {
    showConfirm('开始下一轮？', '起始日会设为本周一，清空每周恢复确认，保留全部历史记录。', '开始下一轮', function () {
      state.settings.startDate = mondayOf(today());
      state.weeks = {};
      state.active = null;
      saveState();
      closeModal();
      navigate('today');
      toast('下一轮已开始，历史记录保留');
    });
  }

  function defaultRir(phase) { return phase === 'adapt' ? 3 : 2; }

  function makeActive(info, phase) {
    var day = P.getDayPlan(info.dayKey, phase, state.settings);
    var exercises = day.exercises.map(function (ex) {
      var sets = [];
      for (var i = 0; i < ex.plannedSets; i++) sets.push({ kg: null, reps: null, rir: defaultRir(phase), done: false });
      return { exId: ex.id, setup: P.getLastSetup(state, info.dayKey, ex.id), pain: false, sets: sets };
    });
    return {
      id: today() + '-' + info.dayKey, date: today(), week: info.week, dayKey: info.dayKey, phase: phase,
      startedAt: new Date().toISOString(), finishedAt: null, exercises: exercises,
      cursor: { exIndex: 0, setIndex: 0 }, restEndsAt: null
    };
  }

  function startTraining() {
    if (state.active) { openTraining(); return; }
    var info = weekInfo();
    if (info.kind !== 'active' || !info.dayKey) { toast('今天不是训练日'); return; }
    var existing = findSession(today(), info.dayKey);
    if (existing) {
      openModal('<h2>今天已有记录</h2><p>' + esc(cnDate(existing.date)) + ' · ' + esc(P.DAYS[existing.dayKey].theme) + '，完成 ' + doneSetCount(existing) + ' 组。</p>' +
        '<div class="modal-actions"><button class="btn ghost" data-action="close-modal">取消</button><button class="btn ghost" data-action="view-session" data-id="' + esc(existing.id) + '">查看记录</button>' +
        '<button class="btn primary wide" data-action="start-anyway">仍要再练一次</button></div>');
      return;
    }
    beginNewTraining(info);
  }

  function beginNewTraining(info) {
    closeModal();
    state.active = makeActive(info, displayPhase(info));
    saveState();
    openTraining();
  }

  function openTraining() {
    if (!state.active) { toast('没有未完成的训练'); return; }
    $('toast').classList.add('is-hidden');
    clearTimeout(toastTimer);
    $('summaryLayer').classList.add('is-hidden');
    $('trainLayer').classList.remove('is-hidden');
    $('trainLayer').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderTraining();
    startClock();
    requestWakeLock();
    if (state.active.restEndsAt && state.active.restEndsAt > Date.now()) showRest();
    else if (state.active.restEndsAt) { state.active.restEndsAt = null; saveState(); }
  }

  function closeTraining() {
    $('trainLayer').classList.add('is-hidden');
    $('trainLayer').setAttribute('aria-hidden', 'true');
    $('restLayer').classList.add('is-hidden');
    document.body.style.overflow = '';
    stopClock();
    if (restTimer) { clearInterval(restTimer); restTimer = null; }
    releaseWakeLock();
    if (trainPlayer) { trainPlayer.stop(); trainPlayer = null; trainFigureId = null; }
  }

  function startClock() {
    stopClock();
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
  }

  function stopClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  function updateClock() {
    if (!state.active) return;
    var sec = (Date.now() - new Date(state.active.startedAt).getTime()) / 1000;
    $('trainClock').textContent = formatDuration(sec);
  }

  function requestWakeLock() {
    if (!navigator.wakeLock || !$('trainLayer') || $('trainLayer').classList.contains('is-hidden')) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
    }).catch(function () { wakeLock = null; });
  }

  function releaseWakeLock() {
    if (wakeLock && wakeLock.release) { try { wakeLock.release(); } catch (err) {} }
    wakeLock = null;
  }

  function activeCtx() {
    var a = state.active;
    if (!a || !a.exercises || !a.exercises.length) return null;
    var exIndex = Math.max(0, Math.min(a.cursor.exIndex || 0, a.exercises.length - 1));
    var ex = a.exercises[exIndex];
    var meta = exerciseMeta(ex.exId);
    if (!meta) return null;
    var setIndex = Math.max(0, Math.min(a.cursor.setIndex || 0, ex.sets.length));
    return { a: a, ex: ex, meta: meta, exIndex: exIndex, setIndex: setIndex, planned: ex.sets.length, set: ex.sets[setIndex] || null };
  }

  function ensureTrainPlayer(exId) {
    if (!window.Figures || !window.Figures.createPlayer) return;
    if (trainFigureId !== exId) {
      if (trainPlayer) trainPlayer.stop();
      trainFigureId = exId;
      trainPlayer = window.Figures.createPlayer($('trainCanvas'), exId);
      if (trainPlayer && trainPlayer.setFault) trainPlayer.setFault(figureFault);
    }
    if (trainPlayer) trainPlayer.setMode(figureMode);
  }

  function renderTraining() {
    var c = activeCtx();
    if (!c) { closeTraining(); return; }
    var day = P.DAYS[c.a.dayKey];
    var g = guideData(c.ex.exId);
    var tips = c.ex.pain ? [] : keyTips(g);
    $('trainExIndex').textContent = '动作 ' + (c.exIndex + 1) + '/' + c.a.exercises.length;
    $('trainSetIndex').textContent = c.setIndex >= c.planned ? '本动作已完成' : '第 ' + (c.setIndex + 1) + '/' + c.planned + ' 组';
    $('trainDayLabel').textContent = (day ? day.label + ' · ' + day.title : '训练');
    $('trainName').textContent = c.meta.name;
    $('trainPhase').textContent = phaseWord(c.a.phase);
    $('trainTarget').textContent = c.planned + ' 组 × ' + P.repsLabel(c.meta) + ' 次';
    $('trainRest').textContent = '组间 ' + c.meta.restSec + ' 秒';
    $('trainLast').innerHTML = lastLine(c.a.dayKey, c.ex.exId);
    $('trainCue').textContent = g ? g.tagline : '';
    var tipHtml = tips.map(function (t) { return '<div class="tip">' + esc(t) + '</div>'; }).join('');
    if (c.ex.pain) tipHtml = '<div class="tip" style="color:#ff9a93">本动作已标记关节不适，剩余组已跳过。</div>' + tipHtml;
    $('trainTips').innerHTML = tipHtml;
    $('trainGuideBody').innerHTML = guideOneLiner(g);
    $('trainFaultChips').innerHTML = (g && window.FIGURES && window.FIGURES[c.ex.exId])
      ? window.FIGURES[c.ex.exId].faults.map(function (f, i) {
        return '<button data-fault-chip="' + (i + 1) + '"' + (figureMode === 'fault' && figureFault === i + 1 ? ' class="is-active"' : '') + '>错误 ' + (i + 1) + ' · ' + esc(f) + '</button>';
      }).join('')
      : '';
    $('trainFaultChips').classList.toggle('is-hidden', figureMode !== 'fault');
    $('setupInput').value = c.ex.setup || '';
    $('rirInput').value = c.set ? (c.set.rir === null || c.set.rir === undefined ? defaultRir(c.a.phase) : c.set.rir) : defaultRir(c.a.phase);

    var previousKg = null;
    for (var i = c.setIndex - 1; i >= 0; i--) {
      if (c.ex.sets[i].done) { previousKg = c.ex.sets[i].kg; break; }
    }
    var kgEl = $('kgInput');
    if (c.meta.bodyweight) {
      kgEl.value = '0';
      kgEl.readOnly = true;
      kgEl.setAttribute('aria-label', '自重动作重量为 0');
    } else {
      kgEl.readOnly = false;
      kgEl.value = c.set && c.set.done ? c.set.kg : (previousKg !== null && previousKg !== undefined ? previousKg : '');
      kgEl.removeAttribute('aria-label');
    }
    $('repsInput').value = c.set && c.set.done ? c.set.reps : '';

    var doneState = c.setIndex >= c.planned;
    $('completeSetBtn').textContent = doneState ? (c.exIndex < c.a.exercises.length - 1 ? '下一个动作' : '完成训练') : '完成本组';
    $('painBtn').classList.toggle('is-hidden', doneState || c.ex.pain);
    $('faultBadge').classList.toggle('is-hidden', figureMode !== 'fault');
    $$('#figureToggle button').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-figure-mode') === figureMode);
    });
    ensureTrainPlayer(c.ex.exId);
  }

  function completeSet() {
    var c = activeCtx();
    if (!c) return;
    if (c.setIndex >= c.planned) { advanceExercise(); return; }
    var kg = c.meta.bodyweight ? 0 : Number($('kgInput').value);
    var reps = Number($('repsInput').value);
    var rir = Number($('rirInput').value);
    if (!c.meta.bodyweight && (!Number.isFinite(kg) || kg < 0)) { toast('请填写重量（kg，允许 0）'); return; }
    if (!Number.isFinite(reps) || reps < 1 || Math.floor(reps) !== reps) { toast('次数必须是 1 以上的整数'); return; }
    if (!Number.isFinite(rir) || rir < 0 || rir > 5) { toast('RIR 请填 0–5'); return; }
    var set = c.ex.sets[c.setIndex];
    set.kg = c.meta.bodyweight ? 0 : P.roundKg(kg);
    set.reps = reps;
    set.rir = rir;
    set.done = true;
    c.ex.setup = $('setupInput').value.trim().slice(0, 40);
    if (c.setIndex < c.planned - 1) {
      c.a.cursor.setIndex = c.setIndex + 1;
      saveState();
      renderTraining();
      startRest(c.meta.restSec);
    } else {
      c.a.cursor.setIndex = c.planned;
      saveState();
      renderTraining();
    }
  }

  function advanceExercise() {
    var c = activeCtx();
    if (!c || c.setIndex < c.planned) return;
    if (c.exIndex < c.a.exercises.length - 1) {
      c.a.cursor.exIndex = c.exIndex + 1;
      c.a.cursor.setIndex = 0;
      saveState();
      renderTraining();
    } else {
      openSummary();
    }
  }

  function startRest(seconds) {
    if (!state.active) return;
    state.active.restEndsAt = Date.now() + Math.max(1, seconds) * 1000;
    saveState();
    showRest();
  }

  function showRest() {
    if (!state.active || !state.active.restEndsAt) return;
    var c = activeCtx();
    $('restLayer').classList.remove('is-hidden');
    $('restLayer').setAttribute('aria-hidden', 'false');
    if (c) $('restNext').textContent = '下一组：' + c.meta.name + ' · 第 ' + (Math.min(c.setIndex + 1, c.planned)) + '/' + c.planned + ' 组';
    restBeeped = false;
    if (restTimer) clearInterval(restTimer);
    if (trainPlayer && trainPlayer.setPaused) trainPlayer.setPaused(true);
    updateRest();
    restTimer = setInterval(updateRest, 250);
  }

  function updateRest() {
    if (!state.active || !state.active.restEndsAt) return;
    var remain = Math.ceil((state.active.restEndsAt - Date.now()) / 1000);
    if (remain <= 0) { finishRest(true); return; }
    $('restTime').textContent = formatDuration(remain);
  }

  function finishRest(natural) {
    if (restTimer) { clearInterval(restTimer); restTimer = null; }
    $('restLayer').classList.add('is-hidden');
    $('restLayer').setAttribute('aria-hidden', 'true');
    if (state.active) { state.active.restEndsAt = null; saveState(); }
    if (trainPlayer && trainPlayer.setPaused) trainPlayer.setPaused(false);
    if (natural && !restBeeped) {
      restBeeped = true;
      beep();
      if (navigator.vibrate) navigator.vibrate([120, 70, 120]);
    }
    if (!$('trainLayer').classList.contains('is-hidden')) renderTraining();
  }

  function adjustRest(delta) {
    if (!state.active || !state.active.restEndsAt) return;
    state.active.restEndsAt = Math.max(Date.now(), state.active.restEndsAt + delta * 1000);
    saveState();
    updateRest();
  }

  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ac = new AC();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.28);
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime + 0.3);
      setTimeout(function () { try { ac.close(); } catch (e) {} }, 600);
    } catch (err) {}
  }

  function markPain() {
    var c = activeCtx();
    if (!c) return;
    showConfirm('标记关节不适？', '停止诱发疼痛的动作，不要只减一组硬练。确认后会跳过这个动作剩余组，并记录 pain=true。', '确认并跳过', function () {
      var a = state.active;
      a.exercises[c.exIndex].pain = true;
      if (c.exIndex < a.exercises.length - 1) {
        a.cursor.exIndex = c.exIndex + 1;
        a.cursor.setIndex = 0;
      } else {
        a.cursor.setIndex = c.planned;
      }
      saveState();
      closeModal();
      renderTraining();
      toast('已记录关节不适，剩余组已跳过');
    }, true);
  }

  function endTrainingPrompt() {
    openModal('<h2>结束训练？</h2><p>保存并退出会保留未完成的训练，下次可以继续。放弃本次会丢弃这次已填内容。</p><div class="modal-actions">' +
      '<button class="btn ghost" data-action="close-modal">继续训练</button><button class="btn primary" data-action="exit-save">保存并退出</button>' +
      '<button class="btn danger-ghost wide" data-action="exit-discard">放弃本次</button></div>');
  }

  function sessionSnapshot() {
    var a = state.active;
    return {
      id: a.id, date: a.date, week: a.week, dayKey: a.dayKey, phase: a.phase,
      startedAt: a.startedAt, finishedAt: null,
      exercises: a.exercises.map(function (ex) {
        return {
          exId: ex.exId, setup: ex.setup || '', pain: ex.pain === true,
          sets: (ex.sets || []).filter(function (s) { return s.done; }).map(function (s) {
            return { kg: Number(s.kg) || 0, reps: Number(s.reps), rir: Number(s.rir), done: true };
          })
        };
      })
    };
  }

  function openSummary() {
    if (!state.active) return;
    var a = state.active;
    var session = sessionSnapshot();
    var completed = 0, volume = 0;
    session.exercises.forEach(function (ex) {
      var meta = exerciseMeta(ex.exId);
      completed += ex.sets.length;
      if (meta && !meta.bodyweight) ex.sets.forEach(function (s) { volume += (Number(s.kg) || 0) * (Number(s.reps) || 0); });
    });
    var elapsed = (Date.now() - new Date(a.startedAt).getTime()) / 1000;
    var tempState = { version: state.version, settings: state.settings, weeks: state.weeks, sessions: state.sessions.concat([session]), active: null };
    var rows = session.exercises.map(function (ex) {
      var meta = exerciseMeta(ex.exId);
      var planned = a.exercises.find(function (x) { return x.exId === ex.exId; });
      var plannedCount = planned ? planned.sets.length : ex.sets.length;
      var advice = P.analyzeProgression(tempState, a.dayKey, ex.exId, a.phase).suggestion;
      return '<div class="summary-row"><div class="top"><span class="name">' + esc(meta ? meta.name : ex.exId) + (ex.pain ? '<span class="pain-flag">关节不适</span>' : '') + '</span>' +
        '<span class="sets">' + ex.sets.length + ' / ' + plannedCount + ' 组</span></div>' +
        '<div class="advice">' + esc(advice) + '</div></div>';
    }).join('');
    summaryData = { session: session, completed: completed, volume: volume };
    var minuteText = elapsed < 60 ? '&lt;1' : String(Math.round(elapsed / 60));
    $('summaryBody').innerHTML = '<div class="stat-grid"><div class="stat"><strong>' + completed + '</strong><span>完成组数</span></div>' +
      '<div class="stat"><strong>' + Math.round(volume).toLocaleString('zh-CN') + '</strong><span>总容量 kg</span></div>' +
      '<div class="stat"><strong>' + minuteText + '</strong><span>分钟</span></div></div>' +
      '<p class="small muted" style="margin-bottom:10px">训练时长 ' + esc(durationText(elapsed)) + '。自重动作不计入总容量。</p>' + rows;
    $('trainLayer').classList.add('is-hidden');
    $('trainLayer').setAttribute('aria-hidden', 'true');
    $('summaryLayer').classList.remove('is-hidden');
    $('summaryLayer').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    stopClock();
    if (trainPlayer) { trainPlayer.stop(); trainPlayer = null; trainFigureId = null; }
  }

  function closeSummary() {
    $('summaryLayer').classList.add('is-hidden');
    $('summaryLayer').setAttribute('aria-hidden', 'true');
    summaryData = null;
    if (state.active) openTraining();
    else { document.body.style.overflow = ''; navigate('today'); }
  }

  function saveSummary() {
    if (!summaryData || !state.active) return;
    if (summaryData.completed < 1) { toast('还没有完成任何组，未保存'); return; }
    var session = summaryData.session;
    session.finishedAt = new Date().toISOString();
    state.sessions = state.sessions.filter(function (s) { return s.id !== session.id; });
    state.sessions.push(session);
    state.active = null;
    saveState();
    summaryData = null;
    $('summaryLayer').classList.add('is-hidden');
    $('summaryLayer').setAttribute('aria-hidden', 'true');
    closeTraining();
    document.body.style.overflow = '';
    navigate('log');
    toast('训练已保存');
  }

  function readWeekChecks() {
    return {
      stable: !!($('weekStable') && $('weekStable').checked),
      noPain: !!($('weekNoPain') && $('weekNoPain').checked),
      recovered: !!($('weekRecovered') && $('weekRecovered').checked)
    };
  }

  function confirmWeek(status) {
    var info = weekInfo();
    if (info.kind !== 'active' || info.week < 3) return;
    var checks = readWeekChecks();
    if (status === 'full' && !(checks.stable && checks.noPain && checks.recovered)) {
      toast('三项都勾选后才能进入完整组数');
      return;
    }
    state.weeks[String(info.week)] = {
      status: status === 'deload' ? 'deload' : 'full',
      confirmedAt: new Date().toISOString(),
      stable: checks.stable, noPain: checks.noPain, recovered: checks.recovered
    };
    saveState();
    renderToday();
    toast(status === 'deload' ? '本周按减量组数执行' : '本周已切换到完整组数');
  }

  function resetWeek() {
    var info = weekInfo();
    if (info.kind !== 'active') return;
    var rec = state.weeks[String(info.week)];
    if (rec) { rec.status = 'adapt'; rec.confirmedAt = null; }
    saveState();
    renderToday();
    toast('可以重新确认或改为减量');
  }

  function captureDraftSetup() {
    var c = activeCtx();
    if (c && $('setupInput')) c.ex.setup = $('setupInput').value.trim().slice(0, 40);
  }

  function exitSave() {
    captureDraftSetup();
    saveState();
    closeModal();
    closeTraining();
    navigate('today');
    toast('已保存未完成的训练');
  }

  function exitDiscard() {
    state.active = null;
    saveState();
    closeModal();
    closeTraining();
    navigate('today');
    toast('已放弃本次训练');
  }

  function handleAction(action, el) {
    switch (action) {
      case 'close-modal': closeModal(); break;
      case 'modal-confirm': { var fn = confirmCallback; confirmCallback = null; if (fn) fn(); else closeModal(); break; }
      case 'start-training': startTraining(); break;
      case 'start-anyway': beginNewTraining(weekInfo()); break;
      case 'resume-training': openTraining(); break;
      case 'confirm-week-full': confirmWeek('full'); break;
      case 'confirm-week-deload': confirmWeek('deload'); break;
      case 'reset-week': resetWeek(); break;
      case 'next-round': startNextRound(); break;
      case 'go-log': closeModal(); navigate('log'); break;
      case 'exercise-detail': openExerciseDetail(el.getAttribute('data-day'), el.getAttribute('data-ex')); break;
      case 'session-detail': sessionDetail(el.getAttribute('data-id')); break;
      case 'delete-session': deleteSession(el.getAttribute('data-id')); break;
      case 'view-session': { var id = el.getAttribute('data-id'); closeModal(); navigate('log', { scroll: false }); sessionDetail(id); break; }
      case 'export': exportBackup(); break;
      case 'import': $('importFile').click(); break;
      case 'clear-all': clearAllData(); break;
      case 'save-settings': saveSettingsFromForm(); break;
      case 'exit-save': exitSave(); break;
      case 'exit-discard': exitDiscard(); break;
      default: break;
    }
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-route]');
      if (tab) { navigate(tab.getAttribute('data-route')); return; }
      var modeBtn = e.target.closest('[data-figure-mode]');
      if (modeBtn) {
        figureMode = modeBtn.getAttribute('data-figure-mode') === 'fault' ? 'fault' : 'correct';
        $$('#figureToggle button').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-figure-mode') === figureMode); });
        $('faultBadge').classList.toggle('is-hidden', figureMode !== 'fault');
        $('trainFaultChips').classList.toggle('is-hidden', figureMode !== 'fault');
        if (trainPlayer) {
          if (figureMode === 'fault' && trainPlayer.setFault) trainPlayer.setFault(figureFault);
          trainPlayer.setMode(figureMode);
        }
        return;
      }
      var detailMode = e.target.closest('[data-detail-mode]');
      if (detailMode) {
        var mode = detailMode.getAttribute('data-detail-mode') === 'fault' ? 'fault' : 'correct';
        $$('#detailToggle button').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-detail-mode') === mode); });
        var chips = $('detailFaultChips');
        if (chips) chips.classList.toggle('is-hidden', mode !== 'fault');
        if (detailPlayer) {
          if (mode === 'fault' && detailPlayer.setFault) detailPlayer.setFault(figureFault);
          detailPlayer.setMode(mode);
        }
        return;
      }
      var faultChip = e.target.closest('[data-fault-chip]');
      if (faultChip) {
        figureFault = Number(faultChip.getAttribute('data-fault-chip')) || 1;
        var group = faultChip.parentNode;
        $$('[data-fault-chip]', group).forEach(function (b) { b.classList.toggle('is-active', b === faultChip); });
        if (detailPlayer && detailPlayer.setFault) detailPlayer.setFault(figureFault);
        if (trainPlayer && trainPlayer.setFault) trainPlayer.setFault(figureFault);
        return;
      }
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) handleAction(actionEl.getAttribute('data-action'), actionEl);
    });

    document.addEventListener('change', function (e) {
      if (e.target.id === 'logFilter') { logFilter = e.target.value; renderLog(); }
      else if (e.target.id === 'importFile') { handleImportFile(e.target.files && e.target.files[0]); e.target.value = ''; }
      else if (e.target.id === 'setupInput') { captureDraftSetup(); saveState(); }
    });

    document.addEventListener('input', function (e) {
      if (e.target.id === 'bodyWeightInput') {
        var v = Number(e.target.value);
        var el = $('proteinRange');
        if (el) el.textContent = proteinText(Number.isFinite(v) && v > 0 ? v : null);
      }
    });

    $('completeSetBtn').addEventListener('click', completeSet);
    $('painBtn').addEventListener('click', markPain);
    $('trainEndBtn').addEventListener('click', endTrainingPrompt);
    $('restMinus').addEventListener('click', function () { adjustRest(-15); });
    $('restPlus').addEventListener('click', function () { adjustRest(15); });
    $('restSkip').addEventListener('click', function () { finishRest(false); });
    $('summaryCloseBtn').addEventListener('click', closeSummary);
    $('saveSummaryBtn').addEventListener('click', saveSummary);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (!$('trainLayer').classList.contains('is-hidden')) {
        updateClock();
        requestWakeLock();
        if (state.active && state.active.restEndsAt && $('restLayer').classList.contains('is-hidden')) showRest();
      }
    });
    window.addEventListener('pagehide', function () {
      if (state && state.active && !$('trainLayer').classList.contains('is-hidden')) { captureDraftSetup(); saveState(); }
    });
    window.addEventListener('hashchange', function () {
      var next = location.hash.replace('#', '');
      if (['today', 'plan', 'log', 'settings'].indexOf(next) >= 0 && next !== route) { route = next; setTab(); render(); window.scrollTo(0, 0); }
    });
  }

  function init() {
    state = loadState();
    var hash = location.hash.replace('#', '');
    if (['today', 'plan', 'log', 'settings'].indexOf(hash) >= 0) route = hash;
    bindEvents();
    setTab();
    render();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  }

  init();
})();
