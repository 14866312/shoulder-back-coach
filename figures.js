(function () {
  'use strict';

  /*
   * 关节骨架版 v3。
   * 规则：
   *  - 骨长固定（上臂 67 / 前臂 61 / 大腿 108 / 小腿 100 / 躯干 122 / 头 41）。
   *  - 手固定在器械握把上，脚固定在踏板/地面上；肘、膝由两骨 IK 反解，并给“关节应在哪一侧”的提示。
   *  - 器械由同一份 pose 反推：踏板跟着脚走、钢索跟着配重走，接触点不会漂。
   *  - 远侧肢体只做 6–10px 深度偏移，不做第二条腿。
   */
  var W = 960, H = 600;
  var PAPER = '#F4F1EA', INK = '#16171A', ORANGE = '#FF5A1F', RED = '#D92D20';
  var FAR = '#98A0A8', FRAME = '#B8BBC0', PAD = '#E8E2D4', PAD_EDGE = '#A7ACB3';
  var TORSO = 122, ARM = 67, FORE = 61, THIGH = 108, SHIN = 100, HEAD = 41;
  var DEG = Math.PI / 180;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function ease(p) { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function pt(x, y) { return { x: x, y: y }; }
  function add(a, b) { return pt(a.x + b.x, a.y + b.y); }
  function sub(a, b) { return pt(a.x - b.x, a.y - b.y); }
  function mul(a, k) { return pt(a.x * k, a.y * k); }
  function len(a) { return Math.hypot(a.x, a.y); }
  function norm(a) { var l = len(a) || 1; return pt(a.x / l, a.y / l); }
  function perp(a) { return pt(-a.y, a.x); }
  function mix(a, b, t) { return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function polar(c, r, deg) { return pt(c.x + Math.cos(deg * DEG) * r, c.y + Math.sin(deg * DEG) * r); }
  function toward(a, b, d) { return add(a, mul(norm(sub(b, a)), d)); }

  // 两骨 IK，两种解；hint 用来挑“膝朝前上 / 肘朝后下”的那一个
  function ik(aLen, bLen, root, target, bend) {
    var d = dist(root, target);
    var dir = d > 0.001 ? norm(sub(target, root)) : pt(0, -1);
    var reach = clamp(d, Math.abs(aLen - bLen) + 0.01, aLen + bLen - 0.01);
    var end = add(root, mul(dir, reach));
    var x = (reach * reach + aLen * aLen - bLen * bLen) / (2 * reach);
    var h = Math.sqrt(Math.max(0, aLen * aLen - x * x));
    var joint = add(add(root, mul(dir, x)), mul(perp(dir), h * (bend || 1)));
    return { joint: joint, end: end };
  }
  /**
   * 关节弯曲方向。
   *
   * 一个两骨 IK 有两组解（肘/膝落在根-目标连线的两侧）。老做法是每一帧挑“离提示点
   * 更近”的那一组，于是肢体扫过提示点所在直线时两组解的距离会反超，关节瞬间跳到
   * 身体另一侧——看起来就是“大幅度运动时关节朝错误方向甩”。
   *
   * 现在改成：每个动作在 pose 里把自己的弯曲方向写死（eSign / kSign，±1 就是 ik 的
   * bend 参数），整段动画都用同一组符号。只要符号不变，ik() 对 p 是连续的，
   * 关节就不可能中途翻转。
   *
   * 符号是按每个动作「起手姿势」的解剖位置标定的（见 tools/_sign2.mjs 的推导与
   * tests/figures.test.mjs 的回归用例），不是逐帧猜的。
   */
  function pickBend(aLen, bLen, root, target, hint) {
    var a = ik(aLen, bLen, root, target, 1);
    var b = ik(aLen, bLen, root, target, -1);
    return dist(a.joint, hint) <= dist(b.joint, hint) ? 1 : -1;
  }

  // ---------- 绘图基元 ----------
  function line(ctx, a, b, color, w) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color || INK; ctx.lineWidth = w || 5; ctx.lineCap = 'round'; ctx.stroke();
  }
  function rpoly(ctx, pts, r, fill, stroke, lw) {
    var n = pts.length;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
      var rr = Math.min(r, dist(prev, cur) / 2.1, dist(cur, next) / 2.1);
      var a = toward(cur, prev, rr), b = toward(cur, next, rr);
      if (i === 0) ctx.moveTo(a.x, a.y); else ctx.lineTo(a.x, a.y);
      ctx.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function circle(ctx, c, r, fill, stroke, w) {
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w || 3; ctx.stroke(); }
  }
  function ellipse(ctx, c, rx, ry, rot, fill, stroke, w) {
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, rot || 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w || 4; ctx.stroke(); }
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function pad(ctx, a, b, thick, fill) {
    var n = perp(norm(sub(b, a)));
    rpoly(ctx, [
      add(a, mul(n, thick / 2)), add(b, mul(n, thick / 2)),
      add(b, mul(n, -thick / 2)), add(a, mul(n, -thick / 2))
    ], Math.min(9, thick / 2), fill || PAD, PAD_EDGE, 2.4);
  }
  function bar(ctx, a, b, w, color) { line(ctx, a, b, color || FRAME, w || 5); }
  function bolt(ctx, c) { circle(ctx, c, 5, PAPER, '#8F959D', 2.4); circle(ctx, c, 1.6, '#8F959D'); }
  function floorLine(ctx) {
    line(ctx, pt(54, 540), pt(906, 540), '#C8C2B5', 3);
    for (var x = 84; x < 890; x += 42) line(ctx, pt(x, 547), pt(x + 18, 558), '#DDD7C9', 2);
  }
  function label(ctx, text, x, y, color, size) {
    ctx.save();
    ctx.font = '800 ' + (size || 21) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    var w = ctx.measureText(text).width;
    rrect(ctx, x - 11, y - 17, w + 22, 34, 9);
    ctx.fillStyle = color || RED; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }
  function arrow(ctx, from, to, bend, color) {
    color = color || RED;
    var d = sub(to, from);
    var mid = add(mix(from, to, 0.5), mul(perp(norm(d)), bend || 0));
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo(mid.x, mid.y, to.x, to.y);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
    var ang = Math.atan2(to.y - mid.y, to.x - mid.x);
    ctx.beginPath(); ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - 13 * Math.cos(ang - 0.42), to.y - 13 * Math.sin(ang - 0.42));
    ctx.lineTo(to.x - 13 * Math.cos(ang + 0.42), to.y - 13 * Math.sin(ang + 0.42));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function dash(ctx, a, b) {
    ctx.save(); ctx.setLineDash([8, 8]); line(ctx, a, b, RED, 3); ctx.restore();
  }
  function arcMark(ctx, c, r, a0, a1) {
    ctx.save(); ctx.beginPath(); ctx.arc(c.x, c.y, r, a0, a1);
    ctx.strokeStyle = RED; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
  }
  function stack(ctx, x, y, w, h, sel) {
    rrect(ctx, x - 6, y - 8, w + 12, h + 16, 8); ctx.fillStyle = '#FAF8F2'; ctx.fill();
    ctx.strokeStyle = '#C5BFB2'; ctx.lineWidth = 2.4; ctx.stroke();
    line(ctx, pt(x + w / 2, y - 30), pt(x + w / 2, y), FRAME, 4);
    for (var i = 0; i < 7; i++) {
      var yy = y + 10 + i * (h - 20) / 7;
      rrect(ctx, x, yy, w, Math.max(9, (h - 20) / 7 - 4), 3);
      ctx.fillStyle = i === (sel || 3) ? ORANGE : '#EDE8DC'; ctx.fill();
      ctx.strokeStyle = '#CCC6B7'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    var sy = y + 13 + (sel || 3) * (h - 20) / 7;
    line(ctx, pt(x + w, sy), pt(x + w + 16, sy), INK, 6);
  }
  function pulley(ctx, c, r) {
    circle(ctx, c, r || 12, '#FAF8F2', '#8F959D', 3.4);
    circle(ctx, c, 3, '#8F959D');
  }
  function cable(ctx, a, b, w) { line(ctx, a, b, '#9AA0A8', w || 2.6); }

  // ---------- 人体 ----------
  function limb(ctx, a, b, wa, wb, fill, stroke, lw) {
    var n = perp(norm(sub(b, a)));
    rpoly(ctx, [
      add(a, mul(n, wa / 2)), add(b, mul(n, wb / 2)),
      add(b, mul(n, -wb / 2)), add(a, mul(n, -wa / 2))
    ], Math.min(wa, wb) * 0.4, fill, stroke, lw);
  }
  // ankle → toe 为脚背方向，sole 指向“从脚底指向脚背”的一侧
  function foot(ctx, ankle, toe, sole, fill, stroke, lw) {
    var d = norm(sub(toe, ankle)), n = norm(sole);
    var heel = add(ankle, mul(d, -10));
    rpoly(ctx, [
      add(heel, mul(n, 3)), add(toe, mul(n, 3)),
      add(toe, mul(n, -9)), add(heel, mul(n, -10))
    ], 4, fill, stroke, lw || 3);
  }
  // 踩在踏板上的脚：脚底贴住踏板面（法线 rail），脚跟→脚尖沿踏板平面（out）
  function footOnPlate(ctx, ankle, rail, out, fill, stroke, lw) {
    var sole = add(ankle, mul(rail, 7));
    var heel = add(sole, mul(out, -22));
    var toe = add(sole, mul(out, 26));
    rpoly(ctx, [
      heel, toe, add(toe, mul(rail, -21)), add(heel, mul(rail, -23))
    ], 5, fill, stroke, lw || 3.2);
    // 脚背折线
    line(ctx, add(heel, mul(rail, -11)), add(add(heel, mul(out, 16)), mul(rail, -11)), stroke, 1.8);
  }
  function hand(ctx, wrist, dir, fill, stroke, lw) {
    circle(ctx, add(wrist, mul(norm(dir), 4)), 7.4, fill, stroke, lw || 3);
  }
  // 躯干：髋宽、腰略收、胸最宽，末端是肩线
  function torsoShape(ctx, hip, chest, fill, stroke, lw) {
    var up = norm(sub(chest, hip)), n = perp(up), L = dist(hip, chest);
    var pts = [
      add(hip, mul(n, 22)), add(add(hip, mul(up, L * 0.30)), mul(n, 26)),
      add(add(hip, mul(up, L * 0.54)), mul(n, 22)),
      add(add(hip, mul(up, L * 0.78)), mul(n, 24)),
      add(add(chest, mul(up, 2)), mul(n, 27)),
      add(add(chest, mul(up, 2)), mul(n, -26)),
      add(add(hip, mul(up, L * 0.78)), mul(n, -26)),
      add(add(hip, mul(up, L * 0.54)), mul(n, -24)),
      add(add(hip, mul(up, L * 0.30)), mul(n, -27)),
      add(hip, mul(n, -24))
    ];
    rpoly(ctx, pts, 13, fill, stroke, lw || 4.8);
  }
  // 正面躯干：左右对称，肩宽 68、腰 40、髋 48
  function frontTorsoShape(ctx, hip, chest, fill, stroke, lw) {
    var up = norm(sub(chest, hip)), n = perp(up), L = dist(hip, chest);
    var pts = [
      add(hip, mul(n, 24)), add(add(hip, mul(up, L * 0.28)), mul(n, 22)),
      add(add(hip, mul(up, L * 0.55)), mul(n, 20)),
      add(add(hip, mul(up, L * 0.80)), mul(n, 27)),
      add(add(chest, mul(up, 2)), mul(n, 34)),
      add(add(chest, mul(up, 2)), mul(n, -34)),
      add(add(hip, mul(up, L * 0.80)), mul(n, -27)),
      add(add(hip, mul(up, L * 0.55)), mul(n, -20)),
      add(add(hip, mul(up, L * 0.28)), mul(n, -22)),
      add(hip, mul(n, -24))
    ];
    rpoly(ctx, pts, 13, fill, stroke, lw || 4.8);
  }
  function headShape(ctx, c, up, fill, stroke, ghost) {
    var rot = Math.atan2(up.y, up.x) - Math.PI / 2;
    var f = perp(up);
    if (f.x < 0) f = mul(f, -1);
    ellipse(ctx, c, 18, 22.5, rot, fill, stroke, ghost ? 2.4 : 4.4);
    if (ghost) return;
    circle(ctx, add(add(c, mul(f, 8)), mul(up, -3)), 2.7, stroke);
    line(ctx, add(c, mul(f, 15)), add(add(c, mul(f, 19)), mul(up, 3)), stroke, 2.2);
  }

  function body(ctx, pose, ghost) {
    var nF = ghost ? 'rgba(244,241,234,0)' : PAPER;
    var sN = ghost ? 'rgba(255,90,31,.5)' : INK;
    var fF = ghost ? 'rgba(244,241,234,0)' : '#EFEADC';
    // 正面视角两侧对称：远侧也用主色，只是线条略细
    var sF = ghost ? 'rgba(255,90,31,.3)' : (pose.symmetric ? INK : FAR);
    if (pose.symmetric && !ghost) fF = PAPER;
    var lw = ghost ? 2.6 : 5;
    // 远侧
    limb(ctx, pose.hipF, pose.kneeF, 21, 15, fF, sF, lw);
    limb(ctx, pose.kneeF, pose.ankleF, 15, 10.5, fF, sF, lw);
    if (!pose.skipFarFoot) {
      if (pose.frontTorso) footFront(ctx, pose.ankleF, pose.toeF, fF, sF, ghost ? 2 : 2.6);
      else foot(ctx, pose.ankleF, pose.toeF, pose.soleF, fF, sF, ghost ? 2 : 2.6);
    }
    if (!pose.hideFarArm) {
      limb(ctx, pose.shF, pose.elbowF, 17, 13, fF, sF, lw);
      limb(ctx, pose.elbowF, pose.handF, 13, 9.5, fF, sF, lw);
      hand(ctx, pose.handF, sub(pose.handF, pose.elbowF), fF, sF, ghost ? 2 : 2.6);
    }
    // 近侧
    if (pose.frontTorso) frontTorsoShape(ctx, pose.hip, pose.chest, nF, sN, ghost ? 2.8 : 5);
    else torsoShape(ctx, pose.hip, pose.chest, nF, sN, ghost ? 2.8 : 5);
    line(ctx, pose.chest, pose.neck, sN, ghost ? 8 : 11);
    limb(ctx, pose.hipN, pose.kneeN, 25, 17, nF, sN, lw);
    limb(ctx, pose.kneeN, pose.ankleN, 17, 10.5, nF, sN, lw);
    if (!pose.skipFoot) {
      if (pose.frontTorso) footFront(ctx, pose.ankleN, pose.toeN, nF, sN, ghost ? 2 : 3.2);
      else foot(ctx, pose.ankleN, pose.toeN, pose.soleN, nF, sN, ghost ? 2 : 3.2);
    }
    limb(ctx, pose.shN, pose.elbowN, 19, 14, nF, sN, lw);
    limb(ctx, pose.elbowN, pose.handN, 14, 10, nF, sN, lw);
    hand(ctx, pose.handN, sub(pose.handN, pose.elbowN), nF, sN, ghost ? 2 : 3.2);
    headShape(ctx, pose.head, norm(sub(pose.head, pose.neck)), nF, sN, ghost);
    if (!ghost) {
      circle(ctx, pose.shN, 3.2, INK); circle(ctx, pose.hipN, 3.6, INK); circle(ctx, pose.kneeN, 3.2, INK);
    }
  }

  /**
   * 由髋、胸、双手、双脚反解全身。
   * opts.kneeN / kneeF：膝盖应该落在哪一侧的提示点。
   * opts.elbow：肘部提示（默认“在肩手连线后下方”）。
   */
  function rig(hip, chest, hands, ankles, opts) {
    opts = opts || {};
    var up = norm(sub(chest, hip)), n = perp(up);
    // 仰卧类动作头不再沿躯干轴延伸，而是枕在垫上：用 opts.headDir 单独给方向。
    var hd = opts.headDir ? norm(opts.headDir) : up;
    var neck = add(chest, mul(hd, 16));
    var head = add(chest, mul(hd, 44));
    var shN = add(add(chest, mul(up, -4)), mul(n, 2));
    var shF = add(add(chest, mul(up, -10)), mul(n, -3));
    var hipF = add(hip, pt(-7, 5));
    var handN = hands[0], handF = hands[1], ankleN = ankles[0], ankleF = ankles[1];
    // 弯曲方向写死在 pose 里，整段动画不变，所以关节不会中途翻面。
    var eSign = opts.eSign || 1, kSign = opts.kSign || 1;
    var eSignF = opts.eSignF || eSign, kSignF = opts.kSignF || kSign;
    var kneeHintN = opts.kneeN || add(mix(hip, ankleN, 0.5), pt(0, -70));
    var kneeHintF = opts.kneeF || add(kneeHintN, pt(-7, 6));
    var eN = ik(ARM, FORE, shN, handN, eSign);
    var eF = ik(ARM, FORE, shF, handF, eSignF);
    var lN = ik(THIGH, SHIN, hip, ankleN, kSign);
    var lF = ik(THIGH, SHIN, hipF, ankleF, kSignF);
    return {
      hip: hip, chest: chest, neck: neck, head: head, shN: shN, shF: shF,
      elbowN: eN.joint, handN: eN.end, elbowF: eF.joint, handF: eF.end,
      hipN: hip, kneeN: lN.joint, ankleN: lN.end,
      hipF: hipF, kneeF: lF.joint, ankleF: lF.end,
      toeN: add(lN.end, opts.toeN || pt(26, 3)),
      toeF: add(lF.end, opts.toeF || pt(23, 8)),
      soleN: opts.soleN || pt(0, -1),
      soleF: opts.soleF || pt(0, -1),
      signs: { eN: eSign, eF: eSignF, kN: kSign, kF: kSignF },
      hints: { elbow: opts.elbow || pt(-34, 14), kneeN: kneeHintN, kneeF: kneeHintF }
    };
  }
  function mark(ctx, c, bad) {
    var col = bad ? RED : '#8F959D';
    circle(ctx, c, 9, 'rgba(244,241,234,.92)', col, 2);
    circle(ctx, c, 2.4, col);
  }

  /**
   * 正面视角骨架：左右肩、髋对称，双臂双腿各自 IK。
   * 返回的 shN/hipF 等键名与 side view 一致，方便 body()/measure() 复用。
   */
  function rigFront(hip, chest, hands, ankles, opts) {
    opts = opts || {};
    var up = norm(sub(chest, hip)), side = perp(up);
    var neck = add(chest, mul(up, 16));
    var head = add(chest, mul(up, 44));
    // 耸肩 = 肩带整体沿躯干轴向上抬；锁骨和躯干长度都不变，只是肩胛上提。
    var shrug = opts.shrug || 0;
    var shR = add(add(add(chest, mul(up, -4)), mul(side, 24)), mul(up, shrug));
    var shL = add(add(add(chest, mul(up, -4)), mul(side, -24)), mul(up, shrug));
    var hipR = add(hip, mul(side, 15));
    var hipL = add(hip, mul(side, -15));
    // 正面视角：近侧（画面右）与远侧（画面左）手臂的弯曲方向天然相反。
    var eSignR = opts.eSignR || 1, eSignL = opts.eSignL || -eSignR;
    // 透视缩短：手臂朝镜头伸时，投影长度会短于真实臂长。这时要按同样的比例缩短
    // 骨长去解 IK，画出来才是“伸直但看起来短”，而不是把肘折成锐角。
    // autoArmScale 时按当前肩-手投影距离反推比例，手臂始终保持接近伸直。
    var asR = opts.armScale || 1, asL = asR;
    if (opts.autoArmScale) {
      asR = clamp(dist(shR, hands[0]) / (ARM + FORE) * 1.02, 0.3, 1);
      asL = clamp(dist(shL, hands[1]) / (ARM + FORE) * 1.02, 0.3, 1);
    }
    var eR = ik(ARM * asR, FORE * asR, shR, hands[0], eSignR);
    var eL = ik(ARM * asL, FORE * asL, shL, hands[1], eSignL);
    // 站立时膝盖略向外顶，不要向内扣成剪刀腿。
    var kSignR = opts.kSignR || -1, kSignL = opts.kSignL || -kSignR;
    var lR = ik(THIGH, SHIN, hipR, ankles[0], kSignR);
    var lL = ik(THIGH, SHIN, hipL, ankles[1], kSignL);
    return {
      hip: hip, chest: chest, neck: neck, head: head,
      shN: shR, shF: shL, elbowN: eR.joint, handN: eR.end, elbowF: eL.joint, handF: eL.end,
      hipN: hipR, kneeN: lR.joint, ankleN: lR.end,
      hipF: hipL, kneeF: lL.joint, ankleF: lL.end,
      side: side, up: up, symmetric: true, frontTorso: true,
      signs: { eN: eSignR, eF: eSignL, kN: kSignR, kF: kSignL },
      armScaleN: asR, armScaleF: asL,
      hints: { elbow: opts.elbow || pt(30, 30) }
    };
  }
  /**
   * 正面坐姿骨架：大腿朝镜头、被透视压缩，所以膝只比髋低约 46px，
   * 小腿再落到脚踝。骨长在 3D 里不变，这里画的是投影。
   */
  function rigFrontSeated(hip, chest, hands, ankles, opts) {
    opts = opts || {};
    var up = norm(sub(chest, hip)), side = perp(up);
    var neck = add(chest, mul(up, 16));
    var head = add(chest, mul(up, 44));
    var shrug = opts.shrug || 0;
    var shR = add(add(add(chest, mul(up, -4)), mul(side, 24)), mul(up, shrug));
    var shL = add(add(add(chest, mul(up, -4)), mul(side, -24)), mul(up, shrug));
    var hipR = add(hip, mul(side, 15));
    var hipL = add(hip, mul(side, -15));
    var eSignR = opts.eSignR || 1, eSignL = opts.eSignL || -eSignR;
    var asR = opts.armScale || 1, asL = asR;
    if (opts.autoArmScale) {
      asR = clamp(dist(shR, hands[0]) / (ARM + FORE) * 1.02, 0.3, 1);
      asL = clamp(dist(shL, hands[1]) / (ARM + FORE) * 1.02, 0.3, 1);
    }
    var eR = ik(ARM * asR, FORE * asR, shR, hands[0], eSignR);
    var eL = ik(ARM * asL, FORE * asL, shL, hands[1], eSignL);
    var kneeR = pt(hipR.x + 26, hipR.y + 44);
    var kneeL = pt(hipL.x - 26, hipL.y + 44);
    return {
      hip: hip, chest: chest, neck: neck, head: head,
      shN: shR, shF: shL, elbowN: eR.joint, handN: eR.end, elbowF: eL.joint, handF: eL.end,
      hipN: hipR, kneeN: kneeR, ankleN: ankles[0],
      hipF: hipL, kneeF: kneeL, ankleF: ankles[1],
      side: side, up: up, frontTorso: true, seatedFront: true,
      signs: { eN: eSignR, eF: eSignL },
      armScaleN: asR, armScaleF: asL,
      hints: { elbow: opts.elbow || pt(30, 10) }
    };
  }
  function footFront(ctx, ankle, dir, fill, stroke, lw) {
    // 正面看：脚掌朝前，画成一个短椭圆 + 脚趾线
    var d = norm(dir);
    ellipse(ctx, add(ankle, mul(d, 16)), 15, 9,
      Math.atan2(d.y, d.x), fill, stroke, lw || 3);
  }
  // 正面肢体：上臂/前臂/大腿/小腿，粗细与 side view 一致
  function armFront(ctx, sh, elbow, wrist, fill, stroke, w1, w2) {
    limb(ctx, sh, elbow, w1, w1 * 0.72, fill, stroke, 5);
    limb(ctx, elbow, wrist, w2, w2 * 0.72, fill, stroke, 5);
    hand(ctx, wrist, sub(wrist, elbow), fill, stroke, 3.2);
  }
  function legFront(ctx, hip, knee, ankle, fill, stroke) {
    limb(ctx, hip, knee, 25, 17, fill, stroke, 5);
    limb(ctx, knee, ankle, 17, 10.5, fill, stroke, 5);
    footFront(ctx, ankle, pt(0, -1), fill, stroke, 3.2);
  }
  // 正面看的哑铃：握把短棒 + 朝外的一片配重盘（盘面正对镜头，所以是圆）
  function dumbbellEnd(ctx, c, dir, fill) {
    var n = norm(dir);
    var grip = add(c, mul(n, -10));
    line(ctx, grip, add(c, mul(n, 4)), INK, 7);
    circle(ctx, add(c, mul(n, 14)), 11, fill || PAPER, INK, 3.6);
    circle(ctx, add(c, mul(n, 14)), 4, INK);
  }

  // ---------- 高位下拉 ----------
  function pulldownPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(440, 424);
    var lean = -96 - (fault === 1 ? 20 * p : 0);
    var chest = polar(hip, TORSO, lean);
    var q = fault === 3 ? 0.45 * p : p;
    var bar = mix(pt(461, 185), pt(484, 302), q);
    if (fault === 2) bar = mix(pt(461, 193), pt(484, 310), q);
    var hands = [bar, add(bar, pt(-6, 7))];
    var knee = pt(540, 440);
    var ankleN = pt(542, 540);
    var ankleF = pt(531, 537);
    var pose = rig(hip, chest, hands, [ankleN, ankleF], {
      kneeN: knee, kneeF: add(knee, pt(-9, 3)),
      toeN: pt(28, 3), toeF: pt(25, 7),
      soleN: pt(0, -1), soleF: pt(0, -1),
      elbow: pt(46, 22), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
    });
    pose.hideFarArm = true;
    pose.bar = bar;
    if (fault === 2) {
      // 耸肩：肩点整体上提，手臂重新求解
      pose.shN = add(pose.shN, pt(0, 13));
      pose.shF = add(pose.shF, pt(0, 13));
      var a = ik(ARM, FORE, pose.shN, hands[0], 1);
      var b = ik(ARM, FORE, pose.shF, hands[1], 1);
      pose.elbowN = a.joint; pose.handN = a.end;
      pose.elbowF = b.joint; pose.handF = b.end;
    }
    return pose;
  }
  function pulldownEquip(ctx) {
    floorLine(ctx);
    // 机架：顶梁 + 立柱 + 底座
    bar(ctx, pt(452, 74), pt(700, 74), 9);
    bar(ctx, pt(700, 74), pt(700, 528), 8);
    bar(ctx, pt(656, 528), pt(748, 528), 9);
    pulley(ctx, pt(470, 92), 12);
    cable(ctx, pt(482, 96), pt(672, 96));
    line(ctx, pt(672, 96), pt(672, 176), '#9AA0A8', 2.2);
    stack(ctx, 682, 188, 60, 226, 3);
    // 座椅
    // 坐垫只托住臀部，止于髋关节前方，别把大腿埋进垫子里
    pad(ctx, pt(296, 434), pt(472, 434), 18);
    bar(ctx, pt(322, 443), pt(322, 528), 7);
    bar(ctx, pt(452, 443), pt(452, 528), 7);
    bar(ctx, pt(322, 512), pt(452, 512), 6);
  }
  function pulldownFront(ctx, pose) {
    // 大腿压垫：压在近侧大腿上方，另一端连到立柱
    var t = mix(pose.hipN, pose.kneeN, 0.55);
    pad(ctx, pt(t.x - 62, t.y - 19), pt(t.x + 58, t.y - 17), 16);
    bar(ctx, pt(t.x + 58, t.y - 18), pt(700, 402), 6);
    bolt(ctx, pt(700, 402));
  }
  function pulldownDraw(ctx, p, fault, opts) {
    var pose = pulldownPose(p, fault);
    pulldownEquip(ctx);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.55; body(ctx, pulldownPose(p, 0), true); ctx.restore(); }
    // 横杆在手后面，先画杆，再画手
    var h = pose.handN;
    // 钢索必须真的接到杆上：杆顶挂环 → 滑轮
    cable(ctx, pt(470, 104), pt(h.x, h.y - 18));
    circle(ctx, pt(h.x, h.y - 18), 4.2, PAPER, '#8F959D', 2.2);
    rrect(ctx, h.x - 9, h.y - 15, 18, 31, 6); ctx.fillStyle = INK; ctx.fill();
    body(ctx, pose);
    pulldownFront(ctx, pose);
    if (opts && opts.contacts) {
      mark(ctx, pt(440, 434)); mark(ctx, pose.hip); mark(ctx, mix(pose.hipN, pose.kneeN, 0.55));
      mark(ctx, pose.handN); mark(ctx, pose.ankleN);
    }
    if (fault === 1) {
      label(ctx, '后仰借力', 548, 150);
      arrow(ctx, pt(pose.hip.x - 26, pose.hip.y - 58), pt(pose.chest.x - 26, pose.chest.y + 18), -16);
      dash(ctx, pt(pose.hip.x + 4, pose.hip.y), pt(pose.chest.x + 4, pose.chest.y));
      arcMark(ctx, pose.hip, 78, -2.05, -1.35);
    } else if (fault === 2) {
      label(ctx, '耸肩 · 肘后跑', 520, 142);
      arrow(ctx, pt(pose.shN.x + 16, pose.shN.y + 30), pt(pose.shN.x + 16, pose.shN.y - 14), -8);
      dash(ctx, pt(pose.shN.x + 2, pose.shN.y + 28), pt(pose.shN.x + 2, pose.shN.y - 30));
      arcMark(ctx, pose.elbowN, 27, 1.0, 2.6);
    } else if (fault === 3) {
      label(ctx, '半程 · 回放失控', 520, 150);
      dash(ctx, pt(pose.handN.x + 14, pose.handN.y + 16), pt(516, 306));
      arrow(ctx, pt(pose.handN.x + 44, pose.handN.y + 26), pt(528, 300), 12);
      ctx.save(); ctx.globalAlpha = 0.65;
      for (var i = 0; i < 3; i++) line(ctx, pt(pose.handN.x + 58, pose.handN.y + i * 11), pt(pose.handN.x + 82, pose.handN.y - 10 + i * 11), RED, 3);
      ctx.restore();
    }
  }

  // ---------- 腿举（45° 斜推） ----------
  /*
   * 几何：踏板沿一条 45° 滑轨走直线，脚掌整个贴在踏板上；
   * 髋在座垫上不动，膝由 IK 反解；踏板、滑车、钢索都从 ankle 反推，
   * 所以人动多少，踏板就走多少。
   */
  var LP = {
    hip: pt(458, 492),
    lean: -118,
    ankle0: pt(562, 466),
    ankle1: pt(636, 394),
    handle: pt(470, 452)
  };
  function legPressPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(LP.hip.x, LP.hip.y);
    var chest = polar(hip, TORSO, LP.lean);
    var a0 = LP.ankle0, a1 = LP.ankle1;
    var ankle = mix(a0, a1, p);
    if (fault === 3) ankle = mix(a0, add(a1, pt(8, -8)), p);
    if (fault === 1) ankle = add(ankle, pt(0, 5 * p));
    if (fault === 2) {
      // 臀离垫：上背仍贴靠背，髋沿“以胸为圆心、躯干长为半径”的弧向前上滑起，
      // 躯干长度因此保持不变，同时腰椎被迫卷曲。
      var r0 = sub(hip, chest);
      var rot = -14 * p * DEG;
      var lift = pt(0, -3 * p);
      var chest2 = add(chest, lift);
      hip = add(chest2, pt(r0.x * Math.cos(rot) - r0.y * Math.sin(rot),
                             r0.x * Math.sin(rot) + r0.y * Math.cos(rot)));
      chest = chest2;
    }

    var rail = norm(sub(a1, a0));
    var across = perp(rail);
    if (across.y > 0) across = mul(across, -1);   // across 指向上方，脚尖沿它
    var kneeHint = add(mix(hip, ankle, 0.5), pt(-6, -70));

    var pose = rig(hip, chest, [LP.handle, add(LP.handle, pt(9, 7))],
      [ankle, add(ankle, pt(-7, 8))], {
        kneeN: kneeHint, kneeF: add(kneeHint, pt(-9, 9)),
        toeN: mul(across, 26), toeF: mul(across, 24),
        soleN: rail, soleF: rail,
        elbow: pt(-4, 34), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
      });
    pose.rail = rail;
    pose.across = across;
    pose.skipFoot = true;
    pose.skipFarFoot = true;
    pose.ankle0 = a0; pose.ankle1 = a1;
    pose.plate = add(ankle, mul(rail, 10));
    return pose;
  }
  function legPressEquip(ctx, pose) {
    floorLine(ctx);
    var r = pose.rail, c = pose.across;
    bar(ctx, pt(170, 528), pt(860, 528), 9);
    bar(ctx, pt(208, 528), pt(208, 436), 6);
    bar(ctx, pt(836, 528), pt(836, 436), 6);

    // 靠背：贴在躯干背面
    var up = norm(sub(pose.chest, pose.hip));
    var back = mul(perp(up), -1);
    if (back.y < 0) back = mul(back, -1);
    var a = add(add(pose.chest, mul(up, 22)), mul(back, 25));
    var b = add(add(pose.hip, mul(up, -14)), mul(back, 24));
    pad(ctx, a, b, 26);
    bar(ctx, add(b, mul(back, 12)), pt(318, 516), 7);
    bar(ctx, pt(318, 516), pt(318, 528), 7);
    bar(ctx, add(add(a, mul(up, 10)), mul(back, 12)), pt(318, 336), 5);

    // 座垫
    // 座垫面与髋骨齐平（垫面 y=492），臀不会悬空
    pad(ctx, pt(398, 501), pt(534, 501), 18);
    bar(ctx, pt(424, 510), pt(424, 528), 6);
    bar(ctx, pt(518, 510), pt(518, 528), 6);

    // 滑轨：从座垫下方起步，到顶端滑轮，不穿地面
    var base = add(pose.ankle0, mul(r, -34));
    var tip = add(pose.ankle1, mul(r, 92));
    [-1, 1].forEach(function (s) {
      var off = mul(c, s * 40);
      bar(ctx, add(base, off), add(tip, off), 6, '#9AA0A8');
    });
    for (var i = 0; i <= 10; i++) {
      var q = mix(base, tip, i / 10);
      line(ctx, add(q, mul(c, 40)), add(q, mul(c, -40)), '#D2CCBE', 2);
    }
    // 轨道落地支撑
    bar(ctx, add(base, mul(c, 40)), pt(base.x + 34, 528), 7);
    bar(ctx, add(base, mul(c, -40)), pt(base.x + 34, 528), 7);

    // 顶端滑轮 + 配重
    cable(ctx, tip, pt(716, 300));
    pulley(ctx, pt(740, 308), 11);
    cable(ctx, pt(740, 308), pt(772, 308));
    stack(ctx, 778, 316, 52, 166, 4);
  }
  function legPressPlate(ctx, pose) {
    var r = pose.rail, c = pose.across;
    var center = pose.plate;

    // 滑车：沿轨道滚的四只轮子 + 车架
    var car = add(center, mul(r, 18));
    var half = 40;
    [-1, 1].forEach(function (s) {
      bar(ctx, add(car, mul(c, s * half)), add(car, mul(c, s * 26)), 7, '#8F959D');
    });
    [-1, 1].forEach(function (s) {
      circle(ctx, add(add(car, mul(c, s * half)), mul(r, -11)), 8, '#FAF8F2', '#8F959D', 3);
      circle(ctx, add(add(car, mul(c, s * half)), mul(r, 11)), 8, '#FAF8F2', '#8F959D', 3);
    });
    // 钢索从滑车连到顶端
    var tip = add(pose.ankle1, mul(r, 92));
    cable(ctx, add(car, mul(c, half)), tip, 2.2);

    // 踏板：垂直于滑轨，脚掌整面贴住
    pad(ctx, add(center, mul(c, 50)), add(center, mul(c, -50)), 15);
    for (var k = -2; k <= 2; k++) {
      var q = add(center, mul(c, k * 22));
      line(ctx, add(q, mul(r, 9)), add(q, mul(r, -9)), '#C9C2B2', 2);
    }
    // 踏板背面与滑车相连
    bar(ctx, add(add(center, mul(r, 11)), mul(c, 50)),
        add(add(center, mul(r, 11)), mul(c, -50)), 7, '#9AA0A8');
  }
  function legPressDraw(ctx, p, fault, opts) {
    var pose = legPressPose(p, fault);
    legPressEquip(ctx, pose);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.55; body(ctx, legPressPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    legPressPlate(ctx, pose);
    drawSoleFoot(ctx, pose.ankleN, pose.across, pose.rail, PAPER, INK, 3.4);
    // 把手
    rrect(ctx, pose.handN.x - 7, pose.handN.y - 13, 14, 26, 5); ctx.fillStyle = '#4A4E56'; ctx.fill();
    bar(ctx, add(pose.handN, pt(6, 12)), pt(496, 500), 6, '#9AA0A8');

    if (opts && opts.contacts) {
      mark(ctx, add(pose.chest, pt(-16, 20)));
      mark(ctx, pt(pose.hip.x - 6, 462), fault === 2);
      mark(ctx, pose.ankleN);
    }
    if (fault === 1) {
      label(ctx, '膝内扣', 556, 250);
      valgus(ctx, 56, 60);
      arrow(ctx, pt(pose.kneeN.x + 30, pose.kneeN.y - 4), pt(pose.kneeN.x + 6, pose.kneeN.y - 18), -6);
      arrow(ctx, pt(pose.kneeF.x - 24, pose.kneeF.y + 10), pt(pose.kneeF.x + 2, pose.kneeF.y - 4), 6);
    } else if (fault === 2) {
      label(ctx, '臀离垫 · 腰卷起', 452, 240);
      dash(ctx, pt(402, 508), pt(482, 508));
      arrow(ctx, pt(pose.hip.x + 4, pose.hip.y + 16), pt(pose.hip.x + 4, pose.hip.y + 46), -10);
      ctx.save(); ctx.beginPath();
      ctx.moveTo(pose.hip.x - 18, pose.hip.y + 2);
      ctx.quadraticCurveTo(pose.hip.x + 10, pose.hip.y + 26, pose.hip.x + 42, pose.hip.y + 4);
      ctx.strokeStyle = RED; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
    } else if (fault === 3) {
      label(ctx, '锁膝 · 平台砸回', 470, 232);
      ctx.save(); ctx.globalAlpha = 0.65;
      for (var i = 0; i < 3; i++) {
        line(ctx, pt(pose.ankleN.x + 34, pose.ankleN.y - 10 + i * 18),
             pt(pose.ankleN.x + 64, pose.ankleN.y - 18 + i * 18), RED, 4);
      }
      ctx.restore();
      arrow(ctx, pt(pose.ankleN.x + 50, pose.ankleN.y + 54), pt(pose.ankleN.x + 4, pose.ankleN.y + 54), -8);
      dash(ctx, pose.ankle0, pose.ankle1);
    }
  }
  // 脚底贴住踏板：sole 面沿 across，脚背朝 rail 反方向
  function drawSoleFoot(ctx, ankle, across, rail, fill, stroke, lw) {
    // 脚掌沿 rail 方向伸向踏板外侧，脚底（sole）朝 +rail，压在板面上
    var sole = add(ankle, mul(rail, 2));
    var heel = add(sole, mul(rail, -22));
    var toe = add(sole, mul(rail, 30));
    var n = mul(across, -1);
    rpoly(ctx, [
      add(heel, mul(n, 6)), add(toe, mul(n, 4)),
      add(toe, mul(n, -14)), add(heel, mul(n, -22))
    ], 5, fill, stroke, lw || 3.2);
    line(ctx, add(add(heel, mul(n, -12)), mul(rail, 6)),
         add(add(heel, mul(n, -12)), mul(rail, 22)), stroke, 1.8);
  }





  function valgus(ctx, x, y) {
    rrect(ctx, x, y, 166, 110, 10); ctx.fillStyle = '#FBF9F3'; ctx.fill();
    ctx.strokeStyle = '#C9C2B2'; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.font = '700 12px "Microsoft YaHei",sans-serif'; ctx.fillStyle = '#6B7078';
    ctx.fillText('正面 · 膝位', x + 10, y + 18); ctx.restore();
    line(ctx, pt(x + 50, y + 96), pt(x + 50, y + 60), INK, 6);
    line(ctx, pt(x + 50, y + 60), pt(x + 77, y + 45), INK, 6);
    line(ctx, pt(x + 114, y + 96), pt(x + 114, y + 60), INK, 6);
    line(ctx, pt(x + 114, y + 60), pt(x + 87, y + 45), INK, 6);
    arrow(ctx, pt(x + 67, y + 55), pt(x + 85, y + 43), -4);
    arrow(ctx, pt(x + 97, y + 55), pt(x + 85, y + 43), 4);
    label(ctx, '内扣', x + 106, y + 28, RED, 13);
  }

  // ---------- 臀桥机 ----------
  /*
   * 机器结构：上背垫固定（肩是支点），脚踩在踏台上，髋向上推。
   * 髋垫挂在双连杆摆臂末端，末端轨迹跟着髋走，所以垫面始终压在髋骨上方；
   * 摆臂根部枢轴在立柱顶部，钢索从摆臂绕到后方配重塔。
   */
  var GM = {
    sh: pt(354, 330),
    ankle: pt(578, 490),
    pivot: pt(520, 512),
    hipLow: 48,
    hipHigh: 19
  };
  function glutePose(p, fault) {
    p = clamp(p, 0, 1);
    var a0 = GM.hipLow, a1 = GM.hipHigh;
    if (fault === 1) a1 = 6;
    if (fault === 3) a1 = 2;
    var t = (fault === 1 || fault === 3) ? Math.pow(p, 1.15) : p;
    var ang = lerp(a0, a1, t);
    var chest = GM.sh;
    if (fault === 1) {
      // 用腰顶：上背沿垫面向后滑一点，胸廓被顶起，骨盆跟着抬得更高
      chest = add(GM.sh, pt(-7 * p, -3 * p));
    }
    var hip = polar(chest, TORSO, ang);

    var ankle = pt(GM.ankle.x, GM.ankle.y);
    if (fault === 2) ankle = pt(640, 474);
    var kneeHint = add(mix(hip, ankle, 0.5), pt(22, -58));

    var pose = rig(hip, chest, [pt(392, 412), pt(404, 419)],
      [ankle, add(ankle, pt(9, 6))], {
        kneeN: kneeHint, kneeF: add(kneeHint, pt(-9, 8)),
        toeN: pt(30, 2), toeF: pt(27, 7),
        soleN: pt(0, -1), soleF: pt(0, -1),
        elbow: pt(4, 32), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
      });
    pose.alpha = ang;
    pose.hipPad = add(hip, pt(4, -32));
    return pose;
  }
  function gluteEquip(ctx, pose) {
    floorLine(ctx);
    bar(ctx, pt(180, 528), pt(862, 528), 9);
    // 配重塔底座：立柱从配重下方直落到地面
    bar(ctx, pt(780, 448), pt(780, 528), 9);
    bar(ctx, pt(746, 528), pt(814, 528), 9);

    // 立柱（滑架导轨的支撑）
    bar(ctx, pt(292, 250), pt(292, 528), 8);
    bar(ctx, pt(262, 528), pt(326, 528), 9);

    // 上背垫：固定件，沿起始躯干背面（肩胛到腰上方），垫面不压进身体
    var upB = norm(sub(GM.sh, polar(GM.sh, TORSO, GM.hipLow)));
    var backB = mul(perp(upB), -1);
    if (backB.x > 0) backB = mul(backB, -1);      // 背面朝左
    var padC = add(add(pose.chest, mul(backB, 26)), mul(upB, -12));
    pad(ctx, add(padC, mul(upB, 30)), add(padC, mul(upB, -46)), 28);
    bar(ctx, add(add(padC, mul(upB, -40)), mul(backB, 16)), pt(292, 470), 7);

    // 踏台
    pad(ctx, pt(532, 502), pt(672, 502), 14);
    bar(ctx, pt(558, 510), pt(558, 524), 7);
    bar(ctx, pt(646, 510), pt(646, 524), 7);

    // 握把：底座立柱直上，握把正好落在 handN 位置
    bar(ctx, pt(392, 528), pt(392, 420), 7);
    rrect(ctx, 375, 398, 34, 17, 6); ctx.fillStyle = '#4A4E56'; ctx.fill();

    // 配重塔：塔顶滑轮与顶梁同高（y=250），钢索水平过去，不出现折角
    pulley(ctx, pt(780, 250), 11);
    stack(ctx, 754, 280, 52, 168, 2);

  }
  /* 髋垫吊在顶部悬臂的竖直滑杆下，垫面始终压住髋骨；
     滑杆从头顶上方下来，不穿过躯干；钢索沿顶梁走，再下到配重塔。 */
  function gluteArm(ctx, pose) {
    var pc = pose.hipPad;
    var railX = pc.x;
    // 顶梁：立柱顶 → 髋垫正上方
    bar(ctx, pt(292, 250), pt(railX, 250), 8);
    // 竖直滑杆：外套管 + 伸出杆
    bar(ctx, pt(railX, 250), pt(railX, pc.y - 36), 13, '#5E646C');
    bar(ctx, pt(railX, pc.y - 38), pt(railX, pc.y), 8, '#9AA0A8');
    // 钢索：沿顶梁一直水平走到塔顶滑轮，全程不折角
    cable(ctx, pt(railX, 250), pt(769, 250), 2.4);
  }
  function glutePad(ctx, pose) {
    var pc = pose.hipPad;
    var up = norm(sub(pose.chest, pose.hip));
    var n = perp(up);
    // 髋垫只压髋骨前缘，长度控制在约一个髋宽，别盖到大腿中段
    pad(ctx, add(pc, mul(n, -30)), add(pc, mul(n, 30)), 19);
  }
  function gluteDraw(ctx, p, fault, opts) {
    var pose = glutePose(p, fault);
    gluteEquip(ctx, pose);
    gluteArm(ctx, pose);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.55; body(ctx, glutePose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    glutePad(ctx, pose);
    if (opts && opts.contacts) {
      mark(ctx, add(pose.chest, pt(-14, 16)));
      mark(ctx, pose.ankleN);
      mark(ctx, pose.hipPad);
    }
    if (fault === 1) {
      label(ctx, '用腰顶 · 肋骨外翻', 470, 190);
      arrow(ctx, pt(pose.hip.x - 4, pose.hip.y + 2), pt(pose.chest.x + 26, pose.chest.y + 18), -14);
      ctx.save(); ctx.beginPath();
      ctx.moveTo(pose.hip.x - 16, pose.hip.y - 26);
      ctx.quadraticCurveTo(pose.hip.x + 26, pose.hip.y - 40, pose.chest.x + 10, pose.chest.y + 18);
      ctx.strokeStyle = RED; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
      arcMark(ctx, pose.hip, 40, -2.5, -1.0);
    } else if (fault === 2) {
      label(ctx, '膝内扣 · 脚位过远', 436, 200);
      valgus(ctx, 62, 372);
      arrow(ctx, pt(pose.kneeN.x + 26, pose.kneeN.y + 16), pt(pose.kneeN.x + 2, pose.kneeN.y - 4), 8);
      dash(ctx, pt(532, 510), pt(586, 510));
    } else if (fault === 3) {
      label(ctx, '幅度过大 · 顶端失控', 448, 172);
      dash(ctx, pt(346, 320), pt(560, 300));
      arrow(ctx, pt(pose.hip.x + 4, pose.hip.y - 10), pt(pose.hip.x + 16, pose.hip.y - 44), -8);
      ctx.save(); ctx.globalAlpha = 0.6;
      for (var i = 0; i < 3; i++) {
        line(ctx, pt(pose.hip.x - 4 + i * 12, pose.hip.y - 46), pt(pose.hip.x - 12 + i * 12, pose.hip.y - 72), RED, 3);
      }
      ctx.restore();
    }
  }


  // ---------- 通用：肩点移动后重新解手臂 ----------
  // 肩点移动后重新解手臂：沿用 pose 已经标定好的弯曲方向，不再重新“就近”选解。
  function reArm(pose, hands) {
    var s = pose.signs;
    var a = ik(ARM, FORE, pose.shN, hands[0], s.eN);
    var b = ik(ARM, FORE, pose.shF, hands[1], s.eF);
    pose.elbowN = a.joint; pose.handN = a.end;
    pose.elbowF = b.joint; pose.handF = b.end;
  }
  function dumbbellAt(ctx, c, ang, s) {
    s = s || 1;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(ang || 0); ctx.scale(s, s);
    line(ctx, pt(-24, 0), pt(24, 0), INK, 5);
    rrect(ctx, -36, -11, 11, 22, 4); ctx.fillStyle = '#4A4E56'; ctx.fill();
    rrect(ctx, 25, -11, 11, 22, 4); ctx.fillStyle = '#4A4E56'; ctx.fill();
    ctx.restore();
  }

  // ---------- 胸支撑器械划船（侧，坐姿靠胸垫） ----------
  var ROW = {
    hip: pt(386, 470), lean: -62,
    ankle: pt(566, 526),
    hand0: pt(556, 362), hand1: pt(492, 396),
    // 握把 → 前立柱低轮 → 立柱顶轮 → 横向 → 配重塔顶轮 → 配重
    pulley: pt(688, 400), topA: pt(688, 186), topB: pt(772, 186), stackX: 772
  };
  function rowPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(ROW.hip.x, ROW.hip.y);
    // 用腰后仰：躯干绕髋立起来、胸口离开胸垫（角度往 -90° 走）
    var lean = ROW.lean - (fault === 1 ? 13 * p : 0);
    var chest = polar(hip, TORSO, lean);
    var q = fault === 3 ? 0.45 * p : p;
    var hand = mix(ROW.hand0, ROW.hand1, q);
    if (fault === 2) hand = add(hand, pt(0, 4));
    var hands = [hand, add(hand, pt(-9, 6))];
    var ankle = pt(ROW.ankle.x, ROW.ankle.y);
    var pose = rig(hip, chest, hands, [ankle, add(ankle, pt(-9, -3))], {
      kneeN: pt(496, 452), kneeF: pt(488, 458),
      toeN: pt(22, 5), toeF: pt(20, 9),
      elbow: pt(0, 42), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
    });
    if (fault === 2) {
      pose.shN = add(pose.shN, pt(0, 13));
      pose.shF = add(pose.shF, pt(0, 13));
      reArm(pose, hands);
    }
    pose.hand = hand;
    return pose;
  }
  function rowEquip(ctx) {
    floorLine(ctx);
    // 机架
    bar(ctx, pt(300, 150), pt(786, 150), 9);
    bar(ctx, pt(300, 150), pt(300, 528), 8);
    bar(ctx, pt(786, 150), pt(786, 528), 8);
    bar(ctx, pt(268, 528), pt(332, 528), 9);
    bar(ctx, pt(754, 528), pt(818, 528), 9);
    // 座椅
    pad(ctx, pt(344, 486), pt(456, 486), 18);
    bar(ctx, pt(368, 495), pt(368, 528), 7);
    bar(ctx, pt(440, 495), pt(440, 528), 7);
    // 胸垫（固定件）：贴在胸前，从锁骨下沿到腹上，由立柱短臂托住
    var base = rowPose(0, 0);
    var up = norm(sub(base.chest, base.hip));
    var front = perp(up);
    if (front.y < 0) front = mul(front, -1);
    var c0 = add(add(base.chest, mul(front, 27)), mul(up, 22));
    var c1 = add(add(base.chest, mul(front, 27)), mul(up, -62));
    pad(ctx, c0, c1, 22);
    // 胸垫从上方顶梁吊下来一根立柱，绕开身体，不从躯干中间穿过去
    var hangX = add(c0, mul(front, 6)).x;
    bar(ctx, pt(hangX, 150), pt(hangX, add(c0, mul(front, 6)).y), 8);
    bar(ctx, pt(hangX, add(c0, mul(front, 6)).y), add(c1, mul(front, 6)), 7);
    bolt(ctx, pt(hangX, 150));
    // 脚踏：与地面齐平的防滑板
    pad(ctx, pt(516, 522), pt(624, 522), 12);
    // 前立柱：从顶梁落到地面，低轮装在 400 高度
    bar(ctx, pt(ROW.pulley.x, 150), pt(ROW.pulley.x, 528), 8, '#B8BBC0');
    bar(ctx, pt(ROW.pulley.x - 16, 528), pt(ROW.pulley.x + 16, 528), 8, '#B8BBC0');
    pulley(ctx, ROW.pulley, 10);
    pulley(ctx, ROW.topA, 10);
    pulley(ctx, ROW.topB, 10);
    // 钢索：握把 → 低轮 → 沿立柱上到顶轮 → 横向 → 塔顶轮 → 配重
    cable(ctx, pt(ROW.pulley.x, ROW.pulley.y - 10), pt(ROW.topA.x, ROW.topA.y + 10), 2.4);
    cable(ctx, pt(ROW.topA.x + 10, ROW.topA.y), pt(ROW.topB.x - 10, ROW.topB.y), 2.4);
    cable(ctx, pt(ROW.topB.x, ROW.topB.y + 10), pt(ROW.stackX, ROW.topB.y + 30), 2.4);
    stack(ctx, ROW.stackX - 27, ROW.topB.y + 30, 54, 180, 3);
  }
  function rowDraw(ctx, p, fault, opts) {
    var pose = rowPose(p, fault);
    rowEquip(ctx);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.55; body(ctx, rowPose(p, 0), true); ctx.restore(); }
    var h = pose.hand;
    cable(ctx, add(h, pt(7, 7)), ROW.pulley, 2.4);
    body(ctx, pose);
    rrect(ctx, h.x - 12, h.y - 9, 24, 18, 5); ctx.fillStyle = INK; ctx.fill();
    if (opts && opts.contacts) {
      mark(ctx, add(pose.chest, mul(norm(sub(pose.chest, pose.hip)), 18)));
      mark(ctx, pose.hip);
      mark(ctx, pose.ankleN);
      mark(ctx, h);
    }
    if (fault === 1) {
      label(ctx, '用腰后仰借力', 470, 232);
      arrow(ctx, pt(pose.hip.x - 20, pose.hip.y - 72), pt(pose.chest.x - 42, pose.chest.y + 10), -14);
      arcMark(ctx, pose.hip, 86, -1.75, -1.05);
    } else if (fault === 2) {
      label(ctx, '耸肩 · 肘掉下去', 452, 208);
      arrow(ctx, pt(pose.shN.x + 16, pose.shN.y + 30), pt(pose.shN.x + 16, pose.shN.y - 12), -8);
      dash(ctx, pt(pose.shN.x, pose.shN.y + 26), pt(pose.shN.x, pose.shN.y - 26));
    } else if (fault === 3) {
      label(ctx, '半程 · 手没到腹部', 452, 226);
      dash(ctx, pose.handN, ROW.hand1);
      arrow(ctx, pt(ROW.hand1.x + 34, ROW.hand1.y + 6), pt(ROW.hand1.x + 6, ROW.hand1.y + 2), 8);
    }
  }

  // ---------- 哑铃平板卧推（侧，仰卧） ----------
  /*
   * 平凳 + 仰卧 + 双脚踩地。躯干水平，肩在胸点上方；手沿一条竖直线上下推哑铃，
   * 肘由 IK 反解，所以起点屈肘、顶点接近伸直。没有器械导轨，接触点只有凳子与地面。
   */
  var DBB = {
    hip: pt(500, 420), chest: pt(378, 420),
    ankle: pt(620, 540),
    hand0: pt(392, 330), hand1: pt(396, 292)
  };
  function dbBenchPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(DBB.hip.x, DBB.hip.y);
    var chest = pt(DBB.chest.x, DBB.chest.y);
    var q = fault === 2 ? 0.5 * p : p;
    // 错误 3：推到顶端时轨迹往头侧漂，哑铃没有停在肩正上方，肩前侧被顶开
    var hand = mix(DBB.hand0, fault === 3 ? add(DBB.hand1, pt(-52, 10)) : DBB.hand1, q);
    var far = add(hand, pt(4, -9));
    var ankle = pt(DBB.ankle.x, DBB.ankle.y);
    var pose = rig(hip, chest, [hand, far], [ankle, add(ankle, pt(-6, -4))], {
      kneeN: pt(600, 470), kneeF: pt(592, 474),
      toeN: pt(26, 2), toeF: pt(23, 6),
      elbow: pt(0, 44), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
    });
    if (fault === 1) {
      pose.shN = add(pose.shN, pt(-6, -13));
      pose.shF = add(pose.shF, pt(-4, -10));
      reArm(pose, [hand, far]);
    }
    pose.hand = hand;
    return pose;
  }
  function dbBenchEquip(ctx) {
    floorLine(ctx);
    // 平凳：凳面与躯干平行，四条腿落地
    pad(ctx, pt(286, 436), pt(670, 436), 24);
    bar(ctx, pt(330, 448), pt(330, 528), 8);
    bar(ctx, pt(624, 448), pt(624, 528), 8);
    bar(ctx, pt(300, 520), pt(654, 520), 7);
  }
  function dbBenchDraw(ctx, p, fault, opts) {
    var pose = dbBenchPose(p, fault);
    dbBenchEquip(ctx);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.55; body(ctx, dbBenchPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    dumbbellAt(ctx, pose.handN, 0, 0.66);
    dumbbellAt(ctx, pose.handF, 0, 0.56);
    if (opts && opts.contacts) {
      mark(ctx, pose.shN);
      mark(ctx, pose.hip);
      mark(ctx, pose.ankleN);
      mark(ctx, pose.handN);
    }
    if (fault === 1) {
      label(ctx, '耸肩 · 肩前顶', 520, 300);
      arrow(ctx, pt(pose.shN.x + 10, pose.shN.y + 30), pt(pose.shN.x + 10, pose.shN.y - 14), -8);
      dash(ctx, pt(pose.shN.x + 2, pose.shN.y + 28), pt(pose.shN.x + 2, pose.shN.y - 26));
    } else if (fault === 2) {
      label(ctx, '半程 · 肘没伸直', 512, 300);
      dash(ctx, DBB.hand1, pose.handN);
      arrow(ctx, pt(pose.handN.x + 22, pose.handN.y - 6), pt(DBB.hand1.x + 12, DBB.hand1.y - 2), -8);
    } else if (fault === 3) {
      label(ctx, '轨迹朝头偏 · 肩前顶', 480, 296);
      dash(ctx, pt(pose.shN.x, pose.shN.y - 40), pt(pose.shN.x, pose.shN.y - 130));
      arrow(ctx, pt(pose.handN.x + 18, pose.handN.y - 4), pt(pose.handN.x - 22, pose.handN.y + 8), -8);
      arcMark(ctx, pose.shN, 26, -1.4, 0.4);
    }
  }

  // ---------- 哑铃侧平举（正面） ----------
  var LAT = {
    hip: pt(480, 336), chest: pt(480, 214),
    ankleR: pt(506, 540), ankleL: pt(454, 540),
    // 起始：手臂自然下垂（肩到手约 124 < 臂展 128）；顶端：手腕与肩同高、外展约 122
    handR0: pt(508, 328), handR1: pt(630, 206),
    handL0: pt(452, 328), handL1: pt(330, 206)
  };
  function lateralPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(LAT.hip.x, LAT.hip.y);
    var chest = pt(LAT.chest.x, LAT.chest.y);
    // 甩起来：躯干前后晃，行程前段靠惯性把哑铃抛上去。
    // 用 1-(1-p)^k 而不是 p^0.55：后者在 p=0 处导数为无穷，起手一帧会跳一下。
    var q = fault === 2 ? 1 - Math.pow(1 - p, 2.4) : p;
    // 顶端超过肩：多加 12% 行程
    var over = fault === 3 ? 1.12 : 1;
    var t = clamp(q * over, 0, 1.12);
    /*
     * 侧平举是“手臂绕肩外展”，手腕走的是以肩为圆心的圆弧，不是起点到终点的直线。
     * 直线插值会在中段把肱骨和前臂折成锐角（肘高过手背），看起来像被折断。
     * 这里改成角度插值：半径固定为臂展，手腕始终在同一个圆上滑。
     */
    var up0 = norm(sub(chest, hip)), side0 = perp(up0);
    var shR0 = add(add(chest, mul(up0, -4)), mul(side0, 24));
    var shL0 = add(add(chest, mul(up0, -4)), mul(side0, -24));
    var R = ARM + FORE - 1.2;
    var aR0 = Math.atan2(LAT.handR0.y - shR0.y, LAT.handR0.x - shR0.x);
    var aR1 = Math.atan2(LAT.handR1.y - shR0.y, LAT.handR1.x - shR0.x);
    /*
     * 远侧手臂不要单独 atan2：atan2 的结果绕在 ±π，两侧各算各的会在 p≈0.5 时
     * 差出一整圈，远侧手就绕着头顶飞过去。左右本来就是屏幕镜像，直接镜像角度。
     */
    var aL0 = Math.PI - aR0, aL1 = Math.PI - aR1;
    var handR = pt(shR0.x + Math.cos(lerp(aR0, aR1, t)) * R, shR0.y + Math.sin(lerp(aR0, aR1, t)) * R);
    var handL = pt(shL0.x + Math.cos(lerp(aL0, aL1, t)) * R, shL0.y + Math.sin(lerp(aL0, aL1, t)) * R);
    var shrug = fault === 1 ? 13 * q : 0;
    // 甩起来：躯干绕髋前后晃（纯旋转，骨长不变），前段靠惯性把哑铃抛上去
    if (fault === 2) {
      var u = norm(sub(chest, hip));
      var sw = 9 * p * DEG;
      chest = add(hip, mul(pt(u.x * Math.cos(sw) - u.y * Math.sin(sw),
                              u.x * Math.sin(sw) + u.y * Math.cos(sw)), TORSO));
    }
    var pose = rigFront(hip, chest, [handR, handL],
      [pt(LAT.ankleR.x, LAT.ankleR.y), pt(LAT.ankleL.x, LAT.ankleL.y)], {
        elbow: pt(20, 16), shrug: shrug, eSignR: 1, eSignL: -1,
        armScale: 0.995
      });
    pose.toeN = pt(0, -1); pose.toeF = pt(0, -1);
    pose.hands = [handR, handL];
    pose.over = t;
    pose.symmetric = false;
    return pose;
  }
  function lateralDraw(ctx, p, fault, opts) {
    var pose = lateralPose(p, fault);
    floorLine(ctx);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, lateralPose(p, 0), true); ctx.restore(); }
    // 正面视角：两侧对称，所以两条手臂都用主色画（远侧略细）
    armFront(ctx, pose.shF, pose.elbowF, pose.handF, '#EFEADC', FAR, 17, 13);
    legFront(ctx, pose.hipF, pose.kneeF, pose.ankleF, '#EFEADC', FAR);
    frontTorsoShape(ctx, pose.hip, pose.chest, PAPER, INK, 5);
    line(ctx, pose.chest, pose.neck, INK, 11);
    armFront(ctx, pose.shN, pose.elbowN, pose.handN, PAPER, INK, 19, 14);
    legFront(ctx, pose.hipN, pose.kneeN, pose.ankleN, PAPER, INK);
    headShape(ctx, pose.head, pose.up, PAPER, INK, false);
    circle(ctx, pose.neck, 3, INK); circle(ctx, pose.hip, 3.4, INK);
    // 哑铃：握把在手上，配重盘朝外
    dumbbellEnd(ctx, pose.handN, sub(pose.handN, pose.elbowN), PAPER);
    dumbbellEnd(ctx, pose.handF, sub(pose.handF, pose.elbowF), '#EFEADC');
    if (opts && opts.contacts) { mark(ctx, pose.handN); mark(ctx, pose.handF); }
    var shH = 208;
    if (fault === 1) {
      label(ctx, '耸肩 · 斜方肌代偿', 612, 150);
      arrow(ctx, pt(pose.shN.x + 34, pose.shN.y - 4), pt(pose.shN.x + 34, pose.shN.y - 30), -8);
      dash(ctx, pt(pose.shN.x + 20, pose.shN.y + 8), pt(pose.shN.x + 20, pose.shN.y - 34));
      dash(ctx, pt(300, shH), pt(660, shH));
    } else if (fault === 2) {
      label(ctx, '甩起来 · 靠惯性', 592, 140);
      arrow(ctx, pt(pose.handN.x + 10, pose.handN.y + 60), pt(pose.handN.x + 26, pose.handN.y - 6), -20);
      ctx.save(); ctx.globalAlpha = 0.6;
      for (var i = 0; i < 3; i++) line(ctx, pt(pose.handN.x + 44, pose.handN.y + 26 + i * 14), pt(pose.handN.x + 66, pose.handN.y + 10 + i * 14), RED, 3);
      ctx.restore();
      arcMark(ctx, pt(pose.shN.x + 6, pose.shN.y + 20), 78, -1.5, -0.2);
    } else if (fault === 3) {
      label(ctx, '超过肩 · 肘高于腕', 552, 132);
      dash(ctx, pt(300, shH), pt(660, shH));
      arrow(ctx, pt(pose.handN.x - 10, pose.handN.y + 14), pt(pose.handN.x - 10, pose.handN.y - 30), -8);
      arcMark(ctx, pose.elbowN, 26, -0.6, 1.4);
    }
  }

  // ---------- 反向蝴蝶机（正面） ----------
  var RF = {
    hip: pt(480, 396), chest: pt(480, 280),
    ankleR: pt(534, 540), ankleL: pt(426, 540),
    // 肩在 (504,284)/(456,284)，臂展 128。
    // 起始：手在体侧偏前下（肩-手 ≈ 74，肘约 95°）；终点：手臂侧展接近伸直（≈ 124）。
    // 距离留 4px 余量，IK 才不会因为“够不着”把肘折成尖角。
    hand0R: pt(534, 352), hand0L: pt(426, 352),
    hand1R: pt(628, 286), hand1L: pt(332, 286)
  };
  function reverseFlyPose(p, fault) {
    p = clamp(p, 0, 1);
    var q = fault === 3 ? 0.45 * p : p;
    var hip = pt(RF.hip.x, RF.hip.y);
    var chest = pt(RF.chest.x, RF.chest.y);
    var handR = mix(RF.hand0R, RF.hand1R, q);
    var handL = mix(RF.hand0L, RF.hand1L, q);
    if (fault === 2) {
      // 屈肘下拉：手往身体下方掉，肘弯得更多
      handR = add(handR, pt(-14 * q, 26 * q));
      handL = add(handL, pt(14 * q, 26 * q));
    }
    var shrug = fault === 1 ? 12 * q : 0;
    var pose = rigFrontSeated(hip, chest, [handR, handL],
      [pt(RF.ankleR.x, RF.ankleR.y), pt(RF.ankleL.x, RF.ankleL.y)], {
        elbow: pt(30, 10), shrug: shrug, eSignR: 1, eSignL: -1
      });
    pose.toeN = pt(0, -1); pose.toeF = pt(0, -1);
    pose.frontTorso = true;
    pose.symmetric = false;
    pose.hands = [handR, handL];
    return pose;
  }
  function reverseFlyDraw(ctx, p, fault, opts) {
    var pose = reverseFlyPose(p, fault);
    floorLine(ctx);
    // 胸垫：正面看是一块竖着的方垫，画在身体后面，从两侧露出边
    rrect(ctx, 414, 246, 132, 168, 16); ctx.fillStyle = PAD; ctx.fill();
    ctx.strokeStyle = PAD_EDGE; ctx.lineWidth = 2.4; ctx.stroke();
    // 座椅
    pad(ctx, pt(404, 410), pt(556, 410), 18);
    bar(ctx, pt(428, 419), pt(428, 528), 7);
    bar(ctx, pt(532, 419), pt(532, 528), 7);
    bar(ctx, pt(404, 528), pt(556, 528), 8);
    // 两侧把手：从机架伸到手上
    [[pose.handN, 1], [pose.handF, -1]].forEach(function (pair) {
      var h = pair[0], s = pair[1];
      bar(ctx, pt(480 + s * 176, h.y + 6), add(h, pt(s * 14, 0)), 8, '#9AA0A8');
      circle(ctx, add(h, pt(s * 14, 0)), 4, '#8F959D');
    });
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, reverseFlyPose(p, 0), true); ctx.restore(); }
    armFront(ctx, pose.shF, pose.elbowF, pose.handF, '#EFEADC', FAR, 17, 13);
    legFront(ctx, pose.hipF, pose.kneeF, pose.ankleF, '#EFEADC', FAR);
    frontTorsoShape(ctx, pose.hip, pose.chest, PAPER, INK, 5);
    line(ctx, pose.chest, pose.neck, INK, 11);
    armFront(ctx, pose.shN, pose.elbowN, pose.handN, PAPER, INK, 19, 14);
    legFront(ctx, pose.hipN, pose.kneeN, pose.ankleN, PAPER, INK);
    headShape(ctx, pose.head, pose.up, PAPER, INK, false);
    rrect(ctx, pose.handN.x - 8, pose.handN.y - 16, 16, 32, 5); ctx.fillStyle = INK; ctx.fill();
    rrect(ctx, pose.handF.x - 7, pose.handF.y - 15, 14, 30, 5); ctx.fillStyle = '#4A4E56'; ctx.fill();
    if (opts && opts.contacts) {
      mark(ctx, add(pose.chest, pt(0, 18))); mark(ctx, pose.hip);
      mark(ctx, pose.ankleN); mark(ctx, pose.ankleF);
    }
    if (fault === 1) {
      label(ctx, '耸肩 · 斜方肌代偿', 590, 168);
      arrow(ctx, pt(pose.shN.x + 40, pose.shN.y + 22), pt(pose.shN.x + 40, pose.shN.y - 16), -8);
      dash(ctx, pt(pose.shN.x + 26, pose.shN.y + 20), pt(pose.shN.x + 26, pose.shN.y - 24));
    } else if (fault === 2) {
      label(ctx, '屈肘下拉 · 背阔代偿', 566, 182);
      arcMark(ctx, pose.elbowN, 26, 0.2, 2.2);
      arrow(ctx, pt(pose.handN.x + 26, pose.handN.y + 34), pt(pose.handN.x + 10, pose.handN.y + 12), 8);
    } else if (fault === 3) {
      label(ctx, '半程 · 只开到一半', 560, 176);
      dash(ctx, pose.handN, RF.hand1R);
      arrow(ctx, pt(RF.hand1R.x + 18, RF.hand1R.y + 26), pt(RF.hand1R.x + 6, RF.hand1R.y + 6), -6);
    }
  }

  // ---------- 坐姿器械肩推（侧） ----------
  // 椅背再往后靠一点（100°），手才能在头两侧上下走，不与脸/头重叠。
  var SP = {
    hip: pt(452, 470), lean: -100, ankle: pt(520, 540),
    // 起始：手在耳侧（肘约 85°）；顶端：手推到头顶正上方（肩到手 124 < 128 臂展）
    hand0: pt(524, 296), hand1: pt(494, 226)
  };
  function shoulderPressPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(SP.hip.x, SP.hip.y);
    // 顶腰：胸廓向后上方顶起，腰椎前凸
    var lean = SP.lean - (fault === 1 ? 8 * p : 0);
    var chest = polar(hip, TORSO, lean);
    var q = fault === 2 ? 0.55 * p : p;
    var hand = mix(SP.hand0, SP.hand1, q);
    if (fault === 1) hand = add(hand, pt(-10 * p, -4 * p));
    // 错误 3：肘向两侧张开，手被带到头后上方（侧视里手比正确位置更靠后）
    if (fault === 3) hand = add(hand, pt(-16 * q, -8 * q));
    var hands = [hand, add(hand, pt(-7, 7))];
    var ankle = pt(SP.ankle.x, SP.ankle.y);
    var pose = rig(hip, chest, hands, [ankle, add(ankle, pt(-8, -2))], {
      kneeN: pt(496, 486), kneeF: pt(488, 490),
      toeN: pt(26, 2), toeF: pt(23, 7),
      // 肘在手腕外下方；错误 3 是肘向外张开、抬到与手同高（侧视表现为肘往前上翻）
      elbow: fault === 3 ? pt(30 + 26 * q, 30 - 34 * q) : pt(30, 30),
      eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
    });
    // 错误 3：折腕——手腕相对前臂向后折 26°
    if (fault === 3) {
      pose.wristBend = 26 * q;
    }
    pose.hand = hand;
    return pose;
  }
  function shoulderPressDraw(ctx, p, fault, opts) {
    var pose = shoulderPressPose(p, fault);
    floorLine(ctx);
    bar(ctx, pt(300, 528), pt(786, 528), 9);
    bar(ctx, pt(322, 528), pt(322, 210), 8);
    bar(ctx, pt(760, 528), pt(760, 210), 8);
    // 靠背
    pad(ctx, pt(390, 470), pt(378, 300), 24);
    // 座垫
    pad(ctx, pt(400, 484), pt(508, 484), 18);
    bar(ctx, pt(424, 493), pt(424, 528), 7);
    // 两侧推臂：立柱上的固定导杆 + 滑车
    var h = pose.hand;
    bar(ctx, pt(520, h.y), pt(516, h.y), 12, '#B8BBC0');
    bar(ctx, pt(520, 300), pt(520, 236), 10, '#B8BBC0');
    rrect(ctx, h.x - 14, h.y - 12, 28, 24, 6); ctx.fillStyle = '#5E646C'; ctx.fill();
    rrect(ctx, h.x - 9, h.y - 7, 18, 14, 4); ctx.fillStyle = INK; ctx.fill();
    // 配重
    pulley(ctx, pt(716, 236), 11);
    cable(ctx, add(h, pt(16, 0)), pt(716, 247), 2.2);
    stack(ctx, 690, 260, 52, 190, 2);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, shoulderPressPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    if (opts && opts.contacts) {
      mark(ctx, add(pose.chest, pt(-16, 6))); mark(ctx, pose.hip);
      mark(ctx, pose.ankleN); mark(ctx, h);
    }
    if (fault === 1) {
      label(ctx, '顶腰 · 肋骨外翻', 452, 262);
      arrow(ctx, pt(pose.hip.x + 26, pose.hip.y - 30), pt(pose.chest.x + 18, pose.chest.y + 18), -12);
      ctx.save(); ctx.beginPath();
      ctx.moveTo(pose.hip.x + 10, pose.hip.y - 4);
      ctx.quadraticCurveTo(pose.hip.x + 44, pose.hip.y - 22, pose.chest.x + 26, pose.chest.y + 16);
      ctx.strokeStyle = RED; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
    } else if (fault === 2) {
      label(ctx, '半程 · 没推到顶', 446, 250);
      dash(ctx, pose.handN, SP.hand1);
      arrow(ctx, pt(SP.hand1.x + 36, SP.hand1.y + 20), pt(SP.hand1.x + 8, SP.hand1.y + 4), -8);
    } else if (fault === 3) {
      label(ctx, '肘过度外展 · 折腕', 420, 268);
      arcMark(ctx, pose.elbowN, 26, -0.4, 1.4);
      arrow(ctx, pt(pose.handN.x + 30, pose.handN.y + 26), pt(pose.handN.x + 8, pose.handN.y + 8), 8);
    }
  }

  // ---------- 坐姿腿弯举（侧） ----------
  /*
   * 坐姿腿弯举：膝是固定转轴（大腿被压垫锁住），小腿绕膝从“伸”转到“屈”，
   * 所以踝是绕膝的圆弧，不是两点之间直连的直线。滚垫贴在踝后方，跟着踝走。
   * 座垫抬高到 420，屈到底时踝仍在 510 左右，不会穿到地面以下。
   */
  var LC = {
    hip: pt(426, 374), lean: -104,
    knee: pt(533, 385), shin: 100,
    a0: 4, a1: 104,        // 小腿相对水平的方向角：4°（伸）→ 104°（屈）
    roller: 15
  };
  function legCurlAnkle(deg) { return polar(LC.knee, LC.shin, deg); }
  function legCurlPose(p, fault) {
    p = clamp(p, 0, 1);
    var hipRaw = pt(LC.hip.x, LC.hip.y);
    var q = fault === 3 ? 0.5 * p : p;
    // 错误 2：屈膝之前先把髋往后倒（髋代偿），膝角提前变小
    var deg = LC.a0 + (LC.a1 - LC.a0) * (fault === 2 ? 1 - Math.pow(1 - q, 2.2) : q);
    // 错误 2：骨盆后倾、躯干跟着往后倒（髋代偿）；错误 1：臀部抬离座垫。
    var lean = LC.lean - (fault === 2 ? 9 * q : 0);
    if (fault === 1) hipRaw = add(hipRaw, pt(0, -10 * p));
    /*
     * 这台器械的膝是固定转轴：大腿被压垫锁住，只有小腿在转。
     * 让 IK 去“反解”膝会得到一个沿髋-踝连线漂移的假膝（大腿看起来被拉长/缩短）。
     * 这里改成：膝钉死在轴心上，髋严格落在“距膝一个腿长”的位置，小腿绕膝扫弧。
     * 于是大腿是不动的刚性段，只有小腿转，骨长严格守恒，膝也不会游移。
     */
    var knee = pt(LC.knee.x, LC.knee.y);
    var hip = add(knee, mul(norm(sub(hipRaw, knee)), THIGH));
    var chest = polar(hip, TORSO, lean);
    var ankle = add(knee, mul(pt(Math.cos(deg * DEG), Math.sin(deg * DEG)), SHIN));
    var shinDir = norm(sub(ankle, knee));
    var back = mul(perp(shinDir), -1);            // 小腿后方
    var pose = rig(hip, chest, [pt(384, 350), pt(393, 356)],
      [ankle, add(ankle, pt(-9, 5))], {
        kneeN: knee, kneeF: add(knee, pt(-8, 6)),
        toeN: pt(11, -17), toeF: pt(10, -15),
        elbow: pt(-24, 30), eSign: 1, eSignF: 1, kSign: 1, kSignF: 1
      });
    pose.kneeN = knee;
    pose.ankleN = ankle;
    pose.kneeF = add(knee, pt(-8, 6));
    pose.ankleF = add(pose.kneeF, mul(shinDir, SHIN));
    // 滚垫贴在小腿后方，偏移量沿小腿法线，所以转轴一变它也跟着转
    pose.roller = add(mix(knee, ankle, 0.62), mul(back, LC.roller));
    pose.armPivot = knee;
    pose.ankle0 = add(knee, mul(pt(Math.cos(LC.a0 * DEG), Math.sin(LC.a0 * DEG)), SHIN));
    pose.ankle1 = add(knee, mul(pt(Math.cos(LC.a1 * DEG), Math.sin(LC.a1 * DEG)), SHIN));
    return pose;
  }
  function legCurlDraw(ctx, p, fault, opts) {
    var pose = legCurlPose(p, fault);
    floorLine(ctx);
    bar(ctx, pt(280, 528), pt(760, 528), 9);
    bar(ctx, pt(300, 528), pt(300, 250), 7);
    // 座垫 + 靠背 + 大腿压垫（座面抬高，脚不落地）
    pad(ctx, pt(360, 388), pt(520, 388), 18);
    pad(ctx, pt(342, 386), pt(332, 248), 22);
    pad(ctx, pt(470, 364), pt(556, 364), 16);
    bar(ctx, pt(556, 368), pt(556, 528), 8);
    // 滚垫 + 摆臂（绕膝轴转动）
    var r = pose.roller;
    bar(ctx, pose.kneeN, r, 8, '#9AA0A8');
    rrect(ctx, r.x - 26, r.y - 12, 52, 24, 10); ctx.fillStyle = '#5E646C'; ctx.fill();
    // 配重
    pulley(ctx, pt(700, 300), 10);
    cable(ctx, pose.roller, pt(700, 310), 2.2);
    stack(ctx, 690, 322, 50, 176, 2);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, legCurlPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    if (opts && opts.contacts) { mark(ctx, pose.hip); mark(ctx, pose.kneeN); mark(ctx, pose.roller); }
    if (fault === 1) {
      label(ctx, '臀部抬离座垫', 470, 236);
      dash(ctx, pt(360, 384), pt(530, 384));
      arrow(ctx, pt(pose.hip.x + 8, pose.hip.y + 10), pt(pose.hip.x + 8, pose.hip.y - 26), -8);
    } else if (fault === 2) {
      label(ctx, '膝先屈 · 髋代偿', 452, 250);
      arcMark(ctx, pose.hip, 62, -2.2, -1.4);
      arrow(ctx, pt(pose.hip.x - 30, pose.hip.y - 10), pt(pose.hip.x - 6, pose.hip.y - 4), -6);
    } else if (fault === 3) {
      label(ctx, '半程 · 回放太快', 456, 244);
      dash(ctx, pose.ankleN, legCurlAnkle(LC.a1));
      ctx.save(); ctx.globalAlpha = 0.6;
      for (var i = 0; i < 3; i++) line(ctx, pt(pose.ankleN.x + 26, pose.ankleN.y + 18 + i * 12), pt(pose.ankleN.x + 50, pose.ankleN.y + 4 + i * 12), RED, 3);
      ctx.restore();
    }
  }

  // ---------- 哑铃站姿提踵（侧） ----------
  /*
   * 侧视：双手各持一只哑铃自然下垂，前脚掌踩在低台上，脚跟悬空。
   * 支点是前脚掌（ball），提踵时整个身体绕它抬起，踝、髋、肩同步升高，
   * 脚掌角度随之变化 —— 所以脚跟能沉到台面以下，也能提到比台面高。
   */
  var CA = {
    hip: pt(478, 296), lean: -90,
    // 前脚掌（支点）踩在台面上；脚跟悬在台外，可以沉到台面以下
    ball: pt(498, 518), heel0: pt(458, 538),
    ankle0: pt(492, 488)
  };
  function calfPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(CA.hip.x, CA.hip.y);
    var lift = (fault === 3 ? 0.4 * p : p) * 26;
    hip = add(hip, pt(0, -lift));
    // 错误 1：膝盖锁死 + 靠弹震，额外叠一次快速的上下弹动
    var bounce = fault === 1 ? -4.2 * Math.abs(Math.sin(p * Math.PI * 2.5)) : 0;
    hip = add(hip, pt(0, bounce));
    var chest = polar(hip, TORSO, CA.lean);
    // 踝点跟着身体一起升起，但仍在前脚掌正上方
    var ankle = add(pt(CA.ankle0.x, CA.ankle0.y), pt(0, -lift));
    // 错误 2：踝内翻 —— 距下关节向内倒，踝点向外偏一点
    if (fault === 2) ankle = add(ankle, pt(8 * p, -2 * p));
    // 错误 1 的“膝锁死”：把踝拉到腿长极限，膝几乎没有弯曲余量
    if (fault === 1) {
      var d0 = norm(sub(ankle, hip));
      ankle = add(hip, mul(d0, THIGH + SHIN - 1.2));
    }
    var kneeHint = fault === 1 ? mix(hip, ankle, 0.5) : pt(492, 392);
    // 手自然下垂在体侧，两只哑铃挂在髋旁边（肩以下接近臂展，手臂几乎伸直）
    // 手臂自然下垂：手到肩约 127px（臂展 128），几乎伸直；哑铃垂在大腿外侧
    var hand = add(hip, pt(14, -2));
    var pose = rig(hip, chest, [hand, add(hand, pt(-8, 4))],
      [ankle, add(ankle, pt(-8, 4))], {
        kneeN: kneeHint, kneeF: add(kneeHint, pt(-8, 6)),
        toeN: pt(26, 4), toeF: pt(24, 8),
        elbow: pt(-24, 20), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
      });
    // 脚单独画：脚掌贴住台面，脚跟悬空
    pose.skipFoot = true; pose.skipFarFoot = true;
    pose.ball = CA.ball;
    pose.lift = lift;
    pose.hand = hand;
    pose.ankle = ankle;
    return pose;
  }
  function calfFoot(ctx, ankle, lift, fill, stroke, lw) {
    /*
     * 脚掌是一整块楔形：踝在最高点，前脚掌压住台面（支点不动），脚跟悬在台外。
     * 提踵时踝和脚跟一起抬起，但前脚掌始终贴着台面，所以脚背角度变大。
     */
    var ball = pt(CA.ball.x, CA.ball.y);
    var heel = add(CA.heel0, pt(0, -lift * 0.9));
    var toe = add(ball, pt(24, 3));
    rpoly(ctx, [
      add(ankle, pt(-6, -7)), add(ankle, pt(9, -3)),
      add(ball, pt(4, -9)), toe,
      add(ball, pt(0, 4)), add(heel, pt(4, 7)),
      add(heel, pt(-6, 3)), add(ankle, pt(-11, 6))
    ], 5, fill, stroke, lw || 3.2);
    circle(ctx, ankle, 4.6, fill, stroke, 2.4);
  }
  function calfDraw(ctx, p, fault, opts) {
    var pose = calfPose(p, fault);
    floorLine(ctx);
    // 低台：前脚掌踩在台面上，脚跟悬在台外
    rrect(ctx, 470, 518, 118, 22, 5); ctx.fillStyle = '#C9CFD6'; ctx.fill();
    ctx.strokeStyle = '#8F959D'; ctx.lineWidth = 2.2; ctx.stroke();
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, calfPose(p, 0), true); ctx.restore(); }
    // 远侧脚（先画，颜色浅）
    calfFoot(ctx, add(pose.ankleN, pt(-9, 4)), pose.lift, '#EFEADC', FAR, 2.6);
    body(ctx, pose);
    calfFoot(ctx, pose.ankleN, pose.lift, PAPER, INK, 3.4);
    dumbbellAt(ctx, pose.handN, 0, 0.58);
    dumbbellAt(ctx, pose.handF, 0, 0.5);
    if (opts && opts.contacts) { mark(ctx, pose.ball); mark(ctx, pose.ankleN); mark(ctx, pose.handN); }
    // 起始高度虚线（静止时脚跟的位置）
    dash(ctx, pt(432, CA.heel0.y), pt(548, CA.heel0.y));
    if (fault === 1) {
      label(ctx, '膝锁死 · 靠弹震', 512, 236);
      arrow(ctx, pt(pose.kneeN.x + 26, pose.kneeN.y - 6), pt(pose.kneeN.x + 2, pose.kneeN.y - 2), -6);
      ctx.save(); ctx.globalAlpha = 0.6;
      for (var i = 0; i < 3; i++) line(ctx, pt(pose.ankleN.x + 30, pose.ankleN.y - 8 + i * 12), pt(pose.ankleN.x + 54, pose.ankleN.y - 20 + i * 12), RED, 3);
      ctx.restore();
    } else if (fault === 2) {
      label(ctx, '踝内翻 · 重心偏外', 494, 248);
      valgus(ctx, 606, 372);
      arrow(ctx, pt(pose.ankleN.x + 22, pose.ankleN.y + 4), pt(pose.ankleN.x + 2, pose.ankleN.y + 10), 6);
    } else if (fault === 3) {
      label(ctx, '半程 · 没到最高点', 492, 260);
      dash(ctx, pt(420, 496 - 28), pt(548, 496 - 28));
      arrow(ctx, pt(pose.ankleN.x + 62, pose.ankleN.y - 4), pt(pose.ankleN.x + 62, pose.ankleN.y - 26), -6);
    }
  }

  // ---------- 绳索下压（侧） ----------
  // 站姿绳索下压：上臂贴体侧、肘在肩下方；起始屈肘约 90°，末端接近伸直
  // 站姿：髋到踝约 199（腿长 208），膝微屈；肩在 224 左右，手最高只能到肩下 128。
  var PD = {
    hip: pt(436, 342), lean: -94, ankle: pt(452, 540),
    // 起始：肘在体侧、前臂向前水平；末端：前臂垂到体侧，手停在髋前上方
    hand0: pt(498, 282), hand1: pt(446, 336),
    pulley: pt(540, 176)
  };
  function pushdownPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(PD.hip.x, PD.hip.y);
    var chest = polar(hip, TORSO, PD.lean + (fault === 1 ? 10 * p : 0));
    var q = fault === 3 ? 0.45 * p : p;
    var hand = mix(PD.hand0, PD.hand1, q);
    // 错误 2「肘前跑」：上臂往前抬，握把被推着往前走，肩也随之向前顶。
    // 侧视里表现为肘越过躯干前缘、前臂由“下压”变成“前推”。
    if (fault === 2) hand = add(hand, pt(30 * q, -12 * q));
    var hands = [hand, add(hand, pt(-8, 5))];
    var shShift = fault === 2 ? pt(5 * q, 2 * q) : pt(0, 0);
    var pose = rig(hip, chest, hands, [pt(PD.ankle.x, PD.ankle.y), pt(PD.ankle.x - 10, PD.ankle.y - 2)], {
      kneeN: pt(444, 470), kneeF: pt(436, 476),
      toeN: pt(24, 2), toeF: pt(22, 6),
      elbow: pt(2, 34),
      eSign: 1, eSignF: 1, kSign: 1, kSignF: 1
    });
    if (fault === 2) {
      pose.shN = add(pose.shN, shShift);
      pose.shF = add(pose.shF, shShift);
      reArm(pose, hands);
    }
    pose.hand = hand;
    return pose;
  }
  function pushdownDraw(ctx, p, fault, opts) {
    var pose = pushdownPose(p, fault);
    floorLine(ctx);
    bar(ctx, pt(280, 528), pt(760, 528), 9);
    bar(ctx, pt(700, 528), pt(700, 160), 8);
    bar(ctx, pt(300, 160), pt(700, 160), 8);
    // 高位滑轮 + 配重
    pulley(ctx, PD.pulley, 11);
    stack(ctx, 656, 200, 50, 210, 2);
    cable(ctx, PD.pulley, pt(676, 172), 2.2);
    // 钢索从滑轮垂到握把
    var h = pose.hand;
    cable(ctx, add(PD.pulley, pt(0, 11)), h, 2.4);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, pushdownPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    rrect(ctx, h.x - 10, h.y - 7, 20, 14, 5); ctx.fillStyle = INK; ctx.fill();
    if (opts && opts.contacts) { mark(ctx, pose.elbowN); mark(ctx, h); mark(ctx, pose.ankleN); }
    if (fault === 1) {
      label(ctx, '身体前压借力', 470, 246);
      arrow(ctx, pt(pose.chest.x + 26, pose.chest.y + 6), pt(pose.chest.x + 40, pose.chest.y + 34), -10);
      arcMark(ctx, pose.hip, 66, -1.9, -1.3);
    } else if (fault === 2) {
      label(ctx, '肘前跑 · 变成推', 470, 232);
      arrow(ctx, pt(pose.elbowN.x - 4, pose.elbowN.y - 20), pt(pose.elbowN.x + 24, pose.elbowN.y - 6), -8);
      dash(ctx, pose.shN, PD.hand0);
    } else if (fault === 3) {
      label(ctx, '半程 · 没伸直', 486, 242);
      dash(ctx, pose.handN, PD.hand0);
      arrow(ctx, pt(pose.handN.x + 30, pose.handN.y + 20), pt(pose.handN.x + 30, pose.handN.y - 4), -6);
    }
  }

  // ---------- 直臂下压（侧） ----------
  /*
   * 站姿、躯干略前倾，肘几乎伸直固定，整条手臂绕肩从“前上方”扫到“大腿前侧”。
   * 手走的是以肩为圆心的圆弧（角度插值），不是直线，否则中段肘会折成尖角。
   * 滑轮在高位前方，钢索始终连着手。
   */
  var SA = {
    hip: pt(432, 352), lean: -84, ankle: pt(446, 540),
    shoulder: pt(436, 236),
    // 起始：手在前上方（略高于肩）；末端：手到大腿前侧
    hand0: pt(452, 112), hand1: pt(470, 356),
    pulley: pt(612, 108)
  };
  function straightArmPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(SA.hip.x, SA.hip.y);
    // 错误 2：躯干后仰借力
    var lean = SA.lean + (fault === 2 ? 12 * p : 0);
    var chest = polar(hip, TORSO, lean);
    var q = fault === 3 ? 0.45 * p : p;
    var sh = add(add(chest, mul(norm(sub(chest, hip)), -6)), pt(2, 0));
    var r = ARM + FORE - 2;
    var a0 = Math.atan2(SA.hand0.y - sh.y, SA.hand0.x - sh.x);
    var a1 = Math.atan2(SA.hand1.y - sh.y, SA.hand1.x - sh.x);
    var hand = pt(sh.x + Math.cos(lerp(a0, a1, q)) * r, sh.y + Math.sin(lerp(a0, a1, q)) * r);
    // 错误 1：肘始终弯着，手臂变成“下拉”
    if (fault === 1) {
      hand = add(sh, mul(norm(sub(hand, sh)), r * 0.72));
    }
    var pose = rig(hip, chest, [hand, add(hand, pt(-7, 5))],
      [pt(SA.ankle.x, SA.ankle.y), pt(SA.ankle.x - 10, SA.ankle.y - 2)], {
        kneeN: pt(440, 468), kneeF: pt(432, 474),
        toeN: pt(24, 2), toeF: pt(22, 6),
        elbow: pt(-18, 24), eSign: 1, eSignF: 1, kSign: 1, kSignF: 1
      });
    pose.hand = hand;
    return pose;
  }
  function straightArmDraw(ctx, p, fault, opts) {
    var pose = straightArmPose(p, fault);
    floorLine(ctx);
    bar(ctx, pt(300, 528), pt(760, 528), 9);
    bar(ctx, pt(700, 528), pt(700, 120), 8);
    bar(ctx, pt(560, 120), pt(700, 120), 8);
    pulley(ctx, SA.pulley, 11);
    stack(ctx, 652, 150, 50, 200, 2);
    cable(ctx, SA.pulley, pt(680, 128), 2.2);
    var h = pose.hand;
    cable(ctx, add(SA.pulley, pt(0, 11)), h, 2.4);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, straightArmPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    rrect(ctx, h.x - 10, h.y - 8, 20, 16, 5); ctx.fillStyle = INK; ctx.fill();
    if (opts && opts.contacts) { mark(ctx, pose.shN); mark(ctx, h); mark(ctx, pose.ankleN); }
    if (fault === 1) {
      label(ctx, '屈肘 · 变成下拉', 512, 236);
      arcMark(ctx, pose.elbowN, 26, 0.3, 2.2);
      arrow(ctx, pt(pose.elbowN.x + 30, pose.elbowN.y + 16), pt(pose.elbowN.x + 6, pose.elbowN.y + 2), 6);
    } else if (fault === 2) {
      label(ctx, '身体后仰借力', 486, 220);
      arcMark(ctx, pose.hip, 70, -1.9, -1.3);
      arrow(ctx, pt(pose.chest.x - 26, pose.chest.y + 10), pt(pose.chest.x - 40, pose.chest.y - 18), -8);
    } else if (fault === 3) {
      label(ctx, '半程 · 手没到大腿', 486, 252);
      dash(ctx, pose.handN, SA.hand1);
      arrow(ctx, pt(pose.handN.x + 24, pose.handN.y + 20), pt(pose.handN.x + 24, pose.handN.y - 4), -6);
    }
  }

  // ---------- 绳索侧平举（正面，双侧低位滑轮） ----------
  /*
   * 正面视角，两侧各一根低位钢索。手臂从体侧扫到与肩同高，路径是以肩为圆心的圆弧。
   * 与哑铃侧平举的区别是阻力来自下方，底段就有张力；手始终连着钢索。
   */
  var CL = {
    hip: pt(480, 336), chest: pt(480, 214),
    ankleR: pt(512, 540), ankleL: pt(448, 540),
    hand0R: pt(516, 330), hand1R: pt(632, 208),
    hand0L: pt(444, 330), hand1L: pt(328, 208),
    pulleyR: pt(700, 528), pulleyL: pt(260, 528)
  };
  function cableLateralPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(CL.hip.x, CL.hip.y);
    var chest = pt(CL.chest.x, CL.chest.y);
    var q = fault === 3 ? 0.45 * p : p;
    // 错误 2：靠躯干摆动把重量甩起来
    if (fault === 2) {
      var u = norm(sub(chest, hip));
      var sw = 8 * p * DEG;
      chest = add(hip, mul(pt(u.x * Math.cos(sw) - u.y * Math.sin(sw),
                              u.x * Math.sin(sw) + u.y * Math.cos(sw)), TORSO));
    }
    var up = norm(sub(chest, hip)), side = perp(up);
    var shR = add(add(chest, mul(up, -4)), mul(side, 24));
    var shL = add(add(chest, mul(up, -4)), mul(side, -24));
    var R = ARM + FORE - 2;
    var aR0 = Math.atan2(CL.hand0R.y - shR.y, CL.hand0R.x - shR.x);
    var aR1 = Math.atan2(CL.hand1R.y - shR.y, CL.hand1R.x - shR.x);
    var aL0 = Math.PI - aR0, aL1 = Math.PI - aR1;
    var handR = pt(shR.x + Math.cos(lerp(aR0, aR1, q)) * R, shR.y + Math.sin(lerp(aR0, aR1, q)) * R);
    var handL = pt(shL.x + Math.cos(lerp(aL0, aL1, q)) * R, shL.y + Math.sin(lerp(aL0, aL1, q)) * R);
    var shrug = fault === 1 ? 13 * q : 0;
    var pose = rigFront(hip, chest, [handR, handL],
      [pt(CL.ankleR.x, CL.ankleR.y), pt(CL.ankleL.x, CL.ankleL.y)], {
        elbow: pt(20, 16), shrug: shrug, eSignR: 1, eSignL: -1, armScale: 0.995
      });
    pose.toeN = pt(0, -1); pose.toeF = pt(0, -1);
    pose.symmetric = false;
    pose.hands = [handR, handL];
    return pose;
  }
  function cableLateralDraw(ctx, p, fault, opts) {
    var pose = cableLateralPose(p, fault);
    floorLine(ctx);
    // 两侧低位滑轮 + 配重
    [[CL.pulleyL, -1], [CL.pulleyR, 1]].forEach(function (pair) {
      var c = pair[0];
      bar(ctx, pt(c.x, c.y), pt(c.x, 300), 7, '#9AA0A8');
      pulley(ctx, pt(c.x, c.y - 4), 10);
      stack(ctx, c.x - 24, 372, 48, 132, 2);
    });
    cable(ctx, add(CL.pulleyL, pt(0, -12)), pose.handF, 2.2);
    cable(ctx, add(CL.pulleyR, pt(0, -12)), pose.handN, 2.2);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, cableLateralPose(p, 0), true); ctx.restore(); }
    armFront(ctx, pose.shF, pose.elbowF, pose.handF, '#EFEADC', FAR, 17, 13);
    legFront(ctx, pose.hipF, pose.kneeF, pose.ankleF, '#EFEADC', FAR);
    frontTorsoShape(ctx, pose.hip, pose.chest, PAPER, INK, 5);
    line(ctx, pose.chest, pose.neck, INK, 11);
    armFront(ctx, pose.shN, pose.elbowN, pose.handN, PAPER, INK, 19, 14);
    legFront(ctx, pose.hipN, pose.kneeN, pose.ankleN, PAPER, INK);
    headShape(ctx, pose.head, pose.up, PAPER, INK, false);
    circle(ctx, pose.neck, 3, INK); circle(ctx, pose.hip, 3.4, INK);
    rrect(ctx, pose.handN.x - 7, pose.handN.y - 8, 14, 16, 5); ctx.fillStyle = INK; ctx.fill();
    rrect(ctx, pose.handF.x - 7, pose.handF.y - 8, 14, 16, 5); ctx.fillStyle = '#4A4E56'; ctx.fill();
    if (opts && opts.contacts) { mark(ctx, pose.handN); mark(ctx, pose.handF); }
    var shH = 208;
    if (fault === 1) {
      label(ctx, '耸肩 · 斜方肌代偿', 604, 150);
      arrow(ctx, pt(pose.shN.x + 34, pose.shN.y - 4), pt(pose.shN.x + 34, pose.shN.y - 30), -8);
      dash(ctx, pt(pose.shN.x + 20, pose.shN.y + 8), pt(pose.shN.x + 20, pose.shN.y - 34));
    } else if (fault === 2) {
      label(ctx, '甩起来 · 靠惯性', 592, 140);
      arrow(ctx, pt(pose.handN.x + 10, pose.handN.y + 60), pt(pose.handN.x + 26, pose.handN.y - 6), -20);
      arcMark(ctx, pt(pose.shN.x + 6, pose.shN.y + 20), 78, -1.5, -0.2);
    } else if (fault === 3) {
      label(ctx, '半程 · 没抬到肩高', 560, 140);
      dash(ctx, pt(300, shH), pt(660, shH));
      arrow(ctx, pt(pose.handN.x - 10, pose.handN.y + 14), pt(pose.handN.x - 10, pose.handN.y - 30), -8);
    }
  }

  // ---------- 哑铃弯举（侧） ----------
  var BI = {
    hip: pt(462, 344), lean: -88, ankle: pt(470, 540),
    hand0: pt(512, 340), hand1: pt(524, 250)
  };
  function bicepsPose(p, fault) {
    p = clamp(p, 0, 1);
    var hip = pt(BI.hip.x, BI.hip.y);
    var chest = polar(hip, TORSO, BI.lean + (fault === 2 ? 8 * p : 0));
    var q = fault === 3 ? 0.4 * p : p;
    var hand = mix(BI.hand0, BI.hand1, q);
    if (fault === 1) hand = add(hand, pt(12 * p, -22 * p));
    var hands = [hand, add(hand, pt(-8, 4))];
    var pose = rig(hip, chest, hands, [pt(BI.ankle.x, BI.ankle.y), pt(BI.ankle.x - 10, BI.ankle.y - 2)], {
      kneeN: pt(468, 484), kneeF: pt(460, 488),
      toeN: pt(24, 2), toeF: pt(22, 6),
      elbow: pt(-14, 26), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
    });
    pose.hand = hand;
    return pose;
  }
  function bicepsDraw(ctx, p, fault, opts) {
    var pose = bicepsPose(p, fault);
    floorLine(ctx);
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, bicepsPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    dumbbellAt(ctx, pose.handN, -Math.PI / 2, 0.72);
    if (opts && opts.contacts) { mark(ctx, pose.elbowN); mark(ctx, pose.handN); mark(ctx, pose.ankleN); }
    if (fault === 1) {
      label(ctx, '甩起来 · 肩前引', 486, 268);
      arrow(ctx, pt(pose.elbowN.x + 26, pose.elbowN.y - 34), pt(pose.elbowN.x + 34, pose.elbowN.y - 4), -10);
      arcMark(ctx, pose.shN, 42, -1.2, -0.2);
    } else if (fault === 2) {
      label(ctx, '身体后仰借力', 470, 256);
      arrow(ctx, pt(pose.chest.x + 30, pose.chest.y + 24), pt(pose.chest.x + 46, pose.chest.y - 4), -8);
      arcMark(ctx, pose.hip, 70, -1.9, -1.2);
    } else if (fault === 3) {
      label(ctx, '半程 · 没到顶峰', 480, 262);
      dash(ctx, pose.handN, BI.hand1);
      arrow(ctx, pt(pose.handN.x + 30, pose.handN.y - 4), pt(pose.handN.x + 30, pose.handN.y - 30), -6);
    }
  }

  // ---------- 自重臀桥（侧，仰卧） ----------
  /*
   * 上背固定垫面，躯干绕肩胛支点旋转：髋是被“转”起来的，不是被拉长的。
   * 脚掌位置固定（错误 2 才把脚放远），膝由 IK 反解，所以顶端膝角仍然成立。
   */
  var GB = { sh: pt(352, 512), r: 122, ankle: pt(554, 540) };
  function gluteBodyweightPose(p, fault) {
    p = clamp(p, 0, 1);
    var q = fault === 3 ? 0.45 * p : p;
    // 错误 1：腰椎过伸，髋多转 6°
    var deg = (fault === 1 ? 34 : 28) * q;
    var chest = pt(GB.sh.x, GB.sh.y);
    var hip = polar(chest, GB.r, -deg);
    var ankle = fault === 2 ? pt(586, 540) : pt(GB.ankle.x, GB.ankle.y);
    var knee = add(mix(hip, ankle, 0.5), pt(2, -78));
    // 双臂平放在垫子上、沿身体朝脚的方向伸直（掌心向下贴在垫面 y≈540）。
    // 肩不离垫，手也不跟着髋走——臀桥时手臂是被动放在地上的。
    var pose = rig(hip, chest, [pt(480, 534), pt(468, 538)],
      [ankle, add(ankle, pt(9, 4))], {
        kneeN: knee, kneeF: add(knee, pt(-8, 6)),
        toeN: pt(24, -2), toeF: pt(22, 2),
        elbow: pt(-30, 16), eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
      });
    // 仰卧侧视：远侧手臂整条被躯干挡住，画出来只会在垫面下方露出一截，直接省掉。
    pose.hideFarArm = true;
    pose.lift = GB.sh.y - hip.y;
    pose.ankle = ankle;
    return pose;
  }
  function gluteBodyweightDraw(ctx, p, fault, opts) {
    var pose = gluteBodyweightPose(p, fault);
    floorLine(ctx);
    rrect(ctx, 250, 536, 452, 22, 9); ctx.fillStyle = '#E8E2D4'; ctx.fill();
    ctx.strokeStyle = PAD_EDGE; ctx.lineWidth = 2.2; ctx.stroke();
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, gluteBodyweightPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    if (opts && opts.contacts) { mark(ctx, pose.chest); mark(ctx, mix(pose.hip, pose.chest, 0.85)); }
    if (fault === 1) {
      label(ctx, '用腰顶 · 肋骨外翻', 470, 336);
      ctx.save(); ctx.beginPath();
      ctx.moveTo(pose.hip.x - 20, pose.hip.y - 6);
      ctx.quadraticCurveTo(pose.hip.x + 16, pose.hip.y - 34, pose.chest.x + 24, pose.chest.y - 4);
      ctx.strokeStyle = RED; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
      arrow(ctx, pt(pose.hip.x, pose.hip.y + 16), pt(pose.hip.x, pose.hip.y - 12), -8);
    } else if (fault === 2) {
      label(ctx, '脚位过远 · 膝内扣', 470, 320);
      valgus(ctx, 590, 292);
      arrow(ctx, pt(pose.kneeN.x + 26, pose.kneeN.y + 8), pt(pose.kneeN.x + 2, pose.kneeN.y - 6), 8);
    } else if (fault === 3) {
      label(ctx, '半程 · 没到髋伸', 486, 344);
      dash(ctx, pt(400, 514 - 62), pt(600, 514 - 62));
      arrow(ctx, pt(pose.hip.x + 6, pose.hip.y - 4), pt(pose.hip.x + 6, pose.hip.y - 40), -8);
    }
  }

  // ---------- 卷腹（侧，仰卧） ----------
  /*
   * 胸廓绕髋旋转（不是把胸点平移过去），所以躯干长度不变。
   * 错误 2 是“髋先动”：骨盆抬离垫面，胸廓几乎不卷——用改变支点位置表达，
   * 而不是把身体整体抬起来。
   */
  var CR = { hip: pt(470, 508), r: 122, curl: 42 };
  function crunchPose(p, fault) {
    p = clamp(p, 0, 1);
    var q = fault === 3 ? 0.45 * p : p;
    var hip = pt(CR.hip.x, CR.hip.y);
    var curl = CR.curl * q;
    if (fault === 2) {
      hip = add(hip, pt(0, -16 * p));
      curl = 10 * q;
    }
    // y 轴向下，所以“卷起来”是角度从 180° 往 180+curl 走（胸点 y 变小）。
    var chest = polar(hip, CR.r, 180 + curl);
    var up = norm(sub(chest, hip)), n = perp(up);
    /*
     * 双手抱在头侧：手落在耳朵旁边（沿躯干轴往外 58，距肩约 62），
     * 肘向身后张开。这是卷腹“手贴耳、肘外展”的侧视剪影。
     * 手点离肩太近（<45）会把上臂折成一段方疙瘩；太靠头顶又会把肘折到脸前面。
     */
    var hand0 = add(add(chest, mul(up, 58)), mul(n, -4));
    var hand1 = add(add(chest, mul(up, 52)), mul(n, -10));
    // 错误 1：双手抱头用力往前拉，手贴到后脑、肘向前收
    if (fault === 1) {
      hand0 = add(add(chest, mul(up, 50)), mul(n, 6));
      hand1 = add(add(chest, mul(up, 44)), mul(n, 0));
    }
    var pose = rig(hip, chest, [hand0, hand1],
      [pt(602, 530), pt(610, 534)], {
        kneeN: pt(562, 478), kneeF: pt(554, 484),
        toeN: pt(24, -2), toeF: pt(22, 2),
        elbow: fault === 1 ? pt(18, -30) : pt(-24, -16),
        eSign: 1, eSignF: 1, kSign: -1, kSignF: -1
      });
    if (fault === 1) {
      // 下巴前伸、抱头拉颈：只动颈头，不动躯干
      pose.head = add(pose.head, pt(-9 * p, 5 * p));
      pose.neck = add(pose.neck, pt(-4 * p, 2 * p));
    }
    pose.chest0 = polar(hip, CR.r, 180);
    pose.chest1 = polar(hip, CR.r, 180 + CR.curl);
    return pose;
  }
  function crunchDraw(ctx, p, fault, opts) {
    var pose = crunchPose(p, fault);
    floorLine(ctx);
    rrect(ctx, 256, 532, 434, 24, 9); ctx.fillStyle = '#E8E2D4'; ctx.fill();
    ctx.strokeStyle = PAD_EDGE; ctx.lineWidth = 2.2; ctx.stroke();
    // 屈膝：大腿朝上、小腿折回
    if (fault) { ctx.save(); ctx.globalAlpha = 0.5; body(ctx, crunchPose(p, 0), true); ctx.restore(); }
    body(ctx, pose);
    if (opts && opts.contacts) { mark(ctx, pose.hip); mark(ctx, mix(pose.chest, pose.hip, 0.5)); }
    if (fault === 1) {
      label(ctx, '抱头拉颈 · 下巴前伸', 520, 344);
      arrow(ctx, pt(pose.head.x - 18, pose.head.y + 22), pt(pose.head.x - 34, pose.head.y + 2), -8);
      arcMark(ctx, pose.neck, 26, -0.4, 1.2);
    } else if (fault === 2) {
      label(ctx, '髋先动 · 变成起身', 512, 330);
      arcMark(ctx, pose.hip, 60, -2.4, -1.5);
      arrow(ctx, pt(pose.hip.x + 22, pose.hip.y - 6), pt(pose.hip.x + 44, pose.hip.y - 26), -8);
    } else if (fault === 3) {
      label(ctx, '半程 · 肩胛没离地', 512, 352);
      dash(ctx, pose.chest, pose.chest1);
      arrow(ctx, pt(pose.chest.x - 26, pose.chest.y - 16), pt(pose.chest.x - 6, pose.chest.y - 34), -6);
    }
  }

  var FIGS = {
    pulldown: { name: '高位下拉', draw: pulldownDraw, pose: pulldownPose, faults: ['后仰借力', '耸肩 · 肘后跑', '半程 · 回放失控'] },
    legPress: { name: '腿举', draw: legPressDraw, pose: legPressPose, faults: ['膝内扣', '臀离垫 · 腰卷起', '锁膝 · 平台砸回'] },
    gluteMachine: { name: '臀桥机', draw: gluteDraw, pose: glutePose, faults: ['用腰顶 · 肋骨外翻', '膝内扣 · 脚位过远', '幅度过大 · 顶端失控'] },
    row: { name: '胸支撑器械划船', draw: rowDraw, pose: rowPose, faults: ['用腰后仰借力', '耸肩 · 肘掉下去', '半程 · 手没到腹部'] },
    straightArm: { name: '直臂下压', draw: straightArmDraw, pose: straightArmPose, faults: ['屈肘 · 变成下拉', '身体后仰借力', '半程 · 手没到大腿'] },
    dbBench: { name: '哑铃平板卧推', draw: dbBenchDraw, pose: dbBenchPose, faults: ['耸肩 · 肩前顶', '半程 · 肘没伸直', '轨迹朝头偏 · 肩前顶'] },
    lateral: { name: '哑铃侧平举', draw: lateralDraw, pose: lateralPose, faults: ['耸肩 · 斜方肌代偿', '甩起来 · 靠惯性', '超过肩 · 肘高于腕'] },
    cableLateral: { name: '绳索侧平举', draw: cableLateralDraw, pose: cableLateralPose, faults: ['耸肩 · 斜方肌代偿', '甩起来 · 靠惯性', '半程 · 没抬到肩高'] },
    reverseFly: { name: '反向蝴蝶机', draw: reverseFlyDraw, pose: reverseFlyPose, faults: ['耸肩 · 斜方肌代偿', '屈肘下拉 · 背阔代偿', '半程 · 只开到一半'] },
    shoulderPress: { name: '坐姿器械肩推', draw: shoulderPressDraw, pose: shoulderPressPose, faults: ['顶腰 · 肋骨外翻', '半程 · 没推到顶', '肘过度外展 · 折腕'] },
    legCurl: { name: '坐姿腿弯举', draw: legCurlDraw, pose: legCurlPose, faults: ['臀部抬离座垫', '膝先屈 · 髋代偿', '半程 · 回放太快'] },
    dbCalf: { name: '哑铃站姿提踵', draw: calfDraw, pose: calfPose, faults: ['膝锁死 · 靠弹震', '踝内翻 · 重心偏外', '半程 · 没到最高点'] },
    pushdown: { name: '绳索下压', draw: pushdownDraw, pose: pushdownPose, faults: ['身体前压借力', '肘前跑 · 变成推', '半程 · 没伸直'] },
    biceps: { name: '哑铃弯举', draw: bicepsDraw, pose: bicepsPose, faults: ['甩起来 · 肩前引', '身体后仰借力', '半程 · 没到顶峰'] },
    gluteBodyweight: { name: '自重臀桥', draw: gluteBodyweightDraw, pose: gluteBodyweightPose, faults: ['用腰顶 · 肋骨外翻', '脚位过远 · 膝内扣', '半程 · 没到髋伸'] },
    crunch: { name: '卷腹', draw: crunchDraw, pose: crunchPose, faults: ['抱头拉颈 · 下巴前伸', '髋先动 · 变成起身', '半程 · 肩胛没离地'] }
  };

  function drawFrame(ctx, cw, ch, id, p, fault, opts) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cw, ch);
    var s = Math.min(cw / W, ch / H);
    ctx.setTransform(s, 0, 0, s, (cw - W * s) / 2, (ch - H * s) / 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    (FIGS[id] || FIGS.pulldown).draw(ctx, clamp(p, 0, 1), fault || 0, opts);
  }

  function createPlayer(canvas, id) {
    var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    var mode = 'correct', fault = 1, paused = false, stopped = false, start = performance.now(), raf = 0;
    var UP = 1100, HOLD = 320, DOWN = 1900, TOTAL = UP + HOLD + DOWN;
    if (!ctx) return { setMode: function () {}, setFault: function () {}, setPaused: function () {}, stop: function () {} };
    function fit() {
      var r = canvas.getBoundingClientRect();
      var cssW = r.width || 360, cssH = r.height || cssW * 10 / 16;
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var cw = Math.max(1, Math.round(cssW * dpr)), ch = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      return { cw: cw, ch: ch };
    }
    function frame(now) {
      if (stopped) return;
      if (document.visibilityState === 'visible' && !paused) {
        var size = fit(), t = (now - start) % TOTAL, p;
        if (t < UP) p = ease(t / UP);
        else if (t < UP + HOLD) p = 1;
        else p = 1 - ease((t - UP - HOLD) / DOWN);
        drawFrame(ctx, size.cw, size.ch, id, p, mode === 'fault' ? fault : 0);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      setMode: function (m) { mode = m === 'fault' ? 'fault' : 'correct'; start = performance.now(); },
      setFault: function (n) { fault = clamp(Number(n) || 1, 1, 3); start = performance.now(); },
      setPaused: function (v) { paused = !!v; if (!paused) start = performance.now(); },
      stop: function () { stopped = true; cancelAnimationFrame(raf); }
    };
  }

  function measure(id, p, fault) {
    var fig = FIGS[id];
    if (!fig) return null;
    var s = fig.pose(p, fault || 0);
    return {
      upperArm: dist(s.shN, s.elbowN), forearm: dist(s.elbowN, s.handN),
      upperArmFar: dist(s.shF, s.elbowF), forearmFar: dist(s.elbowF, s.handF),
      thigh: dist(s.hipN, s.kneeN), shin: dist(s.kneeN, s.ankleN),
      thighFar: dist(s.hipF, s.kneeF), shinFar: dist(s.kneeF, s.ankleF),
      torso: dist(s.hip, s.chest)
    };
  }
  function boneDrift(id) {
    var ref = measure(id, 0, 0), worst = 0, key = '';
    [0.25, 0.5, 0.75, 1].forEach(function (p) {
      var m = measure(id, p, 0);
      Object.keys(ref).forEach(function (k) {
        var d = Math.abs(m[k] - ref[k]);
        if (d > worst) { worst = d; key = k + '@p=' + p; }
      });
    });
    return { worst: worst, key: key };
  }

  var api = {
    FIGS: FIGS, drawFrame: drawFrame, createPlayer: createPlayer,
    measure: measure, boneDrift: boneDrift, ik: ik, pickBend: pickBend,
    BONES: { upperArm: ARM, forearm: FORE, thigh: THIGH, shin: SHIN, torso: TORSO },
    W: W, H: H
  };
  if (typeof window !== 'undefined') { window.Figures = api; window.FIGURES = FIGS; window.Figures2 = api; window.FIGURES2 = FIGS; }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
