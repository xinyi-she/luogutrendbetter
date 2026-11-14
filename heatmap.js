// ==UserScript==
// @name         洛谷 做题趋势 · 美化版
// @namespace    https://www.luogu.com.cn/
// @version      1.0.0
// @description  把洛谷个人主页的「做题趋势」热力图换成渐变卡片风格：柔和配色、悬浮微动效、点击涟漪、详情气泡、统计徽章
// @author       -
// @match        https://www.luogu.com.cn/user/*
// @icon         https://www.luogu.com.cn/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.__lgxTrendLoaded) return;
  window.__lgxTrendLoaded = true;

  /* ============================ 配置 ============================ */

  const CFG = {
    weeks: 27,        // 显示多少周（27 周 ≈ 半年）
    gap: 3,           // 方格间距(px)
  };

  // 难度色阶：索引 0 未评定，1..8 由易到难
  const DIFF = [
    { name: '未评定',      c: '#c9c6d4' },
    { name: '入门',        c: '#f4707f' },
    { name: '普及−',       c: '#f79a4c' },
    { name: '普及/提高−',   c: '#f4c542' },
    { name: '普及+/提高',   c: '#4ec08b' },
    { name: '提高+/省选−',  c: '#33c6bf' },
    { name: '省选/NOI−',   c: '#4d9bf5' },
    { name: 'NOI/NOI+',    c: '#a855f7' },
    { name: 'NOI/CTSC',    c: '#3d3670' },
  ];

  const WD = ['日', '一', '二', '三', '四', '五', '六'];

  /* ============================ 小工具 ============================ */

  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    const f = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g) + f(b);
  }
  // 把颜色按比例混向另一个颜色，t=0 全 c1，t=1 全 c2
  function mix(c1, c2, t) {
    const a = hex2rgb(c1), b = hex2rgb(c2);
    return rgb2hex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }
  function isDark() {
    const el = document.documentElement;
    const v = (el.getAttribute('data-theme') || el.getAttribute('theme') || '') + ' ' + el.className + ' ' + document.body.className;
    if (/dark/i.test(v)) return true;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && /dark/i.test(v || '');
  }

  /* ============================ 数据读取 ============================ */

  // 洛谷新前端把页面数据塞在 <script id="lentille-context"> 里
  function readFromContext() {
    const el = document.querySelector('script#lentille-context');
    if (!el) return null;
    try {
      const j = JSON.parse(el.textContent);
      return (j && j.data && j.data.dailyCounts) || null;
    } catch (e) { return null; }
  }

  // 老前端兜底
  function readFromFeInjection() {
    try {
      const s = window._feInjection;
      if (!s) return null;
      const d = s.currentData || s.data || {};
      return (d.user && d.user.dailyCounts) || d.dailyCounts || null;
    } catch (e) { return null; }
  }

  // 最后兜底：从已有 DOM 的 title/aria-label 里抠
  function readFromDom() {
    const out = {};
    document.querySelectorAll('[title],[aria-label],[data-date]').forEach((el) => {
      const t = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-date') || '';
      const m = t.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
      if (!m) return;
      const c = t.match(/通过\s*(\d+)/) || t.match(/(\d+)\s*题/);
      out[m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3])] = [c ? +c[1] : 1, 0];
    });
    return Object.keys(out).length ? out : null;
  }

  function loadModel() {
    const raw = readFromContext() || readFromFeInjection() || readFromDom();
    if (!raw) return null;

    const map = new Map();
    let maxCount = 1;
    Object.keys(raw).forEach((k) => {
      const v = raw[k];
      const count = Array.isArray(v) ? +v[0] || 0 : +v || 0;
      const diff = Array.isArray(v) ? (+v[1] || 0) : 0;
      if (!count) return;
      map.set(k, { count, diff });
      if (count > maxCount) maxCount = count;
    });
    if (!map.size) return null;

    // 时间范围：从 CFG.weeks 周前的那周日，一直排到本周六（整列对齐，不留缺角）
    const today = startOfDay(new Date());
    const start = addDays(today, -((CFG.weeks - 1) * 7) - today.getDay());
    const end = addDays(start, CFG.weeks * 7 - 1);
    return { map, maxCount, start, end, today };
  }

  /* ============================ 定位旧面板 ============================ */

  function leafByText(txt) {
    const all = document.querySelectorAll('h1,h2,h3,h4,h5,span,div,strong,p,a,label');
    for (const el of all) {
      if (el.closest('#lgx-trend')) continue;
      if (el.childElementCount === 0 && el.textContent.trim() === txt) return el;
    }
    return null;
  }
  function leafContaining(txt) {
    const all = document.querySelectorAll('span,div,p,label,em,i,b');
    for (const el of all) {
      if (el.closest('#lgx-trend')) continue;
      const t = el.textContent.trim();
      if (el.childElementCount <= 1 && t.length < 24 && t.indexOf(txt) !== -1) return el;
    }
    return null;
  }
  function lca(a, b) {
    const set = new Set();
    for (let p = a; p; p = p.parentElement) set.add(p);
    for (let p = b; p; p = p.parentElement) if (set.has(p)) return p;
    return null;
  }

  // 用「做题趋势」标题 + 「未评定」图例这两处文字当锚点，取它们的最近公共祖先，
  // 这样既不会把别的面板框进来，也不会漏掉标题所在的卡片头。
  function findOldPanel() {
    const head = leafByText('做题趋势');
    if (!head) return null;
    const legend = leafContaining('未评定');
    let panel = legend ? lca(head, legend) : null;
    if (!panel || panel === document.body) {
      // 退一步：标题往上找 3 层
      panel = head;
      for (let i = 0; i < 3 && panel.parentElement && panel.parentElement !== document.body; i++) {
        panel = panel.parentElement;
        if (panel.textContent.replace(/\s+/g, '').length > 900) break;
      }
    }
    // 体量过大的容器（比如整页）不碰
    if (panel.querySelectorAll('*').length > 2000) return null;
    return panel;
  }

  /* ============================ 样式 ============================ */

  const CSS = `
#lgx-trend{--lgx-n:${CFG.weeks};--lgx-g:${CFG.gap}px;
  --lgx-bd:#f0f1f2;--lgx-tx:#26262b;--lgx-mut:#8b8b93;--lgx-chip:#f5f6f7;
  --lgx-blank:#f1f2f4;--lgx-accent:#3b82f6;--lgx-card:#fff;
  --lgx-font:"Yuanti SC","YouYuan","幼圆",ui-rounded,"SF Pro Rounded","PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif;
  position:relative;box-sizing:border-box;padding:14px 16px;margin:0 0 16px;border:1px solid var(--lgx-bd);
  border-radius:8px;background:var(--lgx-card);
  font-family:var(--lgx-font);font-size:13px;letter-spacing:.2px;color:var(--lgx-tx);
  overflow:hidden;animation:lgx-card-in .35s ease both;}
html[data-theme="dark"] #lgx-trend,body.dark #lgx-trend{
  --lgx-bd:#2d2d33;--lgx-tx:#e5e5ea;--lgx-mut:#8f8f99;--lgx-chip:#26262b;
  --lgx-blank:#2c2c33;--lgx-accent:#66a3ff;--lgx-card:#202024;}
#lgx-trend *{box-sizing:border-box;}
@keyframes lgx-card-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.lgx-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.lgx-title{font-size:16px;font-weight:600;color:var(--lgx-tx);display:flex;align-items:center;gap:8px;letter-spacing:0}
.lgx-pill{font-size:11.5px;font-weight:400;color:var(--lgx-mut);background:var(--lgx-chip);
  border-radius:4px;padding:2px 6px;letter-spacing:0}
.lgx-stats{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.lgx-stat{display:flex;align-items:baseline;gap:3px;font-size:12px;color:var(--lgx-mut);
  background:var(--lgx-chip);border-radius:5px;padding:3px 8px;transition:color .2s}
.lgx-stat:hover{color:var(--lgx-tx)}
.lgx-stat b{font-size:13px;color:var(--lgx-tx);font-weight:600;font-variant-numeric:tabular-nums}
.lgx-note{font-size:12px;color:var(--lgx-mut);text-decoration:none;white-space:nowrap;transition:color .2s}
.lgx-note:hover{color:var(--lgx-accent)}

.lgx-chart{display:flex;flex-direction:column;gap:6px;position:relative}
.lgx-months{position:relative;height:15px;margin-left:26px}
.lgx-month{position:absolute;top:0;font-size:11.5px;color:var(--lgx-mut);line-height:15px;
  left:calc(var(--i) * 100% / var(--lgx-n) + 1px);
  white-space:nowrap;transition:color .2s}
.lgx-month.is-hot{color:var(--lgx-tx)}

.lgx-body{display:grid;grid-template-columns:13px minmax(0,1fr);column-gap:13px;align-items:stretch}
.lgx-wd{display:grid;grid-template-rows:repeat(7,1fr);font-size:11px;color:var(--lgx-mut)}
.lgx-wd span{display:flex;align-items:center;justify-content:flex-end;transition:color .2s}
.lgx-wd span.is-hot{color:var(--lgx-tx)}
.lgx-grid{display:grid;grid-template-columns:repeat(var(--lgx-n),minmax(0,1fr));gap:var(--lgx-g);min-width:0}
.lgx-col{display:grid;grid-template-rows:repeat(7,auto);gap:var(--lgx-g);min-width:0}

.lgx-cell{width:100%;aspect-ratio:1;padding:0!important;margin:0;border:0!important;border-radius:3px;
  background:var(--lgx-blank)!important;font:inherit;min-width:0;
  cursor:default;position:relative;transition:transform .16s ease,box-shadow .16s ease,opacity .16s ease;
  animation:lgx-cell-in .38s ease both;animation-delay:calc(var(--i) * 11ms);
  -webkit-tap-highlight-color:transparent}
.lgx-cell.has{background:var(--cell-bg)!important}
@keyframes lgx-cell-in{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:none}}
.lgx-cell.has{cursor:pointer}
.lgx-cell.has:not(.is-pinned):hover,.lgx-cell.has:not(.is-pinned):focus-visible{
  transform:scale(1.28);z-index:4;outline:none;
  box-shadow:0 3px 10px -3px rgba(0,0,0,.28),0 0 0 1px rgba(0,0,0,.05)}
.lgx-cell.has:not(.is-pinned):active{transform:scale(1.16)}
.lgx-cell.is-future{opacity:.42;pointer-events:none}
.lgx-cell.blank:hover{transform:scale(1.12);background:#e8eaee!important}
html[data-theme="dark"] .lgx-cell.blank:hover,body.dark .lgx-cell.blank:hover{background:#3a3a42!important}
.lgx-cell.is-today{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.85),0 0 0 1px rgba(20,20,30,.22)}
.lgx-cell.has.is-pinned,.lgx-cell.has.is-pinned:hover{transform:scale(1.3);z-index:5;
  box-shadow:0 0 0 2px var(--lgx-card),0 0 0 3.5px var(--c),0 4px 14px -4px rgba(0,0,0,.35)}
.lgx-cell.is-pop{animation:lgx-pop .3s ease}
@keyframes lgx-pop{0%{transform:scale(1.3)}45%{transform:scale(1.48)}100%{transform:scale(1.3)}}

.lgx-rip{position:absolute;border-radius:50%;pointer-events:none;z-index:9;
  transform:translate(-50%,-50%) scale(.2);animation:lgx-rip .55s ease-out forwards}
@keyframes lgx-rip{0%{opacity:.35;transform:translate(-50%,-50%) scale(.2)}
  70%{opacity:.12}100%{opacity:0;transform:translate(-50%,-50%) scale(6)}}


#lgx-tip{position:fixed;z-index:2147483000;pointer-events:none;opacity:0;transform:translate(-50%,-4px);
  transition:opacity .14s ease,transform .14s ease;
  font-family:"Yuanti SC","YouYuan","幼圆",ui-rounded,"SF Pro Rounded","PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif;
  min-width:124px;
  background:rgba(38,38,44,.94);color:#fff;border-radius:8px;padding:8px 11px 9px;
  box-shadow:0 10px 28px -10px rgba(0,0,0,.5);backdrop-filter:blur(6px)}
#lgx-tip.on{opacity:1;transform:translate(-50%,0)}
#lgx-tip .t-date{font-size:11px;color:rgba(255,255,255,.6)}
#lgx-tip .t-main{display:flex;align-items:baseline;gap:4px;margin-top:3px}
#lgx-tip .t-num{font-size:18px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
#lgx-tip .t-unit{font-size:11px;color:rgba(255,255,255,.7)}
#lgx-tip .t-diff{display:inline-flex;align-items:center;gap:5px;margin-top:7px;font-size:11px;
  background:rgba(255,255,255,.09);border-radius:4px;padding:2px 7px 2px 6px;color:rgba(255,255,255,.88)}
#lgx-tip .t-dot{width:6px;height:6px;border-radius:50%;background:var(--tc,#c9c6d4)}
#lgx-tip .t-bar{display:flex;gap:3px;margin-top:8px}
#lgx-tip .t-bar i{width:8px;height:3px;border-radius:1.5px;background:rgba(255,255,255,.18)}
#lgx-tip .t-bar i.f{background:rgba(255,255,255,.88)}
#lgx-tip::after{content:"";position:absolute;left:50%;bottom:-3px;width:8px;height:8px;border-radius:1px;
  transform:translateX(-50%) rotate(45deg);background:rgba(38,38,44,.94)}
#lgx-tip.below::after{top:-3px;bottom:auto}

@media (max-width:700px){
  #lgx-trend{--lgx-g:3px;padding:14px 14px 10px}
  .lgx-stat{padding:2px 6px}
  .lgx-stats{margin-left:0;width:100%;justify-content:flex-start;order:3}
}
@media (prefers-reduced-motion:reduce){
  #lgx-trend,.lgx-cell{animation:none!important}
}
`;

  function injectStyle() {
    if (document.getElementById('lgx-style')) return;
    const s = document.createElement('style');
    s.id = 'lgx-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ============================ 渲染 ============================ */

  function dayColor(count, maxCount, diffIdx, dark) {
    const base = (DIFF[diffIdx] || DIFF[0]).c;
    // 题数 1..4+ → 由浅到深（混入背景的比例由大到小）
    const k = Math.min(1, (count - 1) / 3);            // 0..1
    const t = dark ? (0.44 - 0.36 * k) : (0.40 - 0.30 * k);
    return dark ? mix(base, '#1c1b23', t) : mix(base, '#ffffff', t);
  }

  function buildCard(model) {
    const dark = isDark();
    const card = document.createElement('div');
    card.id = 'lgx-trend';

    /* ---- 统计 ---- */
    const days = [];
    for (let d = new Date(model.start); d <= model.end; d = addDays(d, 1)) days.push(new Date(d));

    let total = 0, active = 0, best = 0, cur = 0;
    days.forEach((d) => {
      const it = model.map.get(ymd(d));
      const c = it ? it.count : 0;
      total += c;
      if (c) { active++; cur++; if (cur > best) best = cur; } else { cur = 0; }
    });

    /* ---- 头部 ---- */
    const head = document.createElement('div');
    head.className = 'lgx-head';
    head.innerHTML =
      '<div class="lgx-title">做题趋势<span class="lgx-pill">近 ' + CFG.weeks + ' 周</span></div>' +
      '<div class="lgx-stats">' +
        '<span class="lgx-stat">通过 <b>' + total + '</b> 题</span>' +
        '<span class="lgx-stat">活跃 <b>' + active + '</b> 天</span>' +
        '<span class="lgx-stat">最长连续 <b>' + best + '</b> 天</span>' +
      '</div>' +
      '<a class="lgx-note" href="#practice">数据非实时更新</a>';
    card.appendChild(head);

    /* ---- 图表 ---- */
    const chart = document.createElement('div');
    chart.className = 'lgx-chart';

    const totalWeeks = Math.ceil(days.length / 7);
    card.style.setProperty('--lgx-n', totalWeeks);
    const cols = [];
    for (let w = 0; w < totalWeeks; w++) cols.push(days.slice(w * 7, w * 7 + 7));

    // 月份标签：在「该周周日所在月份」发生变化的那一列打标
    const months = document.createElement('div');
    months.className = 'lgx-months';
    let lastMonth = -1;
    cols.forEach((col, wi) => {
      const m = col[0].getMonth();
      if (m === lastMonth) return;
      lastMonth = m;
      // 与上一列标签太近（< 3 列）就跳过，避免挤在一起
      const prev = months.lastChild;
      if (prev && wi - (+prev.dataset.week) < 3) return;
      const span = document.createElement('span');
      span.className = 'lgx-month';
      span.style.setProperty('--i', wi);
      span.dataset.week = wi;
      span.textContent = (m + 1) + '月';
      if (wi >= cols.length - 2) { span.style.left = 'auto'; span.style.right = '0'; }
      months.appendChild(span);
    });
    chart.appendChild(months);

    // 主体
    const body = document.createElement('div');
    body.className = 'lgx-body';

    const wd = document.createElement('div');
    wd.className = 'lgx-wd';
    WD.forEach((t) => {
      const s = document.createElement('span');
      s.textContent = t;
      wd.appendChild(s);
    });
    body.appendChild(wd);

    const grid = document.createElement('div');
    grid.className = 'lgx-grid';

    cols.forEach((col, wi) => {
      const colEl = document.createElement('div');
      colEl.className = 'lgx-col';
      col.forEach((d) => {
        const key = ymd(d);
        const it = model.map.get(key);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'lgx-cell' + (it ? ' has' : ' blank');
        cell.style.setProperty('--i', wi);
        cell.dataset.date = key;
        cell.dataset.week = wi;
        cell.dataset.wd = d.getDay();
        if (key === ymd(model.today)) cell.classList.add('is-today');
        if (it) {
          const c = dayColor(it.count, model.maxCount, it.diff, dark);
          cell.style.setProperty('--cell-bg', c);
          cell.style.setProperty('--c', c);
          cell.dataset.count = it.count;
          cell.dataset.diff = it.diff;
          cell.setAttribute('aria-label', key + ' 通过 ' + it.count + ' 题');
        } else {
          cell.setAttribute('aria-label', key + ' 无记录');
          if (d > model.today) {
            cell.classList.add('is-future');
            cell.setAttribute('aria-label', key + ' 未到');
          }
        }
        colEl.appendChild(cell);
      });
      grid.appendChild(colEl);
    });
    body.appendChild(grid);
    chart.appendChild(body);
    card.appendChild(chart);

    /* ---- 交互 ---- */
    attachInteractions(card, grid, months, wd, model);

    return card;
  }

  /* ============================ 交互 ============================ */

  let tipEl = null;
  let pinned = null;

  function ensureTip() {
    if (tipEl && document.contains(tipEl)) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'lgx-tip';
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function showTip(cell, pinnedMode) {
    const tip = ensureTip();
    const count = +cell.dataset.count || 0;
    const diff = +cell.dataset.diff || 0;
    const d = new Date(cell.dataset.date.replace(/-/g, '/'));
    const info = DIFF[diff] || DIFF[0];
    const bars = 6;
    let barHtml = '';
    for (let i = 0; i < bars; i++) barHtml += '<i class="' + (i < Math.min(count, bars) ? 'f' : '') + '"></i>';

    tip.style.setProperty('--tc', info.c);
    tip.innerHTML =
      '<div class="t-date">' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 周' + WD[d.getDay()] + '</div>' +
      '<div class="t-main"><span class="t-unit">通过</span><span class="t-num">' + count + '</span><span class="t-unit">题</span></div>' +
      '<div class="t-bar">' + barHtml + '</div>' +
      '<div class="t-diff"><span class="t-dot"></span>' + info.name + '</div>';

    tip.classList.add('on');
    placeTip(cell);
    if (pinnedMode) { pinned = cell; cell.classList.add('is-pinned'); }
  }

  function placeTip(cell) {
    if (!tipEl) return;
    const r = cell.getBoundingClientRect();
    const tw = tipEl.offsetWidth || 140;
    const th = tipEl.offsetHeight || 80;
    let x = r.left + r.width / 2;
    let y = r.top - 10;
    x = Math.max(tw / 2 + 8, Math.min(window.innerWidth - tw / 2 - 8, x));
    const above = y - th > 8;
    tipEl.classList.toggle('below', !above);
    tipEl.style.left = x + 'px';
    tipEl.style.top = (above ? y - th : r.bottom + 10) + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove('on');
    if (pinned) { pinned.classList.remove('is-pinned'); pinned = null; }
  }

  function ripple(card, cell) {
    const cr = card.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    const rip = document.createElement('span');
    rip.className = 'lgx-rip';
    const size = Math.max(r.width, r.height) * 1.6;
    rip.style.width = size + 'px';
    rip.style.height = size + 'px';
    rip.style.left = (r.left - cr.left + r.width / 2) + 'px';
    rip.style.top = (r.top - cr.top + r.height / 2) + 'px';
    rip.style.background = 'radial-gradient(circle,' + (cell.style.getPropertyValue('--c') || '#9a7bf0') + ' 0%,transparent 70%)';
    card.appendChild(rip);
    setTimeout(() => rip.remove(), 700);
  }

  function attachInteractions(card, grid, months, wd, model) {
    const wdLabels = [...wd.children];
    const monthLabels = [...months.children];

    function hot(cell, on) {
      const w = cell.dataset.week, d = cell.dataset.wd;
      wdLabels.forEach((el, i) => el.classList.toggle('is-hot', on && String(i) === d));
      monthLabels.forEach((el) => {
        const cur = +el.dataset.week;
        const next = monthLabels[monthLabels.indexOf(el) + 1];
        const end = next ? +next.dataset.week : 99;
        el.classList.toggle('is-hot', on && +w >= cur && +w < end);
      });
    }

    grid.addEventListener('pointerover', (e) => {
      const cell = e.target.closest('.lgx-cell');
      if (!cell || !cell.classList.contains('has')) return;
      if (pinned) return;
      showTip(cell, false);
      hot(cell, true);
    });
    grid.addEventListener('pointerout', (e) => {
      const cell = e.target.closest('.lgx-cell');
      if (!cell) return;
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.lgx-cell') : null;
      if (to === cell) return;
      hot(cell, false);
      if (!pinned) hideTip();
    });

    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.lgx-cell');
      if (!cell) return;
      if (!cell.classList.contains('has')) {
        ripple(card, cell);
        return;
      }
      ripple(card, cell);
      cell.classList.remove('is-pop');
      void cell.offsetWidth;
      cell.classList.add('is-pop');
      setTimeout(() => cell.classList.remove('is-pop'), 380);

      if (pinned === cell) { hideTip(); return; }
      if (pinned) pinned.classList.remove('is-pinned');
      pinned = null;
      showTip(cell, true);
      hot(cell, true);
    });
  }
  /* ============================ 入口 ============================ */

  let observer = null;
  let pending = null;

  function boot() {
    // 每次都把（可能被洛谷重新渲染出来的）旧面板藏掉
    const panel = findOldPanel();
    if (panel) {
      panel.setAttribute('data-lgx-hidden', '1');
      panel.style.setProperty('display', 'none', 'important');
    }
    if (document.getElementById('lgx-trend')) return;
    if (!panel) return;
    const model = loadModel();
    if (!model) return;
    const card = buildCard(model);
    card.dataset.dark = isDark() ? '1' : '';
    panel.parentElement.insertBefore(card, panel.nextSibling);
  }

  function schedule() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; try { boot(); } catch (e) { console.warn('[lgx]', e); } }, 260);
  }

  function start() {
    injectStyle();
    boot();

    // 只关心「新插入的节点」，并且不响应自己卡片内部的变化
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.target && m.target.nodeType === 1 && m.target.closest('#lgx-trend')) continue;
        if (m.addedNodes && m.addedNodes.length) { schedule(); return; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA 路由切换
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) { last = location.href; schedule(); }
    }, 800);

    // 明暗主题切换后重绘
    new MutationObserver(() => {
      const c = document.getElementById('lgx-trend');
      if (!c) return;
      const dark = isDark();
      if (dark === (c.dataset.dark === '1')) return;
      const model = loadModel();
      if (!model) return;
      const nc = buildCard(model);
      nc.dataset.dark = dark ? '1' : '';
      c.replaceWith(nc);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'theme'] });

    // 全局交互只注册一次
    document.addEventListener('pointerdown', (e) => {
      if (!pinned) return;
      if (e.target.closest && e.target.closest('#lgx-trend')) return;
      hideTip();
    }, true);
    window.addEventListener('scroll', () => { if (pinned) placeTip(pinned); }, { passive: true });
    window.addEventListener('resize', () => { if (pinned) placeTip(pinned); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

