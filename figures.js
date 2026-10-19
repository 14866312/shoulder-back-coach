(function () {
  'use strict';

  var W = 960, H = 600;
  var PAPER = '#F4F1EA', INK = '#121316', ORANGE = '#FF5A1F', RED = '#D92D20', GRAY = '#6B7078', LIGHT = '#C9C4B8';
  var FIGURES = {};

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function easeInOut(p) { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  function line(ctx, x1, y1, x2, y2, color, w) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color || INK; ctx.lineWidth = w || 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function path(ctx, pts, close, color, w) {
    if (!pts.length) return;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
    ctx.strokeStyle = color || INK; ctx.lineWidth = w || 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function circ(ctx, x, y, r, fill, stroke, w) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w || 5; ctx.stroke(); }
  }

  function rr(ctx, x, y, w, h, r, fill, stroke, lw) {
    r = Math.min(r || 0, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
  }

  function txt(ctx, str, x, y, size, color, align, weight) {
    ctx.save();
    ctx.font = (weight || 700) + ' ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillStyle = color || INK; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y); ctx.restore();
  }

  function label(ctx, str, x, y, color) {
    ctx.save();
    ctx.font = '800 22px "Microsoft YaHei", "PingFang SC", sans-serif';
    var tw = ctx.measureText(str).width;
    rr(ctx, x - 10, y - 18, tw + 20, 36, 10, color || RED, null, 0);
    txt(ctx, str, x, y, 22, '#FFFFFF', 'left', 800);
    ctx.restore();
  }

  function arrow(ctx, x1, y1, x2, y2, bend, color) {
    color = color || RED;
    var mx = (x1 + x2) / 2 + (bend || 0), my = (y1 + y2) / 2 - Math.abs(bend || 0);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
    var ang = Math.atan2(y2 - my, x2 - mx);
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 14 * Math.cos(ang - 0.45), y2 - 14 * Math.sin(ang - 0.45));
    ctx.lineTo(x2 - 14 * Math.cos(ang + 0.45), y2 - 14 * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  function dash(ctx, x1, y1, x2, y2, color) {
    ctx.save(); ctx.setLineDash([8, 8]); line(ctx, x1, y1, x2, y2, color || RED, 3); ctx.restore();
  }

  function head(ctx, x, y, r) { circ(ctx, x, y, r || 25, PAPER, INK, 5); }

  function dumbbell(ctx, x, y, angle, s) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle || 0); ctx.scale(s || 1, s || 1);
    line(ctx, -28, 0, 28, 0, INK, 5);
    line(ctx, -30, -13, -30, 13, INK, 10); line(ctx, 30, -13, 30, 13, INK, 10);
    ctx.restore();
  }

  function weightStack(ctx, x, y, w, h, sel) {
    rr(ctx, x, y, w, h, 8, null, INK, 3);
    for (var i = 0; i < 6; i++) {
      var yy = y + 14 + i * (h - 26) / 6;
      line(ctx, x + 7, yy, x + w - 7, yy, i === (sel || 4) ? ORANGE : LIGHT, i === (sel || 4) ? 7 : 3);
    }
    line(ctx, x + w / 2, y, x + w / 2, y - 34, GRAY, 3);
  }

  function floor(ctx) { line(ctx, 90, 540, 870, 540, LIGHT, 2); }

  function register(id, name, draw, tips, mistakes) {
    FIGURES[id] = { name: name, draw: draw, tips: tips || [], mistakes: mistakes || [] };
  }

  function drawFrame(ctx, cw, ch, fig, p, fault) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cw, ch);
    var s = Math.min(cw / W, ch / H);
    ctx.setTransform(s, 0, 0, s, (cw - W * s) / 2, (ch - H * s) / 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    fig.draw(ctx, W, H, p, fault);
  }

  function createPlayer(canvas, id) {
    var fig = FIGURES[id] || FIGURES.pulldown;
    var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    var mode = 'correct', paused = false, stopped = false, start = performance.now(), raf = 0;
    if (!ctx) return { setMode: function () {}, setPaused: function () {}, stop: function () {} };

    function fit() {
      var rect = canvas.getBoundingClientRect();
      var cssW = rect.width || 360;
      var cssH = rect.height || cssW * 10 / 16;
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var cw = Math.max(1, Math.round(cssW * dpr));
      var ch = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      return { cw: cw, ch: ch };
    }

    function frame(now) {
      if (stopped) return;
      if (document.visibilityState === 'visible' && !paused) {
        var size = fit();
        var sec = ((now - start) / 1000) % 2.4;
        var p;
        if (sec < 1) p = easeInOut(sec);
        else if (sec < 1.2) p = 1;
        else p = 1 - easeInOut((sec - 1.2) / 1.2);
        drawFrame(ctx, size.cw, size.ch, fig, p, mode === 'fault');
      }
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return {
      setMode: function (m) { mode = m === 'fault' ? 'fault' : 'correct'; start = performance.now(); },
      setPaused: function (v) { paused = !!v; if (!paused) start = performance.now(); },
      stop: function () { stopped = true; cancelAnimationFrame(raf); }
    };
  }

  register('pulldown', '高位下拉', function (ctx, w, h, p, fault) {
    floor(ctx);
    line(ctx, 300, 100, 690, 100, INK, 3);
    line(ctx, 300, 100, 300, 525, INK, 3);
    line(ctx, 690, 100, 690, 225, INK, 3);
    weightStack(ctx, 645, 215, 82, 245, 3);
    line(ctx, 690, 225, 480, 112, GRAY, 3);
    rr(ctx, 360, 410, 240, 22, 9, PAPER, INK, 3);
    line(ctx, 385, 432, 385, 515, INK, 3);
    line(ctx, 575, 432, 575, 515, INK, 3);
    var lean = fault ? 38 : 0;
    var hipX = 480, hipY = 392;
    var shX = 480 + lean, shY = fault ? 258 : 278;
    var headX = shX + 2, headY = shY - 38;
    line(ctx, hipX, hipY, shX, shY, INK, 7);
    line(ctx, hipX, hipY, 422, 432, INK, 7);
    line(ctx, 422, 432, 412, 510, INK, 7);
    line(ctx, hipX, hipY, 538, 432, INK, 7);
    line(ctx, 538, 432, 548, 510, INK, 7);
    head(ctx, headX, headY, 25);
    var barY = lerp(170, 300, p);
    var handLX = 408 + lean * 0.35, handRX = 552 + lean * 0.35;
    var elbowY = lerp(215, 315, p);
    var elbowLX = 408 + lean * 0.55, elbowRX = 552 + lean * 0.55;
    var shLX = shX - 28, shRX = shX + 28;
    line(ctx, shLX, shY, elbowLX, elbowY, INK, 6);
    line(ctx, elbowLX, elbowY, handLX, barY, INK, 6);
    line(ctx, shRX, shY, elbowRX, elbowY, INK, 6);
    line(ctx, elbowRX, elbowY, handRX, barY, INK, 6);
    line(ctx, handLX, barY, handRX, barY, INK, 7);
    line(ctx, 480, 112, 480, barY, GRAY, 3);
    circ(ctx, 480, barY, 6, INK, null, 0);
    if (fault) {
      label(ctx, '后仰', 560, 140);
      arrow(ctx, 560, 360, 610, 270, -55, RED);
      dash(ctx, 480, 392, 480, 300, RED);
    }
  }, [
    '腿垫固定，躯干保持稳定',
    '肘向下拉，回放要慢',
    '不前后摇摆借力'
  ], [
    '身体后仰借力',
    '耸肩，让斜方肌代偿',
    '只拉半程，回放失控'
  ]);

  register('row', '胸支撑器械划船', function (ctx, w, h, p, fault) {
    floor(ctx);
    line(ctx, 290, 515, 730, 515, INK, 3);
    line(ctx, 300, 500, 300, 170, INK, 3);
    line(ctx, 300, 170, 700, 170, INK, 3);
    line(ctx, 700, 170, 700, 500, INK, 3);
    rr(ctx, 372, 245, 52, 185, 16, '#E7E1D4', INK, 3);
    weightStack(ctx, 655, 205, 72, 230, 2);
    var lean = fault ? 26 : 0;
    var hipX = 565 + lean, hipY = 397;
    var shX = 447 + lean * 0.7, shY = fault ? 287 : 302;
    var headX = shX - 36, headY = shY - 26;
    line(ctx, hipX, hipY, shX, shY, INK, 7);
    line(ctx, hipX, hipY, 592, 438, INK, 7);
    line(ctx, 592, 438, 610, 510, INK, 7);
    line(ctx, hipX, hipY, 650, 438, INK, 7);
    line(ctx, 650, 438, 665, 510, INK, 7);
    head(ctx, headX, headY, 24);
    line(ctx, shX - 18, shY, 510, 330, INK, 6);
    line(ctx, shX + 18, shY, 520, 345, INK, 6);
    var handleX = lerp(575, 430, p);
    var handleY = lerp(335, 305, p);
    line(ctx, 510, 330, handleX, handleY, INK, 6);
    line(ctx, 520, 345, handleX, handleY + 12, INK, 6);
    rr(ctx, handleX - 10, handleY - 30, 20, 60, 8, PAPER, INK, 4);
    line(ctx, 700, 255, handleX + 10, handleY, GRAY, 3);
    if (fault) {
      label(ctx, '甩腰', 585, 215);
      arrow(ctx, 590, 350, 625, 300, -42, RED);
      dash(ctx, 450, 310, 540, 310, RED);
    }
  }, [
    '胸贴垫，保持接触',
    '拉回和放回都让肩胛自然运动',
    '不甩腰，不用身体惯性'
  ], [
    '用腰发力把身体拉离垫子',
    '耸肩，手臂没有真正往后拉',
    '只拉一半就急着回放'
  ]);

  register('incline', '上斜器械推胸', function (ctx, w, h, p, fault) {
    floor(ctx);
    line(ctx, 290, 515, 735, 515, INK, 3);
    path(ctx, [[330, 510], [360, 330], [395, 230]], false, INK, 3);
    line(ctx, 395, 230, 560, 230, INK, 3);
    rr(ctx, 365, 250, 58, 185, 15, '#E7E1D4', INK, 3);
    line(ctx, 600, 515, 600, 350, GRAY, 3);
    weightStack(ctx, 650, 245, 70, 210, 4);
    var arch = fault ? 22 : 0;
    var hipX = 462, hipY = 390;
    var shX = 452 + arch, shY = fault ? 278 : 292;
    var headX = 470 + arch, headY = 242;
    line(ctx, hipX, hipY, shX, shY, INK, 7);
    line(ctx, hipX, hipY, 510, 442, INK, 7);
    line(ctx, 510, 442, 515, 510, INK, 7);
    line(ctx, hipX, hipY, 590, 420, INK, 7);
    line(ctx, 590, 420, 620, 492, INK, 7);
    head(ctx, headX, headY, 24);
    var handX = lerp(540, 670, p), handY = lerp(330, 280, p);
    line(ctx, shX - 25, shY, 505, 330, INK, 6);
    line(ctx, shX + 25, shY, 535, 340, INK, 6);
    line(ctx, 505, 330, handX, handY, INK, 6);
    line(ctx, 535, 340, handX + 12, handY + 18, INK, 6);
    rr(ctx, handX - 10, handY - 25, 20, 50, 8, PAPER, INK, 4);
    line(ctx, 670, 255, handX + 8, handY, GRAY, 3);
    if (fault) {
      label(ctx, '拱腰', 500, 205);
      arrow(ctx, 460, 405, 430, 330, -38, RED);
      dash(ctx, 450, 310, 395, 310, RED);
    }
  }, [
    '背部稳定贴垫，双脚踩稳',
    '在无痛可控范围推起',
    '下放约 2 秒，不让配重砸回'
  ], [
    '大幅拱腰，腰椎代偿',
    '肘锁死或猛弹',
    '下放过快，失去控制'
  ]);

  register('lateral', '哑铃侧平举', function (ctx, w, h, p, fault) {
    floor(ctx);
    var shrug = fault ? 18 : 0;
    head(ctx, 470, 148 - shrug, 25);
    line(ctx, 470, 176 - shrug, 470, 340, INK, 7);
    line(ctx, 470, 340, 430, 430, INK, 7);
    line(ctx, 430, 430, 420, 520, INK, 7);
    line(ctx, 470, 340, 510, 430, INK, 7);
    line(ctx, 510, 430, 520, 520, INK, 7);
    var shY = 215 - shrug;
    line(ctx, 445, shY, 495, shY, INK, 7);
    var handLX = lerp(398, 330, p), handLY = lerp(348, 245, p);
    var handRX = lerp(542, 610, p), handRY = lerp(348, 245, p);
    var elbowLX = lerp(414, 382, p), elbowLY = lerp(286, 255, p);
    var elbowRX = lerp(526, 558, p), elbowRY = lerp(286, 255, p);
    line(ctx, 445, shY, elbowLX, elbowLY, INK, 6);
    line(ctx, elbowLX, elbowLY, handLX, handLY, INK, 6);
    line(ctx, 495, shY, elbowRX, elbowRY, INK, 6);
    line(ctx, elbowRX, elbowRY, handRX, handRY, INK, 6);
    dumbbell(ctx, handLX, handLY, 0, 0.72);
    dumbbell(ctx, handRX, handRY, 0, 0.72);
    if (fault) {
      label(ctx, '耸肩', 560, 145);
      arrow(ctx, 520, 250, 535, 205, -22, RED);
      arrow(ctx, 420, 250, 405, 205, 22, RED);
      dash(ctx, 445, shY + 34, 495, shY + 34, RED);
    }
  }, [
    '肘微屈，抬到舒适高度',
    '用中轻重量，控制下落',
    '不甩动，不追求超过肩的高度'
  ], [
    '耸肩，用斜方肌把手臂提起来',
    '重量过大，靠身体摆动',
    '手腕高于肘，动作变形'
  ]);

  register('reverseFly', '反向蝴蝶机', function (ctx, w, h, p, fault) {
    floor(ctx);
    rr(ctx, 430, 238, 96, 175, 18, '#E7E1D4', INK, 3);
    line(ctx, 320, 515, 700, 515, INK, 3);
    line(ctx, 340, 515, 340, 245, INK, 3);
    line(ctx, 340, 245, 640, 245, INK, 3);
    line(ctx, 640, 245, 640, 515, INK, 3);
    weightStack(ctx, 650, 290, 65, 190, 3);
    var lean = fault ? 26 : 0;
    var shX = 478 + lean, shY = 285;
    head(ctx, 470 + lean, 225, 24);
    line(ctx, 478, 380, shX, shY, INK, 7);
    line(ctx, 478, 380, 440, 442, INK, 7);
    line(ctx, 440, 442, 435, 515, INK, 7);
    line(ctx, 478, 380, 540, 435, INK, 7);
    line(ctx, 540, 435, 550, 512, INK, 7);
    line(ctx, shX - 28, shY, shX + 28, shY, INK, 7);
    var handLX = lerp(445, 330, p), handRX = lerp(511, 626, p);
    var handY = lerp(340, 300, p);
    var elbowLX = lerp(430, 390, p), elbowRX = lerp(526, 566, p);
    line(ctx, shX - 28, shY, elbowLX, 310, INK, 6);
    line(ctx, elbowLX, 310, handLX, handY, INK, 6);
    line(ctx, shX + 28, shY, elbowRX, 310, INK, 6);
    line(ctx, elbowRX, 310, handRX, handY, INK, 6);
    rr(ctx, handLX - 8, handY - 22, 16, 44, 7, PAPER, INK, 3);
    rr(ctx, handRX - 8, handY - 22, 16, 44, 7, PAPER, INK, 3);
    if (fault) {
      label(ctx, '挺腰', 555, 200);
      arrow(ctx, 545, 375, 590, 320, -38, RED);
      dash(ctx, 478, 330, 478, 400, RED);
    }
  }, [
    '胸贴垫，肘微屈',
    '向两侧打开，肩胛自然收紧',
    '不挺腰，不用惯性猛夹'
  ], [
    '挺腰，把胸口推离垫子',
    '耸肩，手臂高于肩线',
    '借力甩动，回放失控'
  ]);

  register('shoulderPress', '坐姿器械肩推', function (ctx, w, h, p, fault) {
    floor(ctx);
    line(ctx, 300, 515, 720, 515, INK, 3);
    line(ctx, 320, 515, 320, 215, INK, 3);
    line(ctx, 320, 215, 680, 215, INK, 3);
    line(ctx, 680, 215, 680, 515, INK, 3);
    rr(ctx, 410, 265, 55, 155, 15, '#E7E1D4', INK, 3);
    weightStack(ctx, 655, 260, 70, 210, 4);
    var arch = fault ? 20 : 0;
    head(ctx, 475 + arch, 220, 25);
    line(ctx, 475, 382, 475 + arch, 285, INK, 7);
    line(ctx, 475, 382, 435, 445, INK, 7);
    line(ctx, 435, 445, 428, 515, INK, 7);
    line(ctx, 475, 382, 525, 445, INK, 7);
    line(ctx, 525, 445, 535, 515, INK, 7);
    line(ctx, 445 + arch, 285, 505 + arch, 285, INK, 7);
    var handLX = lerp(420, 405, p), handRX = lerp(530, 545, p);
    var handY = lerp(300, 155, p);
    line(ctx, 445 + arch, 285, 400, 305, INK, 6);
    line(ctx, 505 + arch, 285, 550, 305, INK, 6);
    line(ctx, 400, 305, handLX, handY, INK, 6);
    line(ctx, 550, 305, handRX, handY, INK, 6);
    rr(ctx, handLX - 12, handY - 9, 24, 18, 7, PAPER, INK, 4);
    rr(ctx, handRX - 12, handY - 9, 24, 18, 7, PAPER, INK, 4);
    if (fault) {
      label(ctx, '拱腰', 520, 170);
      arrow(ctx, 485, 400, 515, 325, -35, RED);
      dash(ctx, 420, 320, 420, 390, RED);
    }
  }, [
    '背贴垫，躯干稳定',
    '从舒适位置推起，肘不锁死',
    '下放到可控范围再推'
  ], [
    '大幅拱腰，肋骨外翻',
    '颈部前伸去够重量',
    '只做半程，配重撞击'
  ]);

  register('legPress', '腿举', function (ctx, w, h, p, fault) {
    floor(ctx);
    line(ctx, 190, 515, 805, 515, INK, 3);
    line(ctx, 235, 500, 330, 295, INK, 3);
    line(ctx, 330, 295, 430, 300, INK, 3);
    path(ctx, [[250, 500], [315, 350], [390, 300]], false, INK, 3);
    rr(ctx, 260, 410, 80, 105, 14, '#E7E1D4', INK, 3);
    line(ctx, 520, 515, 520, 330, INK, 3);
    line(ctx, 745, 515, 745, 285, INK, 3);
    var platformX = lerp(625, 735, p);
    line(ctx, platformX, 260, platformX, 455, INK, 7);
    rr(ctx, platformX - 13, 250, 26, 215, 9, PAPER, INK, 4);
    rr(ctx, platformX - 25, 300, 50, 28, 8, '#E7E1D4', INK, 3);
    rr(ctx, platformX - 25, 405, 50, 28, 8, '#E7E1D4', INK, 3);
    var hipX = 410, hipY = 375;
    var kneeX = lerp(525, 585, p), kneeY = lerp(400, 345, p);
    var footX = platformX - 26, footY = lerp(405, 340, p);
    head(ctx, 262, 305, 24);
    line(ctx, 320, 325, hipX, hipY, INK, 7);
    line(ctx, hipX, hipY, kneeX, kneeY, INK, 7);
    line(ctx, kneeX, kneeY, footX, footY, INK, 7);
    line(ctx, footX, footY - 18, footX, footY + 18, INK, 7);
    line(ctx, 320, 325, 370, 280, INK, 6);
    if (fault) {
      label(ctx, '膝内扣', 545, 235);
      arrow(ctx, 500, 430, 552, 400, -18, RED);
      arrow(ctx, 605, 430, 558, 400, 18, RED);
      dash(ctx, 500, 365, 610, 365, RED);
    }
  }, [
    '全脚掌踩稳，膝跟随脚尖方向',
    '下降到骨盆和腰背仍贴垫',
    '不锁膝，推到可控范围即可'
  ], [
    '膝内扣，鞋底内侧翘起',
    '屁股离垫、腰背卷起',
    '幅度过大或锁死膝盖'
  ]);

  register('legCurl', '坐姿腿弯举', function (ctx, w, h, p, fault) {
    floor(ctx);
    line(ctx, 250, 515, 760, 515, INK, 3);
    line(ctx, 300, 500, 300, 250, INK, 3);
    line(ctx, 300, 250, 690, 250, INK, 3);
    line(ctx, 690, 250, 690, 500, INK, 3);
    rr(ctx, 345, 255, 55, 160, 15, '#E7E1D4', INK, 3);
    rr(ctx, 390, 410, 175, 20, 8, PAPER, INK, 3);
    weightStack(ctx, 665, 270, 65, 205, 2);
    var lift = fault ? -30 : 0;
    var hipY = 390 + lift;
    head(ctx, 385, 235 + lift, 24);
    line(ctx, 385, hipY, 385, 275 + lift, INK, 7);
    line(ctx, 385, hipY, 545, 390 + lift, INK, 7);
    line(ctx, 545, 390 + lift, 555, 510, INK, 7);
    line(ctx, 385, hipY, 420, 440 + lift, INK, 6);
    var footX = lerp(585, 610, p), footY = lerp(505, 325, p) + lift;
    line(ctx, 545, 390 + lift, footX, footY, INK, 7);
    rr(ctx, footX - 12, footY - 14, 24, 28, 7, PAPER, INK, 4);
    line(ctx, 560, 435 + lift, 640, 435 + lift, INK, 5);
    line(ctx, 640, 435 + lift, 640, 285, GRAY, 3);
    if (fault) {
      label(ctx, '抬臀', 570, 215);
      arrow(ctx, 470, 450, 515, 400, -28, RED);
      dash(ctx, 370, 420, 470, 420, RED);
    }
  }, [
    '膝对准转轴，大腿压垫固定',
    '慢慢回放，不让配重弹回',
    '全程保持骨盆稳定'
  ], [
    '弹配重，用惯性完成',
    '抬臀，身体被拉起来',
    '只做半程，回放失控'
  ]);

  register('calf', '器械提踵', function (ctx, w, h, p, fault) {
    floor(ctx);
    rr(ctx, 392, 500, 190, 40, 6, '#E7E1D4', INK, 3);
    line(ctx, 392, 540, 582, 540, INK, 3);
    var rise = fault ? 0 : 28 * p;
    var headY = 145 - rise;
    head(ctx, 465, headY, 24);
    line(ctx, 465, headY + 28, 465, 340 - rise, INK, 7);
    line(ctx, 465, 340 - rise, 450, 430 - rise, INK, 7);
    line(ctx, 450, 430 - rise, 468, 492 - rise, INK, 7);
    line(ctx, 465, 340 - rise, 500, 430 - rise, INK, 7);
    line(ctx, 500, 430 - rise, 492, 492 - rise, INK, 7);
    var heelY = fault ? 520 : 516 - 48 * p;
    line(ctx, 468, 492 - rise, 420, heelY, INK, 6);
    line(ctx, 420, heelY, 548, 505, INK, 6);
    line(ctx, 492, 492 - rise, 448, heelY - 2, INK, 6);
    line(ctx, 448, heelY - 2, 548, 505, INK, 6);
    if (fault) {
      label(ctx, '弹跳', 560, 190);
      arrow(ctx, 610, 410, 610, 500, 0, RED);
      arrow(ctx, 630, 500, 630, 420, 0, RED);
      arrow(ctx, 430, 520, 370, 520, -22, RED);
      dash(ctx, 410, 520, 540, 520, RED);
    }
  }, [
    '前脚掌稳定支撑在台阶上',
    '脚跟平稳升降，顶端停一下',
    '不弹跳，不做小幅度抖动'
  ], [
    '弹跳借力，跟腱受力突增',
    '踝外翻，脚掌内侧塌下去',
    '幅度太小，只抖脚跟'
  ]);

  register('pushdown', '绳索下压', function (ctx, w, h, p, fault) {
    floor(ctx);
    line(ctx, 660, 90, 660, 515, INK, 3);
    line(ctx, 660, 90, 830, 90, INK, 3);
    rr(ctx, 700, 90, 20, 18, 4, INK, null, 0);
    weightStack(ctx, 790, 165, 66, 235, 4);
    line(ctx, 710, 100, 710, 175, GRAY, 3);
    var lean = fault ? 24 : 0;
    head(ctx, 455 + lean, 165, 24);
    line(ctx, 455, 340, 455 + lean, 198, INK, 7);
    line(ctx, 455, 340, 420, 435, INK, 7);
    line(ctx, 420, 435, 412, 520, INK, 7);
    line(ctx, 455, 340, 500, 435, INK, 7);
    line(ctx, 500, 435, 510, 520, INK, 7);
    var handY = lerp(275, 395, p);
    line(ctx, 475 + lean, 225, 545, 300, INK, 6);
    line(ctx, 545, 300, 575, handY, INK, 6);
    line(ctx, 545, 300, 710, 300, GRAY, 3);
    line(ctx, 710, 175, 575, handY, GRAY, 3);
    circ(ctx, 575, handY, 5, INK, null, 0);
    if (fault) {
      label(ctx, '躯干压', 535, 180);
      arrow(ctx, 490, 260, 530, 330, -34, RED);
      dash(ctx, 455, 230, 500, 260, RED);
    }
  }, [
    '上臂相对固定，肘位不飘',
    '伸肘后慢放，保持张力',
    '只用前臂完成动作'
  ], [
    '躯干向下猛压借力',
    '肘向外张开，变成推',
    '耸肩，肩膀跟着往下掉'
  ]);

  register('biceps', '哑铃弯举', function (ctx, w, h, p, fault) {
    floor(ctx);
    var lean = fault ? 26 : 0;
    head(ctx, 465 + lean, 150, 25);
    line(ctx, 465, 340, 465 + lean, 185, INK, 7);
    line(ctx, 465, 340, 430, 430, INK, 7);
    line(ctx, 430, 430, 422, 520, INK, 7);
    line(ctx, 465, 340, 510, 430, INK, 7);
    line(ctx, 510, 430, 520, 520, INK, 7);
    line(ctx, 453 + lean, 212, 548 + lean, 220, INK, 7);
    var handX = lerp(555, 530, p), handY = lerp(355, 235, p);
    line(ctx, 535 + lean, 225, 540, 300, INK, 6);
    line(ctx, 540, 300, handX, handY, INK, 6);
    dumbbell(ctx, handX, handY, 0, 0.72);
    if (fault) {
      label(ctx, '后仰', 555, 140);
      arrow(ctx, 550, 300, 595, 235, -36, RED);
      dash(ctx, 465, 200, 465, 300, RED);
    }
  }, [
    '每侧独立完成，肘位稳定',
    '下放到底，再控制着弯起',
    '不后仰，不甩腰'
  ], [
    '甩腰，用身体把哑铃带起来',
    '肘向前跑，变成前平举',
    '只做半程，回放直接掉下'
  ]);

  register('deadbug', '死虫式', function (ctx, w, h, p, fault) {
    line(ctx, 170, 505, 800, 505, LIGHT, 3);
    var lift = fault ? 14 : 0;
    head(ctx, 300, 430 - lift, 24);
    line(ctx, 335, 450 - lift, 520, 455 - lift, INK, 7);
    line(ctx, 520, 455 - lift, 575, 390 - lift, INK, 7);
    var kneeX = lerp(575, 615, p), kneeY = lerp(390, 420, p) - lift;
    var footX = lerp(610, 720, p), footY = lerp(445, 480, p) - lift;
    line(ctx, 520, 455 - lift, kneeX, kneeY, INK, 7);
    line(ctx, kneeX, kneeY, footX, footY, INK, 7);
    line(ctx, 520, 455 - lift, 600, 455 - lift, INK, 7);
    line(ctx, 600, 455 - lift, 610, 415 - lift, INK, 7);
    var armHandX = lerp(380, 250, p), armHandY = lerp(320, 425, p) - lift;
    line(ctx, 350, 440 - lift, 360, 370 - lift, INK, 6);
    line(ctx, 360, 370 - lift, armHandX, armHandY, INK, 6);
    line(ctx, 400, 440 - lift, 410, 370 - lift, INK, 6);
    line(ctx, 410, 370 - lift, 430, 320 - lift, INK, 6);
    line(ctx, 210, 505, 740, 505, LIGHT, 2);
    if (fault) {
      label(ctx, '腰离地', 535, 540);
      arrow(ctx, 460, 470, 460, 520, -28, RED);
      dash(ctx, 430, 488, 545, 488, RED);
      dash(ctx, 430, 505, 545, 505, RED);
    }
  }, [
    '腰背贴地，肋骨不外翻',
    '对侧手脚交替伸展，呼气',
    '先缩短伸展距离，控制速度'
  ], [
    '腰离地，腰椎过度伸展',
    '憋气硬撑',
    '速度过快，用惯性甩手脚'
  ]);

  function drawGlute(ctx, p, fault, machine) {
    line(ctx, 160, 520, 820, 520, LIGHT, 3);
    if (machine) {
      line(ctx, 250, 520, 250, 300, INK, 3);
      line(ctx, 250, 300, 760, 300, INK, 3);
      line(ctx, 760, 300, 760, 520, INK, 3);
      line(ctx, 390, 520, 390, 335, INK, 3);
      weightStack(ctx, 690, 340, 65, 170, 2);
    }
    var lift = lerp(0, 78, p);
    var hipY = 465 - (fault ? 20 : lift);
    head(ctx, 292, 448, 24);
    line(ctx, 330, 468, 515, hipY, INK, 7);
    line(ctx, 515, hipY, 605, 395, INK, 7);
    line(ctx, 605, 395, 650, 495, INK, 7);
    line(ctx, 515, hipY, 590, 455, INK, 7);
    line(ctx, 590, 455, 650, 495, INK, 7);
    line(ctx, 330, 468, 280, 490, INK, 6);
    line(ctx, 515, hipY, 560, 495, INK, 6);
    if (machine) {
      var padY = hipY - 30;
      rr(ctx, 470, padY, 100, 24, 10, '#E7E1D4', INK, 3);
      line(ctx, 520, padY - 8, 520, 335, INK, 3);
    }
    if (fault) {
      label(ctx, '用腰顶', 545, 335);
      arrow(ctx, 500, hipY + 20, 545, hipY - 45, -34, RED);
      dash(ctx, 430, 500, 550, 500, RED);
      arrow(ctx, 575, 455, 625, 455, -24, RED);
      arrow(ctx, 645, 455, 600, 455, 24, RED);
    }
  }

  register('gluteMachine', '臀桥机', function (ctx, w, h, p, fault) {
    drawGlute(ctx, p, fault, true);
  }, [
    '脚跟发力，平稳伸髋',
    '顶端停一下，不靠腰椎过度后仰',
    '膝盖跟随脚尖，骨盆保持稳定'
  ], [
    '用腰顶，肋骨外翻',
    '膝内扣，膝盖向内塌',
    '幅度过大，腰部代偿'
  ]);

  register('gluteBodyweight', '自重臀桥', function (ctx, w, h, p, fault) {
    drawGlute(ctx, p, fault, false);
  }, [
    '脚跟发力，平稳顶髋',
    '顶端停一下，再控制着落下',
    '膝盖跟随脚尖，腰背不过度反弓'
  ], [
    '用腰顶，腰部先于臀部发力',
    '膝内扣，脚掌内侧塌陷',
    '幅度过大或快速弹起'
  ]);

  register('crunch', '卷腹', function (ctx, w, h, p, fault) {
    line(ctx, 150, 515, 820, 515, LIGHT, 3);
    var curl = fault ? 58 : 58 * p;
    var shX = 350 + curl * 0.62, shY = 455 - curl;
    var headX = 300 + curl * 0.62, headY = 448 - curl;
    line(ctx, 515, 460, 600, 400, INK, 7);
    line(ctx, 600, 400, 640, 495, INK, 7);
    line(ctx, 515, 460, 590, 455, INK, 7);
    line(ctx, 590, 455, 640, 495, INK, 7);
    line(ctx, 515, 460, shX, shY, INK, 7);
    head(ctx, headX, headY, 24);
    line(ctx, shX - 8, shY - 5, headX - 18, headY - 8, INK, 6);
    line(ctx, shX + 8, shY - 6, headX + 18, headY - 10, INK, 6);
    if (fault) {
      label(ctx, '拉脖子', 495, 340);
      arrow(ctx, 465, 380, 410, 360, -30, RED);
      dash(ctx, headX - 40, headY - 25, headX + 40, headY - 25, RED);
    }
  }, [
    '呼气卷起肩胛，腰部不离地',
    '慢慢落下，控制离心',
    '下巴微收，颈部放松'
  ], [
    '双手拉脖子，颈部代偿',
    '用惯性甩起上身',
    '腰离地，变成仰卧起坐'
  ]);

  window.FIGURES = FIGURES;
  window.Figures = { FIGURES: FIGURES, createPlayer: createPlayer };
})();
