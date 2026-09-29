'use strict';
/*
 * Evergreen Love Studio — editor paramétrico para corte láser (xTool P2S).
 * Todo funciona en el navegador: sin servidor, sin cuentas.
 * La geometría interna siempre está en milímetros; el documento puede trabajar en mm o pulgadas.
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (s, r = document) => r.querySelector(s);
  const STORE_KEY = 'creaciones-evergreen:doc';
  const CL = window.ClipperLib; // lib/clipper.js (uniones, restas y contornos)

  /* ================= Expresiones ================= */
  const DEG = Math.PI / 180;
  const FUNCS = {
    sin: a => Math.sin(a * DEG), cos: a => Math.cos(a * DEG), tan: a => Math.tan(a * DEG),
    asin: a => Math.asin(a) / DEG, acos: a => Math.acos(a) / DEG, atan: a => Math.atan(a) / DEG,
    sqrt: Math.sqrt, raiz: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
    round: (a, d = 0) => Math.round(a * 10 ** d) / 10 ** d,
    floor: Math.floor, ceil: Math.ceil,
  };
  FUNCS.redondear = FUNCS.round; FUNCS.piso = FUNCS.floor; FUNCS.techo = FUNCS.ceil;
  const CONSTS = { pi: Math.PI };
  // Unidades: los números sin sufijo están en la unidad del documento; "3mm", "1/8in" o '2"' se convierten solos.
  const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pulg: 25.4, '"': 25.4 };
  const UNIT_RE = /^\s*(mm|cm|in|pulg|")(?![\wÀ-ɏ])/;
  const FRAC_RE = /^\s*\/\s*(\d+\.?\d*)\s*(mm|cm|in|pulg|")(?![\wÀ-ɏ])/;
  let unitMM = 1; // mm por unidad del documento
  // Máquina: xTool P2S (área con listones / con panel de panal)
  const BEDS = [
    { label: 'xTool P2S · listones (600 × 305 mm)', w: 600, h: 305 },
    { label: 'xTool P2S · panal (556 × 280 mm)', w: 556, h: 280 },
  ];
  const isIdStart = c => /[A-Za-z_À-ɏ]/.test(c);
  const isIdChar = c => /[\wÀ-ɏ]/.test(c);
  const NAME_RE = /^[A-Za-z_À-ɏ][\wÀ-ɏ]*$/;

  function evalExpr(src, vars) {
    const s = String(src);
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const expr = () => {
      let v = term();
      for (;;) {
        ws();
        if (s[i] === '+') { i++; v += term(); }
        else if (s[i] === '-') { i++; v -= term(); }
        else return v;
      }
    };
    const term = () => {
      let v = unary();
      for (;;) {
        ws();
        if (s[i] === '*') { i++; v *= unary(); }
        else if (s[i] === '/') { i++; v /= unary(); }
        else if (s[i] === '%') { i++; v %= unary(); }
        else return v;
      }
    };
    const unary = () => {
      ws();
      if (s[i] === '-') { i++; return -unary(); }
      if (s[i] === '+') { i++; return unary(); }
      const b = primary();
      ws();
      if (s[i] === '^') { i++; return Math.pow(b, unary()); }
      return b;
    };
    const primary = () => {
      ws();
      const c = s[i];
      if (c === '(') {
        i++; const v = expr(); ws();
        if (s[i] !== ')') throw new Error('falta ")"');
        i++; return v;
      }
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        const v = parseFloat(m[0]);
        const fr = FRAC_RE.exec(s.slice(i));
        if (fr) { i += fr[0].length; return v / parseFloat(fr[1]) * UNIT_MM[fr[2]] / unitMM; }
        const u = UNIT_RE.exec(s.slice(i));
        if (u) { i += u[0].length; return v * UNIT_MM[u[1]] / unitMM; }
        return v;
      }
      if (c && isIdStart(c)) {
        let j = i + 1;
        while (j < s.length && isIdChar(s[j])) j++;
        const name = s.slice(i, j); i = j; ws();
        if (s[i] === '(') {
          i++; const args = []; ws();
          if (s[i] !== ')') {
            for (;;) { args.push(expr()); ws(); if (s[i] === ',') { i++; continue; } break; }
          }
          if (s[i] !== ')') throw new Error('falta ")"');
          i++;
          const f = FUNCS[name.toLowerCase()];
          if (!f) throw new Error('función desconocida: ' + name);
          return f(...args);
        }
        if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
        if (CONSTS[name.toLowerCase()] !== undefined) return CONSTS[name.toLowerCase()];
        throw new Error('no existe "' + name + '"');
      }
      throw new Error(c ? 'símbolo inesperado "' + c + '"' : 'expresión incompleta');
    };
    if (!s.trim()) throw new Error('vacío');
    const v = expr(); ws();
    if (i < s.length) throw new Error('símbolo inesperado "' + s[i] + '"');
    if (!Number.isFinite(v)) throw new Error('resultado no válido');
    return v;
  }

  const fmt = (n, dec = 4) => String(Math.round(n * 10 ** dec) / 10 ** dec);
  const isInch = () => doc.units === 'in';
  const unitLabel = () => isInch() ? 'in' : 'mm';
  // Valor "redondo" para la unidad actual a partir de mm (pulgadas: al 1/8" más cercano)
  const nice = mm => isInch() ? fmt(Math.max(0.125, Math.round(mm / 25.4 * 8) / 8)) : fmt(mm);
  // Muestra una longitud (en unidades del documento) también en la otra unidad
  const otherUnit = v => isInch() ? `${fmt(v * 25.4, 2)} mm` : `${fmt(v / 25.4, 3)} in`;
  const isNumeric = s => /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(s);
  const r4 = n => Math.round(n * 10000) / 10000;

  // Mueve una expresión por "d" (unidades del documento) sin perder la fórmula.
  function shiftExpr(expr, d) {
    if (!d) return expr;
    if (isNumeric(expr)) return fmt(parseFloat(expr) + d);
    const m = /^(.*?)\s*([+-])\s*(\d+\.?\d*)\s*$/.exec(expr);
    if (m && m[1] && !/[+\-*/^%(,]\s*$/.test(m[1])) {
      const v = (m[2] === '+' ? 1 : -1) * parseFloat(m[3]) + d;
      if (Math.abs(v) < 1e-9) return m[1];
      return `${m[1]} ${v > 0 ? '+' : '-'} ${fmt(Math.abs(v))}`;
    }
    return `${expr} ${d > 0 ? '+' : '-'} ${fmt(Math.abs(d))}`;
  }

  /* ================= Tipos de figura ================= */
  const OPS = { corte: 'Corte', grabado: 'Grabado', marcado: 'Marcado' };
  const EDGE_OPTS = { plano: 'Plano', dedos: 'Dedos (salen)', ranuras: 'Ranuras (entran)' };
  const MODES = { grupo: 'Solo agrupar', unir: 'Unir', restar: 'Restar', intersectar: 'Intersectar' };
  const REP_OPTS = { no: 'Sin repetir', fila: 'En fila', cuadricula: 'Cuadrícula', circular: 'Circular' };
  const JOINT_OPTS = { dedos: 'Con dedos (finger joint)', planas: 'Sin dedos (para pegar)' };
  const LID_OPTS = { si: 'Con tapa', deslizante: 'Tapa deslizante', no: 'Abierta' };
  const GRIP_OPTS = { si: 'Con hueco para el dedo', no: 'Sin hueco' };
  const DRAWER_OPTS = { no: 'Sin cajón', si: 'Con cajón' };
  const ENGRAVE_OPTS = { auto: 'Automático', tapa: 'Tapa', frente: 'Frente', cajon: 'Frente del cajón' };
  const ENGRAVE_TARGETS = { tapa: ['Tapa deslizante', 'Tapa', 'Mueble techo'], frente: ['Frente', 'Frente decorativo'], cajon: ['Frente decorativo'] };
  const SLIDE_KEYS = new Set(['borde', 'holgura', 'agarre']);
  const DIM_OPTS = { exteriores: 'Exteriores', interiores: 'Interiores' };
  const ROT = ['rot', 'Rotación °'];
  const TYPES = {
    rect: { label: 'Rectángulo', props: [['x', 'X'], ['y', 'Y'], ['w', 'Ancho'], ['h', 'Alto'], ['r', 'Radio esquinas'], ROT] },
    circle: { label: 'Círculo', props: [['x', 'Centro X'], ['y', 'Centro Y'], ['d', 'Diámetro'], ROT] },
    polygon: { label: 'Polígono', props: [['x', 'Centro X'], ['y', 'Centro Y'], ['d', 'Diámetro'], ['n', 'Lados'], ROT] },
    line: { label: 'Línea', open: true, props: [['x', 'X inicio'], ['y', 'Y inicio'], ['x2', 'X final'], ['y2', 'Y final']] },
    text: { label: 'Texto', open: true, props: [['texto', 'Texto', 'text'], ['x', 'X'], ['y', 'Y (base)'], ['tam', 'Tamaño'], ROT] },
    panel: {
      label: 'Panel con dedos',
      props: [['x', 'X'], ['y', 'Y'], ['w', 'Ancho'], ['h', 'Alto'], ['t', 'Grosor material'], ['dedo', 'Ancho de dedo'],
        ['kerf', 'Kerf (corte)'], ['top', 'Borde superior', 'edge'], ['right', 'Borde derecho', 'edge'],
        ['bottom', 'Borde inferior', 'edge'], ['left', 'Borde izquierdo', 'edge'], ROT],
    },
    hinge: {
      label: 'Bisagra viva', open: true,
      props: [['x', 'X'], ['y', 'Y'], ['w', 'Ancho'], ['h', 'Alto'], ['largo', 'Largo de corte'], ['puente', 'Puente'], ['paso', 'Separación líneas'], ROT],
    },
    box: {
      label: 'Caja', noOffset: true,
      props: [['uniones', 'Uniones', JOINT_OPTS], ['cajon', 'Cajón', DRAWER_OPTS], ['nCaj', 'Cantidad de cajones'], ['holguraC', 'Holgura cajón'], ['tapa', 'Tapa', LID_OPTS],
        ['borde', 'Borde sobre la tapa'], ['holgura', 'Holgura ranura'], ['agarre', 'Agarre', GRIP_OPTS], ['medidas', 'Medidas', DIM_OPTS],
        ['x', 'X'], ['y', 'Y'], ['ancho', 'Ancho'], ['profundo', 'Profundo'], ['alto', 'Alto'], ['t', 'Grosor material'],
        ['dedo', 'Ancho de dedo'], ['kerf', 'Kerf (corte)'], ['sep', 'Separación piezas'], ROT,
        ['divX', 'Compartimentos a lo ancho'], ['divZ', 'Compartimentos a lo profundo'], ['divH', 'Altura divisiones'],
        ['grabadoEn', 'Grabar en', ENGRAVE_OPTS], ['grabadoTexto', 'Texto', 'text'], ['grabadoTam', 'Tamaño del texto'], ['logoTam', 'Ancho del logo']],
    },
    group: { label: 'Grupo', props: [['mode', 'Tipo de grupo', 'mode'], ['x', 'Mover X'], ['y', 'Mover Y'], ROT] },
  };
  // Propiedades comunes (contorno y repetición)
  const REP_FIELDS = {
    fila: [['repN', 'Cantidad'], ['repDx', 'Paso X'], ['repDy', 'Paso Y']],
    cuadricula: [['repN', 'Columnas'], ['repM', 'Filas'], ['repDx', 'Paso X'], ['repDy', 'Paso Y']],
    circular: [['repN', 'Cantidad'], ['repCx', 'Centro X'], ['repCy', 'Centro Y'], ['repA', 'Ángulo total °']],
  };
  const NON_EXPR = new Set(['texto', 'top', 'right', 'bottom', 'left', 'mode', 'rep', 'uniones', 'tapa', 'medidas', 'agarre', 'cajon', 'grabadoEn', 'grabadoTexto', 'grabadoLogo']);
  const NON_LENGTH = new Set(['n', 'rot', 'repN', 'repM', 'repA', 'divX', 'divZ', 'nCaj']);
  const isLengthKey = k => !NON_EXPR.has(k) && !NON_LENGTH.has(k);
  const canOffset = s => !TYPES[s.type].open && !TYPES[s.type].noOffset;
  // Nombre sugerido al convertir una propiedad en parámetro
  const PROMOTE_NAMES = {
    w: 'ancho', h: 'alto', d: 'diametro', r: 'radio', n: 'lados', t: 'grosor', dedo: 'dedo', kerf: 'kerf', tam: 'tam_texto',
    rot: 'giro', x: 'pos_x', y: 'pos_y', x2: 'fin_x', y2: 'fin_y', largo: 'largo_corte', puente: 'puente', paso: 'paso_bisagra',
    ancho: 'ancho', profundo: 'profundo', alto: 'alto', sep: 'sep', borde: 'borde_tapa', holgura: 'holgura', holguraC: 'holgura_cajon', nCaj: 'cajones', grabadoTam: 'tam_grabado', logoTam: 'ancho_logo', divX: 'comp_ancho', divZ: 'comp_profundo', divH: 'alto_div',
    off: 'contorno', repN: 'cantidad', repM: 'filas', repDx: 'paso_x', repDy: 'paso_y', repCx: 'centro_x', repCy: 'centro_y', repA: 'angulo',
  };

  /* ================= Estado ================= */
  let doc = null;
  let vars = {};
  let paramErrors = {};
  let sel = new Set();
  let tool = 'select';
  const view = { x: -20, y: -20, s: 3 }; // s = píxeles por mm
  let snap = true;
  let drag = null;
  let spaceDown = false;
  let lastPointer = { x: 0, y: 0 };
  let evalCache = new Map();  // id de objeto principal → resultado
  let worldCache = new Map(); // id de cualquier objeto (también hijos) → piezas en coordenadas del lienzo

  const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // sheet siempre en mm; grid en unidades del documento
  const newDoc = (units = 'mm') => ({ app: 'creaciones-evergreen', version: 2, name: 'Mi diseño', units, params: [], shapes: [], assets: {}, sheet: { w: BEDS[0].w, h: BEDS[0].h }, grid: units === 'in' ? 0.125 : 1 });

  /* ----- Árbol de objetos (los grupos tienen hijos) ----- */
  function* walk(list = doc.shapes, parent = null) {
    for (const s of list) {
      yield [s, parent];
      if (s.children) yield* walk(s.children, s);
    }
  }
  const allShapes = () => [...walk()].map(([s]) => s);
  const byId = id => { for (const [s] of walk()) if (s.id === id) return s; return null; };
  const parentOf = id => { for (const [s, p] of walk()) if (s.id === id) return p; return null; };
  const listOf = id => { const p = parentOf(id); return p ? p.children : doc.shapes; };
  function topOf(id) {
    let s = byId(id), p;
    while (s && (p = parentOf(s.id))) s = p;
    return s;
  }

  /* ================= Historial ================= */
  const undoStack = [];
  let redoStack = [];
  let savedState = '';

  function checkpoint() {
    const cur = JSON.stringify(doc);
    if (cur !== savedState) {
      undoStack.push(savedState);
      if (undoStack.length > 200) undoStack.shift();
      savedState = cur;
      redoStack = [];
      persist();
    }
    updateButtons();
  }
  function undo() {
    checkpoint();
    if (!undoStack.length) return;
    redoStack.push(savedState);
    savedState = undoStack.pop();
    doc = JSON.parse(savedState);
    afterHistory();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(savedState);
    savedState = redoStack.pop();
    doc = JSON.parse(savedState);
    afterHistory();
  }
  function afterHistory() {
    sel = new Set([...sel].filter(byId));
    persist();
    fullRender();
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch (e) { /* sin almacenamiento */ }
  }

  /* ================= Evaluación ================= */
  function evaluateParams() {
    unitMM = UNIT_MM[doc.units] || 1;
    vars = {}; paramErrors = {};
    const done = new Set();
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of doc.params) {
        if (done.has(p)) continue;
        try { vars[p.name] = evalExpr(p.expr, vars); done.add(p); progress = true; } catch (e) { /* reintentar */ }
      }
    }
    for (const p of doc.params) {
      if (!done.has(p)) {
        try { evalExpr(p.expr, vars); } catch (e) { paramErrors[p.name] = e.message; }
      }
    }
  }
  function num(s, k, def = 0) {
    const e = s.p[k];
    if (e === undefined || String(e).trim() === '') return def;
    try { return evalExpr(e, vars); } catch (err) { return NaN; }
  }
  // Longitud en mm (la geometría y el lienzo siempre trabajan en mm)
  function len(s, k, defMM = 0) {
    const e = s.p[k];
    if (e === undefined || String(e).trim() === '') return defMM;
    return num(s, k) * unitMM;
  }

  const wordRe = name => new RegExp(`(^|[^\\w\\u00C0-\\u024F])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w\\u00C0-\\u024F])`, 'g');

  // Parámetros que no son medidas (se usan en lados/rotación/cantidades o su nombre lo indica)
  function dimensionlessParams() {
    const out = new Set(doc.params.filter(p => /lados|cantidad|copias|num|giro|angulo|ángulo|veces|filas|columnas/i.test(p.name)).map(p => p.name));
    for (const s of allShapes()) {
      for (const k of NON_LENGTH) {
        const e = s.p[k];
        if (typeof e !== 'string') continue;
        for (const p of doc.params) if (wordRe(p.name).test(e)) out.add(p.name);
      }
    }
    return out;
  }

  /* ================= Geometría ================= */
  // Pieza = { op, polys: [{ pts: [[x, y]...], closed }], texts: [{ x, y, size, str, rot, anchor? }],
  //          images: [{ href, x, y, w, h, rot }] }, todo en mm.
  const TOL = 0.01; // tolerancia de curvas en mm
  function segs(r, ang) {
    if (!(r > 0)) return 2;
    const step = 2 * Math.acos(Math.max(-1, 1 - Math.min(TOL / r, 1)));
    return Math.max(2, Math.min(720, Math.ceil(ang / step)));
  }
  function arcPts(cx, cy, r, a0, a1) {
    const n = segs(r, Math.abs(a1 - a0)), out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }
  function roundRect(x, y, w, h, r) {
    if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const PI = Math.PI;
    return [
      ...arcPts(x + w - r, y + r, r, -PI / 2, 0), ...arcPts(x + w - r, y + h - r, r, 0, PI / 2),
      ...arcPts(x + r, y + h - r, r, PI / 2, PI), ...arcPts(x + r, y + r, r, PI, 1.5 * PI),
    ];
  }

  function cleanPolygon(pts) {
    const eps = 1e-7;
    let out = pts.filter((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return Math.abs(p[0] - q[0]) > eps || Math.abs(p[1] - q[1]) > eps;
    });
    let changed = true;
    while (changed && out.length > 3) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cross) < eps) { out.splice(i, 1); changed = true; break; }
      }
    }
    return out;
  }

  // Panel rectangular con uniones de dedos. Borde: plano | dedos | ranuras.
  function panelPoints(W, H, t, fw, modes, kerf) {
    const L = [W, H, W, H];
    const edges = L.map((ln, k) => {
      let n = fw > 0 ? Math.floor(ln / fw) : 1;
      if (!(n >= 1)) n = 1;
      if (n > 999) n = 999;
      if (n % 2 === 0) n--;
      const o = [];
      for (let i = 0; i < n; i++) {
        const m = modes[k];
        o.push(m === 'dedos' ? (i % 2 ? t : 0) : m === 'ranuras' ? (i % 2 ? 0 : t) : 0);
      }
      return { n, s: ln / n, o };
    });
    const at = (k, u, o) => k === 0 ? [u, o] : k === 1 ? [W - o, u] : k === 2 ? [W - u, H - o] : [o, H - u];
    let pts = [];
    for (let k = 0; k < 4; k++) {
      const e = edges[k], prev = edges[(k + 3) % 4], next = edges[(k + 1) % 4];
      const us = prev.o[prev.n - 1], ue = L[k] - next.o[0];
      for (let i = 0; i < e.n; i++) {
        const a = Math.max(i * e.s, us), b = Math.min((i + 1) * e.s, ue);
        if (b < a) continue;
        pts.push(at(k, a, e.o[i]), at(k, b, e.o[i]));
      }
    }
    return kerfOffset(cleanPolygon(pts), (kerf || 0) / 2);
  }

  // Compensación de kerf: desplaza cada borde hacia afuera k2 (polígono ortogonal, sentido horario en pantalla)
  function kerfOffset(pts, k2) {
    if (!k2) return pts;
    const N = pts.length;
    const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
    return pts.map((b, i) => {
      const a = pts[(i - 1 + N) % N], c = pts[(i + 1) % N];
      const n1 = nrm(a, b), n2 = nrm(b, c);
      return [b[0] + k2 * (n1[0] + n2[0]), b[1] + k2 * (n1[1] + n2[1])];
    });
  }

  // División interna: largo L, alto hd. Ranuras de media altura arriba o abajo (para cruzarse con otras)
  // y pestañas abajo que entran en la base. Rangos [a, b] medidos a lo largo de la pieza.
  function dividerPoints(L, hd, t, topSlots, bottomSlots, tabs, kerf) {
    const half = hd / 2, pts = [[0, 0]];
    for (const [a, b] of [...topSlots].sort((p, q) => p[0] - q[0])) pts.push([a, 0], [a, half], [b, half], [b, 0]);
    pts.push([L, 0], [L, hd]);
    const bottom = [...bottomSlots.map(r => [...r, 'slot']), ...tabs.map(r => [...r, 'tab'])].sort((p, q) => q[0] - p[0]);
    for (const [a, b, kind] of bottom) {
      const y = kind === 'slot' ? half : hd + t;
      pts.push([b, hd], [b, y], [a, y], [a, hd]);
    }
    pts.push([0, hd]);
    return kerfOffset(cleanPolygon(pts), (kerf || 0) / 2);
  }

  // Bisagra viva: líneas de corte alternadas que dejan "puentes" de material.
  function hingeLines(x, y, w, h, L, b, s) {
    const lines = [];
    if (!(L > 0) || !(s > 0) || !(b >= 0) || w < 0 || h <= 0) return lines;
    const cols = Math.min(600, Math.floor(w / s) + 1);
    const x0 = x + (w - (cols - 1) * s) / 2;
    const period = L + b;
    for (let i = 0; i < cols; i++) {
      const cx = x0 + i * s;
      let start = y + b - (i % 2 ? period / 2 : 0);
      for (let guard = 0; start < y + h && guard < 2000; guard++, start += period) {
        const a = Math.max(start, y), e = Math.min(start + L, y + h);
        if (e - a > 0.3) lines.push({ closed: false, pts: [[cx, a], [cx, e]] });
      }
    }
    return lines;
  }

  /* ----- Caja paramétrica ----- */
  // Devuelve las piezas de la caja (en mm, cada una con su origen arriba a la izquierda) y cómo se arman en 3D.
  function boxModel(s, forView = false) {
    const t = len(s, 't', 3), fw = len(s, 'dedo', 10), sep = len(s, 'sep', 5);
    const kerf = forView ? 0 : len(s, 'kerf', 0), k = kerf / 2;
    let W = len(s, 'ancho', 100), D = len(s, 'profundo', 80), H = len(s, 'alto', 60);
    const lidMode = s.p.tapa || 'si', lid = lidMode === 'si', slide = lidMode === 'deslizante';
    const fingers = (s.p.uniones || 'dedos') === 'dedos';
    if (s.p.cajon === 'si') return drawerModel(s, { t, fw, sep, kerf, W, D, H, fingers });
    // Tapa deslizante: ranura de alto (grosor + holgura) a "borde" del canto superior de los lados
    const mTop = s.p.borde && String(s.p.borde).trim() ? len(s, 'borde') : Math.max(1.5 * t, 3);
    const slotH = t + (s.p.holgura && String(s.p.holgura).trim() ? len(s, 'holgura') : 0.15);
    if (s.p.medidas === 'interiores') { W += 2 * t; D += 2 * t; H += lid ? 2 * t : slide ? t + mTop + slotH : t; }
    if (![t, fw, sep, kerf, W, D, H, mTop, slotH].every(Number.isFinite) || t <= 0 || W <= 2 * t || D <= 3 * t || H <= 2 * t) return null;
    const lidBottom = H - mTop - slotH; // altura (Y) donde se apoya la tapa deslizante
    if (slide && (mTop < 0 || lidBottom <= 3 * t)) return null;
    const innerTop = lid ? H - t : slide ? lidBottom : H;
    const rect = (w, h) => [[-k, -k], [w + k, -k], [w + k, h + k], [-k, h + k]];
    const panels = [];
    const add = (name, w, h, place, pts, extra) => panels.push({ name, w, h, place, holes: [], pts, ...extra });
    if (fingers) {
      const T = lid ? 'ranuras' : 'plano';
      const Hf = slide ? lidBottom : H;
      add('Frente', W, Hf, 'front', panelPoints(W, Hf, t, fw, [T, 'dedos', 'ranuras', 'dedos'], kerf));
      add('Atrás', W, H, 'back', panelPoints(W, H, t, fw, [T, 'dedos', 'ranuras', 'dedos'], kerf));
      const side = slide ? slideSidePoints(D, H, t, fw, Hf, mTop, slotH, D - 2 * t, kerf) : panelPoints(D, H, t, fw, [T, 'ranuras', 'ranuras', 'ranuras'], kerf);
      add('Lado izquierdo', D, H, 'left', side);
      add('Lado derecho', D, H, 'right', side);
      add('Base', W, D, 'bottom', panelPoints(W, D, t, fw, ['dedos', 'dedos', 'dedos', 'dedos'], kerf));
      if (lid) add('Tapa', W, D, 'top', panelPoints(W, D, t, fw, ['dedos', 'dedos', 'dedos', 'dedos'], kerf));
    } else {
      // Sin dedos: la base y la tapa cubren todo; frente y atrás van entre ellas; los lados, entre frente y atrás.
      const hIn = H - t - (lid ? t : 0), hFront = slide ? lidBottom - t : hIn;
      add('Frente', W, hFront, 'front', rect(W, hFront));
      add('Atrás', W, hIn, 'back', rect(W, hIn));
      const L = D - 2 * t;
      // Ranura abierta por el frente del lado (que empieza en Z = grosor), hasta 2 grosores antes del fondo
      const side = slide ? kerfOffset([[0, 0], [L, 0], [L, hIn], [0, hIn], [0, mTop + slotH], [L - t, mTop + slotH], [L - t, mTop], [0, mTop]], k) : rect(L, hIn);
      add('Lado izquierdo', L, hIn, 'left', side);
      add('Lado derecho', L, hIn, 'right', side);
      add('Base', W, D, 'bottom', rect(W, D));
      if (lid) add('Tapa', W, D, 'top', rect(W, D));
    }
    if (slide) {
      // La tapa atraviesa las ranuras de ambos lados (queda al ras por fuera) y llega hasta 2 grosores del fondo
      const Ll = D - 2 * t;
      const lidPanel = {
        name: 'Tapa deslizante', w: W, h: Ll, place: 'top', holes: [], pts: rect(W, Ll),
        axes: { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, 1, 0], o: [0, lidBottom + (slotH - t) / 2, 0], out: [0, 0, -1] },
      };
      if ((s.p.agarre || 'si') === 'si') {
        const r = Math.min(9, W / 8, Ll / 6) - k, cy = Math.min(9, W / 8, Ll / 6) + 4;
        if (r > 1) lidPanel.holes.push(Array.from({ length: 48 }, (_, i) => [W / 2 + r * Math.cos(i * Math.PI / 24), cy + r * Math.sin(i * Math.PI / 24)]));
      }
      panels.push(lidPanel);
    }
    const divs = boxDividers(s, { W, D, t, fw, kerf, innerTop, fingers }, panels.find(q => q.place === 'bottom'));
    if (!divs) return null;
    const byPlace = pl => panels.find(q => q.place === pl);
    const layout = [['front', 'back'], ['left', 'right'], ['bottom', 'top']].map(row => row.map(byPlace));
    for (let i = 0; i < divs.length; i += 4) layout.push(divs.slice(i, i + 4));
    return { W, D, H, t, fingers, lid, slide, sep, panels, dividers: divs, layout };
  }

  /* ----- Grabado de nombre o logo en la caja ----- */
  // Piezas donde se graba. Con varios cajones, cada frente decorativo (el de arriba primero).
  function engraveTargets(s, m) {
    let where = s.p.grabadoEn || 'auto';
    if (where === 'auto') where = m.drawer ? 'cajon' : (m.slide || m.lid) ? 'tapa' : 'frente';
    const faces = m.panels.filter(q => q.face).sort((a, b) => a.faceIndex - b.faceIndex);
    if (faces.length && (where === 'cajon' || where === 'frente')) return faces.map((q, i) => ({ q, lid: false, i }));
    const find = n => m.panels.find(q => q.name === n);
    const q = (ENGRAVE_TARGETS[where] || []).map(find).find(Boolean) || find('Frente') || faces[0];
    return q ? [{ q, lid: ['Tapa deslizante', 'Tapa', 'Mueble techo'].includes(q.name), i: 0 }] : [];
  }

  // Devuelve la pieza de grabado (op "grabado") centrada en la cara elegida, evitando dedos y huecos.
  function boxEngraving(s, m, placed) {
    const parts = String(s.p.grabadoTexto || '').split('|').map(x => x.trim());
    const asset = s.p.grabadoLogo && doc.assets && doc.assets[s.p.grabadoLogo];
    const all = { op: 'grabado', polys: [], texts: [], images: [] };
    for (const tg of engraveTargets(s, m)) {
      if (!placed.has(tg.q)) continue;
      // "Hilos | Botones": un nombre por cajón; un solo texto va en todos
      const str = parts.length > 1 ? (parts[tg.i] || '') : parts[0];
      const one = engraveOne(s, m, tg, str, asset, placed.get(tg.q));
      if (one) for (const k of ['polys', 'texts', 'images']) all[k].push(...one[k]);
    }
    return all.polys.length || all.texts.length || all.images.length ? all : null;
  }

  function engraveOne(s, m, tg, str, asset, [px, py]) {
    if (!str && !asset) return null;
    const { q } = tg;
    const mg = q.face ? 2.5 : m.t + 2; // margen: los frentes decorativos no llevan dedos
    let r = { x: mg, y: mg, w: q.w - 2 * mg, h: q.h - 2 * mg };
    // Si la pieza tiene un hueco (agarre), usa el espacio libre más grande arriba o abajo del hueco
    const holePts = (q.holes || []).flat();
    if (holePts.length) {
      const hy0 = Math.min(...holePts.map(p => p[1])), hy1 = Math.max(...holePts.map(p => p[1]));
      const above = { x: r.x, y: r.y, w: r.w, h: hy0 - 3 - r.y }, below = { x: r.x, y: hy1 + 3, w: r.w, h: r.y + r.h - hy1 - 3 };
      const best = above.h >= below.h ? above : below;
      if (best.h > 6) r = best;
    }
    if (r.w <= 2 || r.h <= 2) return null;
    const given = k => s.p[k] && String(s.p[k]).trim();
    let S = str ? (given('grabadoTam') ? len(s, 'grabadoTam') : Math.min(12, r.h * (asset ? 0.3 : 0.75))) : 0;
    const aspect = asset ? asset.h / asset.w : 0;
    let lw = 0;
    if (asset) lw = given('logoTam') ? len(s, 'logoTam') : Math.min(r.w * 0.6, Math.max(4, (r.h - (str ? S * 1.4 : 0)) * 0.9) / aspect);
    if (![S, lw].every(Number.isFinite)) return null;
    const textW = () => S * 0.58 * str.length;
    const gapF = str && asset ? 0.4 : 0;
    const totalW = Math.max(textW(), lw), totalH = lw * aspect + S * gapF + S;
    const k = Math.min(1, r.w / (totalW || 1), r.h / (totalH || 1)); // se achica si no cabe
    S *= k; lw *= k;
    const lh = lw * aspect, gap = S * gapF, H = lh + gap + (str ? S : 0);
    const cx = r.x + r.w / 2, top = r.y + (r.h - H) / 2;
    const it = { op: 'grabado', polys: [], texts: [], images: [] };
    if (asset && asset.kind === 'vector') {
      for (const pl of asset.polys) it.polys.push({ closed: pl.closed, pts: pl.pts.map(([u, v]) => [cx - lw / 2 + u * lw, top + v * lw]) });
    } else if (asset) {
      it.images.push({ href: asset.href, x: cx - lw / 2, y: top, w: lw, h: lh, rot: 0 });
    }
    if (str) it.texts.push({ x: cx, y: top + lh + gap + S * 0.8, size: S, str, rot: 0, anchor: 'middle' });
    // A la posición de la pieza en el plano; en las tapas se gira 180° para que se lea de frente al armar
    let mtx = mT(px, py);
    if (tg.lid) mtx = mMul(mtx, mR(180, cx, r.y + r.h / 2));
    return transformItems([it], mtx)[0];
  }

  /* ----- Mueble con cajón ----- */
  // El mueble queda abierto al frente; el cajón (caja abierta arriba) entra con holgura y lleva un frente decorativo.
  function drawerModel(s, o) {
    const { t, fw, sep, kerf, fingers } = o;
    let { W, D, H } = o;
    const k = kerf / 2;
    const c = s.p.holguraC && String(s.p.holguraC).trim() ? len(s, 'holguraC') : 1; // holgura por lado (mm)
    if (!Number.isFinite(c) || c < 0) return null;
    const n = Math.max(1, Math.min(8, Math.round(num(s, 'nCaj', 1)) || 1)); // cajones apilados
    if (s.p.medidas === 'interiores') {
      // Medidas interiores = espacio útil dentro de cada cajón
      W += 2 * t + 2 * c + 2 * t; D += 2 * t + c + t;
      H = n * (H + t + 2 * c) + (n - 1) * t + 2 * t;
    }
    const hOpen = (H - 2 * t - (n - 1) * t) / n; // hueco de cada cajón dentro del mueble
    const Wd = W - 2 * t - 2 * c, Hd = hOpen - 2 * c, Dd = D - t - c; // cada cajón (exterior)
    if (![W, D, H, Wd, Hd, Dd].every(Number.isFinite) || Wd <= 3 * t || Hd <= 3 * t || Dd <= 3 * t) return null;
    const rect = (w, h) => [[-k, -k], [w + k, -k], [w + k, h + k], [-k, h + k]];
    const panels = [];
    const add = (q) => { panels.push({ holes: [], ...q }); return panels[panels.length - 1]; };
    // Mueble (sin frente)
    if (fingers) {
      add({ name: 'Mueble atrás', w: W, h: H, place: 'back', pts: panelPoints(W, H, t, fw, ['ranuras', 'dedos', 'ranuras', 'dedos'], kerf) });
      const side = panelPoints(D, H, t, fw, ['ranuras', 'ranuras', 'ranuras', 'plano'], kerf);
      add({ name: 'Mueble lado izq.', w: D, h: H, place: 'left', pts: side });
      add({ name: 'Mueble lado der.', w: D, h: H, place: 'right', pts: side });
      const plate = panelPoints(W, D, t, fw, ['plano', 'dedos', 'dedos', 'dedos'], kerf);
      add({ name: 'Mueble base', w: W, h: D, place: 'bottom', pts: plate });
      add({ name: 'Mueble techo', w: W, h: D, place: 'top', pts: plate });
    } else {
      const hIn = H - 2 * t;
      add({ name: 'Mueble atrás', w: W, h: hIn, place: 'back', pts: rect(W, hIn) });
      add({ name: 'Mueble lado izq.', w: D - t, h: hIn, place: 'left', pts: rect(D - t, hIn),
        axes: { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], o: [0, t + hIn, 0], out: [0, 0, 0] } });
      add({ name: 'Mueble lado der.', w: D - t, h: hIn, place: 'right', pts: rect(D - t, hIn),
        axes: { eu: [0, 0, 1], ev: [0, -1, 0], ew: [-1, 0, 0], o: [W, t + hIn, 0], out: [0, 0, 0] } });
      add({ name: 'Mueble base', w: W, h: D, place: 'bottom', pts: rect(W, D) });
      add({ name: 'Mueble techo', w: W, h: D, place: 'top', pts: rect(W, D) });
    }
    // Entrepaños entre cajones: con dedos llevan pestañas que entran en ranuras de los lados y del fondo
    const Wi = W - 2 * t, Di = D - t;
    const sideL = panels.find(q => q.name === 'Mueble lado izq.'), sideR = panels.find(q => q.name === 'Mueble lado der.');
    const back = panels.find(q => q.name === 'Mueble atrás');
    const slot = (u0, v0, u1, v1) => [[u0 + k, v0 + k], [u1 - k, v0 + k], [u1 - k, v1 - k], [u0 + k, v1 - k]];
    for (let i = 1; i < n; i++) {
      const yb = t + i * hOpen + (i - 1) * t; // altura (Y) de la cara inferior del entrepaño
      const name = `Entrepaño ${n - i}`;
      const axes = { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, 1, 0], out: [0, 0, 0] };
      if (fingers) {
        const tw = Math.min(fw, Di * 0.25), tb = Math.min(fw, Wi * 0.25);
        const sideTabs = [[Di * 0.25 - tw / 2, Di * 0.25 + tw / 2], [Di * 0.75 - tw / 2, Di * 0.75 + tw / 2]];
        const backTabs = [[Wi * 0.25 - tb / 2, Wi * 0.25 + tb / 2], [Wi * 0.75 - tb / 2, Wi * 0.75 + tb / 2]];
        // Contorno en sentido horario, desplazado +t para que la pestaña izquierda quede en u >= 0
        const pts = [[0, 0], [Wi, 0]];
        for (const [a, b] of sideTabs) pts.push([Wi, a], [Wi + t, a], [Wi + t, b], [Wi, b]);
        pts.push([Wi, Di]);
        for (const [a, b] of [...backTabs].reverse()) pts.push([b, Di], [b, Di + t], [a, Di + t], [a, Di]);
        pts.push([0, Di]);
        for (const [a, b] of [...sideTabs].reverse()) pts.push([0, b], [-t, b], [-t, a], [0, a]);
        add({ name, w: Wi + 2 * t, h: Di + t, pts: kerfOffset(cleanPolygon(pts), k).map(([u, v]) => [u + t, v]), axes: { ...axes, o: [0, yb, 0] } });
        const v0 = H - yb - t, v1 = H - yb;
        for (const [a, b] of sideTabs) { sideL.holes.push(slot(a, v0, b, v1)); sideR.holes.push(slot(a, v0, b, v1)); }
        for (const [a, b] of backTabs) back.holes.push(slot(W - t - b, v0, W - t - a, v1));
      } else {
        add({ name, w: Wi, h: Di, pts: rect(Wi, Di), axes: { ...axes, o: [t, yb, 0] } });
      }
    }
    // Nombre a grabar por cajón ("Hilos | Botones"): el primero va en el cajón de arriba
    const texts = String(s.p.grabadoTexto || '').split('|').map(x => x.trim());
    const engraveFaces = ['auto', 'cajon', 'frente'].includes(s.p.grabadoEn || 'auto');
    const gapF = n > 1 ? 1 : 0, hf = (H - (n - 1) * gapF) / n; // alto de cada frente decorativo
    const allDivs = [];
    for (let j = 0; j < n; j++) {
      const top = n - 1 - j; // 0 = cajón de arriba
      const tag = n > 1 ? ` ${top + 1}` : '';
      // Cajón: apoyado en su piso, centrado a lo ancho, empieza en el frente (Z = 0)
      const x0 = t + c, y0 = t + j * (hOpen + t), z0 = 0;
      const dw = (nm, w, h, pts, axes) => add({ name: `Cajón${tag} ${nm}`, w, h, pts, drawer: true, drawerIndex: top, axes: { ...axes, out: [0, 0, 0] } });
      let base;
      if (fingers) {
        const fb = panelPoints(Wd, Hd, t, fw, ['plano', 'dedos', 'ranuras', 'dedos'], kerf);
        const sd = panelPoints(Dd, Hd, t, fw, ['plano', 'ranuras', 'ranuras', 'ranuras'], kerf);
        dw('frente', Wd, Hd, fb, { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [x0, y0 + Hd, z0] });
        dw('atrás', Wd, Hd, fb, { eu: [-1, 0, 0], ev: [0, -1, 0], ew: [0, 0, -1], o: [x0 + Wd, y0 + Hd, z0 + Dd] });
        dw('lado izq.', Dd, Hd, sd, { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], o: [x0, y0 + Hd, z0] });
        dw('lado der.', Dd, Hd, sd, { eu: [0, 0, 1], ev: [0, -1, 0], ew: [-1, 0, 0], o: [x0 + Wd, y0 + Hd, z0] });
        base = dw('base', Wd, Dd, panelPoints(Wd, Dd, t, fw, ['dedos', 'dedos', 'dedos', 'dedos'], kerf), { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, 1, 0], o: [x0, y0, z0] });
      } else {
        const hIn = Hd - t, yTop = y0 + t + hIn;
        dw('frente', Wd, hIn, rect(Wd, hIn), { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [x0, yTop, z0] });
        dw('atrás', Wd, hIn, rect(Wd, hIn), { eu: [-1, 0, 0], ev: [0, -1, 0], ew: [0, 0, -1], o: [x0 + Wd, yTop, z0 + Dd] });
        dw('lado izq.', Dd - 2 * t, hIn, rect(Dd - 2 * t, hIn), { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], o: [x0, yTop, z0 + t] });
        dw('lado der.', Dd - 2 * t, hIn, rect(Dd - 2 * t, hIn), { eu: [0, 0, 1], ev: [0, -1, 0], ew: [-1, 0, 0], o: [x0 + Wd, yTop, z0 + t] });
        base = dw('base', Wd, Dd, rect(Wd, Dd), { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, 1, 0], o: [x0, y0, z0] });
      }
      // Frente decorativo: cubre su parte del frente del mueble y se pega al frente del cajón
      const fy = j * (hf + gapF);
      const face = add({ name: `Frente decorativo${tag}`, w: W, h: hf, pts: rect(W, hf), drawer: true, drawerIndex: top, face: true, faceIndex: top,
        axes: { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [0, fy + hf, -t], out: [0, 0, 0] } });
      if ((s.p.agarre || 'si') === 'si') {
        const R = Math.min(12, W / 8, hf / 5), r = R - k;
        // Si se graba en este frente, el hueco baja para dejar espacio arriba al nombre o logo
        const myText = texts.length > 1 ? (texts[top] || '') : texts[0];
        const engraved = engraveFaces && (myText || s.p.grabadoLogo);
        const cy = engraved ? hf - 2.5 - R : hf / 2; // el frente decorativo no lleva dedos: el hueco puede ir cerca del borde
        if (r > 1) face.holes.push(Array.from({ length: 48 }, (_, i) => [W / 2 + r * Math.cos(i * Math.PI / 24), cy + r * Math.sin(i * Math.PI / 24)]));
      }
      // Divisiones dentro de cada cajón (el cajón no tiene tapa: llegan hasta el borde)
      const divs = boxDividers(s, { W: Wd, D: Dd, t, fw, kerf, innerTop: Hd, fingers }, base, [x0, y0, z0]);
      if (!divs) return null;
      divs.forEach(q => { q.drawer = true; q.drawerIndex = top; if (n > 1) q.name = `Cajón${tag} ${q.name.toLowerCase()}`; });
      panels.push(...divs);
      allDivs.push(...divs);
    }
    const layout = [panels];
    return { W, D, H, t, fingers, sep, panels, dividers: [], layout, drawer: { Wd, Hd, Dd, c, n } };
  }

  // Lado para tapa deslizante (con dedos): canto de arriba liso, ranura abierta por el frente
  // y dedos del frente solo en la altura del frente (Hf).
  function slideSidePoints(D, H, t, fw, Hf, mTop, slotH, slotLen, kerf) {
    const segs = (ln, mode) => {
      let n = fw > 0 ? Math.floor(ln / fw) : 1;
      if (!(n >= 1)) n = 1;
      if (n > 999) n = 999;
      if (n % 2 === 0) n--;
      const s = ln / n;
      return Array.from({ length: n }, (_, i) => [i * s, (i + 1) * s, mode === 'dedos' ? (i % 2 ? t : 0) : (i % 2 ? 0 : t)]);
    };
    const back = segs(H, 'ranuras'), bottom = segs(D, 'ranuras'), front = segs(Hf, 'ranuras');
    const at = (kk, u, o) => kk === 1 ? [D - o, u] : kk === 2 ? [D - u, H - o] : [o, H - u];
    const pts = [[0, 0], [D - back[0][2], 0]];
    const edge = (kk, list, us, ue) => {
      for (const [a0, b0, o] of list) {
        const a = Math.max(a0, us), b = Math.min(b0, ue);
        if (b >= a) pts.push(at(kk, a, o), at(kk, b, o));
      }
    };
    edge(1, back, 0, H - bottom[0][2]);
    edge(2, bottom, back[back.length - 1][2], D - front[0][2]);
    edge(3, front, bottom[bottom.length - 1][2], Hf);
    const vS = mTop + slotH; // = H - Hf
    pts.push([front[front.length - 1][2], vS], [slotLen, vS], [slotLen, mTop], [0, mTop]);
    return kerfOffset(cleanPolygon(pts), (kerf || 0) / 2);
  }

  // Divisiones internas tipo rejilla. Coordenadas 3D: X ancho, Y alto, Z profundo (frente en Z = 0).
  // base: pieza donde van las ranuras de las pestañas; origin: esquina (X, Y, Z) de la caja que las contiene.
  function boxDividers(s, m, base, origin = [0, 0, 0]) {
    const { W, D, t, fw, kerf, innerTop, fingers } = m;
    const [ox, oy, oz] = origin;
    const nx = Math.max(1, Math.min(20, Math.round(num(s, 'divX', 1)) || 1));
    const nz = Math.max(1, Math.min(20, Math.round(num(s, 'divZ', 1)) || 1));
    if (nx === 1 && nz === 1) return [];
    const Wi = W - 2 * t, Di = D - 2 * t, Hi = innerTop - t;
    const hd = s.p.divH && String(s.p.divH).trim() ? Math.min(len(s, 'divH'), Hi) : Hi;
    const cx = (Wi - (nx - 1) * t) / nx, cz = (Di - (nz - 1) * t) / nz;
    if (![hd, cx, cz].every(Number.isFinite) || hd <= t || cx <= t || cz <= t) return null;
    // Posición (relativa al interior) donde empieza cada división
    const xs = Array.from({ length: nx - 1 }, (_, i) => (i + 1) * cx + i * t);
    const zs = Array.from({ length: nz - 1 }, (_, i) => (i + 1) * cz + i * t);
    const k2 = kerf / 2;
    // Una pestaña centrada en cada tramo libre (entre paredes y cruces)
    const tabsFor = (L, cuts, span) => {
      if (!fingers) return [];
      const edges = [0, ...cuts.flatMap(c => [c, c + t]), L];
      const out = [];
      for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i], b = edges[i + 1], seg = b - a, tw = Math.min(fw, seg * 0.4);
        if (tw > t * 0.5) out.push([a + (seg - tw) / 2, a + (seg + tw) / 2]);
      }
      return out;
    };
    const hole = (u0, v0, u1, v1) => [[u0 + k2, v0 + k2], [u1 - k2, v0 + k2], [u1 - k2, v1 - k2], [u0 + k2, v1 - k2]];
    const out = [];
    const mid = cz > 0 && nz > 1; // ¿hay cruces?
    xs.forEach((x, i) => {
      // Paralela a los lados: largo Di, ranuras arriba donde cruzan las divisiones a lo profundo
      const tabs = tabsFor(Di, zs);
      out.push({
        name: `División ancho ${i + 1}`, w: Di, h: hd + (tabs.length ? t : 0), holes: [],
        pts: dividerPoints(Di, hd, t, mid ? zs.map(z => [z, z + t]) : [], [], tabs, kerf),
        axes: { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], o: [ox + t + x, oy + t + hd, oz + t], out: [0, 1, 0] },
      });
      for (const [a, b] of tabs) base.holes.push(hole(t + x, t + a, t + x + t, t + b));
    });
    zs.forEach((z, i) => {
      // Paralela al frente: largo Wi, ranuras abajo donde cruzan las divisiones a lo ancho
      const tabs = tabsFor(Wi, xs);
      out.push({
        name: `División profundo ${i + 1}`, w: Wi, h: hd + (tabs.length ? t : 0), holes: [],
        pts: dividerPoints(Wi, hd, t, [], nx > 1 ? xs.map(x => [x, x + t]) : [], tabs, kerf),
        axes: { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [ox + t, oy + t + hd, oz + t + z], out: [0, 1, 0] },
      });
      for (const [a, b] of tabs) base.holes.push(hole(t + a, t + z, t + b, t + z + t));
    });
    return out;
  }

  // Figura básica (sin rotación ni repeticiones)
  function primitive(s) {
    const it = { op: s.op, polys: [], texts: [], images: [] };
    switch (s.type) {
      case 'rect': {
        let x = len(s, 'x'), y = len(s, 'y'), w = len(s, 'w'), h = len(s, 'h');
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        const r = Math.max(0, Math.min(len(s, 'r') || 0, w / 2, h / 2));
        it.polys.push({ closed: true, pts: roundRect(x, y, w, h, r) });
        break;
      }
      case 'circle': {
        const cx = len(s, 'x'), cy = len(s, 'y'), r = Math.abs(len(s, 'd')) / 2;
        const n = Math.max(12, segs(r, 2 * Math.PI)), pts = [];
        for (let i = 0; i < n; i++) pts.push([cx + r * Math.cos(i * 2 * Math.PI / n), cy + r * Math.sin(i * 2 * Math.PI / n)]);
        it.polys.push({ closed: true, pts });
        break;
      }
      case 'polygon': {
        const cx = len(s, 'x'), cy = len(s, 'y'), r = Math.abs(len(s, 'd')) / 2;
        const n = Math.max(3, Math.min(200, Math.round(num(s, 'n', 6))));
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / n;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        it.polys.push({ closed: true, pts });
        break;
      }
      case 'line':
        it.polys.push({ closed: false, pts: [[len(s, 'x'), len(s, 'y')], [len(s, 'x2'), len(s, 'y2')]] });
        break;
      case 'text':
        it.texts.push({ x: len(s, 'x'), y: len(s, 'y'), size: Math.abs(len(s, 'tam', 10)), str: String(s.p.texto || ''), rot: num(s, 'rot', 0) || 0 });
        break;
      case 'panel': {
        const x = len(s, 'x'), y = len(s, 'y'), w = Math.abs(len(s, 'w')), h = Math.abs(len(s, 'h'));
        const t = Math.max(0, Math.min(len(s, 't', 3), w / 2, h / 2));
        const pts = panelPoints(w, h, t, len(s, 'dedo', 10), [s.p.top, s.p.right, s.p.bottom, s.p.left], len(s, 'kerf', 0));
        it.polys.push({ closed: true, pts: pts.map(p => [p[0] + x, p[1] + y]) });
        break;
      }
      case 'box': {
        const m = boxModel(s);
        if (!m) return null;
        const x0 = len(s, 'x'), y0 = len(s, 'y');
        // Plano de corte: [frente, atrás] / [lados] / [base, tapa]
        // Acomoda las piezas en filas dentro del ancho de la cama de la máquina (las más altas primero)
        const pieces = m.layout.flat().filter(Boolean).sort((a, b) => b.h - a.h);
        const maxW = Math.max(doc.sheet.w - Math.max(0, x0), ...pieces.map(q => q.w));
        let x = x0, y = y0, shelf = 0;
        const placed = new Map();
        for (const q of pieces) {
          if (x > x0 && x - x0 + q.w > maxW) { x = x0; y += shelf + m.sep; shelf = 0; }
          const px = x, py = y;
          placed.set(q, [px, py]);
          const mv = ([u, v]) => [u + px, v + py];
          it.polys.push({ closed: true, pts: q.pts.map(mv) });
          for (const hl of q.holes || []) it.polys.push({ closed: true, pts: hl.map(mv) });
          x += q.w + m.sep;
          shelf = Math.max(shelf, q.h);
        }
        const eng = boxEngraving(s, m, placed);
        if (eng) return [it, eng];
        break;
      }
      case 'hinge':
        it.polys.push(...hingeLines(len(s, 'x'), len(s, 'y'), Math.abs(len(s, 'w')), Math.abs(len(s, 'h')),
          len(s, 'largo', 20), len(s, 'puente', 3), len(s, 'paso', 2)));
        break;
    }
    const ok = it.polys.every(p => p.pts.every(q => Number.isFinite(q[0]) && Number.isFinite(q[1])))
      && it.texts.every(t => [t.x, t.y, t.size, t.rot].every(Number.isFinite));
    return ok ? it : null;
  }

  /* ----- Transformaciones (matriz afín [a b c d e f]) ----- */
  const M_ID = [1, 0, 0, 1, 0, 0];
  const mMul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const mT = (dx, dy) => [1, 0, 0, 1, dx, dy];
  const mR = (deg, cx, cy) => {
    const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
  };
  const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function transformItems(items, m) {
    if (m === M_ID) return items;
    const dr = Math.atan2(m[1], m[0]) / DEG;
    return items.map(it => ({
      op: it.op,
      polys: it.polys.map(p => ({ closed: p.closed, pts: p.pts.map(q => apply(m, q)) })),
      texts: it.texts.map(t => { const [x, y] = apply(m, [t.x, t.y]); return { ...t, x, y, rot: t.rot + dr }; }),
      images: (it.images || []).map(g => { const [x, y] = apply(m, [g.x, g.y]); return { ...g, x, y, rot: g.rot + dr }; }),
    }));
  }

  // Esquinas aproximadas del texto (para seleccionar y medir)
  function textCorners(t) {
    const w = Math.max(t.size * 0.3, t.size * 0.58 * t.str.length);
    const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.x;
    const m = mR(t.rot, t.x, t.y);
    return [[x0, t.y - t.size * 0.8], [x0 + w, t.y - t.size * 0.8], [x0 + w, t.y + t.size * 0.2], [x0, t.y + t.size * 0.2]].map(p => apply(m, p));
  }
  function imageCorners(g) {
    const m = mR(g.rot, g.x, g.y);
    return [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]].map(p => apply(m, p));
  }
  function bboxOfItems(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = ([x, y]) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
    for (const it of items) {
      for (const p of it.polys) p.pts.forEach(add);
      for (const t of it.texts) textCorners(t).forEach(add);
      for (const g of it.images || []) imageCorners(g).forEach(add);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function unionBox(boxes) {
    boxes = boxes.filter(Boolean);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
  }

  /* ----- Uniones, restas y contornos (Clipper) ----- */
  const SC = 1000; // precisión de 1 µm
  const toC = polys => polys.filter(p => p.closed && p.pts.length >= 3)
    .map(p => p.pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) })));
  const fromC = paths => paths.filter(p => p.length >= 3).map(p => ({ closed: true, pts: p.map(q => [q.X / SC, q.Y / SC]) }));
  function clip(type, subj, clp = []) {
    const c = new CL.Clipper();
    if (subj.length) c.AddPaths(subj, CL.PolyType.ptSubject, true);
    if (clp.length) c.AddPaths(clp, CL.PolyType.ptClip, true);
    const sol = new CL.Paths();
    c.Execute(type, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return sol;
  }
  const normalize = paths => clip(CL.ClipType.ctUnion, paths);
  function booleanOp(mode, list) {
    const CT = CL.ClipType;
    if (!list.length) return [];
    if (mode === 'unir') return clip(CT.ctUnion, list.flat());
    if (mode === 'restar') return clip(CT.ctDifference, list[0], normalize(list.slice(1).flat()));
    let acc = list[0];
    for (const p of list.slice(1)) acc = clip(CT.ctIntersection, acc, p);
    return acc;
  }
  function offsetPolys(polys, d) {
    const co = new CL.ClipperOffset(3, 0.25);
    co.AddPaths(normalize(toC(polys)), CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
    const sol = new CL.Paths();
    co.Execute(sol, d * SC);
    return fromC(sol);
  }

  /* ----- Repeticiones ----- */
  function repMatrices(s, bb) {
    const mode = s.p.rep || 'no';
    if (mode === 'no') return [M_ID];
    const n = Math.max(1, Math.min(500, Math.round(num(s, 'repN', 1)) || 1));
    const out = [];
    if (mode === 'fila' || mode === 'cuadricula') {
      const dx = len(s, 'repDx'), dy = len(s, 'repDy');
      const rows = mode === 'cuadricula' ? Math.max(1, Math.min(500, Math.round(num(s, 'repM', 1)) || 1)) : 1;
      if (![dx, dy].every(Number.isFinite)) return [M_ID];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < n; i++) {
          if (out.length >= 2000) break;
          out.push(mode === 'fila' ? mT(i * dx, i * dy) : mT(i * dx, j * dy));
        }
      }
    } else if (mode === 'circular') {
      const cx = s.p.repCx ? len(s, 'repCx') : bb.x + bb.w / 2;
      const cy = s.p.repCy ? len(s, 'repCy') : bb.y + bb.h / 2;
      const A = num(s, 'repA', 360);
      if (![cx, cy, A].every(Number.isFinite)) return [M_ID];
      const step = Math.abs(Math.abs(A) - 360) < 1e-9 ? A / n : A / Math.max(1, n - 1);
      for (let i = 0; i < n; i++) out.push(i === 0 ? M_ID : mR(i * step, cx, cy));
    }
    return out.length ? out : [M_ID];
  }

  // Evalúa un objeto (y sus hijos). Devuelve piezas en coordenadas del objeto padre.
  function evalShape(s) {
    let items;
    const desc = new Map();
    if (s.type === 'group') {
      const kids = (s.children || []).map(evalShape).filter(Boolean);
      for (const k of kids) {
        for (const [id, it] of k.desc) desc.set(id, it);
        desc.set(k.id, k.items);
      }
      const mode = s.p.mode || 'grupo';
      if (mode === 'grupo' || !CL) {
        items = kids.flatMap(k => k.items);
      } else {
        const closed = kids.map(k => normalize(toC(k.items.flatMap(it => it.polys)))).filter(p => p.length);
        const pass = kids.flatMap(k => k.items.map(it => ({ op: it.op, polys: it.polys.filter(p => !p.closed), texts: it.texts, images: it.images || [] })))
          .filter(it => it.polys.length || it.texts.length || it.images.length);
        items = [{ op: s.op, polys: fromC(booleanOp(mode, closed)), texts: [], images: [] }, ...pass];
      }
    } else {
      const it = primitive(s);
      if (!it) return null;
      items = Array.isArray(it) ? it : [it];
    }
    const off = s.p.off ? len(s, 'off') : 0;
    if (off && CL && canOffset(s) && Number.isFinite(off)) {
      items = items.map(it => ({ ...it, polys: [...offsetPolys(it.polys, off), ...it.polys.filter(p => !p.closed)] }));
    }
    let bb = bboxOfItems(items);
    if (!bb) return { id: s.id, items: [], desc, bbox: null };
    let m = M_ID;
    const rot = s.type === 'text' || s.type === 'line' ? 0 : (num(s, 'rot', 0) || 0);
    if (rot) m = mR(rot, bb.x + bb.w / 2, bb.y + bb.h / 2);
    if (s.type === 'group') {
      const gx = len(s, 'x'), gy = len(s, 'y');
      if (Number.isFinite(gx) && Number.isFinite(gy) && (gx || gy)) m = mMul(mT(gx, gy), m);
    }
    items = transformItems(items, m);
    if (m !== M_ID) for (const [id, it] of desc) desc.set(id, transformItems(it, m));
    bb = bboxOfItems(items);
    const copies = repMatrices(s, bb);
    if (copies.length > 1) items = copies.flatMap(c => transformItems(items, c));
    return { id: s.id, items, desc, bbox: bboxOfItems(items) };
  }

  function evaluateAll() {
    evalCache = new Map(); worldCache = new Map();
    for (const s of doc.shapes) {
      let r = null;
      try { r = evalShape(s); } catch (e) { r = null; }
      if (!r) continue;
      evalCache.set(s.id, r);
      worldCache.set(s.id, r.items);
      for (const [id, it] of r.desc) worldCache.set(id, it);
    }
  }

  const P = (x, y) => `${r4(x)} ${r4(y)}`;
  const pathD = polys => polys.map(p => 'M' + p.pts.map(q => P(q[0], q[1])).join('L') + (p.closed ? 'Z' : '')).join('');

  /* ================= DOM helpers ================= */
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) e.append(kid);
    return e;
  }
  let msgTimer = 0;
  function msg(text) {
    const el = $('#stMsg');
    el.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.textContent = ''; }, 4500);
  }

  /* ================= Lienzo ================= */
  const svg = $('#canvas');
  const stage = $('#stage');
  const layerShapes = $('#layerShapes');
  const layerOverlay = $('#layerOverlay');

  function renderItems(items, parent, clsExtra, withHit) {
    for (const it of items) {
      const cls = `shape op-${it.op}${clsExtra}`;
      if (it.polys.length) {
        const d = pathD(it.polys);
        svgEl('path', { d, class: cls, 'vector-effect': 'non-scaling-stroke', 'fill-rule': 'evenodd' }, parent);
        if (withHit) svgEl('path', { d, class: 'hit' + (it.polys.every(p => !p.closed) ? ' open' : ''), 'vector-effect': 'non-scaling-stroke', 'fill-rule': 'evenodd' }, parent);
      }
      for (const t of it.texts) {
        const el = svgEl('text', {
          x: r4(t.x), y: r4(t.y), 'font-size': r4(t.size), 'font-family': 'Arial, Helvetica, sans-serif', class: cls,
          'text-anchor': t.anchor === 'middle' ? 'middle' : null,
          transform: t.rot ? `rotate(${r4(t.rot)} ${r4(t.x)} ${r4(t.y)})` : null, 'vector-effect': 'non-scaling-stroke',
        }, parent);
        el.textContent = t.str;
        if (withHit) svgEl('path', { d: pathD([{ closed: true, pts: textCorners(t) }]), class: 'hit' }, parent);
      }
      for (const g of it.images || []) {
        svgEl('image', {
          href: g.href, x: r4(g.x), y: r4(g.y), width: r4(g.w), height: r4(g.h), preserveAspectRatio: 'none', class: 'engrave-img',
          transform: g.rot ? `rotate(${r4(g.rot)} ${r4(g.x)} ${r4(g.y)})` : null,
        }, parent);
        if (withHit) svgEl('path', { d: pathD([{ closed: true, pts: imageCorners(g) }]), class: 'hit' }, parent);
      }
    }
  }

  function drawCanvas() {
    const W = stage.clientWidth, H = stage.clientHeight;
    const vw = W / view.s, vh = H / view.s;
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${vw} ${vh}`);

    const step = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].find(v => v * view.s >= 8) || 500;
    const major = step * 10;
    const pm = $('#gridMinor'), pM = $('#gridMajor');
    pm.setAttribute('width', step); pm.setAttribute('height', step);
    pm.firstElementChild.setAttribute('d', `M${step} 0L0 0 0 ${step}`);
    pM.setAttribute('width', major); pM.setAttribute('height', major);
    pM.firstElementChild.setAttribute('d', `M${major} 0L0 0 0 ${major}`);
    for (const id of ['#gridA', '#gridB']) {
      const r = $(id);
      r.setAttribute('x', view.x); r.setAttribute('y', view.y);
      r.setAttribute('width', vw); r.setAttribute('height', vh);
    }
    const sh = $('#sheet');
    sh.setAttribute('x', 0); sh.setAttribute('y', 0);
    sh.setAttribute('width', doc.sheet.w); sh.setAttribute('height', doc.sheet.h);
    const a = 6 / view.s * 2;
    $('#axes').setAttribute('d', `M${-a} 0H${a}M0 ${-a}V${a}`);

    evaluateAll();
    layerShapes.replaceChildren();
    for (const s of doc.shapes) {
      const r = evalCache.get(s.id);
      if (!r || !r.items.length) continue;
      const grp = svgEl('g', { 'data-id': s.id }, layerShapes);
      renderItems(r.items, grp, sel.has(s.id) ? ' selected' : '', true);
    }
    drawOverlay();
    $('#zoomLabel').textContent = Math.round(view.s / 3 * 100) + '%';
  }

  function drawOverlay() {
    layerOverlay.replaceChildren();
    const pad = 3 / view.s;
    for (const id of sel) {
      const items = worldCache.get(id);
      if (!items) continue;
      const b = bboxOfItems(items);
      if (!b) continue;
      if (!evalCache.has(id)) renderItems(items, svgEl('g', { class: 'child-sel' }, layerOverlay), ' child', false);
      svgEl('rect', { x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, class: 'sel-box', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
    if (drag && drag.mode === 'marquee') {
      const b = rectFrom(drag.start, drag.cur);
      svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'marquee', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
    if (drag && drag.mode === 'draw') {
      const it = primitive(shapeFromDrag(drag.start, drag.cur, false));
      if (it && it.polys.length) svgEl('path', { d: pathD(it.polys), class: 'preview', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
  }

  const rectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    return { x: view.x + (e.clientX - r.left) / view.s, y: view.y + (e.clientY - r.top) / view.s };
  }
  const snapOn = e => snap && !(e && e.altKey);
  // Paso del imán en mm (doc.grid está en unidades del documento)
  const gridMM = () => doc.grid * unitMM;
  const snapV = (v, e) => snapOn(e) ? Math.round(v / gridMM()) * gridMM() : v;
  const snapPt = (p, e) => ({ x: snapV(p.x, e), y: snapV(p.y, e) });

  function defaultsFor(type) {
    const has = n => doc.params.some(p => p.name === n);
    return {
      op: type === 'text' ? 'grabado' : 'corte',
      t: has('grosor') ? 'grosor' : nice(3),
      dedo: has('dedo') ? 'dedo' : nice(10),
      kerf: has('kerf') ? 'kerf' : '0',
    };
  }

  // a y b llegan en mm; las propiedades se escriben en la unidad del documento
  function shapeFromDrag(a, b, final) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const tiny = Math.abs(dx) < 1 && Math.abs(dy) < 1 && final;
    const s = { id: uid(), type: tool, name: '', op: defaultsFor(tool).op, p: {} };
    const f = mm => fmt(mm / unitMM);
    switch (tool) {
      case 'rect':
      case 'panel':
      case 'hinge': {
        const r = rectFrom(a, b);
        Object.assign(s.p, { x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h), rot: '0' });
        if (tiny) Object.assign(s.p, { rect: { w: nice(50), h: nice(30) }, panel: { w: nice(100), h: nice(60) }, hinge: { w: nice(60), h: nice(40) } }[tool]);
        if (tool === 'rect') s.p.r = '0';
        else if (tool === 'hinge') Object.assign(s.p, { largo: nice(20), puente: nice(3), paso: isInch() ? '0.08' : '2' });
        else {
          const d = defaultsFor('panel');
          Object.assign(s.p, { t: d.t, dedo: d.dedo, kerf: d.kerf, top: 'dedos', right: 'dedos', bottom: 'dedos', left: 'dedos' });
        }
        break;
      }
      case 'box': {
        const d = defaultsFor('panel');
        const has = n => doc.params.some(p => p.name === n);
        Object.assign(s.p, {
          uniones: 'dedos', tapa: 'si', medidas: 'exteriores', x: f(a.x), y: f(a.y),
          ancho: has('ancho') ? 'ancho' : nice(100), profundo: has('profundo') ? 'profundo' : nice(80), alto: has('alto') ? 'alto' : nice(60),
          t: d.t, dedo: d.dedo, kerf: d.kerf, sep: has('sep') ? 'sep' : nice(5), rot: '0',
        });
        break;
      }
      case 'circle':
      case 'polygon': {
        Object.assign(s.p, { x: f(a.x), y: f(a.y), d: tiny ? nice(tool === 'circle' ? 30 : 40) : f(2 * Math.hypot(dx, dy)), rot: '0' });
        if (tool === 'polygon') s.p.n = '6';
        break;
      }
      case 'line': {
        Object.assign(s.p, { x: f(a.x), y: f(a.y), x2: tiny ? shiftExpr(f(a.x), parseFloat(nice(50))) : f(b.x), y2: f(tiny ? a.y : b.y) });
        break;
      }
    }
    return s;
  }

  function nextName(label) {
    let k = 1;
    const names = new Set(allShapes().map(s => s.name));
    while (names.has(`${label} ${k}`)) k++;
    return `${label} ${k}`;
  }

  function addShape(s) {
    s.name = s.name || nextName(TYPES[s.type].label);
    doc.shapes.push(s);
    sel = new Set([s.id]);
    checkpoint();
    setTool('select');
    fullRender();
  }

  /* ----- Puntero ----- */
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    if (e.button === 1 || spaceDown || tool === 'hand') {
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      stage.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'select') {
      const hit = e.target.closest && e.target.closest('[data-id]');
      const id = hit && hit.dataset.id;
      if (isDoubleClick(e, id) && enterGroup(id, p)) {
        drag = { mode: 'move', start: p, moved: false, orig: [...sel].map(byId).filter(Boolean).map(s => ({ s, p: { ...s.p } })) };
        return;
      }
      if (id) {
        // Si hay un hijo de este grupo seleccionado (desde la lista o con doble clic), se mueve el hijo.
        const insideSel = [...sel].some(sid => sid !== id && topOf(sid) && topOf(sid).id === id);
        if (e.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
        else if (!sel.has(id) && !insideSel) sel = new Set([id]);
        drag = { mode: 'move', start: p, moved: false, orig: [...sel].map(byId).filter(Boolean).map(s => ({ s, p: { ...s.p } })) };
        buildInspector(); buildObjects(); drawCanvas();
      } else {
        drag = { mode: 'marquee', start: p, cur: p, base: e.shiftKey ? new Set(sel) : new Set() };
        if (!e.shiftKey && sel.size) { sel.clear(); buildInspector(); buildObjects(); drawCanvas(); }
      }
    } else if (tool === 'text') {
      const q = snapPt(p, e);
      const d = defaultsFor('text');
      addShape({ id: uid(), type: 'text', name: '', op: d.op, p: { texto: 'Evergreen', x: fmt(q.x / unitMM), y: fmt(q.y / unitMM), tam: nice(10), rot: '0' } });
      const f = $('#inspector input[data-key="texto"]');
      if (f) { f.focus(); f.select(); }
    } else {
      const q = snapPt(p, e);
      drag = { mode: 'draw', start: q, cur: q };
    }
  });

  // Doble clic sobre un grupo: selecciona el objeto de adentro que está bajo el puntero.
  // (Se detecta a mano: el lienzo se redibuja al primer clic y el navegador no envía "dblclick".)
  let lastDown = { t: 0, x: 0, y: 0, id: null };
  function isDoubleClick(e, id) {
    const now = performance.now();
    const dbl = id && id === lastDown.id && now - lastDown.t < 400 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
    lastDown = dbl ? { t: 0, x: 0, y: 0, id: null } : { t: now, x: e.clientX, y: e.clientY, id };
    return dbl;
  }
  function enterGroup(topId, p) {
    const top = byId(topId);
    if (!top || top.type !== 'group') return false;
    const inside = s => { const b = bboxOfItems(worldCache.get(s.id) || []); return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; };
    let cur = top, found = null;
    while (cur && cur.type === 'group') {
      const kid = [...(cur.children || [])].reverse().find(inside);
      if (!kid) break;
      found = kid; cur = kid;
    }
    if (!found) return false;
    sel = new Set([found.id]); buildInspector(); buildObjects(); drawCanvas();
    msg(`Editando "${found.name}" dentro de "${top.name}". Esc para salir.`);
    return true;
  }

  svg.addEventListener('pointermove', e => {
    const p = toWorld(e);
    lastPointer = p;
    $('#stCoords').textContent = `x ${fmt(p.x / unitMM, isInch() ? 3 : 1)} · y ${fmt(p.y / unitMM, isInch() ? 3 : 1)} ${unitLabel()}`;
    if (!drag) return;
    if (drag.mode === 'pan') {
      view.x = drag.vx - (e.clientX - drag.sx) / view.s;
      view.y = drag.vy - (e.clientY - drag.sy) / view.s;
      drawCanvas();
    } else if (drag.mode === 'move') {
      const dx = snapV(p.x - drag.start.x, e), dy = snapV(p.y - drag.start.y, e);
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.s < 3) return;
      drag.moved = true;
      for (const o of drag.orig) moveShape(o.s, o.p, dx, dy);
      evaluateParams(); drawCanvas();
    } else if (drag.mode === 'marquee') {
      drag.cur = p;
      const m = rectFrom(drag.start, drag.cur);
      sel = new Set(drag.base);
      for (const [id, r] of evalCache) {
        const b = r.bbox;
        if (b && b.x < m.x + m.w && b.x + b.w > m.x && b.y < m.y + m.h && b.y + b.h > m.y) sel.add(id);
      }
      drawCanvas();
    } else if (drag.mode === 'draw') {
      drag.cur = snapPt(p, e);
      drawOverlay();
    }
  });

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    stage.classList.remove('panning');
    if (d.mode === 'move' && d.moved) { checkpoint(); buildInspector(); }
    else if (d.mode === 'marquee') { buildInspector(); buildObjects(); drawCanvas(); }
    else if (d.mode === 'draw') addShape(shapeFromDrag(d.start, d.cur, true));
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointerup', endDrag);
  svg.addEventListener('lostpointercapture', endDrag);

  // dx, dy en mm
  function moveShape(s, orig, dxMM, dyMM) {
    const dx = parseFloat(fmt(dxMM / unitMM)), dy = parseFloat(fmt(dyMM / unitMM));
    s.p.x = shiftExpr(orig.x ?? '0', dx);
    s.p.y = shiftExpr(orig.y ?? '0', dy);
    if (s.type === 'line') { s.p.x2 = shiftExpr(orig.x2, dx); s.p.y2 = shiftExpr(orig.y2, dy); }
    if (s.p.rep === 'circular' && orig.repCx) { s.p.repCx = shiftExpr(orig.repCx, dx); s.p.repCy = shiftExpr(orig.repCy, dy); }
  }

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const zoom = e.ctrlKey || e.metaKey || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40);
    if (zoom) {
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(toWorld(e), view.s * factor, e);
    } else {
      view.x += e.deltaX / view.s; view.y += e.deltaY / view.s;
      drawCanvas();
    }
  }, { passive: false });

  function zoomAt(p, s, e) {
    s = Math.max(0.2, Math.min(80, s));
    const r = svg.getBoundingClientRect();
    const px = e ? e.clientX - r.left : r.width / 2, py = e ? e.clientY - r.top : r.height / 2;
    view.s = s;
    view.x = p.x - px / s; view.y = p.y - py / s;
    drawCanvas();
  }
  function zoomCenter(f) {
    const W = stage.clientWidth, H = stage.clientHeight;
    zoomAt({ x: view.x + W / 2 / view.s, y: view.y + H / 2 / view.s }, view.s * f);
  }
  function fitView() {
    evaluateParams(); evaluateAll();
    // Se ajusta a las piezas; si no hay ninguna, al área de la máquina
    const b = unionBox([...evalCache.values()].map(r => r.bbox)) || { x: 0, y: 0, w: doc.sheet.w, h: doc.sheet.h };
    b.w = Math.max(b.w, 10); b.h = Math.max(b.h, 10);
    const W = stage.clientWidth, H = stage.clientHeight, pad = 40;
    view.s = Math.max(0.2, Math.min(80, Math.min((W - 2 * pad) / b.w, (H - 2 * pad) / b.h)));
    view.x = b.x - (W / view.s - b.w) / 2;
    view.y = b.y - (H / view.s - b.h) / 2;
    drawCanvas();
  }

  /* ================= Herramientas ================= */
  function setTool(t) {
    tool = t;
    for (const b of document.querySelectorAll('#tools button')) b.classList.toggle('active', b.dataset.tool === t);
    stage.classList.toggle('tool-draw', !['select', 'hand'].includes(t));
    stage.classList.toggle('tool-hand', t === 'hand');
  }
  $('#tools').addEventListener('click', e => {
    const b = e.target.closest('button[data-tool]');
    if (b) setTool(b.dataset.tool);
  });

  /* ================= Panel: Parámetros ================= */
  function stepper(input, onStep, isLength = true) {
    input.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!isNumeric(input.value)) return;
      e.preventDefault();
      const step = isLength && isInch() ? (e.shiftKey ? 1 : e.altKey ? 0.0625 : 0.125) : (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      input.value = fmt(parseFloat(input.value) + (e.key === 'ArrowUp' ? step : -step));
      onStep(input.value);
      liveRender();
      checkpoint();
    });
  }

  function buildParams() {
    const box = $('#params');
    box.replaceChildren();
    if (!doc.params.length) {
      box.append(h('p', { class: 'empty' }, 'Crea parámetros (ej. ancho, grosor) y úsalos en las medidas. Al cambiarlos, todo el diseño se actualiza.'));
      return;
    }
    doc.params.forEach((p, i) => {
      const name = h('input', { class: 'pname', value: p.name, spellcheck: 'false', 'aria-label': 'Nombre del parámetro' });
      name.addEventListener('change', () => renameParam(p, name));
      const ex = h('input', { class: 'pexpr', value: p.expr, spellcheck: 'false', 'aria-label': 'Valor de ' + p.name });
      ex.addEventListener('input', () => { p.expr = ex.value; liveRender(); });
      ex.addEventListener('change', checkpoint);
      stepper(ex, v => { p.expr = v; });
      const val = h('span', { class: 'hint', 'data-hint': 'p:' + i });
      const del = h('button', { class: 'icon-btn del', title: 'Eliminar parámetro', 'aria-label': 'Eliminar ' + p.name, onclick: () => { doc.params.splice(i, 1); checkpoint(); fullRender(); } }, '×');
      box.append(h('div', { class: 'param-row' }, name, h('span', { class: 'eq' }, '='), ex, val, del));
    });
  }

  function renameParam(p, input) {
    const nv = input.value.trim();
    if (nv === p.name) return;
    if (!NAME_RE.test(nv) || doc.params.some(q => q !== p && q.name === nv) || FUNCS[nv.toLowerCase()] || UNIT_MM[nv.toLowerCase()] || CONSTS[nv.toLowerCase()] !== undefined) {
      input.value = p.name;
      msg('Nombre no válido o repetido. Usa letras, números y _ (sin espacios).');
      return;
    }
    const re = wordRe(p.name);
    for (const q of doc.params) q.expr = q.expr.replace(re, `$1${nv}`);
    for (const s of allShapes()) {
      for (const k in s.p) {
        if (!NON_EXPR.has(k) && typeof s.p[k] === 'string') s.p[k] = s.p[k].replace(re, `$1${nv}`);
      }
    }
    p.name = nv;
    checkpoint();
    fullRender();
  }

  function addParam(name, expr, focus = true) {
    let base = name || 'param', n = base, k = 2;
    while (doc.params.some(p => p.name === n)) n = base + k++;
    doc.params.push({ name: n, expr: expr || '10' });
    checkpoint();
    fullRender();
    if (focus) {
      const inputs = document.querySelectorAll('#params .pname');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    }
    return n;
  }

  /* ================= Panel: Propiedades ================= */
  function propRow(labelText, control, hintKey, extra) {
    const field = h('div', { class: 'field' }, control, hintKey ? h('span', { class: 'hint', 'data-hint': hintKey }) : null);
    return h('div', { class: 'prop-row' }, h('label', {}, labelText), field, extra || h('span'));
  }
  function selectEl(options, value, label, onChange) {
    const s = h('select', { 'aria-label': label });
    for (const k in options) s.append(h('option', { value: k }, options[k]));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function exprRow(s, key, label) {
    const inp = h('input', { value: s.p[key] ?? '', spellcheck: 'false', 'data-key': key, 'aria-label': label });
    inp.addEventListener('input', () => { s.p[key] = inp.value; liveRender(); });
    inp.addEventListener('change', checkpoint);
    stepper(inp, v => { s.p[key] = v; }, isLengthKey(key));
    const promote = h('button', {
      class: 'promote', title: 'Convertir en parámetro', 'aria-label': 'Convertir ' + label + ' en parámetro',
      onclick: () => {
        const pname = addParam(PROMOTE_NAMES[key] || key, s.p[key] || '0', false);
        s.p[key] = pname;
        checkpoint(); fullRender();
        msg(`Nuevo parámetro "${pname}". Puedes renombrarlo en el panel Parámetros.`);
      },
    }, 'ƒ');
    return propRow(label, inp, `s:${s.id}:${key}`, promote);
  }

  // Valores iniciales útiles al elegir un tipo de repetición
  function repDefaults(s, mode) {
    const b = bboxOfItems(worldCache.get(s.id) || []) || { x: 0, y: 0, w: 20, h: 20 };
    const gap = parseFloat(nice(5)) * unitMM;
    const u = mm => fmt(mm / unitMM, isInch() ? 3 : 2);
    const p = s.p;
    if (mode === 'fila') Object.assign(p, { repN: p.repN || '4', repDx: p.repDx || u(b.w + gap), repDy: p.repDy || '0' });
    if (mode === 'cuadricula') Object.assign(p, { repN: p.repN || '3', repM: p.repM || '2', repDx: p.repDx || u(b.w + gap), repDy: p.repDy || u(b.h + gap) });
    if (mode === 'circular') {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2 + Math.max(b.h, 20);
      Object.assign(p, { repN: p.repN || '6', repCx: p.repCx || u(cx), repCy: p.repCy || u(cy), repA: p.repA || '360' });
    }
  }

  function buildInspector() {
    buildInspectorFields();
    refreshHints();
  }
  function buildInspectorFields() {
    const box = $('#inspector');
    box.replaceChildren();
    const shapes = [...sel].map(byId).filter(Boolean);

    if (!shapes.length) {
      const u = unitLabel();
      const numInput = (val, set) => {
        const i = h('input', { value: val, type: 'number', min: '0', step: 'any' });
        i.addEventListener('change', () => { const v = parseFloat(i.value); if (v > 0) { set(v); checkpoint(); fullRender(); } else i.value = val; });
        return i;
      };
      const bedOpts = { '': 'Personalizada' };
      BEDS.forEach((b, i) => { bedOpts[i] = b.label; });
      const bedIdx = BEDS.findIndex(b => b.w === doc.sheet.w && b.h === doc.sheet.h);
      box.append(
        h('div', { class: 'insp-title' }, 'Documento'),
        propRow('Unidades', selectEl({ mm: 'Milímetros (mm)', in: 'Pulgadas (in)' }, doc.units, 'Unidades', setUnits)),
        propRow('Máquina', selectEl(bedOpts, bedIdx < 0 ? '' : String(bedIdx), 'Área de trabajo', v => {
          const b = BEDS[+v];
          if (v !== '' && b) { doc.sheet = { w: b.w, h: b.h }; checkpoint(); fullRender(); fitView(); }
        })),
        propRow(`Área ancho (${u})`, numInput(fmt(doc.sheet.w / unitMM, 3), v => { doc.sheet.w = v * unitMM; })),
        propRow(`Área alto (${u})`, numInput(fmt(doc.sheet.h / unitMM, 3), v => { doc.sheet.h = v * unitMM; })),
        propRow(`Paso imán (${u})`, numInput(doc.grid, v => { doc.grid = v; })),
        h('p', { class: 'tip' }, 'En cualquier medida puedes escribir fórmulas, por ejemplo ', h('code', {}, 'ancho - 2*grosor'),
          ', y mezclar unidades: ', h('code', {}, '3mm'), ', ', h('code', {}, '1/8in'), ' o ', h('code', {}, '2"'),
          '. Flechas ↑↓ cambian números' + (isInch() ? ' (1/8", Shift 1", Alt 1/16").' : ' (1 mm, Shift 10, Alt 0.1).')),
        h('p', { class: 'tip' }, 'Selecciona varias figuras (Shift + clic o arrastrando un recuadro) para unirlas, restarlas o agruparlas.'),
      );
      return;
    }

    if (shapes.length > 1) {
      const sameList = shapes.every(s => listOf(s.id) === listOf(shapes[0].id));
      box.append(
        h('div', { class: 'insp-title' }, `${shapes.length} objetos seleccionados`),
        propRow('Operación', selectEl(OPS, shapes.every(s => s.op === shapes[0].op) ? shapes[0].op : '', 'Operación', v => { shapes.forEach(s => { s.op = v; }); checkpoint(); fullRender(); })),
        h('div', { class: 'insp-sub' }, 'Combinar'),
        sameList
          ? h('div', { class: 'btn-grid' },
            h('button', { onclick: () => groupSel('unir'), title: 'Une las figuras en una sola silueta' }, 'Unir'),
            h('button', { onclick: () => groupSel('restar'), title: 'A la figura de más abajo en la lista le quita las demás (ej. agujeros)' }, 'Restar'),
            h('button', { onclick: () => groupSel('intersectar'), title: 'Deja solo la parte donde se cruzan' }, 'Intersectar'),
            h('button', { onclick: () => groupSel('grupo'), title: 'Agrupa sin combinar (Ctrl+G)' }, 'Agrupar'))
          : h('p', { class: 'tip' }, 'Para combinar, los objetos deben estar en el mismo nivel.'),
        h('p', { class: 'tip' }, 'Restar: la figura de más abajo en la lista de Objetos es la pieza; las demás se recortan de ella.'),
        h('div', { class: 'insp-actions' },
          h('button', { onclick: duplicateSel }, 'Duplicar'),
          h('button', { class: 'danger', onclick: deleteSel }, 'Eliminar')),
      );
      return;
    }

    const s = shapes[0];
    const name = h('input', { value: s.name, 'aria-label': 'Nombre del objeto' });
    name.addEventListener('input', () => { s.name = name.value; buildObjects(); });
    name.addEventListener('change', checkpoint);
    const parent = parentOf(s.id);
    box.append(
      h('div', { class: 'insp-title' }, h('span', { class: 'type' }, TYPES[s.type].label + (parent ? ` · dentro de "${parent.name}"` : ''))),
      propRow('Nombre', name),
    );
    const isPlainGroup = s.type === 'group' && (s.p.mode || 'grupo') === 'grupo';
    if (!isPlainGroup) box.append(propRow('Operación', selectEl(OPS, s.op, 'Operación', v => { s.op = v; checkpoint(); fullRender(); })));

    for (const [key, label, kind] of TYPES[s.type].props) {
      if (kind === 'edge') {
        box.append(propRow(label, selectEl(EDGE_OPTS, s.p[key] || 'plano', label, v => { s.p[key] = v; checkpoint(); liveRender(); })));
      } else if (s.type === 'box' && boxFieldHidden(s, key)) {
        continue;
      } else if (s.type === 'box' && key === 'grabadoEn') {
        box.append(h('div', { class: 'insp-sub' }, 'Grabado (nombre o logo)'));
        box.append(propRow(label, selectEl(kind, s.p.grabadoEn || 'auto', label, v => { s.p.grabadoEn = v; checkpoint(); fullRender(); })));
      } else if (s.type === 'box' && key === 'logoTam') {
        const asset = s.p.grabadoLogo && doc.assets && doc.assets[s.p.grabadoLogo];
        if (asset) {
          const row = exprRow(s, key, label);
          row.querySelector('input').placeholder = 'auto';
          box.append(row);
        }
        box.append(h('div', { class: 'logo-row' },
          asset ? h('span', { class: 'logo-name', title: asset.name }, (asset.kind === 'vector' ? 'Logo (vector): ' : 'Logo (imagen): ') + asset.name) : null,
          h('button', { onclick: () => pickLogo(s) }, asset ? 'Cambiar logo' : 'Cargar logo (SVG, PNG o JPG)'),
          asset ? h('button', { class: 'danger', onclick: () => { delete s.p.grabadoLogo; checkpoint(); fullRender(); } }, 'Quitar') : null));
        if (asset && asset.kind === 'image') box.append(h('p', { class: 'tip' }, 'Las imágenes PNG/JPG se graban como foto. Para un grabado más nítido usa el logo en SVG.'));
      } else if (kind && typeof kind === 'object') {
        box.append(propRow(label, selectEl(kind, s.p[key] || Object.keys(kind)[0], label, v => { s.p[key] = v; checkpoint(); fullRender(); })));
      } else if (s.type === 'box' && key === 'dedo' && s.p.uniones === 'planas') {
        continue;
      } else if (s.type === 'box' && SLIDE_KEYS.has(key)) {
        const row = exprRow(s, key, label);
        row.querySelector('input').placeholder = key === 'borde' ? 'auto (1.5 × grosor)' : 'auto (0.15 mm)';
        box.append(row);
      } else if (s.type === 'box' && key.startsWith('div')) {
        if (key === 'divX') box.append(h('div', { class: 'insp-sub' }, 'Divisiones internas'));
        const hasDivs = Math.round(num(s, 'divX', 1)) > 1 || Math.round(num(s, 'divZ', 1)) > 1;
        if (key === 'divH' && !hasDivs) continue;
        const row = exprRow(s, key, label);
        if (key === 'divH') row.querySelector('input').placeholder = 'completa';
        else row.querySelector('input').addEventListener('change', () => fullRender());
        box.append(row);
        if (key === 'divH') box.append(h('p', { class: 'tip', id: 'compTip' }));
      } else if (kind === 'mode') {
        box.append(propRow(label, selectEl(MODES, s.p.mode || 'grupo', label, v => { s.p.mode = v; checkpoint(); fullRender(); })));
        if (isPlainGroup) box.append(h('p', { class: 'tip' }, 'Cada objeto del grupo conserva su propia operación (corte, grabado o marcado).'));
        else if (s.p.mode === 'restar') box.append(h('p', { class: 'tip' }, 'Al primer objeto del grupo (el de más abajo en la lista) se le restan los demás.'));
      } else if (kind === 'text') {
        const inp = h('input', { value: s.p[key] ?? '', spellcheck: 'false', 'data-key': key, 'aria-label': label, placeholder: key === 'grabadoTexto' ? 'Ej.: Evergreen Love' : null });
        inp.addEventListener('input', () => { s.p[key] = inp.value; liveRender(); });
        inp.addEventListener('change', checkpoint);
        box.append(propRow(label, inp));
        if (key === 'grabadoTexto' && s.p.cajon === 'si' && Math.round(num(s, 'nCaj', 1)) > 1) {
          box.append(h('p', { class: 'tip' }, 'Un nombre por cajón (de arriba a abajo): sepáralos con ', h('code', {}, '|'), ', por ejemplo ', h('code', {}, 'Hilos | Botones | Agujas'), '.'));
        }
      } else {
        const row = exprRow(s, key, label);
        if (s.type === 'box' && key === 'nCaj') row.querySelector('input').addEventListener('change', () => fullRender());
        if (s.type === 'box' && key === 'holguraC') row.querySelector('input').placeholder = 'auto (1 mm por lado)';
        if (s.type === 'box' && key === 'grabadoTam') row.querySelector('input').placeholder = 'auto';
        box.append(row);
      }
    }

    // Contorno y repetición
    box.append(h('div', { class: 'insp-sub' }, canOffset(s) ? 'Contorno y repetición' : 'Repetición'));
    if (canOffset(s)) {
      box.append(exprRow(s, 'off', 'Contorno ±'));
      if (!CL) box.append(h('p', { class: 'tip' }, 'No se encontró lib/clipper.js: el contorno está desactivado.'));
    }
    box.append(propRow('Repetir', selectEl(REP_OPTS, s.p.rep || 'no', 'Repetir', v => {
      s.p.rep = v; repDefaults(s, v); checkpoint(); fullRender();
    })));
    for (const [key, label] of REP_FIELDS[s.p.rep] || []) box.append(exprRow(s, key, label));

    if (s.type === 'box') updateCompTip(s);
    if (s.type === 'box' && s.p.cajon === 'si') {
      const m = boxModel(s, true);
      box.append(h('p', { class: 'tip', id: 'drawerTip' }, m
        ? (m.drawer.n > 1 ? `${m.drawer.n} cajones. ` : '') + `Cada cajón por dentro: ${fmt((m.drawer.Wd - 2 * m.t) / unitMM, isInch() ? 3 : 1)} × ${fmt((m.drawer.Dd - 2 * m.t) / unitMM, isInch() ? 3 : 1)} × ${fmt((m.drawer.Hd - m.t) / unitMM, isInch() ? 3 : 1)} ${unitLabel()} (ancho × fondo × alto). El frente decorativo se pega al frente del cajón.`
        : 'Las medidas no alcanzan para el cajón: agranda la caja o baja la holgura.'));
    }
    if (s.type === 'box') {
      box.append(h('button', { class: 'primary wide', onclick: () => open3D(s.id) }, 'Ver caja armada en 3D'));
      if (!boxModel(s)) box.append(h('p', { class: 'tip err-tip' }, 'Revisa las medidas: la caja debe ser más grande que dos veces el grosor.'));
    }
    const list = listOf(s.id), idx = list.indexOf(s);
    box.append(h('div', { class: 'insp-actions' },
      h('button', { onclick: duplicateSel }, 'Duplicar'),
      s.type === 'group' ? h('button', { onclick: ungroupSel, title: 'Ctrl+Shift+G' }, 'Desagrupar') : null,
      h('button', { class: 'icon-btn', title: 'Subir en la lista (queda encima)', 'aria-label': 'Subir', disabled: idx >= list.length - 1 ? '' : null, onclick: () => reorder(1) }, '↑'),
      h('button', { class: 'icon-btn', title: 'Bajar en la lista (queda debajo)', 'aria-label': 'Bajar', disabled: idx <= 0 ? '' : null, onclick: () => reorder(-1) }, '↓'),
      h('button', { class: 'danger', onclick: deleteSel }, 'Eliminar')));
  }

  // Campos de la caja que no aplican según las opciones elegidas
  function boxFieldHidden(s, key) {
    const drawer = s.p.cajon === 'si';
    if (key === 'holguraC' || key === 'nCaj') return !drawer;
    if (drawer && key === 'tapa') return true;
    if (key === 'borde' || key === 'holgura') return drawer || s.p.tapa !== 'deslizante';
    if (key === 'agarre') return !(drawer || s.p.tapa === 'deslizante');
    return false;
  }

  // Medida de cada compartimento (espacio libre adentro)
  function updateCompTip(s) {
    const el = $('#compTip');
    if (!el) return;
    const m = boxModel(s, true);
    if (!m) { el.textContent = 'Las divisiones no caben: prueba con menos compartimentos o una caja más grande.'; el.classList.add('err-tip'); return; }
    el.classList.remove('err-tip');
    const nx = Math.max(1, Math.round(num(s, 'divX', 1))), nz = Math.max(1, Math.round(num(s, 'divZ', 1)));
    const W = m.drawer ? m.drawer.Wd : m.W, D = m.drawer ? m.drawer.Dd : m.D;
    const cx = (W - 2 * m.t - (nx - 1) * m.t) / nx, cz = (D - 2 * m.t - (nz - 1) * m.t) / nz;
    const u = v => fmt(v / unitMM, isInch() ? 3 : 1);
    el.textContent = (m.drawer ? 'Dentro del cajón: c' : 'C') + `ada compartimento mide ${u(cx)} × ${u(cz)} ${unitLabel()} por dentro.` + (m.fingers ? ' Las divisiones llevan pestañas que entran en la base.' : '');
  }

  function refreshHints() {
    const dimless = dimensionlessParams();
    for (const el of document.querySelectorAll('[data-hint]')) {
      const key = el.dataset.hint;
      let text = '', err = '';
      if (key.startsWith('p:')) {
        const p = doc.params[+key.slice(2)];
        if (!p) continue;
        if (paramErrors[p.name] || vars[p.name] === undefined) err = paramErrors[p.name] || 'error';
        else {
          text = fmt(vars[p.name], 3);
          el.dataset.alt = dimless.has(p.name) ? '' : otherUnit(vars[p.name]);
        }
      } else {
        const [, id, k] = key.split(':');
        const s = byId(id);
        if (!s) continue;
        const e = s.p[k] ?? '';
        if (String(e).trim() === '') { text = ''; }
        else {
          try {
            const v = evalExpr(e, vars);
            const parts = [];
            if (!isNumeric(e)) parts.push('= ' + fmt(v, 3) + (isLengthKey(k) ? ' ' + unitLabel() : ''));
            if (isLengthKey(k)) parts.push(otherUnit(v));
            text = parts.join(' · ');
          } catch (ex) { err = ex.message; }
        }
      }
      el.textContent = err ? '⚠ ' + err : text;
      el.title = err || el.dataset.alt || '';
      el.classList.toggle('err', !!err);
      const input = el.parentElement.querySelector('input') || el.previousElementSibling;
      if (input && input.tagName === 'INPUT') input.classList.toggle('invalid', !!err);
    }
  }

  // ¿La fórmula suma o resta un número sin unidad? (ej. "ancho + 5") — ese número no se convierte.
  const addsBareNumber = e => typeof e === 'string' && !isNumeric(e) &&
    /(^|[-+])\s*\d+\.?\d*\s*($|[-+)])/.test(e.replace(/\d+\.?\d*\s*(\/\s*\d+\.?\d*\s*)?(mm|cm|in|pulg|")/g, 'U'));

  // Cambia la unidad del documento y convierte las medidas escritas como números.
  function setUnits(u) {
    if (u === doc.units || !UNIT_MM[u]) return;
    const f = UNIT_MM[doc.units] / UNIT_MM[u];
    const dec = u === 'in' ? 5 : 3;
    const conv = e => typeof e === 'string' && isNumeric(e) ? fmt(parseFloat(e) * f, dec) : e;
    const dimless = dimensionlessParams();
    let formulas = 0;
    for (const p of doc.params) {
      if (dimless.has(p.name)) continue;
      if (addsBareNumber(p.expr)) formulas++;
      p.expr = conv(p.expr);
    }
    for (const s of allShapes()) {
      for (const k in s.p) {
        if (!isLengthKey(k)) continue;
        if (addsBareNumber(s.p[k])) formulas++;
        s.p[k] = conv(s.p[k]);
      }
    }
    doc.units = u;
    doc.grid = u === 'in' ? 0.125 : 1;
    checkpoint(); fullRender();
    msg(`Medidas convertidas a ${u === 'in' ? 'pulgadas' : 'milímetros'}.` + (formulas ? ' Revisa las fórmulas que suman números sueltos.' : ''));
  }

  /* ================= Panel: Objetos ================= */
  function buildObjects() {
    const ul = $('#objects');
    ul.replaceChildren();
    if (!doc.shapes.length) {
      ul.append(h('li', { class: 'empty' }, 'Aún no hay objetos. Dibuja con las herramientas de la izquierda.'));
      return;
    }
    const add = (list, depth) => {
      for (const s of [...list].reverse()) {
        const type = s.type === 'group' ? `Grupo · ${MODES[s.p.mode || 'grupo']}` : TYPES[s.type].label;
        const isPlain = s.type === 'group' && (s.p.mode || 'grupo') === 'grupo';
        ul.append(h('li', {
          class: (sel.has(s.id) ? 'selected' : '') + (depth ? ' child' : ''),
          style: depth ? `padding-left:${8 + depth * 14}px` : null,
          onclick: e => {
            if (e.shiftKey) { sel.has(s.id) ? sel.delete(s.id) : sel.add(s.id); }
            else sel = new Set([s.id]);
            buildInspector(); buildObjects(); drawCanvas();
          },
        }, h('span', {}, isPlain ? h('span', { class: 'dot group' }) : h('span', { class: 'dot op-' + s.op }), s.name), h('span', { class: 'type' }, type)));
        if (s.children) add(s.children, depth + 1);
      }
    };
    add(doc.shapes, 0);
  }

  /* ================= Acciones ================= */
  function deleteSel() {
    if (!sel.size) return;
    for (const id of sel) {
      const list = listOf(id), s = byId(id);
      if (s && list.includes(s)) list.splice(list.indexOf(s), 1);
    }
    sel.clear();
    checkpoint(); fullRender();
  }
  const cloneShape = s => {
    const c = JSON.parse(JSON.stringify(s));
    const reid = x => { x.id = uid(); (x.children || []).forEach(reid); };
    reid(c);
    return c;
  };
  function duplicateSel() {
    if (!sel.size) return;
    const off = parseFloat(nice(10)) * unitMM;
    const copies = [];
    for (const id of sel) {
      const s = byId(id); if (!s) continue;
      const c = cloneShape(s);
      c.name = s.name + ' copia';
      moveShape(c, s.p, off, off);
      const list = listOf(id);
      list.splice(list.indexOf(s) + 1, 0, c);
      copies.push(c);
    }
    sel = new Set(copies.map(c => c.id));
    checkpoint(); fullRender();
  }
  function nudge(dx, dy) {
    for (const id of sel) { const s = byId(id); if (s) moveShape(s, { ...s.p }, dx, dy); }
    checkpoint(); liveRender(); buildInspector();
  }
  function reorder(dir) {
    if (sel.size !== 1) return;
    const id = [...sel][0], list = listOf(id), s = byId(id), i = list.indexOf(s), j = i + dir;
    if (j < 0 || j >= list.length) return;
    list.splice(i, 1); list.splice(j, 0, s);
    checkpoint(); fullRender();
  }

  function groupSel(mode) {
    const shapes = [...sel].map(byId).filter(Boolean);
    if (shapes.length < 2 && mode !== 'grupo') { msg('Selecciona al menos dos figuras.'); return; }
    if (!shapes.length) return;
    const list = listOf(shapes[0].id);
    const members = list.filter(s => sel.has(s.id)); // en el orden de la lista (el de abajo primero)
    if (members.length !== shapes.length) { msg('Para combinar, los objetos deben estar en el mismo nivel.'); return; }
    if (mode !== 'grupo' && members.every(s => TYPES[s.type].open)) { msg('Unir y restar funcionan con figuras cerradas (no líneas ni texto).'); return; }
    const at = list.indexOf(members[0]);
    const label = { grupo: 'Grupo', unir: 'Unión', restar: 'Resta', intersectar: 'Intersección' }[mode];
    const g = { id: uid(), type: 'group', name: nextName(label), op: members[0].op, p: { mode, x: '0', y: '0', rot: '0' }, children: members };
    for (const m of members) list.splice(list.indexOf(m), 1);
    list.splice(at, 0, g);
    sel = new Set([g.id]);
    checkpoint(); fullRender();
    if (mode === 'restar') msg(`"${members[0].name}" es la pieza; las demás figuras se recortan de ella.`);
  }
  function ungroupSel() {
    const groups = [...sel].map(byId).filter(s => s && s.type === 'group');
    if (!groups.length) return;
    const newSel = new Set();
    let lost = false;
    for (const g of groups) {
      const list = listOf(g.id), at = list.indexOf(g);
      const gx = len(g, 'x'), gy = len(g, 'y');
      if ((num(g, 'rot', 0) || 0) !== 0 || (g.p.rep && g.p.rep !== 'no') || (g.p.off && len(g, 'off'))) lost = true;
      for (const c of g.children || []) {
        if ((gx || gy) && Number.isFinite(gx) && Number.isFinite(gy)) moveShape(c, { ...c.p }, gx, gy);
        newSel.add(c.id);
      }
      list.splice(at, 1, ...(g.children || []));
    }
    sel = newSel;
    checkpoint(); fullRender();
    if (lost) msg('Se desagrupó. La rotación, el contorno o la repetición del grupo no se pasan a cada objeto.');
  }

  /* ================= Archivos ================= */
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const safeName = () => (doc.name || 'diseño').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'diseño';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Todas las piezas finales, listas para exportar
  function exportItems() {
    evaluateParams(); evaluateAll();
    const items = [...evalCache.values()].flatMap(r => r.items);
    const bad = doc.shapes.length - evalCache.size;
    return { items, bad, bbox: bboxOfItems(items) };
  }

  function exportSVG() {
    const { items, bad, bbox: b } = exportItems();
    if (!b) { msg('No hay nada que exportar.'); return; }
    const m = 1;
    const x = b.x - m, y = b.y - m, w = b.w + 2 * m, hgt = b.h + 2 * m;
    const STROKE = { corte: '#FF0000', grabado: '#000000', marcado: '#0000FF' };
    // El SVG siempre sale en mm reales: xTool Creative Space lo importa al tamaño exacto.
    const out = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${r4(w)}mm" height="${r4(hgt)}mm" viewBox="${r4(x)} ${r4(y)} ${r4(w)} ${r4(hgt)}">`,
      `<!-- ${esc(doc.name)} · Evergreen Love Studio · rojo = corte, negro = grabado, azul = marcado -->`,
    ];
    for (const op of Object.keys(OPS)) {
      const group = items.filter(it => it.op === op);
      if (!group.length) continue;
      out.push(`<g id="${op}">`);
      const line = `fill="none" stroke="${STROKE[op]}" stroke-width="0.1"`;
      for (const it of group) {
        const closed = it.polys.filter(p => p.closed), open = it.polys.filter(p => !p.closed);
        if (op === 'grabado') {
          if (closed.length) out.push(`<path d="${pathD(closed)}" fill="#000000" fill-rule="evenodd" stroke="none"/>`);
          if (open.length) out.push(`<path d="${pathD(open)}" ${line}/>`);
        } else if (it.polys.length) {
          out.push(`<path d="${pathD(it.polys)}" ${line}/>`);
        }
        for (const t of it.texts) {
          const style = op === 'grabado' ? 'fill="#000000" stroke="none"' : line;
          const tr = t.rot ? ` transform="rotate(${r4(t.rot)} ${r4(t.x)} ${r4(t.y)})"` : '';
          const anchor = t.anchor === 'middle' ? ' text-anchor="middle"' : '';
          out.push(`<text x="${r4(t.x)}" y="${r4(t.y)}" font-size="${r4(t.size)}" font-family="Arial, Helvetica, sans-serif"${anchor} ${style}${tr}>${esc(t.str)}</text>`);
        }
        for (const g of it.images || []) {
          const tr = g.rot ? ` transform="rotate(${r4(g.rot)} ${r4(g.x)} ${r4(g.y)})"` : '';
          out.push(`<image x="${r4(g.x)}" y="${r4(g.y)}" width="${r4(g.w)}" height="${r4(g.h)}" preserveAspectRatio="none" href="${g.href}" xlink:href="${g.href}"${tr}/>`);
        }
      }
      out.push('</g>');
    }
    out.push('</svg>');
    download(safeName() + '.svg', out.join('\n'), 'image/svg+xml');
    msg(`SVG exportado: ${fmt(b.w / unitMM, 2)} × ${fmt(b.h / unitMM, 2)} ${unitLabel()}` + (bad ? ` (${bad} objeto(s) con error omitidos)` : ''));
  }

  // DXF (R12, en mm): capas CORTE (rojo), GRABADO (negro/blanco) y MARCADO (azul).
  function exportDXF() {
    const { items, bad, bbox: b } = exportItems();
    if (!b) { msg('No hay nada que exportar.'); return; }
    const LAYERS = { corte: ['CORTE', 1], grabado: ['GRABADO', 7], marcado: ['MARCADO', 5] };
    let skippedImages = 0;
    const out = [];
    const g = (code, val) => { out.push(String(code), String(val)); };
    const dxfStr = s => s.replace(/[^\x20-\x7E]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, 4);
    g(9, '$MEASUREMENT'); g(70, 1);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, 3);
    for (const [name, color] of Object.values(LAYERS)) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); }
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const it of items) {
      const layer = LAYERS[it.op][0];
      for (const p of it.polys) {
        g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, p.closed ? 1 : 0);
        for (const [x, y] of p.pts) { g(0, 'VERTEX'); g(8, layer); g(10, r4(x)); g(20, r4(-y)); g(30, 0); }
        g(0, 'SEQEND'); g(8, layer);
      }
      for (const t of it.texts) {
        g(0, 'TEXT'); g(8, layer); g(10, r4(t.x)); g(20, r4(-t.y)); g(30, 0); g(40, r4(t.size * 0.7)); g(1, dxfStr(t.str)); g(50, r4(-t.rot));
        if (t.anchor === 'middle') { g(72, 1); g(11, r4(t.x)); g(21, r4(-t.y)); g(31, 0); }
      }
      skippedImages += (it.images || []).length;
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    download(safeName() + '.dxf', out.join('\r\n') + '\r\n', 'application/dxf');
    msg(`DXF exportado en mm: ${fmt(b.w, 1)} × ${fmt(b.h, 1)} mm` + (bad ? ` (${bad} objeto(s) con error omitidos)` : '')
      + (skippedImages ? '. El DXF no admite imágenes: para el logo en PNG/JPG usa Exportar SVG.' : ''));
  }

  function saveFile() {
    download(safeName() + '.json', JSON.stringify(doc, null, 2), 'application/json');
    msg('Diseño guardado en tu carpeta de Descargas.');
  }

  function loadDoc(d) {
    if (!d || !Array.isArray(d.shapes) || !Array.isArray(d.params)) throw new Error('formato');
    const base = newDoc(d.units === 'in' ? 'in' : 'mm');
    const clean = s => {
      const c = { op: 'corte', ...s, id: s.id || uid(), p: { ...s.p } };
      if (!OPS[c.op]) c.op = 'corte';
      if (c.type === 'group') c.children = (s.children || []).filter(k => k && TYPES[k.type]).map(clean);
      return c;
    };
    doc = { ...base, ...d, sheet: { ...base.sheet, ...(d.sheet || {}) }, assets: { ...(d.assets || {}) } };
    doc.shapes = doc.shapes.filter(s => s && TYPES[s.type]).map(clean);
    sel.clear();
  }

  $('#fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        checkpoint();
        loadDoc(JSON.parse(reader.result));
        checkpoint(); fullRender(); fitView();
        msg('Diseño abierto: ' + file.name);
      } catch (err) { msg('No se pudo abrir ese archivo.'); }
    };
    reader.readAsText(file);
  });

  /* ================= Logos (SVG a trazos, PNG/JPG como imagen) ================= */
  function pickLogo(s) {
    const input = h('input', { type: 'file', accept: '.svg,image/svg+xml,image/png,image/jpeg' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const asset = /svg/i.test(file.type) || /\.svg$/i.test(file.name) ? importSvgLogo(await file.text(), file.name) : await importImageLogo(file);
        const id = 'a' + uid();
        doc.assets = doc.assets || {};
        doc.assets[id] = asset;
        s.p.grabadoLogo = id;
        checkpoint(); fullRender();
        msg(`Logo cargado: ${file.name}`);
      } catch (e) { msg('No se pudo leer ese logo: ' + e.message); }
    });
    input.click();
  }

  // Convierte las figuras del SVG en trazos (normalizados a ancho 1) para grabar con relleno.
  function importSvgLogo(text, name) {
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('no es un SVG válido');
    root.querySelectorAll('script, foreignObject, image').forEach(e => e.remove());
    for (const el of root.querySelectorAll('*')) for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    // Contenedor fuera de pantalla (transparente, no oculto: así se puede medir cada figura)
    const host = h('div', { style: 'position:fixed;left:-20000px;top:0;width:1000px;height:1000px;opacity:0;pointer-events:none' });
    const svgNode = document.importNode(root, true);
    host.append(svgNode);
    document.body.append(host);
    const polys = [];
    try {
      for (const el of svgNode.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')) {
        if (el.closest('defs, clipPath, mask, symbol, marker, pattern')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const L = el.getTotalLength();
        const m = el.getCTM();
        if (!(L > 0) || !m) continue;
        const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
        const n = Math.min(6000, Math.max(24, Math.ceil(L * scale / 0.4)));
        const step = L / n;
        let cur = [], prev = null;
        const flush = () => {
          if (cur.length >= 2) {
            const a = cur[0], b = cur[cur.length - 1];
            const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < step * scale * 2 || /^(rect|circle|ellipse|polygon)$/i.test(el.nodeName);
            polys.push({ closed, pts: closed && cur.length > 2 ? cur.slice(0, -1) : cur });
          }
          cur = [];
        };
        for (let i = 0; i <= n; i++) {
          const pt = el.getPointAtLength(Math.min(L, i * step));
          const q = [m.a * pt.x + m.c * pt.y + m.e, m.b * pt.x + m.d * pt.y + m.f];
          if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > step * scale * 3) flush(); // salto = nuevo subtrazo
          cur.push(q); prev = q;
        }
        flush();
      }
    } finally { host.remove(); }
    if (!polys.length) throw new Error('no se encontraron figuras (si el logo tiene textos, conviértelos a trazos en tu programa de diseño)');
    const all = polys.flatMap(pl => pl.pts);
    const x0 = Math.min(...all.map(p => p[0])), y0 = Math.min(...all.map(p => p[1]));
    const W = Math.max(...all.map(p => p[0])) - x0 || 1, H = Math.max(...all.map(p => p[1])) - y0 || 1;
    const r5 = v => Math.round(v * 1e5) / 1e5;
    return {
      kind: 'vector', name, w: 1, h: H / W,
      polys: polys.map(pl => ({ closed: pl.closed, pts: pl.pts.map(([x, y]) => [r5((x - x0) / W), r5((y - y0) / W)]) })),
    };
  }

  // Imagen PNG/JPG: se reduce a máx. 1200 px para no hacer pesado el archivo del diseño.
  function importImageLogo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('no se pudo leer'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('imagen no válida'));
        img.onload = () => {
          const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ kind: 'image', name: file.name, w: c.width, h: c.height, href: c.toDataURL('image/png') });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ================= Plantillas ================= */
  function boxTemplate(uniones = 'dedos', units = 'mm', sheet, tapa = 'si', cajon = 'no') {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = cajon === 'si' ? 'Caja con cajón' : tapa === 'deslizante' ? 'Caja con tapa deslizante' : uniones === 'dedos' ? 'Caja con dedos' : 'Caja para pegar';
    const values = units === 'in'
      ? [['ancho', '4'], ['profundo', '3'], ['alto', '2.5'], ['grosor', '0.125'], ['dedo', '0.4'], ['kerf', '0.004'], ['sep', '0.2']]
      : [['ancho', '100'], ['profundo', '80'], ['alto', '60'], ['grosor', '3'], ['dedo', '10'], ['kerf', '0.1'], ['sep', '5']];
    d.params = values.map(([name, expr]) => ({ name, expr: cajon === 'si' && name === 'alto' ? (units === 'in' ? '4' : '100') : expr }));
    if (cajon === 'si') d.name = 'Mueble con cajones';
    d.shapes = [{
      id: uid(), type: 'box', name: 'Caja', op: 'corte',
      p: { uniones, cajon, nCaj: cajon === 'si' ? '2' : '1', tapa, medidas: 'exteriores', x: '0', y: '0', ancho: 'ancho', profundo: 'profundo', alto: 'alto',
        t: 'grosor', dedo: 'dedo', kerf: 'kerf', sep: 'sep', rot: '0', rep: 'no' },
    }];
    return d;
  }

  // Valor inicial en la unidad del documento (pulgadas redondeadas a 1/16")
  const tv = (mm, units) => units === 'in' ? fmt(Math.round(mm / 25.4 * 16) / 16) : fmt(mm);
  const node = (type, name, op, p, children) => ({ id: uid(), type, name, op, p, ...(children ? { children } : {}) });

  function keychainTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = 'Llavero';
    d.params = [['largo', tv(60, units)], ['alto', tv(25, units)], ['radio', tv(6, units)], ['agujero', tv(5, units)],
      ['margen', tv(6, units)], ['texto_tam', tv(9, units)]].map(([name, expr]) => ({ name, expr }));
    d.shapes = [
      node('group', 'Llavero', 'corte', { mode: 'restar', x: '0', y: '0', rot: '0', rep: 'no' }, [
        node('rect', 'Contorno', 'corte', { x: '0', y: '0', w: 'largo', h: 'alto', r: 'radio', rot: '0' }),
        node('circle', 'Agujero', 'corte', { x: 'margen', y: 'alto / 2', d: 'agujero', rot: '0' }),
      ]),
      node('text', 'Nombre', 'grabado', { texto: 'Evergreen', x: 'margen * 2', y: 'alto / 2 + texto_tam * 0.35', tam: 'texto_tam', rot: '0' }),
    ];
    return d;
  }

  function coasterTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = 'Posavasos';
    d.params = [['diametro', tv(95, units)], ['borde', tv(6, units)], ['sep', tv(5, units)], ['columnas', '3'], ['filas', '2']]
      .map(([name, expr]) => ({ name, expr }));
    const c = 'diametro / 2';
    d.shapes = [
      node('group', 'Posavasos', 'corte', { mode: 'grupo', x: '0', y: '0', rot: '0', rep: 'cuadricula', repN: 'columnas', repM: 'filas', repDx: 'diametro + sep', repDy: 'diametro + sep' }, [
        node('circle', 'Círculo', 'corte', { x: c, y: c, d: 'diametro', rot: '0' }),
        node('circle', 'Aro marcado', 'marcado', { x: c, y: c, d: 'diametro - 2 * borde', rot: '0' }),
        node('text', 'Texto', 'grabado', { texto: 'Evergreen', x: 'diametro * 0.2', y: 'diametro / 2 + diametro * 0.04', tam: 'diametro * 0.12', rot: '0' }),
      ]),
    ];
    return d;
  }

  function hingeTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = 'Muestra de bisagra';
    d.params = [['ancho', tv(120, units)], ['alto', tv(60, units)], ['zona', tv(50, units)], ['largo', tv(20, units)],
      ['puente', tv(3, units)], ['paso', units === 'in' ? '0.08' : '2']].map(([name, expr]) => ({ name, expr }));
    d.shapes = [
      node('rect', 'Pieza', 'corte', { x: '0', y: '0', w: 'ancho', h: 'alto', r: '0', rot: '0' }),
      node('hinge', 'Bisagra', 'corte', { x: '(ancho - zona) / 2', y: '0', w: 'zona', h: 'alto', largo: 'largo', puente: 'puente', paso: 'paso', rot: '0' }),
    ];
    return d;
  }

  const TEMPLATES = {
    'box-dedos': (u, s) => boxTemplate('dedos', u, s),
    'box-planas': (u, s) => boxTemplate('planas', u, s),
    'box-slide': (u, s) => boxTemplate('dedos', u, s, 'deslizante'),
    'box-drawer': (u, s) => boxTemplate('dedos', u, s, 'si', 'si'),
    keychain: keychainTemplate,
    coasters: coasterTemplate,
    hinge: hingeTemplate,
  };

  /* ================= Vista 3D (Three.js en lib/) ================= */
  // Cómo se coloca cada pieza: ejes u (ancho), v (alto, hacia abajo en el plano) y w (grosor) en el espacio 3D.
  // X = ancho de la caja, Y = altura, Z = profundidad (el frente está en Z = 0).
  const PLACE = {
    front: { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], out: [0, 0, -1] },
    back: { eu: [-1, 0, 0], ev: [0, -1, 0], ew: [0, 0, -1], out: [0, 0, 1] },
    left: { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], out: [-1, 0, 0] },
    right: { eu: [0, 0, 1], ev: [0, -1, 0], ew: [-1, 0, 0], out: [1, 0, 0] },
    bottom: { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, 1, 0], out: [0, -1, 0] },
    top: { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, -1, 0], out: [0, 1, 0] },
  };
  const WOOD = { front: 0xd9b384, back: 0xd9b384, left: 0xc79d68, right: 0xc79d68, bottom: 0xcfa878, top: 0xcfa878 };
  function placeOrigin(m, q) {
    const { W, D, H, t, fingers } = m;
    const topY = (fingers ? 0 : t) + q.h; // las paredes se apoyan en el piso (con dedos) o sobre la base (sin dedos)
    const z0 = fingers ? 0 : t;
    return { front: [0, topY, 0], back: [W, topY, D], left: [0, topY, z0], right: [W, topY, z0], bottom: [0, 0, 0], top: [0, H, 0] }[q.place];
  }

  const v3 = { open: false, id: null, renderer: null, scene: null, camera: null, controls: null, group: null, raf: 0, model: null };

  function init3D() {
    if (v3.renderer) return true;
    const T = window.THREE;
    if (!T || !T.OrbitControls) { msg('Falta lib/three.min.js u OrbitControls.js: la vista 3D no está disponible.'); return false; }
    const host = $('#view3dCanvas');
    try {
      v3.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) { msg('Este navegador no permite gráficos 3D (WebGL).'); return false; }
    v3.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.append(v3.renderer.domElement);
    v3.scene = new T.Scene();
    v3.camera = new T.PerspectiveCamera(35, 1, 1, 20000);
    v3.scene.add(new T.HemisphereLight(0xfff6ea, 0x8a7a66, 0.6));
    const key = new T.DirectionalLight(0xffffff, 0.6); key.position.set(1.2, 1.4, -1.6); v3.scene.add(key);
    const fill = new T.DirectionalLight(0xffffff, 0.3); fill.position.set(-1.5, 0.6, 1); v3.scene.add(fill);
    v3.controls = new T.OrbitControls(v3.camera, v3.renderer.domElement);
    v3.controls.enableDamping = true;
    v3.group = new T.Group();
    v3.scene.add(v3.group);
    new ResizeObserver(resize3D).observe(host);
    return true;
  }
  function resize3D() {
    if (!v3.renderer) return;
    const host = $('#view3dCanvas'), w = host.clientWidth, hh = host.clientHeight;
    if (!w || !hh) return;
    v3.renderer.setSize(w, hh);
    v3.camera.aspect = w / hh;
    v3.camera.updateProjectionMatrix();
  }

  function build3D() {
    const T = window.THREE, s = byId(v3.id);
    for (const c of [...v3.group.children]) {
      c.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      v3.group.remove(c);
    }
    const m = s && boxModel(s, true);
    v3.model = m;
    $('#view3dMsg').hidden = !!m;
    if (!m) { $('#view3dMsg').textContent = 'Las medidas de la caja no son válidas: revisa que sea más grande que dos veces el grosor.'; return; }
    const comps = m.dividers.length ? ` · ${Math.max(1, Math.round(num(s, 'divX', 1)))} × ${Math.max(1, Math.round(num(s, 'divZ', 1)))} compartimentos` : '';
    $('#view3dTitle').textContent = `${s.name} · ${fmt(m.W / unitMM, 3)} × ${fmt(m.D / unitMM, 3)} × ${fmt(m.H / unitMM, 3)} ${unitLabel()} (exterior)${comps}${m.drawer ? ' · con cajón' : ''}`;
    const engQs = new Set(engraveTargets(s, m).map(tg => tg.q));
    for (const q of [...m.panels, ...m.dividers]) {
      const P = q.axes || PLACE[q.place], o = q.axes ? q.axes.o : placeOrigin(m, q);
      const shape = new T.Shape(q.pts.map(([u, v]) => new T.Vector2(u, v)));
      for (const hl of q.holes || []) shape.holes.push(new T.Path(hl.map(([u, v]) => new T.Vector2(u, v))));
      const geo = new T.ExtrudeGeometry(shape, { depth: m.t, bevelEnabled: false, curveSegments: 1 });
      const mat4 = new T.Matrix4().set(
        P.eu[0], P.ev[0], P.ew[0], o[0],
        P.eu[1], P.ev[1], P.ew[1], o[1],
        P.eu[2], P.ev[2], P.ew[2], o[2],
        0, 0, 0, 1);
      const holder = new T.Group();
      // Con cajón, el mueble queda fijo y el control desliza el cajón hacia afuera
      holder.userData.out = m.drawer ? [0, 0, 0] : q.axes ? q.axes.out : P.out;
      holder.userData.slide = !!q.drawer;
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: WOOD[q.place] || 0xe2bf8d, roughness: 0.85, metalness: 0, side: T.DoubleSide }));
      const edges = new T.LineSegments(new T.EdgesGeometry(geo, 20), new T.LineBasicMaterial({ color: 0x6b4a2b }));
      const parts = [mesh, edges];
      if (engQs.has(q)) {
        const decal = engraveDecal(s, m, q, P);
        if (decal) parts.push(decal);
      }
      for (const obj of parts) { obj.matrixAutoUpdate = false; obj.matrix.copy(mat4); holder.add(obj); }
      v3.group.add(holder);
    }
    v3.group.position.set(-m.W / 2, -m.H / 2, -m.D / 2);
    applyExplode();
  }
  // Grabado en 3D: se dibuja en una textura (color madera quemada) pegada a la cara exterior de la pieza.
  const imgCache = new Map();
  function engraveDecal(s, m, q, P) {
    const T = window.THREE;
    const it = boxEngraving(s, m, new Map([[q, [0, 0]]]));
    if (!it) return null;
    const lid = q.name === 'Tapa deslizante';
    const w0 = lid ? m.t + 0.06 : -0.06; // cara exterior (la tapa deslizante mira hacia +w)
    // En el modelo algunas piezas quedan reflejadas; se refleja la textura para que se lea igual que la pieza real
    const cross = [P.eu[1] * P.ev[2] - P.eu[2] * P.ev[1], P.eu[2] * P.ev[0] - P.eu[0] * P.ev[2], P.eu[0] * P.ev[1] - P.eu[1] * P.ev[0]];
    const dot = cross[0] * P.ew[0] + cross[1] * P.ew[1] + cross[2] * P.ew[2];
    const flip = lid ? dot > 0 : dot < 0;
    const sc = Math.min(10, 2048 / Math.max(q.w, q.h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(q.w * sc)); cv.height = Math.max(2, Math.round(q.h * sc));
    const tex = new T.CanvasTexture(cv);
    tex.anisotropy = v3.renderer.capabilities.getMaxAnisotropy();
    const draw = () => {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.save();
      if (flip) { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
      ctx.scale(sc, sc);
      ctx.fillStyle = ctx.strokeStyle = 'rgba(58, 32, 14, 0.88)';
      const closed = it.polys.filter(pl => pl.closed), open = it.polys.filter(pl => !pl.closed);
      const trace = list => { ctx.beginPath(); for (const pl of list) { pl.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (pl.closed) ctx.closePath(); } };
      if (closed.length) { trace(closed); ctx.fill('evenodd'); }
      if (open.length) { trace(open); ctx.lineWidth = 0.3; ctx.stroke(); }
      for (const t of it.texts) {
        ctx.save();
        ctx.translate(t.x, t.y); ctx.rotate(t.rot * DEG);
        ctx.font = `${t.size}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = t.anchor === 'middle' ? 'center' : 'left';
        ctx.fillText(t.str, 0, 0);
        ctx.restore();
      }
      for (const g of it.images) {
        let img = imgCache.get(g.href);
        if (!img) { img = new Image(); img.src = g.href; imgCache.set(g.href, img); }
        if (!img.complete) { img.addEventListener('load', () => { draw(); tex.needsUpdate = true; }, { once: true }); continue; }
        ctx.save();
        ctx.translate(g.x, g.y); ctx.rotate(g.rot * DEG);
        ctx.globalAlpha = 0.85; ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, 0, 0, g.w, g.h);
        ctx.restore();
      }
      ctx.restore();
    };
    draw();
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute([0, 0, w0, q.w, 0, w0, q.w, q.h, w0, 0, q.h, w0], 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    return new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: T.DoubleSide }));
  }

  function applyExplode() {
    const m = v3.model;
    if (!m) return;
    const e = parseFloat($('#explode').value) || 0, dist = Math.max(m.W, m.D, m.H) * 0.45 * e;
    for (const holder of v3.group.children) {
      const [x, y, z] = holder.userData.out;
      holder.position.set(x * dist, y * dist, z * dist);
      if (holder.userData.slide && m.drawer) holder.position.z = -e * m.drawer.Dd * 0.85;
    }
    $('#explodeLabel').textContent = m.drawer ? 'Abrir cajón' : 'Separar piezas';
  }
  function fit3D() {
    const m = v3.model;
    if (!m) return;
    const R = Math.hypot(m.W, m.H, m.D);
    v3.camera.position.set(R * 0.95, R * 0.8, -R * 1.45);
    v3.controls.target.set(0, 0, 0);
    v3.controls.update();
  }
  function loop3D() {
    if (!v3.open) return;
    v3.controls.update();
    v3.renderer.render(v3.scene, v3.camera);
    v3.raf = requestAnimationFrame(loop3D);
  }
  function open3D(id) {
    if (!id) {
      const pick = [...sel].map(byId).find(s => s && s.type === 'box');
      const any = allShapes().find(s => s.type === 'box');
      id = (pick || any || {}).id;
    }
    if (!id) { msg('La vista 3D muestra objetos Caja. Crea una con Plantillas → Caja o con la herramienta Caja (K).'); return; }
    if (!init3D()) return;
    v3.id = id; v3.open = true;
    $('#view3d').hidden = false;
    resize3D();
    evaluateParams();
    build3D(); fit3D();
    cancelAnimationFrame(v3.raf);
    loop3D();
  }
  function close3D() {
    v3.open = false;
    cancelAnimationFrame(v3.raf);
    $('#view3d').hidden = true;
  }
  $('#btnView3d').onclick = () => open3D();
  $('#btnView3dClose').onclick = close3D;
  $('#btnView3dFit').onclick = fit3D;
  $('#explode').addEventListener('input', applyExplode);

  /* ================= Render ================= */
  function liveRender() {
    evaluateParams(); drawCanvas(); refreshHints();
    const one = sel.size === 1 && byId([...sel][0]);
    if (one && one.type === 'box') updateCompTip(one);
    if (v3.open) build3D();
  }
  function fullRender() {
    evaluateParams();
    $('#docName').value = doc.name;
    $('#unitSelect').value = doc.units;
    $('#stCoords').textContent = `x ${fmt(lastPointer.x / unitMM, 3)} · y ${fmt(lastPointer.y / unitMM, 3)} ${unitLabel()}`;
    drawCanvas(); buildParams(); buildInspector(); buildObjects(); refreshHints(); updateButtons();
    if (v3.open) { if (byId(v3.id)) build3D(); else close3D(); }
  }
  function updateButtons() {
    $('#btnUndo').disabled = !undoStack.length && JSON.stringify(doc) === savedState;
    $('#btnRedo').disabled = !redoStack.length;
  }

  /* ================= Eventos de la interfaz ================= */
  $('#btnNew').onclick = () => {
    if (doc.shapes.length && !confirm('¿Empezar un diseño nuevo? El actual se puede recuperar con Deshacer.')) return;
    checkpoint(); doc = newDoc(doc.units); sel.clear(); checkpoint(); fullRender(); fitView();
  };
  $('#btnOpen').onclick = () => $('#fileInput').click();
  $('#btnSave').onclick = saveFile;
  $('#btnExport').onclick = exportSVG;
  $('#btnExportDxf').onclick = exportDXF;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnAddParam').onclick = () => addParam();
  $('#btnZoomIn').onclick = () => zoomCenter(1.25);
  $('#btnZoomOut').onclick = () => zoomCenter(0.8);
  $('#btnFit').onclick = fitView;
  $('#unitSelect').onchange = e => setUnits(e.target.value);
  $('#chkSnap').onchange = e => { snap = e.target.checked; };
  $('#docName').addEventListener('input', e => { doc.name = e.target.value; });
  $('#docName').addEventListener('change', checkpoint);

  const menu = $('#menuTemplates');
  $('#btnTemplates').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-template]');
    if (!b || !TEMPLATES[b.dataset.template]) return;
    if (doc.shapes.length && !confirm('La plantilla reemplaza el diseño actual (puedes volver con Deshacer). ¿Continuar?')) return;
    checkpoint();
    doc = TEMPLATES[b.dataset.template](doc.units, doc.sheet);
    sel.clear(); checkpoint(); fullRender(); fitView();
  });

  const TOOL_KEYS = { v: 'select', h: 'hand', r: 'rect', c: 'circle', p: 'polygon', l: 'line', t: 'text', f: 'panel', b: 'hinge', k: 'box' };
  document.addEventListener('keydown', e => {
    const inField = e.target.matches && e.target.matches('input, textarea, select');
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); saveFile(); return; }
    if (mod && k === 'o') { e.preventDefault(); $('#fileInput').click(); return; }
    if (inField) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel('grupo'); return; }
    if (mod && k === 'a') { e.preventDefault(); sel = new Set(doc.shapes.map(s => s.id)); buildInspector(); buildObjects(); drawCanvas(); return; }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (e.key === ' ') { e.preventDefault(); spaceDown = true; stage.classList.add('panning'); return; }
    if (e.key === 'Escape' && v3.open) { close3D(); return; }
    if (e.key === 'Escape') {
      // Si estaba editando dentro de un grupo, vuelve a seleccionar el grupo
      const one = sel.size === 1 && byId([...sel][0]);
      const par = one && parentOf(one.id);
      sel = par ? new Set([par.id]) : new Set();
      setTool('select'); fullRender(); return;
    }
    if (e.key === '0') { fitView(); return; }
    if (e.key === '+' || e.key === '=') { zoomCenter(1.25); return; }
    if (e.key === '-') { zoomCenter(0.8); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && sel.size) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1;
      nudge(arrows[e.key][0] * st * gridMM(), arrows[e.key][1] * st * gridMM());
      return;
    }
    if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
  });
  document.addEventListener('keyup', e => {
    if (e.key === ' ') { spaceDown = false; if (!drag) stage.classList.remove('panning'); }
  });

  new ResizeObserver(() => drawCanvas()).observe(stage);

  /* ================= Inicio ================= */
  let restored = false;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { loadDoc(JSON.parse(raw)); restored = true; }
  } catch (e) { /* sin datos guardados */ }
  if (!restored) doc = boxTemplate('dedos');
  if (!CL) setTimeout(() => msg('Aviso: falta lib/clipper.js; unir, restar y contorno no estarán disponibles.'), 500);
  savedState = JSON.stringify(doc);
  setTool('select');
  fullRender();
  fitView();
})();
