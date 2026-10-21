import test from 'node:test';
import assert from 'node:assert/strict';
import Figures from '../figures.js';
import Guides from '../guides.js';

const SAMPLES = [
  'pulldown', 'legPress', 'gluteMachine', 'row', 'straightArm', 'dbBench', 'lateral',
  'cableLateral', 'reverseFly', 'shoulderPress', 'legCurl', 'dbCalf', 'pushdown', 'biceps',
  'gluteBodyweight', 'crunch'
];
const PS = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1];

function angle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

test('16 个动作都在 FIGURES 里，且错误变体数量与文案一致', () => {
  for (const id of SAMPLES) {
    const fig = Figures.FIGS[id];
    const guide = Guides[id];
    assert.ok(fig, `缺少动作图 ${id}`);
    assert.ok(guide, `缺少文案 ${id}`);
    assert.equal(fig.faults.length, 3, `${id} 应有 3 个错误变体`);
    assert.equal(guide.mistakes.length, fig.faults.length, `${id} 文案与动画错误数量不一致`);
    guide.mistakes.forEach((m, i) => {
      assert.equal(m.fault, i + 1, `${id} 第 ${i + 1} 个错误的 fault 编号不连续`);
    });
  }
});

test('骨长全程固定（漂移 < 0.5px）', () => {
  for (const id of SAMPLES) {
    const ref = Figures.measure(id, 0, 0);
    for (const p of PS) {
      const m = Figures.measure(id, p, 0);
      for (const key of Object.keys(ref)) {
        assert.ok(Math.abs(m[key] - ref[key]) < 0.5,
          `${id} ${key} 在 p=${p} 漂移 ${(m[key] - ref[key]).toFixed(2)}px`);
      }
    }
    // 错误变体也不能拉长骨头
    for (let fault = 1; fault <= 3; fault++) {
      for (const p of [0.5, 1]) {
        const m = Figures.measure(id, p, fault);
        for (const key of Object.keys(ref)) {
          assert.ok(Math.abs(m[key] - ref[key]) < 0.5,
            `${id} fault=${fault} ${key} 在 p=${p} 漂移`);
        }
      }
    }
  }
});

test('接触点不脱开：手在握把、脚在踏板、上背在垫上', () => {
  // 高位下拉：手始终在横杆位置，脚始终踩地
  for (const p of PS) {
    const s = Figures.FIGS.pulldown.pose(p, 0);
    // 肩到杆必须落在臂展内（67+61=128），否则 IK 会把手夹在边界、看起来脱杆
    const reach = Math.hypot(s.shN.x - s.bar.x, s.shN.y - s.bar.y);
    assert.ok(reach <= 127.5, `pulldown p=${p} 肩到杆 ${reach.toFixed(1)}px，超出臂展`);
    assert.ok(Math.hypot(s.handN.x - s.bar.x, s.handN.y - s.bar.y) < 0.5, `pulldown p=${p} 手脱杆`);
    assert.ok(Math.abs(s.ankleN.y - 540) < 8, `pulldown p=${p} 脚离地 ${(s.ankleN.y - 540).toFixed(1)}px`);
  }

  // 腿举：脚踝必须落在滑轨直线上，踏板跟着脚走
  for (const p of PS) {
    const s = Figures.FIGS.legPress.pose(p, 0);
    const a = s.ankle0, b = s.ankle1;
    const cross = ((b.x - a.x) * (s.ankleN.y - a.y) - (b.y - a.y) * (s.ankleN.x - a.x))
      / Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(Math.abs(cross) < 1, `legPress p=${p} 脚踝偏离滑轨 ${cross.toFixed(2)}px`);
    const plateOffset = Math.hypot(s.plate.x - s.ankleN.x, s.plate.y - s.ankleN.y);
    assert.ok(plateOffset > 5 && plateOffset < 30, `legPress p=${p} 踏板没有贴住脚 (${plateOffset.toFixed(1)}px)`);
  }

  // 臀桥机：上背固定在垫上，脚固定在踏台
  for (const p of PS) {
    const s = Figures.FIGS.gluteMachine.pose(p, 0);
    assert.ok(Math.abs(s.chest.x - 354) < 6 && Math.abs(s.chest.y - 330) < 6, `gluteMachine p=${p} 上背离垫`);
    assert.ok(Math.abs(s.ankleN.x - 578) < 6 && Math.abs(s.ankleN.y - 490) < 6, `gluteMachine p=${p} 脚离踏台`);
    // 髋垫始终在髋关节上方 25–38px
    const gap = Math.hypot(s.hipPad.x - s.hip.x, s.hipPad.y - s.hip.y);
    assert.ok(gap > 25 && gap < 40, `gluteMachine p=${p} 髋垫脱离髋骨 (${gap.toFixed(1)}px)`);
  }
});

test('动作幅度成立：膝/肘在行程中确实改变角度', () => {
  const pulldown0 = Figures.FIGS.pulldown.pose(0, 0);
  const pulldown1 = Figures.FIGS.pulldown.pose(1, 0);
  const e0 = angle(pulldown0.shN, pulldown0.elbowN, pulldown0.handN);
  const e1 = angle(pulldown1.shN, pulldown1.elbowN, pulldown1.handN);
  assert.ok(e0 > 140, `高位下拉起始肘应接近伸直，实际 ${e0.toFixed(1)}°`);
  assert.ok(e1 < 90, `高位下拉峰值肘应明显屈曲，实际 ${e1.toFixed(1)}°`);

  const lp0 = Figures.FIGS.legPress.pose(0, 0);
  const lp1 = Figures.FIGS.legPress.pose(1, 0);
  const k0 = angle(lp0.hipN, lp0.kneeN, lp0.ankleN);
  const k1 = angle(lp1.hipN, lp1.kneeN, lp1.ankleN);
  assert.ok(k0 < 110, `腿举起始膝应约 90°，实际 ${k0.toFixed(1)}°`);
  assert.ok(k1 > 150, `腿举峰值膝应接近伸直，实际 ${k1.toFixed(1)}°`);

  const gm0 = Figures.FIGS.gluteMachine.pose(0, 0);
  const gm1 = Figures.FIGS.gluteMachine.pose(1, 0);
  const hip0 = angle(gm0.chest, gm0.hip, gm0.kneeN);
  const hip1 = angle(gm1.chest, gm1.hip, gm1.kneeN);
  assert.ok(hip1 - hip0 > 25, `臀桥机髋伸幅度不足 (${hip0.toFixed(1)}° → ${hip1.toFixed(1)}°)`);
});

test('错误变体与正确动作有可见差异', () => {
  for (const id of SAMPLES) {
    for (let fault = 1; fault <= 3; fault++) {
      const ok = Figures.FIGS[id].pose(1, 0);
      const bad = Figures.FIGS[id].pose(1, fault);
      let moved = 0;
      for (const key of ['hip', 'chest', 'kneeN', 'ankleN', 'elbowN', 'handN']) {
        moved = Math.max(moved, Math.hypot(bad[key].x - ok[key].x, bad[key].y - ok[key].y));
      }
      assert.ok(moved > 3, `${id} 错误 ${fault} 与正确姿势几乎一样 (${moved.toFixed(1)}px)`);
    }
  }
});

/**
 * 回归：关节不能中途翻面。
 *
 * 旧实现每帧按“离提示点最近”在两组 IK 解里二选一，肢体扫过提示点时肘/膝会
 * 瞬间跳到身体另一侧（单帧位移 100px 以上）。现在弯曲方向在 pose 里写死，
 * 位移必须连续——抖一下就会在这里炸出来。
 */
test('关节运动连续：任意一帧的位移都小于 5px', () => {
  const N = 300;
  for (const id of SAMPLES) {
    const fig = Figures.FIGS[id];
    for (let fault = 0; fault <= 3; fault++) {
      for (const key of ['elbowN', 'elbowF', 'kneeN', 'kneeF']) {
        let prev = null, worst = 0, at = 0;
        for (let i = 0; i <= N; i++) {
          const p = i / N;
          const cur = fig.pose(p, fault)[key];
          if (prev) {
            const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
            if (d > worst) { worst = d; at = p; }
          }
          prev = cur;
        }
        assert.ok(worst < 5,
          `${id} fault=${fault} ${key} 在 p=${at.toFixed(3)} 突然跳了 ${worst.toFixed(1)}px（关节翻面）`);
      }
    }
  }
});

test('教学文案字段完整，且达到 400 字以上的信息量', () => {
  for (const id of SAMPLES) {
    const g = Guides[id];
    assert.ok(g.tagline.length >= 8, `${id} 缺少一句话要点`);
    assert.ok(g.setup.length >= 4, `${id} 器械设置太少`);
    assert.ok(g.steps.length >= 4 && g.steps.length <= 6, `${id} 分步应为 4–6 步`);
    g.steps.forEach((s) => {
      assert.ok(s.title && s.text, `${id} 分步缺少标题或正文`);
    });
    assert.ok(g.safety.length >= 2, `${id} 自检与安全太少`);
    assert.ok(g.machineVariation.length >= 1, `${id} 缺少器械差异`);
    g.mistakes.forEach((m) => {
      for (const key of ['tag', 'phenomenon', 'why', 'fix', 'check']) {
        // tag 是纠错胶囊上的短标签，允许 2–3 字（如“膝内扣”）；其余字段必须成句
        const min = key === 'tag' ? 2 : 4;
        assert.ok(m[key] && m[key].length >= min, `${id} 错误「${m.tag}」的 ${key} 缺失`);
      }
    });
    const chars = [
      g.tagline, ...g.setup, ...g.steps.map((s) => s.title + s.text),
      ...g.mistakes.map((m) => m.tag + m.phenomenon + m.why + m.fix + m.check),
      ...g.safety, ...g.machineVariation
    ].join('').length;
    assert.ok(chars >= 400, `${id} 文案只有 ${chars} 字，低于 400 字下限`);
  }
});

test('drawFrame 能在任意 p 与错误变体下绘制（不抛异常）', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop in target) return target[prop];
      return (...args) => { calls.push([prop, args]); };
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  for (const id of SAMPLES) {
    for (const p of PS) {
      for (let fault = 0; fault <= 3; fault++) {
        Figures.drawFrame(ctx, 480, 300, id, p, fault);
      }
    }
  }
  assert.ok(calls.length > 1000, '画布几乎没有绘制调用');
});

