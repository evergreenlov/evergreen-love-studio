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
  const IMPORT_OPS = { archivo: 'Según colores del archivo', ...OPS };
  const EDGE_OPTS = { plano: 'Plano', dedos: 'Dedos (salen)', ranuras: 'Ranuras (entran)' };
  const MODES = { grupo: 'Solo agrupar', unir: 'Unir', restar: 'Restar', intersectar: 'Intersectar', excluir: 'Excluir (quita lo que se cruza)' };
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
    polygon: { label: 'Polígono', props: [['x', 'Centro X'], ['y', 'Centro Y'], ['d', 'Diámetro'], ['n', 'Lados'],
      ['forma', 'Forma', { poligono: 'Polígono regular', estrella: 'Estrella' }], ['profEst', 'Profundidad de las puntas %'], ['redond', 'Redondear puntas'], ROT] },
    line: { label: 'Línea', open: true, props: [['x', 'X inicio'], ['y', 'Y inicio'], ['x2', 'X final'], ['y2', 'Y final']] },
    text: { label: 'Texto', open: true, props: [['texto', 'Texto', 'text'], ['fuente', 'Tipografía', 'font'], ['x', 'X'], ['y', 'Y (base)'], ['tam', 'Tamaño'],
      ['curva', 'Forma del texto', { no: 'Recto', arriba: 'Arco hacia arriba', abajo: 'Arco hacia abajo', trazo: 'Sobre un trazo (curva, línea o figura)' }], ['radioC', 'Radio del arco'],
      ['trazo', 'Trazo donde va el texto', 'shape'], ['desde', 'Distancia desde el inicio del trazo'], ['sepTrazo', 'Separación del trazo (hacia arriba)'], ['espaciado', 'Espaciado extra entre letras'], ROT] },
    panel: {
      label: 'Panel con dedos',
      props: [['x', 'X'], ['y', 'Y'], ['w', 'Ancho'], ['h', 'Alto'], ['t', 'Grosor material'],
        ['dedoModo', 'Dedos', { ancho: 'Por ancho de dedo', cantidad: 'Por cantidad' }], ['dedo', 'Ancho de dedo'],
        ['nH', 'Dedos arriba y abajo'], ['nV', 'Dedos a los lados'],
        ['kerf', 'Kerf (corte)'], ['top', 'Borde superior', 'edge'], ['right', 'Borde derecho', 'edge'],
        ['bottom', 'Borde inferior', 'edge'], ['left', 'Borde izquierdo', 'edge'], ROT],
    },
    hinge: {
      label: 'Bisagra viva', open: true,
      props: [['x', 'X'], ['y', 'Y'], ['w', 'Ancho'], ['h', 'Alto'], ['largo', 'Largo de corte'], ['puente', 'Puente'], ['paso', 'Separación líneas'], ROT],
    },
    box: {
      label: 'Caja', noOffset: true,
      props: [['pared', 'Uso', { no: 'Caja normal', si: 'Bandeja de pared (TypeTray)' }], ['colgar', 'Agujeros para colgar', { si: 'Con agujeros', no: 'Sin agujeros' }],
        ['uniones', 'Uniones', JOINT_OPTS], ['dedoModo', 'Dedos', { ancho: 'Por ancho de dedo', cantidad: 'Por cantidad' }],
        ['nAncho', 'Dedos a lo ancho'], ['nProf', 'Dedos a lo profundo'], ['nAlto', 'Dedos a lo alto'], ['cajon', 'Cajón', DRAWER_OPTS], ['nCaj', 'Cantidad de cajones'], ['holguraC', 'Holgura cajón'], ['tapa', 'Tapa', LID_OPTS],
        ['cubierta', 'Cubierta de otra madera', { no: 'Sin cubierta', si: 'Con cubierta (paneles lisos, sin dedos)' }], ['grosorCub', 'Grosor de la cubierta'], ['cubiertaCaras', 'Caras con cubierta', { todas: 'Todas las caras', paredes: 'Solo las paredes (sin tapa)', frente: 'Solo el frente' }], ['cubiertaLargas', 'Cubiertas más largas', { lados: 'Los lados (izquierdo y derecho)', frente: 'Frente y atrás' }],
        ['borde', 'Borde sobre la tapa'], ['holgura', 'Holgura ranura'], ['agarre', 'Agarre', GRIP_OPTS], ['medidas', 'Medidas', DIM_OPTS],
        ['x', 'X'], ['y', 'Y'], ['ancho', 'Ancho'], ['profundo', 'Profundo'], ['alto', 'Alto'], ['t', 'Grosor material'],
        ['dedo', 'Ancho de dedo'], ['kerf', 'Kerf (corte)'], ['sep', 'Separación piezas'], ROT,
        ['divX', 'Compartimentos a lo ancho'], ['divZ', 'Compartimentos a lo profundo'], ['divH', 'Altura divisiones'],
        ['grabadoEn', 'Grabar en', ENGRAVE_OPTS], ['grabadoTexto', 'Texto', 'text'], ['grabadoFuente', 'Tipografía', 'font'], ['grabadoTam', 'Tamaño del texto'], ['logoTam', 'Ancho del logo']],
    },
    taper: {
      label: 'Caja cónica', noOffset: true,
      props: [['ancho', 'Ancho abajo'], ['prof', 'Largo abajo'], ['anchoArr', 'Ancho arriba'], ['largoArr', 'Largo arriba'], ['alto', 'Alto'],
        ['t', 'Grosor material'],
        ['uniones', 'Uniones', { planas: 'Para pegar (sin dedos)', esquinas: 'Dedos solo en las esquinas', dedos: 'Dedos en esquinas y base', custom: 'Elegir por esquina' }],
        ['cFI', 'Esquina Frente / Lado izq.', { si: 'Con dedos', no: 'Pegada' }], ['cFD', 'Esquina Frente / Lado der.', { si: 'Con dedos', no: 'Pegada' }],
        ['cAI', 'Esquina Atrás / Lado izq.', { si: 'Con dedos', no: 'Pegada' }], ['cAD', 'Esquina Atrás / Lado der.', { si: 'Con dedos', no: 'Pegada' }],
        ['baseDedos', 'Base', { si: 'Con pestañas', no: 'Pegada' }],
        ['dedoModo', 'Dedos', { ancho: 'Por ancho de dedo', cantidad: 'Por cantidad' }], ['dedo', 'Ancho de dedo'],
        ['nEsq', 'Dedos por esquina'], ['nBaseT', 'Pestañas de la base por lado'],
        ['nAnillos', 'Anillos de refuerzo'], ['bandaAnillo', 'Ancho del anillo'],
        ['tapa', 'Tapa', { no: 'Sin tapa', si: 'Con tapa' }],
        ['cubierta', 'Cubierta de otra madera', { no: 'Sin cubierta', si: 'Con cubierta (paneles lisos, sin dedos)' }], ['grosorCub', 'Grosor de la cubierta'], ['margenCub', 'Sobrante extra por lado (0 = al ras)'], ['cubiertaCaras', 'Caras con cubierta', { todas: 'Todas las caras', paredes: 'Solo las paredes (sin tapa)', frente: 'Solo el frente' }], ['cubiertaLargas', 'Cubiertas más largas', { lados: 'Los lados (izquierdo y derecho)', frente: 'Frente y atrás' }],
        ['kerf', 'Kerf (corte)'], ['sep', 'Separación piezas'],
        ['x', 'X'], ['y', 'Y'], ROT],
    },
    cone: {
      label: 'Cono con bisagra viva', noOffset: true,
      props: [['d', 'Diámetro abajo'], ['dArr', 'Diámetro arriba'], ['alto', 'Alto'], ['t', 'Grosor material'],
        ['largo', 'Largo de corte'], ['puente', 'Puente'], ['paso', 'Separación líneas'],
        ['cierre', 'Cierre', { si: 'Con pestañas (peine)', no: 'Liso (para pegar)' }], ['baseDisco', 'Base', { si: 'Con base redonda', no: 'Sin base' }],
        ['kerf', 'Kerf (corte)'], ['sep', 'Separación piezas'], ['x', 'X'], ['y', 'Y'], ROT],
    },
    basket: {
      label: 'Canasta', noOffset: true,
      props: [['ancho', 'Ancho'], ['alto', 'Alto'], ['profundo', 'Largo'], ['t', 'Grosor material'], ['radio', 'Radio del fondo'],
        ['nTab', 'Cantidad de tablillas'], ['sepTab', 'Separación tablillas'],
        ['asa', 'Asa', { si: 'Con asa en arco', no: 'Sin asa' }], ['asaAlto', 'Alto del asa'], ['asaArco', 'Curva del asa'], ['asaAncho', 'Ancho del asa'],
        ['asaTexto', 'Texto en el asa', 'text'], ['asaFuente', 'Tipografía del asa', 'font'],
        ['frente', 'Marco decorativo', { si: 'Con marco al frente', no: 'Sin marco' }], ['marco', 'Ancho del marco'],
        ['kerf', 'Kerf (corte)'], ['sep', 'Separación piezas'], ['x', 'X'], ['y', 'Y'], ROT],
    },
    planter: {
      label: 'Maceta / arreglo floral (living hinge)', noOffset: true,
      props: [['forma', 'Forma', { redonda: 'Redonda (cilindro)', media: 'Media redonda (pared recta atrás)' }], ['d', 'Diámetro'], ['alto', 'Alto'], ['t', 'Grosor material'],
        ['cierre', 'Cierre', { rompecabezas: 'Rompecabezas (cabeza redonda)', dedos: 'Dedos (finger joint)' }],
        ['dedo', 'Ancho de pestaña'], ['nTab', 'Pestañas de la base'], ['refuerzo', 'Refuerzo de base', { si: 'Con refuerzo (disco extra)', no: 'Sin refuerzo' }], ['nAros', 'Aros de refuerzo (0 a 3)'],
        ['largo', 'Largo de corte de la bisagra'], ['puente', 'Puente'], ['paso', 'Separación líneas'],
        ['kerf', 'Kerf (corte)'], ['sep', 'Separación piezas'], ['x', 'X'], ['y', 'Y'], ROT],
    },
    import: {
      label: 'Archivo importado',
      props: [['x', 'X'], ['y', 'Y'], ['w', 'Ancho'], ['h', 'Alto'], ['prop', 'Proporción', { si: 'Mantener proporción', no: 'Ancho y alto libres' }], ['redond', 'Redondear esquinas'], ROT],
    },
    group: { label: 'Grupo', props: [['mode', 'Tipo de grupo', 'mode'], ['x', 'Mover X'], ['y', 'Mover Y'], ['redond', 'Redondear esquinas'], ROT] },
  };
  // Propiedades comunes (contorno y repetición)
  const REP_FIELDS = {
    fila: [['repN', 'Cantidad'], ['repDx', 'Paso X'], ['repDy', 'Paso Y']],
    cuadricula: [['repN', 'Columnas'], ['repM', 'Filas'], ['repDx', 'Paso X'], ['repDy', 'Paso Y']],
    circular: [['repN', 'Cantidad'], ['repCx', 'Centro X'], ['repCy', 'Centro Y'], ['repA', 'Ángulo total °']],
  };
  const NON_EXPR = new Set(['texto', 'top', 'right', 'bottom', 'left', 'mode', 'rep', 'uniones', 'tapa', 'medidas', 'agarre', 'cajon', 'grabadoEn', 'grabadoTexto', 'grabadoLogo', 'prop', 'asset', 'dedoModo', 'asa', 'asaTexto', 'frente', 'fuente', 'grabadoFuente', 'asaFuente', 'pared', 'colgar', 'cierre', 'baseDisco', 'forma', 'cFI', 'cFD', 'cAI', 'cAD', 'baseDedos', 'cubierta', 'cubiertaCaras', 'cubiertaLargas', 'refuerzo', 'curva', 'trazo']);
  const NON_LENGTH = new Set(['n', 'profEst', 'nEsq', 'nBaseT', 'nAnillos', 'rot', 'repN', 'repM', 'repA', 'divX', 'divZ', 'nCaj', 'nAncho', 'nProf', 'nAlto', 'nTab', 'nH', 'nV', 'nAros', 'puentes']);
  const isLengthKey = k => !NON_EXPR.has(k) && !NON_LENGTH.has(k);
  const canOffset = s => !TYPES[s.type].open && !TYPES[s.type].noOffset;
  // Nombre sugerido al convertir una propiedad en parámetro
  const PROMOTE_NAMES = {
    w: 'ancho', h: 'alto', d: 'diametro', r: 'radio', n: 'lados', t: 'grosor', dedo: 'dedo', kerf: 'kerf', tam: 'tam_texto',
    rot: 'giro', x: 'pos_x', y: 'pos_y', x2: 'fin_x', y2: 'fin_y', largo: 'largo_corte', puente: 'puente', paso: 'paso_bisagra',
    ancho: 'ancho', profundo: 'profundo', alto: 'alto', sep: 'sep', borde: 'borde_tapa', holgura: 'holgura', holguraC: 'holgura_cajon', nCaj: 'cajones', nTab: 'tablillas', sepTab: 'sep_tablillas', radio: 'radio_fondo', asaAlto: 'alto_asa', asaArco: 'curva_asa', asaAncho: 'ancho_asa', marco: 'marco', nAncho: 'dedos_ancho', nH: 'dedos_horizontal', nV: 'dedos_vertical', nProf: 'dedos_profundo', nAlto: 'dedos_alto', grabadoTam: 'tam_grabado', logoTam: 'ancho_logo', divX: 'comp_ancho', divZ: 'comp_profundo', divH: 'alto_div',
    nEsq: 'dedos_esquina', nBaseT: 'pestanas_base', nAnillos: 'anillos', bandaAnillo: 'ancho_anillo',
    redond: 'redondeo', profEst: 'profundidad_puntas', prof: 'largo_abajo', anchoArr: 'ancho_arriba', largoArr: 'largo_arriba', dArr: 'diam_arriba',
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
  const newDoc = (units = 'mm') => ({ app: 'creaciones-evergreen', version: 2, name: 'Mi diseño', units, params: [], shapes: [], assets: {}, measures: [], sheet: { w: BEDS[0].w, h: BEDS[0].h }, grid: units === 'in' ? 0.125 : 1 });

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
  // counts (opcional): número de segmentos por borde [arriba, derecha, abajo, izquierda] cuando se elige "por cantidad"
  function panelPoints(W, H, t, fw, modes, kerf, counts) {
    const L = [W, H, W, H];
    const edges = L.map((ln, k) => {
      let n = counts && counts[k] ? counts[k] : fw > 0 ? Math.floor(ln / fw) : 1;
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
  // Dedos "por cantidad": N dedos en un borde = 2N − 1 segmentos (dedo, hueco, dedo…), igual en las dos piezas de la unión
  const FINGER_KEYS = { W: 'nAncho', D: 'nProf', H: 'nAlto' };
  function fingerSegs(s, du, dv) {
    if (s.p.dedoModo !== 'cantidad') return null;
    const seg = d => 2 * Math.max(1, Math.min(200, Math.round(num(s, FINGER_KEYS[d], 3)) || 1)) - 1;
    return [seg(du), seg(dv), seg(du), seg(dv)];
  }

  // Devuelve las piezas de la caja (en mm, cada una con su origen arriba a la izquierda) y cómo se arman en 3D.
  function boxModel(s, forView = false) {
    const t = len(s, 't', 3), fw = len(s, 'dedo', 10), sep = len(s, 'sep', 5);
    const kerf = forView ? 0 : len(s, 'kerf', 0), k = kerf / 2;
    let W = len(s, 'ancho', 100), D = len(s, 'profundo', 80), H = len(s, 'alto', 60);
    const wall = s.p.pared === 'si'; // bandeja de pared: abierta al frente, sin tapa ni cajón
    const lidMode = wall ? 'no' : (s.p.tapa || 'si'), lid = lidMode === 'si', slide = lidMode === 'deslizante';
    const fingers = (s.p.uniones || 'dedos') === 'dedos';
    if (s.p.cajon === 'si' && !wall) return drawerModel(s, { t, fw, sep, kerf, W, D, H, fingers });
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
      add('Frente', W, Hf, 'front', panelPoints(W, Hf, t, fw, [T, 'dedos', 'ranuras', 'dedos'], kerf, fingerSegs(s, 'W', 'H')));
      add('Atrás', W, H, 'back', panelPoints(W, H, t, fw, [T, 'dedos', 'ranuras', 'dedos'], kerf, fingerSegs(s, 'W', 'H')));
      const side = slide ? slideSidePoints(D, H, t, fw, Hf, mTop, slotH, D - 2 * t, kerf, fingerSegs(s, 'D', 'H')) : panelPoints(D, H, t, fw, [T, 'ranuras', 'ranuras', 'ranuras'], kerf, fingerSegs(s, 'D', 'H'));
      add('Lado izquierdo', D, H, 'left', side);
      add('Lado derecho', D, H, 'right', side);
      add('Base', W, D, 'bottom', panelPoints(W, D, t, fw, ['dedos', 'dedos', 'dedos', 'dedos'], kerf, fingerSegs(s, 'W', 'D')));
      if (lid) add('Tapa', W, D, 'top', panelPoints(W, D, t, fw, ['dedos', 'dedos', 'dedos', 'dedos'], kerf, fingerSegs(s, 'W', 'D')));
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
    if (wall && s.p.colgar !== 'no') hangingHoles(s, panels.find(q => q.place === 'bottom'), { W, D, t, k });
    // Cubierta de otra madera: paneles lisos pegados por fuera (sin dedos); cada uno es una pieza más del plano de corte
    if (s.p.cubierta === 'si') {
      const c = s.p.grosorCub && String(s.p.grosorCub).trim() ? len(s, 'grosorCub') : t;
      if (!(c > 0) || !Number.isFinite(c)) return null;
      const caras = s.p.cubiertaCaras || 'todas', covers = [];
      const addC = (name, w, h, place, eu, ev, ew, o, out) => covers.push({ name, w, h, place, holes: [], pts: rect(w, h), th: c, color: 0xa9743f, axes: { eu, ev, ew, o, out } });
      // Dos de las cubiertas son más largas (suman el grosor de la chapa en cada punta) para cerrar las esquinas al ras:
      // los lados por defecto, o frente y atrás si se elige.
      const fL = s.p.cubiertaLargas === 'frente', ex = fL ? c : 0, sx = fL ? 0 : c;
      addC('Cubierta Frente', W + 2 * ex, H, 'front', [1, 0, 0], [0, -1, 0], [0, 0, 1], [-ex, H, -c], [0, 0, -1]);
      if (caras !== 'frente') {
        addC('Cubierta Atrás', W + 2 * ex, H, 'back', [-1, 0, 0], [0, -1, 0], [0, 0, -1], [W + ex, H, D + c], [0, 0, 1]);
        addC('Cubierta Lado izquierdo', D + 2 * sx, H, 'left', [0, 0, 1], [0, -1, 0], [1, 0, 0], [-c, H, -sx], [-1, 0, 0]);
        addC('Cubierta Lado derecho', D + 2 * sx, H, 'right', [0, 0, -1], [0, -1, 0], [-1, 0, 0], [W + c, H, D + sx], [1, 0, 0]);
        if (caras === 'todas') addC('Cubierta Base', W + 2 * c, D + 2 * c, 'bottom', [1, 0, 0], [0, 0, 1], [0, 1, 0], [-c, -c, -c], [0, -1, 0]);
        if (caras === 'todas' && lid) addC('Cubierta Tapa', W + 2 * c, D + 2 * c, 'top', [1, 0, 0], [0, 0, 1], [0, -1, 0], [-c, H + c, -c], [0, 1, 0]);
      }
      panels.push(...covers);
      for (let i = 0; i < covers.length; i += 3) layout.push(covers.slice(i, i + 3));
    }
    return { W, D, H, t, fingers, lid, slide, sep, panels, dividers: divs, layout, wall };
  }

  // Bandeja de pared: dos agujeros para tornillos cerca del borde de arriba (en las celdas de las esquinas)
  function hangingHoles(s, base, { W, D, t, k }) {
    if (!base) return;
    const nx = Math.max(1, Math.min(20, Math.round(num(s, 'divX', 1)) || 1)), nz = Math.max(1, Math.min(20, Math.round(num(s, 'divZ', 1)) || 1));
    const cx = (W - 2 * t - (nx - 1) * t) / nx, cz = (D - 2 * t - (nz - 1) * t) / nz, r = 3.5;
    if (cx < 2 * r + 6 || cz < 24) return; // las celdas son muy chicas para los agujeros
    const v = D - t - 10; // la pared "Atrás" es el borde de arriba de la bandeja
    const xs = nx === 1 ? [W * 0.25, W * 0.75] : [t + cx / 2, t + (nx - 1) * (cx + t) + cx / 2];
    for (const x of xs) base.holes.push(Array.from({ length: 24 }, (_, i) => [x + (r - k) * Math.cos(i * Math.PI / 12), v + (r - k) * Math.sin(i * Math.PI / 12)]));
  }

  window.__evergreen = { model: id => modelOf(byId(id), true) }; // para pruebas
  const modelOf = (s, forView) => !s ? null
    : s.type === 'basket' ? basketModel(s, forView)
    : s.type === 'taper' ? taperModel(s, forView)
    : s.type === 'cone' ? coneModel(s, forView)
    : s.type === 'planter' ? planterModel(s, forView)
    : boxModel(s, forView);
  // Engrosa o adelgaza un contorno cerrado (mm); devuelve los puntos
  const growPoly = (pts, d) => d ? ((offsetPolys([{ closed: true, pts }], d)[0] || { pts }).pts) : pts;

  /* ----- Caja cónica: paredes inclinadas (más ancha arriba o abajo) ----- */
  // Se arma pegando: las cuatro paredes trapezoidales se apoyan sobre la base. Coordenadas 3D: X ancho, Y alto, Z largo.
  function taperModel(s, forView = false) {
    const t = len(s, 't', 3), sep = len(s, 'sep', 5), kerf = forView ? 0 : len(s, 'kerf', 0), k = kerf / 2;
    const Wb = len(s, 'ancho', 100), Db = len(s, 'prof', 80), Wt = len(s, 'anchoArr', 140), Dt = len(s, 'largoArr', 120), H = len(s, 'alto', 80);
    const lid = s.p.tapa === 'si';
    const joint = CL ? (s.p.uniones || 'planas') : 'planas';
    // Dedos por esquina: Frente/Atrás con Lado izquierdo/derecho (como se llaman las piezas), y la base aparte
    const on = k => s.p[k] !== 'no';
    const cFI = joint === 'custom' ? on('cFI') : joint !== 'planas', cFD = joint === 'custom' ? on('cFD') : joint !== 'planas';
    const cAI = joint === 'custom' ? on('cAI') : joint !== 'planas', cAD = joint === 'custom' ? on('cAD') : joint !== 'planas';
    const cornerF = cFI || cFD || cAI || cAD, baseF = joint === 'custom' ? on('baseDedos') : joint === 'dedos';
    if (![t, sep, kerf, Wb, Db, Wt, Dt, H].every(Number.isFinite) || t <= 0 || Wb <= 4 * t || Db <= 4 * t || Wt <= 4 * t || Dt <= 4 * t || H <= 2 * t) return null;
    const dW = (Wt - Wb) / 2, dD = (Dt - Db) / 2;
    const Lf = Math.hypot(H, dD), Ls = Math.hypot(H, dW); // largo inclinado de frente/atrás y de los lados
    const E = Math.hypot(H, dW, dD);                        // largo de cada esquina inclinada
    const alW = Math.atan(dW / H), alD = Math.atan(dD / H); // inclinación (+ = se abre hacia arriba)
    const tW = Math.tan(alW), tD = Math.tan(alD);
    const hW = t / Math.cos(alW), hD = t / Math.cos(alD);   // grosor horizontal de las paredes laterales / de frente y atrás
    if (Dt - 2 * hD <= t || Db - 2 * hD <= t) return null;   // los lados se acortan en las esquinas pegadas
    const ox = Math.max(0, dW), oz = Math.max(0, dD);
    const yb = baseF ? 0 : t, yT = yb + H;                 // altura donde empiezan y terminan las paredes
    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v) || 0));
    const odd = n => { n = Math.max(1, n); return n % 2 === 0 ? n - 1 : n; };

    // ----- Dedos de las esquinas (a lo largo de la esquina inclinada) y de la base -----
    const byCount = s.p.dedoModo === 'cantidad', fw = Math.max(1, len(s, 'dedo', 10));
    let nSeg = byCount ? 2 * clampInt(num(s, 'nEsq', 3), 1, 60) - 1 : odd(Math.floor(E / fw));
    while (nSeg > 1 && E / nSeg < 1.5 * t) nSeg -= 2;
    const cosD = (dW * dD) / (Lf * Ls), recess = t / Math.sqrt(Math.max(0.05, 1 - cosD * cosD)); // profundidad del hueco (ángulo entre paredes)
    const baseSegs = L => { let n = byCount ? 2 * clampInt(num(s, 'nBaseT', 2), 0, 40) + 1 : odd(Math.floor(L / fw)); while (n > 1 && L / n < 1.5 * t) n -= 2; return n; };
    const nbW = baseF ? baseSegs(Wb) : 1, nbD = baseF ? baseSegs(Db) : 1;
    // Rango (a lo largo de la pared, medido desde su esquina de abajo) que ocupa un listón horizontal de grosor t a la altura yr
    const slotAB = (al, yr) => [(yr - t * Math.max(0, Math.sin(al))) / Math.cos(al), (yr + t + t * Math.max(0, -Math.sin(al))) / Math.cos(al)];

    // ----- Anillos de refuerzo: marcos horizontales con pestañas que cruzan las paredes por ranuras -----
    const nR = clampInt(num(s, 'nAnillos', 0), 0, 3);
    const rings = [];
    for (let j = 0; j < nR; j++) {
      const yr = H * (j + 1) / (nR + 1) - t / 2, ym = yr + t / 2;
      const xL = -ym * tW, xR = Wb + ym * tW, zF = -ym * tD, zB = Db + ym * tD;
      const tabWf = Math.max(8, Math.min(40, (xR - xL) * 0.4)), tabWs = Math.max(8, Math.min(40, (zB - zF) * 0.4));
      rings.push({ yr, xL, xR, zF, zB, tabWf, tabWs });
    }

    const polysOf = ps => fromC(ps);
    const union = list => polysOf(clip(CL.ClipType.ctUnion, toC(list.map(pts => ({ closed: true, pts })))));
    const bigger = list => list.reduce((a, b) => polyArea(b.pts) > polyArea(a.pts) ? b : a, list[0]);

    // Pared trapezoidal con dedos en las dos esquinas, pestañas/muescas de la base y ranuras para los anillos.
    // pat: 'A' (frente/atrás: dedos en los segmentos pares) o 'B' (lados: muescas en los pares).
    // fingL / fingR: la esquina de ese lado lleva dedos. Las paredes laterales (pat 'B') se acortan donde la esquina va pegada.
    const wall = (wTop, wBot, hh, pat, al, nBot, tabW, fingL, fingR) => {
      const off = (wTop - wBot) / 2;
      const shL = pat === 'B' && !fingL ? hD : 0, shR = pat === 'B' && !fingR ? hD : 0;
      const TL = [shL, 0], TR = [wTop - shR, 0], BR = [wTop - off - shR, hh], BL = [off + shL, hh];
      const cuts = [];
      if (fingL || fingR) {
        for (const [P0, P1, left] of [[TL, BL, true], [TR, BR, false]]) {
          if (left ? !fingL : !fingR) continue;
          const dx = P1[0] - P0[0], dy = P1[1] - P0[1], Lh = Math.hypot(dx, dy), e = [dx / Lh, dy / Lh];
          const inn = left ? [e[1], -e[0]] : [-e[1], e[0]]; // hacia adentro de la pared
          const seg = Lh / nSeg;
          for (let i = 0; i < nSeg; i++) {
            if ((pat === 'A') !== (i % 2 === 1)) continue; // A: se hunden los impares; B: los pares
            const u0 = i === 0 ? -3 : i * seg, u1 = i === nSeg - 1 ? Lh + 3 : (i + 1) * seg;
            const A = [P0[0] + e[0] * u0, P0[1] + e[1] * u0], B = [P0[0] + e[0] * u1, P0[1] + e[1] * u1];
            cuts.push([[A[0] - inn[0] * 2, A[1] - inn[1] * 2], [B[0] - inn[0] * 2, B[1] - inn[1] * 2],
              [B[0] + inn[0] * recess, B[1] + inn[1] * recess], [A[0] + inn[0] * recess, A[1] + inn[1] * recess]]);
          }
        }
      }
      if (baseF && nBot > 2) { // muescas en el borde de abajo donde entran las pestañas de la base
        const hn = slotAB(al, 0)[1] + 0.1, sb = wBot / nBot;
        for (let i = 1; i < nBot; i += 2) cuts.push([[off + i * sb, hh - hn], [off + (i + 1) * sb, hh - hn], [off + (i + 1) * sb, hh + 2], [off + i * sb, hh + 2]]);
      }
      let pts = [TL, TR, BR, BL];
      if (cuts.length) {
        const res = fromC(clip(CL.ClipType.ctDifference, toC([{ closed: true, pts }]), toC(cuts.map(c => ({ closed: true, pts: c })))));
        if (res.length) pts = bigger(res).pts;
      }
      const holes = [];
      for (const rg of rings) { // ranuras para las pestañas de los anillos (centradas en la pared)
        const [alo, ahi] = slotAB(al, rg.yr), uc = wTop / 2, hw = tabW(rg) / 2 + 0.1;
        holes.push([[uc - hw, hh - ahi - 0.1], [uc + hw, hh - ahi - 0.1], [uc + hw, hh - alo + 0.1], [uc - hw, hh - alo + 0.1]]);
      }
      return { pts, holes, off };
    };
    // Pone un polígono (y sus agujeros) con su esquina en (0, 0), ajusta kerf y calcula dónde queda en 3D
    const place = (name, shape, eu, ev, ew, O, out) => {
      const outline = growPoly(shape.pts, k), holes = (shape.holes || []).map(hl => growPoly(hl, -k));
      const b = polyBox(outline), mx = b[0], my = b[1];
      const sh = ([x, y]) => [x - mx, y - my];
      return { name, w: b[2] - b[0], h: b[3] - b[1], pts: outline.map(sh), holes: holes.map(hl => hl.map(sh)),
        axes: { eu, ev, ew, o: [O[0] + mx * eu[0] + my * ev[0], O[1] + mx * eu[1] + my * ev[1], O[2] + mx * eu[2] + my * ev[2]], out } };
    };
    // Cada pared usa sus dos esquinas (en el plano de cada pieza, "izquierda" es donde empieza su eje)
    const Ff = wall(Wt, Wb, Lf, 'A', alD, nbW, rg => rg.tabWf, cFI, cFD);   // frente: izq = Lado izquierdo, der = Lado derecho
    const Fb = wall(Wt, Wb, Lf, 'A', alD, nbW, rg => rg.tabWf, cAD, cAI);   // atrás (está invertida): izq = Lado derecho
    const Sl = wall(Dt, Db, Ls, 'B', alW, nbD, rg => rg.tabWs, cFI, cAI);   // lado izquierdo: izq = Frente, der = Atrás
    const Sr = wall(Dt, Db, Ls, 'B', alW, nbD, rg => rg.tabWs, cAD, cFD);   // lado derecho: izq = Atrás, der = Frente
    const panels = [
      place('Frente', Ff, [1, 0, 0], [0, -H / Lf, dD / Lf], [0, dD / Lf, H / Lf], [ox - dW, yT, oz - dD], [0, 0, -1]),
      place('Atrás', Fb, [-1, 0, 0], [0, -H / Lf, -dD / Lf], [0, dD / Lf, -H / Lf], [ox + Wb + dW, yT, oz + Db + dD], [0, 0, 1]),
      place('Lado izquierdo', Sl, [0, 0, 1], [dW / Ls, -H / Ls, 0], [H / Ls, dW / Ls, 0], [ox - dW, yT, oz - dD], [-1, 0, 0]),
      place('Lado derecho', Sr, [0, 0, -1], [-dW / Ls, -H / Ls, 0], [-H / Ls, dW / Ls, 0], [ox + Wb + dW, yT, oz + Db + dD], [1, 0, 0]),
    ];

    // Base: lisa, o con pestañas que entran en las muescas de las cuatro paredes
    const flat = [0, 0, 1], up = [0, 1, 0], xAxis = [1, 0, 0];
    if (baseF) {
      const tipL = -(t / 2) * tW, tipR = Wb + (t / 2) * tW, tipF = -(t / 2) * tD, tipB = Db + (t / 2) * tD;
      const body = [[tipL + hW, tipF + hD], [tipR - hW, tipF + hD], [tipR - hW, tipB - hD], [tipL + hW, tipB - hD]];
      const parts = [body];
      const sw = Wb / nbW, sd = Db / nbD;
      for (let i = 1; i < nbW; i += 2) {
        parts.push([[i * sw, tipF], [(i + 1) * sw, tipF], [(i + 1) * sw, tipF + hD + 0.5], [i * sw, tipF + hD + 0.5]]);
        parts.push([[i * sw, tipB - hD - 0.5], [(i + 1) * sw, tipB - hD - 0.5], [(i + 1) * sw, tipB], [i * sw, tipB]]);
      }
      for (let i = 1; i < nbD; i += 2) {
        parts.push([[tipL, i * sd], [tipL + hW + 0.5, i * sd], [tipL + hW + 0.5, (i + 1) * sd], [tipL, (i + 1) * sd]]);
        parts.push([[tipR - hW - 0.5, i * sd], [tipR, i * sd], [tipR, (i + 1) * sd], [tipR - hW - 0.5, (i + 1) * sd]]);
      }
      panels.push(place('Base', { pts: bigger(union(parts)).pts }, xAxis, flat, up, [ox, 0, oz], [0, -1, 0]));
    } else {
      panels.push(place('Base', { pts: [[0, 0], [Wb, 0], [Wb, Db], [0, Db]] }, xAxis, flat, up, [ox, 0, oz], [0, -1, 0]));
    }
    // Cubierta decorativa: paneles lisos de otra madera que se pegan por fuera de cada pared (sin dedos)
    if (s.p.cubierta === 'si') {
      const c = s.p.grosorCub && String(s.p.grosorCub).trim() ? len(s, 'grosorCub') : t;
      if (!(c > 0) || !Number.isFinite(c)) return null;
      // Frente y atrás cubren el ancho exacto; los lados son más largos (grosor de la cubierta en cada punta) para cerrar la esquina al ras.
      // Sobrante por lado opcional (0 por defecto): ensancha cada panel si quieres rebasar y lijar después.
      const mg = s.p.margenCub && String(s.p.margenCub).trim() ? len(s, 'margenCub') : 0;
      if (!Number.isFinite(mg) || mg < 0) return null;
      const cD = c / Math.cos(alD), trap = (wTop, wBot, hh) => { const off = (wTop - wBot) / 2; return { pts: [[0, 0], [wTop + 2 * mg, 0], [wTop + 2 * mg - off, hh], [off, hh]] }; };
      const cover = (name, shape, eu, ev, ew, O, out, du) => {
        const P = place(name, shape, eu, ev, ew, [O[0] + eu[0] * du - ew[0] * c, O[1] + eu[1] * du - ew[1] * c, O[2] + eu[2] * du - ew[2] * c], out);
        P.th = c; P.color = 0xa9743f; panels.push(P);
      };
      const longFB = s.p.cubiertaLargas === 'frente', cW0 = c / Math.cos(alW), exF = longFB ? cW0 : 0, exS = longFB ? 0 : cD;
      cover('Cubierta Frente', trap(Wt + 2 * exF, Wb + 2 * exF, Lf), [1, 0, 0], [0, -H / Lf, dD / Lf], [0, dD / Lf, H / Lf], [ox - dW, yT, oz - dD], [0, 0, -1], -exF - mg);
      if (s.p.cubiertaCaras !== 'frente') {
      cover('Cubierta Atrás', trap(Wt + 2 * exF, Wb + 2 * exF, Lf), [-1, 0, 0], [0, -H / Lf, -dD / Lf], [0, dD / Lf, -H / Lf], [ox + Wb + dW, yT, oz + Db + dD], [0, 0, 1], -exF - mg);
      cover('Cubierta Lado izquierdo', trap(Dt + 2 * exS, Db + 2 * exS, Ls), [0, 0, 1], [dW / Ls, -H / Ls, 0], [H / Ls, dW / Ls, 0], [ox - dW, yT, oz - dD], [-1, 0, 0], -exS - mg);
      cover('Cubierta Lado derecho', trap(Dt + 2 * exS, Db + 2 * exS, Ls), [0, 0, -1], [-dW / Ls, -H / Ls, 0], [-H / Ls, dW / Ls, 0], [ox + Wb + dW, yT, oz + Db + dD], [1, 0, 0], -exS - mg);
      const cW = c / Math.cos(alW), bw = Wb + 2 * cW, bd = Db + 2 * cD;
      const bc = place('Cubierta Base', { pts: [[0, 0], [bw, 0], [bw, bd], [0, bd]] }, [1, 0, 0], [0, 0, 1], [0, 1, 0], [ox - cW, -c, oz - cD], [0, -1, 0]);
      bc.th = c; bc.color = 0xa9743f; panels.push(bc);
      }
    }
    // Anillos de refuerzo
    const band = s.p.bandaAnillo && String(s.p.bandaAnillo).trim() ? len(s, 'bandaAnillo') : 14;
    rings.forEach((rg, j) => {
      const { xL, xR, zF, zB, tabWf, tabWs } = rg;
      const body = [[xL + hW, zF + hD], [xR - hW, zF + hD], [xR - hW, zB - hD], [xL + hW, zB - hD]];
      const cx = Wb / 2, cz = Db / 2;
      const parts = [body,
        [[cx - tabWf / 2, zF], [cx + tabWf / 2, zF], [cx + tabWf / 2, zF + hD + 0.5], [cx - tabWf / 2, zF + hD + 0.5]],
        [[cx - tabWf / 2, zB - hD - 0.5], [cx + tabWf / 2, zB - hD - 0.5], [cx + tabWf / 2, zB], [cx - tabWf / 2, zB]],
        [[xL, cz - tabWs / 2], [xL + hW + 0.5, cz - tabWs / 2], [xL + hW + 0.5, cz + tabWs / 2], [xL, cz + tabWs / 2]],
        [[xR - hW - 0.5, cz - tabWs / 2], [xR, cz - tabWs / 2], [xR, cz + tabWs / 2], [xR - hW - 0.5, cz + tabWs / 2]]];
      const shape = { pts: bigger(union(parts)).pts, holes: [] };
      const bx0 = body[0][0] + band, bz0 = body[0][1] + band, bx1 = body[2][0] - band, bz1 = body[2][1] - band;
      if (bx1 - bx0 > 8 && bz1 - bz0 > 8) shape.holes.push([[bx0, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1]]);
      panels.push(place(`Anillo ${j + 1}`, shape, xAxis, flat, up, [ox, yb + rg.yr, oz], [0, 1, 0]));
    });
    if (lid) panels.push(place('Tapa', { pts: [[0, 0], [Wt, 0], [Wt, Dt], [0, Dt]] }, xAxis, flat, up, [ox - dW, yT, oz - dD], [0, 1, 0]));
    return { W: Math.max(Wb, Wt), D: Math.max(Db, Dt), H: yT + (lid ? t : 0), t, fingers: cornerF, sep, panels, dividers: [], layout: [panels],
      taper: { angW: alW / DEG, angD: alD / DEG, joint, nSeg, nbW, nbD, nRings: rings.length, E, corners: [cFI, cFD, cAI, cAD].filter(Boolean).length, baseF } };
  }

  /* ----- Cono con bisagra viva: una pared que se enrolla (abanico) y una base redonda ----- */
  function coneModel(s, forView = false) {
    const t = len(s, 't', 3), sep = len(s, 'sep', 5), kerf = forView ? 0 : len(s, 'kerf', 0), k = kerf / 2;
    const Db = len(s, 'd', 60), Dt = len(s, 'dArr', 100), H = len(s, 'alto', 110);
    const given = key => s.p[key] && String(s.p[key]).trim();
    const Lc = given('largo') ? len(s, 'largo') : 20, br = given('puente') ? len(s, 'puente') : 3, pa = given('paso') ? len(s, 'paso') : 2;
    if (![t, sep, kerf, Db, Dt, H, Lc, br, pa].every(Number.isFinite) || t <= 0 || H <= 2 * t || Db < 10 || Dt < 10 || Math.abs(Db - Dt) < 2 || Lc < 2 || br < 0.5 || pa < 0.8) return null;
    const Rb = Db / 2, Rt = Dt / 2, Rmax = Math.max(Rb, Rt), Rmin = Math.min(Rb, Rt);
    const sl = Math.hypot(H, Rmax - Rmin);            // largo de la pared sobre la inclinación
    const Aout = sl * Rmax / (Rmax - Rmin), Ain = Aout - sl; // radios del abanico desplegado
    const theta = 2 * Math.PI * Rmax / Aout;                 // ángulo del abanico
    if (!(theta > 0.05 && theta < 2 * Math.PI - 0.05)) return null;
    const th = t * sl / H; // grosor horizontal de la pared
    const comb = (s.p.cierre || 'si') === 'si';
    const nT = comb ? Math.max(2, Math.floor(sl / 30)) : 0, tw = comb ? Math.min(12, sl / nT * 0.5) : 0, pl = 8;
    const P = (r, a) => [r * Math.sin(a), r * Math.cos(a)];
    const a0 = -theta / 2, a1 = theta / 2;
    const arcAng = (r, from, to) => { const n = Math.max(2, segs(r, Math.abs(to - from))); return Array.from({ length: n + 1 }, (_, i) => from + (to - from) * i / n); };
    const dirIn = a => [-Math.cos(a), Math.sin(a)]; // hacia donde disminuye el ángulo (sentido del peine)
    const off = (pt, d, l) => [pt[0] + d[0] * l, pt[1] + d[1] * l];
    const cs = Array.from({ length: nT }, (_, j) => Ain + sl * (j + 0.5) / nT); // centros de las pestañas (radios)
    const outline = [];
    for (const a of arcAng(Aout, a0, a1)) outline.push(P(Aout, a));
    // borde derecho (de afuera hacia adentro) con las muescas del peine
    for (let j = nT - 1; j >= 0; j--) {
      const rh = P(cs[j] + tw / 2, a1), rl = P(cs[j] - tw / 2, a1), d = dirIn(a1);
      outline.push(rh, off(rh, d, pl), off(rl, d, pl), rl);
    }
    if (Ain > 0.5) for (const a of arcAng(Ain, a1, a0)) outline.push(P(Ain, a)); else outline.push([0, 0]);
    // borde izquierdo (de adentro hacia afuera) con las pestañas del peine
    for (let j = 0; j < nT; j++) {
      const rl = P(cs[j] - tw / 2, a0), rh = P(cs[j] + tw / 2, a0), d = dirIn(a0);
      outline.push(rl, off(rl, d, pl), off(rh, d, pl), rh);
    }
    // Líneas de la bisagra: rayos desde el centro del abanico, en tramos alternados
    const lines = [];
    const m0 = 4, rMin = Ain + m0, Lr = sl - 2 * m0, edgeM = (comb ? pl : 0) + 6;
    const rMid = (Ain + Aout) / 2, cnt = Math.max(1, Math.floor(theta / (pa / rMid))), da = theta / cnt;
    if (cnt * (Lr / (Lc + br) + 1) > 12000) return null; // demasiadas líneas: sube la separación
    for (let i = 0; i < cnt; i++) {
      const a = a0 + (i + 0.5) * da, ph = (i % 2) * (Lc + br) / 2;
      for (let p0 = -ph; p0 < Lr; p0 += Lc + br) {
        const st = Math.max(0, p0), en = Math.min(Lr, p0 + Lc);
        if (en - st < 1) continue;
        const r1 = rMin + st, r2 = rMin + en;
        if (Math.min(a - a0, a1 - a) * r1 < edgeM) continue; // deja macizo cerca del cierre
        lines.push([P(r1, a), P(r2, a)]);
      }
    }
    const outG = growPoly(outline, k);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of outG) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const sh = ([x, y]) => [x - x0, y - y0];
    const panels = [{ name: 'Pared del cono', w: x1 - x0, h: y1 - y0, pts: outG.map(sh), holes: [], lines: lines.map(l => l.map(sh)) }];
    const Rbase = Math.max(3, Rb - th);
    if ((s.p.baseDisco || 'si') !== 'no') {
      const n = Math.max(24, segs(Rbase, 2 * Math.PI));
      const disc = growPoly(Array.from({ length: n }, (_, i) => [Rbase + Rbase * Math.cos(i * 2 * Math.PI / n), Rbase + Rbase * Math.sin(i * 2 * Math.PI / n)]), k);
      panels.push({ name: 'Base', w: 2 * Rbase, h: 2 * Rbase, pts: disc, holes: [] });
    }
    return { W: 2 * Rmax, D: 2 * Rmax, H: H + t, t, fingers: false, sep, panels, dividers: [], layout: [panels],
      cone: { Rb, Rt, H, t, th, theta, sl, Aout, Ain, Rbase, base: panels.length > 1 } };
  }

  /* ----- Maceta / arreglo floral: pared flexible (living hinge) redonda o media redonda ----- */
  // Una sola tira se curva alrededor de la base; se cierra con rompecabezas o dedos y la base entra por muescas, así que no se desarma.
  function planterModel(s, forView = false) {
    const t = len(s, 't', 3), sep = len(s, 'sep', 5), kerf = forView ? 0 : len(s, 'kerf', 0), k = kerf / 2;
    const Dm = len(s, 'd', 100), H = len(s, 'alto', 100), fw = len(s, 'dedo', 10);
    const given = key => s.p[key] && String(s.p[key]).trim();
    const Lc = given('largo') ? len(s, 'largo') : 20, br = given('puente') ? len(s, 'puente') : 3, pa = given('paso') ? len(s, 'paso') : 2;
    const half = s.p.forma === 'media', puzzle = (s.p.cierre || 'rompecabezas') === 'rompecabezas';
    const nTab = Math.max(3, Math.min(60, Math.round(num(s, 'nTab', 8)) || 8)), nA = Math.max(0, Math.min(3, Math.round(num(s, 'nAros', 1)) || 0));
    if (![t, sep, kerf, Dm, H, fw, Lc, br, pa].every(Number.isFinite) || t <= 0 || Dm < 12 * t || Dm < 40 || H < 6 * t + 12 || Lc < 2 || br < 0.5 || pa < 0.8 || fw < 3) return null;
    const R = Dm / 2, Rm = R - t / 2, Ri = R - t;                    // radio exterior, de la fibra neutra y del interior
    const arcLen = (half ? 1 : 2) * Math.PI * Rm, flatH = half ? Rm : 0, wc = half ? Math.max(6, 2.5 * t) : 0;
    const L = 2 * flatH + 2 * wc + arcLen;
    const tw = Math.max(4, Math.min(fw, 14, L / (nTab * 2.2)));      // ancho de cada pestaña de la base
    const pl = 8;                                                    // profundidad del cierre
    const clampBack = half ? 0 : 0;
    // Punto de la pared (en el plano de la planta) a la distancia s desde el inicio de la tira, y hacia dónde mira el exterior
    const pathAt = x => {
      if (!half) { const a = x / Rm; return { p: [Rm * Math.cos(a), -Rm * Math.sin(a)], n: [Math.cos(a), -Math.sin(a)] }; }
      if (x < flatH) return { p: [x, 0], n: [0, 1] };
      if (x < flatH + wc) return { p: [Rm, 0], n: [1, 0], corner: true };
      if (x < flatH + wc + arcLen) { const a = (x - flatH - wc) / Rm; return { p: [Rm * Math.cos(a), -Rm * Math.sin(a)], n: [Math.cos(a), -Math.sin(a)] }; }
      if (x < flatH + 2 * wc + arcLen) return { p: [-Rm, 0], n: [-1, 0], corner: true };
      return { p: [-Rm + (x - (flatH + 2 * wc + arcLen)), 0], n: [0, 1] };
    };
    const inCorner = x => half && ((x > flatH - tw / 2 - 1 && x < flatH + wc + tw / 2 + 1) || (x > flatH + wc + arcLen - tw / 2 - 1 && x < flatH + 2 * wc + arcLen + tw / 2 + 1));
    const evenly = (n, margin) => Array.from({ length: n }, (_, i) => margin + (L - 2 * margin) * (i + 0.5) / n).filter(x => !inCorner(x));
    const mClose = pl + tw / 2 + 5;
    const tabsAt = evenly(nTab, mClose), slotAt = nA ? evenly(4, mClose + 4) : [];
    const polysOf = fromC;
    const union = list => polysOf(clip(CL.ClipType.ctUnion, toC(list.map(pts => ({ closed: true, pts })))));
    const diff = (a, list) => polysOf(clip(CL.ClipType.ctDifference, toC([{ closed: true, pts: a }]), toC(list.map(pts => ({ closed: true, pts })))));
    const bigger = list => list.reduce((a, b) => polyArea(b.pts) > polyArea(a.pts) ? b : a, list[0]);
    const rectP = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const circP = (cx, cy, r) => Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 12), cy + r * Math.sin(i * Math.PI / 12)]);

    // ----- Pared (tira) -----
    const cuts = [], adds = [];
    const top = 0, bot = H;
    if (puzzle) {
      const nK = Math.max(1, Math.round(H / 34)), rk = Math.min(5.5, H / nK * 0.3), nk = rk * 0.5, nl = rk * 0.9;
      for (let j = 0; j < nK; j++) {
        const yk = H * (j + 0.5) / nK;
        const knob = () => [rectP(0, yk - nk, nl + 0.2, yk + nk), circP(nl + rk * 0.7, yk, rk)];
        for (const p of knob()) adds.push(p.map(([x, y]) => [x + L, y]));   // cabeza que sale a la derecha
        for (const p of knob()) cuts.push(p.map(([x, y]) => [x - 0.2, y]));  // hueco a la izquierda
      }
    } else {
      const n = Math.max(3, 2 * Math.floor(H / (2 * Math.max(5, fw))) + 1), hs = H / n;
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) { adds.push(rectP(L - 0.2, i * hs, L + pl, (i + 1) * hs)); cuts.push(rectP(-0.2, i * hs, pl, (i + 1) * hs)); }
        else { adds.push(rectP(-pl, i * hs, 0.2, (i + 1) * hs)); cuts.push(rectP(L - pl, i * hs, L + 0.2, (i + 1) * hs)); }
      }
    }
    for (const x of tabsAt) cuts.push(rectP(x - tw / 2, bot - t, x + tw / 2, bot + 1));   // muescas donde entra la base
    let wallPts = union([rectP(0, top, L, bot), ...adds]).length ? bigger(union([rectP(0, top, L, bot), ...adds])).pts : rectP(0, top, L, bot);
    const dres = diff(wallPts, cuts);
    if (dres.length) wallPts = bigger(dres).pts;
    const holes = [];
    for (let j = 0; j < nA; j++) {
      const yc = H * (j + 1) / (nA + 1);
      for (const x of slotAt) holes.push(rectP(x - tw / 2, yc - t / 2, x + tw / 2, yc + t / 2));
    }
    // Líneas de la bisagra: paralelas al eje, solo en la parte que se curva
    const edge = (puzzle ? pl + 5 : pl + 4);
    const hx0 = half ? flatH + 1 : edge, hx1 = half ? flatH + 2 * wc + arcLen - 1 : L - edge;
    // Las líneas de la bisagra recorren toda la tira; solo se interrumpen justo donde hay una ranura para un aro (con 2 mm de margen)
    const slotRows = [];
    for (let j = 0; j < nA; j++) { const yc = H * (j + 1) / (nA + 1); slotRows.push([yc - t / 2 - 2, yc + t / 2 + 2]); }
    const hl = [];
    // Las líneas llegan hasta los bordes de arriba y de abajo (alternadas): una banda maciza en el borde impediría que la pared se curve
    for (const ln of hingeLines(hx0, 0, hx1 - hx0, H, Lc, br, pa)) {
      const x = ln.pts[0][0];
      let pieces = [[ln.pts[0][1], ln.pts[1][1]]];
      if (slotAt.some(sx => Math.abs(x - sx) < tw / 2 + 2)) {
        for (const [g0, g1] of slotRows) pieces = pieces.flatMap(([a, b]) => b <= g0 || a >= g1 ? [[a, b]] : [[a, Math.min(b, g0)], [Math.max(a, g1), b]].filter(([p, q]) => q > p));
      }
      for (const [a, b] of pieces) if (b - a > 1) hl.push({ closed: false, pts: [[x, a], [x, b]] });
    }
    if (hl.length > 14000) return null;
    const wallG = growPoly(wallPts, k);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of wallG) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const sh = ([x, y]) => [x - x0, y - y0];
    const panels = [{ name: 'Pared flexible', w: x1 - x0, h: y1 - y0, pts: wallG.map(sh), holes: holes.map(hh => growPoly(hh, -k).map(sh)), lines: hl.map(l => l.pts.map(sh)) }];

    // ----- Base, refuerzo de base y aros (en planta) -----
    const body = (r) => { // círculo o media luna (con el borde recto en la cara interior de la pared de atrás)
      if (!half) { const nn = Math.max(24, segs(r, 2 * Math.PI)); return Array.from({ length: nn }, (_, i) => [r * Math.cos(i * 2 * Math.PI / nn), r * Math.sin(i * 2 * Math.PI / nn)]); }
      const y0f = -t / 2, p0 = Math.asin(Math.min(1, -y0f / r)), n = Math.max(12, segs(r, Math.PI - 2 * p0));
      return Array.from({ length: n + 1 }, (_, i) => { const a = p0 + (Math.PI - 2 * p0) * i / n; return [r * Math.cos(a), -r * Math.sin(a)]; });
    };
    const tabRect = x => {
      const { p, n } = pathAt(x), tg = [-n[1], n[0]];
      const q = (u, v) => [p[0] + tg[0] * u + n[0] * v, p[1] + tg[1] * u + n[1] * v];
      return [q(-tw / 2, -t / 2 - 0.4), q(tw / 2, -t / 2 - 0.4), q(tw / 2, t / 2), q(-tw / 2, t / 2)];
    };
    const withTabs = (pts, xs) => { const u = union([pts, ...xs.map(tabRect)]); return u.length ? bigger(u).pts : pts; };
    const basePlan = withTabs(body(Ri), tabsAt);
    const place = (name, pts, hs = []) => {
      const outG = growPoly(pts, k);
      let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
      for (const [x, y] of outG) { if (x < a0) a0 = x; if (y < b0) b0 = y; if (x > a1) a1 = x; if (y > b1) b1 = y; }
      const sh2 = ([x, y]) => [x - a0, y - b0];
      return { name, w: a1 - a0, h: b1 - b0, pts: outG.map(sh2), holes: hs.map(hh => growPoly(hh, -k).map(sh2)) };
    };
    const pieces = [place('Base (con pestañas)', basePlan)];
    if ((s.p.refuerzo || 'si') !== 'no') pieces.push(place('Refuerzo de base (pegar encima)', body(Ri - 0.4)));
    const band = Math.max(8, Math.min(16, Ri * 0.18));
    const rings = [];
    for (let j = 0; j < nA; j++) {
      const outer = withTabs(body(Ri - 0.4), slotAt), inner = body(Math.max(6, Ri - band)).map(([x, y]) => [x, half ? y + (half ? 0 : 0) : y]);
      pieces.push(place(`Aro ${j + 1}`, outer, [inner]));
      rings.push({ outer, inner, y: H * (j + 1) / (nA + 1) });
    }
    const wallW = x1 - x0;
    return { W: 2 * R, D: half ? R + t : 2 * R, H, t, fingers: false, sep, panels: [...panels, ...pieces], dividers: [], layout: [[panels[0]], pieces],
      planter: { R, Rm, Ri, half, L, H, pathAt, hl: hl.map(l => l.pts), wallW, basePlan, rings, reinf: (s.p.refuerzo || 'si') !== 'no' ? body(Ri - 0.4) : null, hingeLines: hl.length, nTab: tabsAt.length, nSlots: slotAt.length } };
  }

  /* ----- Grabado de nombre o logo en la caja ----- */
  // Piezas donde se graba. Con varios cajones, cada frente decorativo (el de arriba primero).
  // Dónde queda cada pieza de la caja en el plano de corte (las más altas primero, en filas dentro de la cama)
  function boxPlacement(s, m) {
    const x0 = len(s, 'x'), y0 = len(s, 'y');
    const pieces = m.layout.flat().filter(Boolean).sort((a, b) => b.h - a.h);
    const maxW = Math.max(doc.sheet.w - Math.max(0, x0), ...pieces.map(q => q.w));
    let x = x0, y = y0, shelf = 0;
    const placed = new Map();
    for (const q of pieces) {
      if (x > x0 && x - x0 + q.w > maxW) { x = x0; y += shelf + m.sep; shelf = 0; }
      placed.set(q, [x, y]);
      x += q.w + m.sep;
      shelf = Math.max(shelf, q.h);
    }
    return placed;
  }
  // Diseños dibujados sobre una pieza en el plano de corte (grabado, marcado, recortes): se ven también en la vista 3D
  function boxOverlays(s, m) {
    const out = new Map();
    if (!m || !m.layout) return out;
    const placed = boxPlacement(s, m), spots = [...placed].map(([q, [px, py]]) => ({ q, px, py, outline: q.pts.map(([u, v]) => [u + px, v + py]) }));
    const get = (q, px, py) => { let o = out.get(q); if (!o) { o = { engr: { polys: [], texts: [], images: [] }, holes: [] }; out.set(q, o); } return o; };
    for (const id of evalCache.keys()) {
      const sh = byId(id);
      if (!sh || id === s.id || SEPARABLE.has(sh.type) || (sh.type === 'import' && sh.asm)) continue;
      for (const it of worldCache.get(id) || []) {
        const b = bboxOfItems([it]);
        if (!b) continue;
        const c = [b.x + b.w / 2, b.y + b.h / 2], sp = spots.find(z => inPoly(c, z.outline));
        if (!sp) continue;
        const { px, py } = sp, o = get(sp.q);
        const mv = ([x, y]) => [x - px, y - py];
        if (it.op === 'grabado' || it.op === 'marcado') {
          for (const pl of it.polys) o.engr.polys.push({ closed: pl.closed, pts: pl.pts.map(mv) });
          for (const t of it.texts) o.engr.texts.push({ ...t, x: t.x - px, y: t.y - py });
          for (const g of it.images || []) o.engr.images.push({ ...g, x: g.x - px, y: g.y - py });
        } else if (it.op === 'corte') {
          for (const pl of it.polys) if (pl.closed && pl.pts.every(p => inPoly(p, sp.outline))) o.holes.push(pl.pts.map(mv));
        }
      }
    }
    return out;
  }

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
    const textW = () => measureTextWidth(str, S, s.p.grabadoFuente);
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
    if (str) it.texts.push({ x: cx, y: top + lh + gap + S * 0.8, size: S, str, rot: 0, anchor: 'middle', font: s.p.grabadoFuente });
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
      add({ name: 'Mueble atrás', w: W, h: H, place: 'back', pts: panelPoints(W, H, t, fw, ['ranuras', 'dedos', 'ranuras', 'dedos'], kerf, fingerSegs(s, 'W', 'H')) });
      const side = panelPoints(D, H, t, fw, ['ranuras', 'ranuras', 'ranuras', 'plano'], kerf, fingerSegs(s, 'D', 'H'));
      add({ name: 'Mueble lado izq.', w: D, h: H, place: 'left', pts: side });
      add({ name: 'Mueble lado der.', w: D, h: H, place: 'right', pts: side });
      const plate = panelPoints(W, D, t, fw, ['plano', 'dedos', 'dedos', 'dedos'], kerf, fingerSegs(s, 'W', 'D'));
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
        const fb = panelPoints(Wd, Hd, t, fw, ['plano', 'dedos', 'ranuras', 'dedos'], kerf, fingerSegs(s, 'W', 'H'));
        const sd = panelPoints(Dd, Hd, t, fw, ['plano', 'ranuras', 'ranuras', 'ranuras'], kerf, fingerSegs(s, 'D', 'H'));
        dw('frente', Wd, Hd, fb, { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [x0, y0 + Hd, z0] });
        dw('atrás', Wd, Hd, fb, { eu: [-1, 0, 0], ev: [0, -1, 0], ew: [0, 0, -1], o: [x0 + Wd, y0 + Hd, z0 + Dd] });
        dw('lado izq.', Dd, Hd, sd, { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], o: [x0, y0 + Hd, z0] });
        dw('lado der.', Dd, Hd, sd, { eu: [0, 0, 1], ev: [0, -1, 0], ew: [-1, 0, 0], o: [x0 + Wd, y0 + Hd, z0] });
        base = dw('base', Wd, Dd, panelPoints(Wd, Dd, t, fw, ['dedos', 'dedos', 'dedos', 'dedos'], kerf, fingerSegs(s, 'W', 'D')), { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, 1, 0], o: [x0, y0, z0] });
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
    // Cubierta de otra madera: lados, atrás, base y techo del mueble, y un panel sobre cada frente decorativo (se desliza con su cajón)
    if (s.p.cubierta === 'si') {
      const cv = s.p.grosorCub && String(s.p.grosorCub).trim() ? len(s, 'grosorCub') : t;
      if (!(cv > 0) || !Number.isFinite(cv)) return null;
      const caras = s.p.cubiertaCaras || 'todas', fL = s.p.cubiertaLargas === 'frente', ex = fL ? cv : 0, sx = fL ? 0 : cv;
      const covers = [];
      const addC = (name, w, h, place, eu, ev, ew, oo, out, extra) => covers.push({ name, w, h, place, holes: [], pts: rect(w, h), th: cv, color: 0xa9743f, ...extra, axes: { eu, ev, ew, o: oo, out } });
      const Lz = D + t; // largo exterior del mueble contando el frente decorativo
      if (caras !== 'frente') {
        addC('Cubierta Atrás', W + 2 * ex, H, 'back', [-1, 0, 0], [0, -1, 0], [0, 0, -1], [W + ex, H, D + cv], [0, 0, 1]);
        addC('Cubierta Lado izq.', Lz + 2 * sx, H, 'left', [0, 0, 1], [0, -1, 0], [1, 0, 0], [-cv, H, -t - sx], [-1, 0, 0]);
        addC('Cubierta Lado der.', Lz + 2 * sx, H, 'right', [0, 0, -1], [0, -1, 0], [-1, 0, 0], [W + cv, H, D + sx], [1, 0, 0]);
        if (caras === 'todas') {
          addC('Cubierta Base', W + 2 * cv, Lz + 2 * cv, 'bottom', [1, 0, 0], [0, 0, 1], [0, 1, 0], [-cv, -cv, -t - cv], [0, -1, 0]);
          addC('Cubierta Techo', W + 2 * cv, Lz + 2 * cv, 'top', [1, 0, 0], [0, 0, 1], [0, -1, 0], [-cv, H + cv, -t - cv], [0, 1, 0]);
        }
      }
      for (const f of panels.filter(q => q.face)) {
        const tg = n > 1 ? ` ${f.faceIndex + 1}` : '';
        addC(`Cubierta frente${tg}`, W + 2 * ex, f.h, 'front', [1, 0, 0], [0, -1, 0], [0, 0, 1], [f.axes.o[0] - ex, f.axes.o[1], -t - cv], [0, 0, -1],
          { drawer: true, drawerIndex: f.drawerIndex });
        const last = covers[covers.length - 1];
        last.holes = f.holes.map(hh => hh.map(([u, v]) => [u + ex, v]));
      }
      panels.push(...covers);
    }
    const layout = [panels];
    return { W, D, H, t, fingers, sep, panels, dividers: [], layout, drawer: { Wd, Hd, Dd, c, n } };
  }

  /* ----- Canasta paramétrica ----- */
  // Laterales en U (con poste del asa), tablillas alrededor de la U con pestañas a ranuras, asa en arco y marco opcional.
  // Plano de cada pieza: u a la derecha, v hacia abajo (mm). 3D: X ancho, Y alto, Z largo (frente en Z = 0).
  function basketModel(s, forView = false) {
    const t = len(s, 't', 3), sep = len(s, 'sep', 5), kerf = forView ? 0 : len(s, 'kerf', 0), k = kerf / 2;
    const W = len(s, 'ancho', 150), H = len(s, 'alto', 110), D = len(s, 'profundo', 220);
    const given = key => s.p[key] && String(s.p[key]).trim();
    const R = Math.max(0, Math.min(given('radio') ? len(s, 'radio') : Math.min(W / 2, H * 0.6), W / 2, H));
    const N = Math.max(2, Math.min(40, Math.round(num(s, 'nTab', 7)) || 7));
    const g = given('sepTab') ? len(s, 'sepTab') : 4;
    const asa = (s.p.asa || 'si') === 'si';
    const hA = given('asaAlto') ? len(s, 'asaAlto') : Math.max(40, H * 0.8);
    const rise = given('asaArco') ? len(s, 'asaArco') : D * 0.18;
    const bw = given('asaAncho') ? len(s, 'asaAncho') : 22;
    const marco = given('marco') ? len(s, 'marco') : Math.max(10, 3 * t);
    if (![t, sep, kerf, W, H, D, R, g, hA, rise, bw, marco].every(Number.isFinite) || t <= 0 || W <= 6 * t || H <= 4 * t || D <= 6 * t) return null;
    // Recorrido de la U (sin el borde de arriba): lado izq. ↓, curva, fondo, curva, lado der. ↑
    const segsU = [
      { L: H - R, at: a => [[0, a], [0, 1]] },
      { L: Math.PI * R / 2, at: a => { const th = Math.PI - a / (R || 1); return [[R + R * Math.cos(th), H - R + R * Math.sin(th)], [Math.sin(th), -Math.cos(th)]]; } },
      { L: W - 2 * R, at: a => [[R + a, H], [1, 0]] },
      { L: Math.PI * R / 2, at: a => { const th = Math.PI / 2 - a / (R || 1); return [[W - R + R * Math.cos(th), H - R + R * Math.sin(th)], [Math.sin(th), -Math.cos(th)]]; } },
      { L: H - R, at: a => [[W, H - R - a], [0, -1]] },
    ];
    const Lp = segsU.reduce((a, q) => a + q.L, 0);
    const pointAt = a => {
      for (const q of segsU) { if (a <= q.L + 1e-9 || q === segsU[segsU.length - 1]) { const [p, tn] = q.at(Math.min(a, q.L)); return { p, tn, n: [tn[1], -tn[0]] }; } a -= q.L; }
    };
    const sw = (Lp - (N - 1) * g) / N; // ancho de cada tablilla
    if (!(sw > 2 * t + 2)) return null;
    const tw = Math.max(Math.min(sw * 0.5, 30), Math.min(sw - 2, 6)); // ancho de la pestaña
    // Contorno de la U (con poste arriba si hay asa), sentido horario en pantalla
    const arcPtsPlan = (cx, cy, r, a0, a1) => arcPts(cx, cy, r, a0, a1).slice(1);
    const wp = Math.max(bw * 0.9, 3 * t + 8), vHead = -(hA - wp / 2);
    const outline = [[0, 0]];
    if (asa) outline.push([W / 2 - wp / 2, 0], [W / 2 - wp / 2, vHead], ...arcPtsPlan(W / 2, vHead, wp / 2, Math.PI, 2 * Math.PI), [W / 2 + wp / 2, 0]);
    outline.push([W, 0], [W, H - R]);
    if (R > 0) outline.push(...arcPtsPlan(W - R, H - R, R, 0, Math.PI / 2));
    outline.push([R, H]);
    if (R > 0) outline.push(...arcPtsPlan(R, H - R, R, Math.PI / 2, Math.PI));
    const outlineU = outline.filter(([x, y]) => y >= 0);
    const grow = (pts, d) => d ? (offsetPolys([{ closed: true, pts }], d)[0] || { pts }).pts : pts;
    const rot = (c, tn, n, a, b) => [[-a, -b], [a, -b], [a, b], [-a, b]].map(([u, v]) => [c[0] + tn[0] * u + n[0] * v, c[1] + tn[1] * u + n[1] * v]);
    const endHoles = [];
    const panels = [];
    const top = [0, 0 - (asa ? hA : 0)];
    const shiftV = asa ? hA : 0; // el plano se corre hacia abajo para que empiece en v = 0
    const sh = pts => pts.map(([u, v]) => [u, v + shiftV]);
    // Tablillas
    for (let i = 0; i < N; i++) {
      const c = i * (sw + g) + sw / 2;
      const { p, tn, n } = pointAt(c);
      const sc = [p[0] + n[0] * t / 2, p[1] + n[1] * t / 2];
      endHoles.push(grow(rot(sc, tn, n, tw / 2, t / 2), -k));
      const a0 = (sw - tw) / 2, b0 = (sw + tw) / 2;
      const pts = kerfOffset([[t, 0], [D - t, 0], [D - t, a0], [D, a0], [D, b0], [D - t, b0], [D - t, sw], [t, sw], [t, b0], [0, b0], [0, a0], [t, a0]], k);
      const p3 = [p[0], H - p[1], 0], ev = [tn[0], -tn[1], 0], ew = [n[0], -n[1], 0];
      panels.push({ name: `Tablilla ${i + 1}`, w: D, h: sw, holes: [], pts,
        axes: { eu: [0, 0, 1], ev, ew, o: [p3[0] - ev[0] * sw / 2, p3[1] - ev[1] * sw / 2, 0], out: [-ew[0], -ew[1], 0] } });
    }
    // Ranura del asa en la cabeza del poste
    const tabH = Math.min(bw * 0.6, wp - 6);
    if (asa) endHoles.push(grow([[W / 2 - t / 2, vHead - tabH / 2], [W / 2 + t / 2, vHead - tabH / 2], [W / 2 + t / 2, vHead + tabH / 2], [W / 2 - t / 2, vHead + tabH / 2]], -k));
    const endPts = sh(grow(outline, k)), holes = endHoles.map(sh);
    const hEnd = H + shiftV;
    panels.push({ name: 'Lateral frente', w: W, h: hEnd, pts: endPts, holes: holes.map(x => x.slice()),
      axes: { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [0, H + shiftV, 0], out: [0, 0, -1] } });
    panels.push({ name: 'Lateral atrás', w: W, h: hEnd, pts: endPts, holes: holes.map(x => x.slice()),
      axes: { eu: [-1, 0, 0], ev: [0, -1, 0], ew: [0, 0, -1], o: [W, H + shiftV, D], out: [0, 0, 1] } });
    // Marco decorativo: mismo contorno con una ventana (se pega al frente y tapa las ranuras)
    if ((s.p.frente || 'no') === 'si') {
      const win = offsetPolys([{ closed: true, pts: outlineU }], -marco).map(pl => sh(grow(pl.pts, -k)));
      panels.push({ name: 'Marco decorativo', w: W, h: hEnd, pts: endPts, holes: win,
        axes: { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [0, H + shiftV, -t], out: [0, 0, -1.6] } });
    }
    // Asa en arco: banda curva con pestañas que atraviesan los postes
    if (asa) {
      const Lc = D, c = Lc - 2 * t, r = (c * c / 4 + rise * rise) / (2 * rise || 1), cy = -rise + r;
      const arcY = x => rise > 0 ? cy - Math.sqrt(Math.max(0, r * r - (x - Lc / 2) ** 2)) : 0;
      const n = 40, xs = Array.from({ length: n + 1 }, (_, i) => t + c * i / n);
      const a0 = (bw - tabH) / 2, b0 = (bw + tabH) / 2;
      const pts = [...xs.map(x => [x, arcY(x)]),
        [Lc - t, a0], [Lc, a0], [Lc, b0], [Lc - t, b0], [Lc - t, bw],
        ...xs.slice().reverse().map(x => [x, arcY(x) + bw]),
        [t, bw], [t, b0], [0, b0], [0, a0], [t, a0]];
      const band = grow(cleanPolygon(pts), k).map(([u, v]) => [u, v + rise]);
      const q = { name: 'Asa', w: Lc, h: bw + rise, holes: [], pts: band,
        axes: { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], o: [W / 2 - t / 2, H + hA - wp / 2 + bw / 2 + rise, 0], out: [0, 1, 0] } };
      // Texto a lo largo del arco (una letra por posición, girada según la curva)
      const str = String(s.p.asaTexto || '').trim();
      if (str) {
        let size = bw * 0.5;
        const chars = [...str], room = (Lc - 4 * t) * 0.95;
        const fnt = s.p.asaFuente;
        let total = chars.reduce((a, ch) => a + measureTextWidth(ch, size, fnt) + size * 0.05, 0);
        if (total > room) { size *= room / total; total = room; } // si no cabe, se achica
        let cur = Lc / 2 - total / 2;
        q.texts = chars.map(ch => {
          const cw = measureTextWidth(ch, size, fnt) + size * 0.05, x = cur + cw / 2;
          cur += cw;
          const dy = arcY(x + 0.5) - arcY(x - 0.5);
          return { x, y: arcY(x) + bw / 2 + size * 0.35 + rise, size, str: ch, rot: Math.atan2(dy, 1) / DEG, anchor: 'middle', font: fnt };
        }).filter(tx => tx.str.trim());
      }
      panels.push(q);
    }
    return { W, D, H: H + (asa ? hA : 0), t, fingers: true, sep, panels, dividers: [], layout: [panels], basket: { sw, N } };
  }

  // Lado para tapa deslizante (con dedos): canto de arriba liso, ranura abierta por el frente
  // y dedos del frente solo en la altura del frente (Hf).
  function slideSidePoints(D, H, t, fw, Hf, mTop, slotH, slotLen, kerf, counts) {
    const segs = (ln, mode, cnt) => {
      let n = cnt || (fw > 0 ? Math.floor(ln / fw) : 1);
      if (!(n >= 1)) n = 1;
      if (n > 999) n = 999;
      if (n % 2 === 0) n--;
      const s = ln / n;
      return Array.from({ length: n }, (_, i) => [i * s, (i + 1) * s, mode === 'dedos' ? (i % 2 ? t : 0) : (i % 2 ? 0 : t)]);
    };
    const back = segs(H, 'ranuras', counts && counts[1]), bottom = segs(D, 'ranuras', counts && counts[0]), front = segs(Hf, 'ranuras', counts && counts[1]);
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
        const star = s.p.forma === 'estrella';
        const inner = r * Math.max(0.05, Math.min(0.95, (num(s, 'profEst', 50) || 50) / 100)); // radio de los huecos entre puntas
        const pts = [];
        for (let i = 0; i < (star ? 2 * n : n); i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / (star ? 2 * n : n), rr = star && i % 2 ? inner : r;
          pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
        }
        it.polys.push({ closed: true, pts });
        break;
      }
      case 'line':
        it.polys.push({ closed: false, pts: [[len(s, 'x'), len(s, 'y')], [len(s, 'x2'), len(s, 'y2')]] });
        break;
      case 'text': {
        const x = len(s, 'x'), y = len(s, 'y'), size = Math.abs(len(s, 'tam', 10)), str = String(s.p.texto || ''), rot = num(s, 'rot', 0) || 0;
        // El giro es alrededor del centro del texto (no de su esquina), como en cualquier programa de diseño
        const curva = s.p.curva || 'no';
        if (curva !== 'no' && str && Number.isFinite(x + y + size)) {
          const placed = curvedTextItems(s, x, y, size, str);
          if (placed) { it.texts.push(...placed); break; }
        }
        let ax = x, ay = y;
        if (rot && Number.isFinite(rot)) [ax, ay] = apply(mR(rot, x + Math.max(size * 0.3, measureTextWidth(str, size, s.p.fuente)) / 2, y - size * 0.35), [x, y]);
        it.texts.push({ x: ax, y: ay, size, str, rot, font: s.p.fuente });
        break;
      }
      case 'panel': {
        const x = len(s, 'x'), y = len(s, 'y'), w = Math.abs(len(s, 'w')), h = Math.abs(len(s, 'h'));
        const t = Math.max(0, Math.min(len(s, 't', 3), w / 2, h / 2));
        // "Por cantidad": N dedos en un borde = 2N − 1 segmentos
        const seg = k => 2 * Math.max(1, Math.min(200, Math.round(num(s, k, 3)) || 1)) - 1;
        const counts = s.p.dedoModo === 'cantidad' ? [seg('nH'), seg('nV'), seg('nH'), seg('nV')] : null;
        const pts = panelPoints(w, h, t, len(s, 'dedo', 10), [s.p.top, s.p.right, s.p.bottom, s.p.left], len(s, 'kerf', 0), counts);
        it.polys.push({ closed: true, pts: pts.map(p => [p[0] + x, p[1] + y]) });
        break;
      }
      case 'box':
      case 'taper':
      case 'cone':
      case 'planter':
      case 'basket': {
        const m = modelOf(s, false);
        if (!m) return null;
        // Plano de corte: [frente, atrás] / [lados] / [base, tapa]; las piezas van en filas dentro del ancho de la cama
        const placed = boxPlacement(s, m);
        for (const [q, [px, py]] of placed) {
          const mv = ([u, v]) => [u + px, v + py];
          it.polys.push({ closed: true, pts: q.pts.map(mv), name: q.name });
          for (const hl of q.holes || []) it.polys.push({ closed: true, pts: hl.map(mv) });
          for (const ln of q.lines || []) it.polys.push({ closed: false, pts: ln.map(mv) }); // cortes de la bisagra viva
        }
        const eng = boxEngraving(s, m, placed) || { op: 'grabado', polys: [], texts: [], images: [] };
        // Textos propios de las piezas (p. ej. el texto del asa de la canasta)
        for (const [q, [px, py]] of placed) for (const tx of q.texts || []) eng.texts.push({ ...tx, x: tx.x + px, y: tx.y + py });
        if (eng.polys.length || eng.texts.length || eng.images.length) return [it, eng];
        break;
      }
      case 'import': {
        const a = doc.assets && doc.assets[s.p.asset];
        if (!a) return null;
        const x = len(s, 'x'), y = len(s, 'y'), w = Math.abs(len(s, 'w'));
        const aspect = a.h / a.w;
        const h = s.p.prop === 'no' ? Math.abs(len(s, 'h')) : w * aspect;
        if (![x, y, w, h].every(Number.isFinite) || !w || !h) return null;
        if (a.kind === 'image') {
          it.op = OPS[s.op] ? s.op : 'grabado';
          it.images.push({ href: a.href, x, y, w, h, rot: 0 });
          break;
        }
        // Trazos normalizados (ancho 1): se escalan al tamaño pedido; con "archivo" cada trazo usa su color
        const sy = h / aspect;
        const byOp = new Map();
        for (const pl of a.polys) {
          const op = s.op === 'archivo' ? (pl.op || 'corte') : s.op;
          if (!byOp.has(op)) byOp.set(op, { op, polys: [], texts: [], images: [] });
          byOp.get(op).polys.push({ closed: pl.closed, pts: pl.pts.map(([u, v]) => [x + u * w, y + v * sy]) });
        }
        for (const t of a.texts || []) {
          const op = s.op === 'archivo' ? (t.op || 'grabado') : s.op;
          if (!byOp.has(op)) byOp.set(op, { op, polys: [], texts: [], images: [] });
          byOp.get(op).texts.push({ ...t, x: x + t.x * w, y: y + t.y * sy, size: t.size * w });
        }
        const list = [...byOp.values()];
        return list.length ? list : null;
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
      polys: it.polys.map(p => ({ ...p, pts: p.pts.map(q => apply(m, q)), ...(p.ref ? { ref: p.ref.map(q => apply(m, q)) } : {}) })),
      texts: it.texts.map(t => { const [x, y] = apply(m, [t.x, t.y]); return { ...t, x, y, rot: t.rot + dr }; }),
      images: (it.images || []).map(g => { const [x, y] = apply(m, [g.x, g.y]); return { ...g, x, y, rot: g.rot + dr }; }),
    }));
  }

  // Esquinas aproximadas del texto (para seleccionar y medir)
  function textCorners(t) {
    const w = Math.max(t.size * 0.3, measureTextWidth(t.str, t.size));
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
    if (mode === 'excluir') { let x = list[0]; for (const p of list.slice(1)) x = clip(CT.ctXor, x, p); return x; }
    let acc = list[0];
    for (const p of list.slice(1)) acc = clip(CT.ctIntersection, acc, p);
    return acc;
  }
  // Redondea las esquinas salientes (puntas) con radio r: se encoge y se vuelve a agrandar con unión redonda.
  // Lo que sea más delgado que 2·r desaparece.
  function roundPolys(polys, r) {
    const src = normalize(toC(polys));
    if (!src.length || !(r > 0)) return polys;
    const inward = new CL.Paths(), outward = new CL.Paths();
    const c1 = new CL.ClipperOffset(2, 10);
    c1.AddPaths(src, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    c1.Execute(inward, -r * SC);
    const c2 = new CL.ClipperOffset(2, 10);
    c2.AddPaths(inward, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    c2.Execute(outward, r * SC);
    return fromC(outward);
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
      const kids = (s.children || []).filter(k => !k.hidden).map(evalShape).filter(Boolean);
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
      items = (Array.isArray(it) ? it : [it]).map(fontOutlines);
    }
    let rr = s.p.redond ? len(s, 'redond') : 0;
    if (rr > 0 && CL && canOffset(s) && Number.isFinite(rr)) {
      if (s.type === 'polygon' && s.p.forma !== 'estrella') {
        // en un polígono regular, el radio no puede pasar del círculo inscrito
        const n = Math.max(3, Math.min(200, Math.round(num(s, 'n', 6)))), ap = Math.abs(len(s, 'd')) / 2 * Math.cos(Math.PI / n);
        rr = Math.min(rr, ap * 0.999);
      }
      items = items.map(it => ({ ...it, polys: [...roundPolys(it.polys.filter(p => p.closed), rr), ...it.polys.filter(p => !p.closed)] }));
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
    items = applyBridges(items, s);
    bb = bboxOfItems(items);
    const copies = repMatrices(s, bb);
    if (copies.length > 1) items = copies.flatMap(c => transformItems(items, c));
    return { id: s.id, items, desc, bbox: bboxOfItems(items) };
  }

  // Puentes: pequeños tramos sin cortar en el contorno de la pieza, para que no se mueva mientras el láser termina
  let bridgeSeq = 0;
  function bridgePieces(P, n, gap, id) {
    const m = P.length, cum = [0];
    for (let i = 0; i < m; i++) cum.push(cum[i] + Math.hypot(P[(i + 1) % m][0] - P[i][0], P[(i + 1) % m][1] - P[i][1]));
    const L = cum[m];
    if (!(L > n * gap * 3)) return null;
    const segAt = c => { let k = 0; while (k < m - 1 && cum[k + 1] < c) k++; return k; };
    const snap = c => { const k = segAt(c), a = cum[k], b = cum[k + 1]; return b - a >= gap * 1.6 ? Math.max(a + gap * 0.8, Math.min(b - gap * 0.8, c)) : c; };
    const centers = Array.from({ length: n }, (_, i) => snap(L * (i + 0.5) / n)).sort((a, b) => a - b);
    for (let i = 1; i < centers.length; i++) if (centers[i] - centers[i - 1] < gap * 1.5) return null;
    const pointAt = s => { s = ((s % L) + L) % L; const k = segAt(s), a = P[k], b = P[(k + 1) % m], t = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    const extract = (sa, sb) => {
      const pts = [pointAt(sa)];
      for (let lap = 0; lap < 2; lap++) for (let i = 0; i < m; i++) { const v = cum[i] + lap * L; if (v > sa + 1e-9 && v < sb - 1e-9) pts.push([P[i][0], P[i][1]]); }
      pts.push(pointAt(sb));
      return pts;
    };
    const ref = P.map(q => [q[0], q[1]]), out = [];
    for (let i = 0; i < n; i++) {
      const sa = centers[i] + gap / 2; let sb = centers[(i + 1) % n] - gap / 2; if (i === n - 1) sb += L;
      if (sb - sa > 0.05) out.push({ closed: false, pts: extract(sa, sb), refId: id, ref });
    }
    return out.length ? out : null;
  }
  function applyBridges(items, s) {
    const n = Math.round(num(s, 'puentes', 0) || 0);
    if (!(n > 0) || !Number.isFinite(n)) return items;
    const gap = s.p.puenteAncho && String(s.p.puenteAncho).trim() ? len(s, 'puenteAncho') : 1.5;
    if (!(gap > 0)) return items;
    return items.map(it => {
      if (it.op !== 'corte') return it;
      const closed = it.polys.filter(p => p.closed && p.pts.length >= 3);
      if (!closed.length) return it;
      const outer = closed.reduce((a, b) => shoelace(b.pts) > shoelace(a.pts) ? b : a);
      const pieces = bridgePieces(outer.pts, Math.min(n, 40), gap, ++bridgeSeq);
      return pieces ? { ...it, polys: [...it.polys.filter(p => p !== outer), ...pieces] } : it;
    });
  }

  // Texto sobre una curva: cada letra se coloca (con su giro) sobre un arco o sobre el trazo de otra figura
  let textPathDepth = 0;
  function pathPolyline(id) {
    const sh = byId(id);
    if (!sh || textPathDepth > 2) return null;
    textPathDepth++;
    try {
      const r = evalShape(sh);
      const pl = r && r.items.flatMap(i => i.polys).filter(p => p.pts.length >= 2).sort((a, b) => b.pts.length - a.pts.length)[0];
      if (!pl) return null;
      const pts = pl.closed ? [...pl.pts, pl.pts[0]] : pl.pts;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, total: cum[cum.length - 1] };
    } catch (e) { return null; } finally { textPathDepth--; }
  }
  function curvedTextItems(s, x, y, size, str) {
    const chars = [...str], font = s.p.fuente, track = s.p.espaciado && String(s.p.espaciado).trim() ? len(s, 'espaciado') : 0;
    const wd = chars.map(c => measureTextWidth(c, size, font));
    const total = wd.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
    if (!Number.isFinite(total) || !(total > 0)) return null;
    const out = [], mk = (str1, px, py, rot) => ({ x: px, y: py, size, str: str1, rot, font, anchor: 'middle' });
    let cum = 0;
    if (s.p.curva === 'arriba' || s.p.curva === 'abajo') {
      const R = Math.max(size * 0.8, Math.abs(s.p.radioC && String(s.p.radioC).trim() ? len(s, 'radioC') : 40));
      if (!Number.isFinite(R)) return null;
      const cx = x + total / 2, top = s.p.curva === 'arriba', cy = top ? y + R : y - R;
      chars.forEach((c, i) => {
        const sc = -total / 2 + cum + wd[i] / 2, th = sc / R;
        cum += wd[i] + track;
        if (c.trim() === '') return;
        out.push(top ? mk(c, cx + R * Math.sin(th), cy - R * Math.cos(th), th / DEG) : mk(c, cx + R * Math.sin(th), cy + R * Math.cos(th), -th / DEG));
      });
      return out;
    }
    // sobre el trazo de otra figura
    const path = s.p.trazo && s.p.trazo !== s.id ? pathPolyline(s.p.trazo) : null;
    if (!path || !(path.total > 0)) return null;
    const d0 = s.p.desde && String(s.p.desde).trim() ? len(s, 'desde') : 0, lift = s.p.sepTrazo && String(s.p.sepTrazo).trim() ? len(s, 'sepTrazo') : 0;
    const at = d => {
      let i = 1; while (i < path.cum.length - 1 && path.cum[i] < d) i++;
      const a = path.pts[i - 1], b = path.pts[i], seg = path.cum[i] - path.cum[i - 1] || 1, t = Math.max(0, Math.min(1, (d - path.cum[i - 1]) / seg));
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ang];
    };
    chars.forEach((c, i) => {
      const sc = d0 + cum + wd[i] / 2;
      cum += wd[i] + track;
      if (c.trim() === '' || sc < 0 || sc + wd[i] / 2 > path.total + 1e-6) return;
      const [px, py, ang] = at(sc);
      out.push(mk(c, px + Math.sin(ang) * lift, py - Math.cos(ang) * lift, ang / DEG));
    });
    return out;
  }

  function evaluateAll() {
    evalVersion++;
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
          x: r4(t.x), y: r4(t.y), 'font-size': r4(t.size), 'font-family': fontCss(t.font), class: cls,
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
    for (const e of [...sh.parentNode.querySelectorAll('.sheet-extra, .sheet-label')]) e.remove();
    const nSheets = doc.nest && doc.nest.count > 1 ? doc.nest.count : 1;
    for (let k = 1; k < nSheets; k++) {
      const r = sh.cloneNode(false); r.removeAttribute('id'); r.classList.add('sheet-extra');
      r.setAttribute('x', k * (doc.sheet.w + doc.nest.gap));
      sh.parentNode.insertBefore(r, sh.nextSibling);
    }
    const a = 6 / view.s * 2;
    $('#axes').setAttribute('d', `M${-a} 0H${a}M0 ${-a}V${a}`);

    evaluateAll();
    layerShapes.replaceChildren();
    for (const s of doc.shapes) {
      const r = evalCache.get(s.id);
      if (!r || !r.items.length || s.hidden) continue;
      const grp = svgEl('g', { 'data-id': s.id, style: s.locked ? 'pointer-events:none' : null }, layerShapes);
      renderItems(r.items, grp, sel.has(s.id) ? ' selected' : '', true);
    }
    drawOverlay();
    drawRulers();
    $('#zoomLabel').textContent = Math.round(view.s / 3 * 100) + '%';
  }

  /* ----- Puntos (vértices) de cada figura: doble clic los muestra; en dibujos importados y piezas sueltas se arrastran ----- */
  const nodeShow = new Set();       // figuras con los puntos visibles
  const nodeSel = new Set();        // puntos seleccionados: "id|poligono|vertice"
  let nodeHover = null;             // punto o segmento bajo el cursor
  const CONVERTIBLE = new Set(['rect', 'circle', 'polygon', 'line', 'panel', 'hinge']);
  const nkey = (id, pi, vi) => `${id}|${pi}|${vi}`;
  // Vértices de una polilínea: esquinas (giro de más de ~12°), extremos abiertos y los puntos añadidos a mano (marcados con un 3er valor).
  // Las curvas suaves solo marcan sus cuatro extremos.
  function vertexIdx(pl) {
    const pts = pl.pts, n = pts.length, keep = new Set();
    if (n < 2) return [];
    for (let i = 0; i < n; i++) {
      if (pts[i][2]) { keep.add(i); continue; }
      if (!pl.closed && (i === 0 || i === n - 1)) { keep.add(i); continue; }
      const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 0.21) keep.add(i);
    }
    if (!keep.size) for (const f of [p => p[0], p => -p[0], p => p[1], p => -p[1]]) keep.add(pts.reduce((m, p, i) => f(p) > f(pts[m]) ? i : m, 0));
    return [...keep].sort((a, b) => a - b);
  }
  // Cómo se coloca un dibujo importado en el lienzo (rotated = girado o repetido: ahí no se editan puntos)
  function importFrame(s) {
    if (!s || s.type !== 'import') return null;
    const a = doc.assets && doc.assets[s.p.asset];
    if (!a || a.kind !== 'vector') return null;
    const x = len(s, 'x'), y = len(s, 'y'), w = Math.abs(len(s, 'w')), aspect = a.h / a.w;
    const h = s.p.prop === 'no' ? Math.abs(len(s, 'h')) : w * aspect;
    if (![x, y, w, h].every(Number.isFinite) || !w || !h) return null;
    const rotated = (num(s, 'rot', 0) || 0) !== 0 || (s.p.rep && s.p.rep !== 'no');
    return { a, x, y, w, sy: h / aspect, rotated };
  }
  const frameWorld = (fr, q) => [fr.x + q[0] * fr.w, fr.y + q[1] * fr.sy];
  function nodeList(id) {
    const s = byId(id), fr = importFrame(s), out = [];
    if (fr && !fr.rotated) {
      fr.a.polys.forEach((pl, pi) => {
        const cv = fr.a.curves && fr.a.curves[pi];
        if (cv) cv.n.forEach((nd, vi) => { const [x, y] = frameWorld(fr, nd.p); out.push({ x, y, pi, vi, edit: true, curve: true, smooth: !!nd.s, key: nkey(id, pi, vi) }); });
        else vertexIdx(pl).forEach(vi => { const [x, y] = frameWorld(fr, pl.pts[vi]); out.push({ x, y, pi, vi, edit: true, key: nkey(id, pi, vi) }); });
      });
      return out;
    }
    for (const it of worldCache.get(id) || []) for (const pl of it.polys || []) vertexIdx(pl).forEach(i => out.push({ x: pl.pts[i][0], y: pl.pts[i][1] }));
    return out;
  }
  const anyEditable = () => [...sel].some(id => nodeShow.has(id) && importFrame(byId(id)) && !importFrame(byId(id)).rotated);
  function drawNodes() {
    const px = 1 / view.s, hs = 7 * px;
    for (const id of sel) {
      if (!nodeShow.has(id)) continue;
      const pts = nodeList(id), step = Math.max(1, Math.ceil(pts.length / 2500));
      for (let i = 0; i < pts.length; i += step) {
        const q = pts[i], on = q.key && nodeSel.has(q.key), hov = nodeHover && nodeHover.kind === 'node' && nodeHover.key === q.key, h2 = (on || hov) ? hs * 1.35 : hs;
        svgEl('rect', { x: r4(q.x - h2 / 2), y: r4(q.y - h2 / 2), width: r4(h2), height: r4(h2), class: 'node-pt' + (q.edit ? ' edit' : '') + (on ? ' on' : '') + (hov ? ' hov' : ''), 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      }
    }
    drawBezHandles();
    if (nodeHover && (nodeHover.kind === 'seg' || nodeHover.kind === 'cseg')) { // "+" para añadir un punto sobre el borde
      const [x, y] = nodeHover.pt, r = 6 * px;
      svgEl('circle', { cx: r4(x), cy: r4(y), r: r4(r), class: 'node-add', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      svgEl('path', { d: `M${r4(x - r * 0.5)} ${r4(y)}H${r4(x + r * 0.5)}M${r4(x)} ${r4(y - r * 0.5)}V${r4(y + r * 0.5)}`, class: 'node-add-plus', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
    if (drag && drag.mode === 'nmarq') {
      const b = rectFrom(drag.start, drag.cur);
      svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'marquee', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
  }
  function toggleNodes(id) {
    sel = new Set([id]);
    if (nodeShow.has(id)) { nodeShow.delete(id); nodeSel.clear(); nodeHover = null; msg('Puntos ocultos.'); }
    else {
      nodeShow.add(id);
      const n = nodeList(id), s = byId(id), editable = n.some(q => q.edit);
      msg(`${n.length} puntos en «${(s || {}).name || 'la figura'}». ` + (editable
        ? 'Haz clic en un punto para elegirlo (Shift suma, o arrastra un recuadro) y arrástralo; clic sobre el borde añade un punto; Supr borra los elegidos; flechas los mueven poco a poco (Shift: más); Esc oculta.'
        : (CONVERTIBLE.has(s && s.type) || SEPARABLE.has(s && s.type)) ? 'Si arrastras un punto, la figura se convierte en piezas/dibujo editable (te lo pregunta antes).' : 'Pasa el cursor sobre uno para ver sus coordenadas.'));
    }
    buildInspector(); buildObjects(); drawCanvas();
  }
  function nodeNear(p) {
    let best = null, bd = 10 / view.s;
    for (const id of sel) {
      if (!nodeShow.has(id)) continue;
      for (const q of nodeList(id)) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = { ...q, id, kind: 'node' }; } }
    }
    return best;
  }
  // Punto más cercano sobre un borde de un dibujo editable (para añadir un punto)
  function segNear(p) {
    let best = null, bd = 8 / view.s;
    for (const id of sel) {
      if (!nodeShow.has(id)) continue;
      const fr = importFrame(byId(id));
      if (!fr || fr.rotated) continue;
      fr.a.polys.forEach((pl, pi) => {
        if (fr.a.curves && fr.a.curves[pi]) return;
        const n = pl.pts.length, last = pl.closed ? n : n - 1;
        for (let i = 0; i < last; i++) {
          const A = frameWorld(fr, pl.pts[i]), B = frameWorld(fr, pl.pts[(i + 1) % n]);
          const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
          if (!L2) continue;
          const t = Math.max(0, Math.min(1, ((p.x - A[0]) * dx + (p.y - A[1]) * dy) / L2)), X = A[0] + t * dx, Y = A[1] + t * dy, d = Math.hypot(p.x - X, p.y - Y);
          if (d < bd && t > 0.02 && t < 0.98) { bd = d; best = { kind: 'seg', id, pi, si: i, pt: [X, Y] }; }
        }
      });
    }
    return best;
  }
  // Convierte una figura paramétrica sencilla en un dibujo con puntos editables (en el mismo lugar)
  function convertToEditable(s) {
    const ev = evalCache.get(s.id);
    if (!ev) return null;
    const polys = [], texts = [];
    for (const it of ev.items) { for (const pl of it.polys) polys.push({ closed: pl.closed, pts: pl.pts, op: it.op }); for (const t of it.texts) texts.push({ ...t, op: it.op }); }
    if (!polys.length) return null;
    const o = importObject(s.name || 'Figura', polys, texts), list = listOf(s.id), i = list.indexOf(s);
    if (i < 0) return null;
    o.op = s.op;
    list.splice(i, 1, o);
    nodeShow.delete(s.id); nodeShow.add(o.id); sel = new Set([o.id]);
    return o;
  }
  // Si otras figuras comparten el dibujo, esta recibe su propia copia antes de cambiarlo
  function ownAsset(s) {
    if (allShapes().some(x => x !== s && x.type === 'import' && x.p.asset === s.p.asset)) {
      const nid = 'a' + uid();
      doc.assets[nid] = JSON.parse(JSON.stringify(doc.assets[s.p.asset]));
      s.p.asset = nid;
    }
  }
  const nodeParts = k => { const [id, pi, vi] = k.split('|'); return { id, pi: +pi, vi: +vi }; };
  // Prepara el arrastre de los puntos elegidos (si el punto tocado no estaba elegido, queda como único elegido)
  function startNodeDrag(hit, shift) {
    let s = byId(hit.id);
    if (!hit.edit) {
      if (!s) return null;
      if (SEPARABLE.has(s.type)) {
        // Cajas, macetas, canastas, conos: se separan en piezas sueltas y se edita el punto en la pieza que se tocó
        if (!confirm(`Para mover puntos, «${s.name}» se separa en piezas independientes (la pared, la base, etc.) y deja de cambiar con los parámetros. Deshacer la vuelve atrás. ¿Continuar?`)) return null;
        separateMany([s]);
        const ids = [...sel];
        for (const i of ids) nodeShow.add(i);
        let best = null, bd = Infinity;
        for (const i of ids) for (const q of nodeList(i)) { if (!q.edit) continue; const d = Math.hypot(q.x - hit.x, q.y - hit.y); if (d < bd) { bd = d; best = { ...q, id: i, kind: 'node' }; } }
        return best ? startNodeDrag(best, false) : null;
      }
      if (!CONVERTIBLE.has(s.type)) { msg('Los puntos de esta figura no se pueden mover.'); return null; }
      if (!confirm('Para mover puntos, esta figura se convierte en un dibujo editable y deja de cambiar con los parámetros. Deshacer la vuelve atrás. ¿Continuar?')) return null;
      const o = convertToEditable(s);
      if (!o) return null;
      fullRender();
      const q = nodeList(o.id).reduce((m, c) => !m || Math.hypot(c.x - hit.x, c.y - hit.y) < Math.hypot(m.x - hit.x, m.y - hit.y) ? c : m, null);
      return q ? startNodeDrag({ ...q, id: o.id, kind: 'node' }, false) : null;
    }
    if (shift) { nodeSel.has(hit.key) ? nodeSel.delete(hit.key) : nodeSel.add(hit.key); drawOverlay(); return null; }
    if (!nodeSel.has(hit.key)) { nodeSel.clear(); nodeSel.add(hit.key); }
    const items = [];
    for (const k of nodeSel) {
      const { id, pi, vi } = nodeParts(k), sh = byId(id);
      if (!sh) continue;
      ownAsset(sh);
      const fr = importFrame(sh), pl = fr && fr.a.polys[pi];
      const cvx = fr && fr.a.curves && fr.a.curves[pi];
      if (cvx) { const nd = cvx.n[vi]; if (nd) items.push({ id, pi, vi, curve: true, u: nd.p[0], v: nd.p[1] }); continue; }
      if (!pl || !pl.pts[vi]) continue;
      const p0 = pl.pts[vi];
      const same = pl.pts.map((q, i) => i).filter(i => Math.abs(pl.pts[i][0] - p0[0]) < 1e-9 && Math.abs(pl.pts[i][1] - p0[1]) < 1e-9);
      items.push({ id, pi, same, u: p0[0], v: p0[1] });
    }
    return { mode: 'node', items, anchor: { x: hit.x, y: hit.y }, start: null, moved: false };
  }
  function moveNodeItems(items, du, dv) {
    const redo = new Map();
    for (const it of items) {
      const fr = importFrame(byId(it.id));
      if (!fr) continue;
      if (it.curve) { fr.a.curves[it.pi].n[it.vi].p = [it.u + du, it.v + dv]; redo.set(it.id + '|' + it.pi, [fr.a, it.pi]); continue; }
      const pl = fr.a.polys[it.pi];
      for (const i of it.same) pl.pts[i] = [it.u + du, it.v + dv, ...(pl.pts[i][2] ? [1] : [])];
    }
    for (const [a, pi] of redo.values()) reflat(a, pi);
  }
  function applyNodeDrag(d, p, e) {
    const s0 = byId(d.items[0] && d.items[0].id), fr = importFrame(s0);
    if (!fr) return;
    // Imán suave: el punto se pega a la cuadrícula solo cuando está muy cerca (a ~5 px); si no, se mueve libre y sin saltos
    const soft = v => { const q = snapV(v, e); return Math.abs(q - v) * view.s < 5 ? q : v; };
    const t = { x: soft(d.anchor.x + (p.x - d.start.x)), y: soft(d.anchor.y + (p.y - d.start.y)) };
    moveNodeItems(d.items, (t.x - d.anchor.x) / fr.w, (t.y - d.anchor.y) / fr.sy);
    d.moved = true;
    $('#stCoords').textContent = `Punto  x ${fmt(t.x / unitMM, isInch() ? 3 : 2)} · y ${fmt(t.y / unitMM, isInch() ? 3 : 2)} ${unitLabel()}`;
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; evaluateParams(); drawCanvas(); }); // un redibujado por cuadro
  }
  // Añade un punto sobre un borde y lo deja elegido, listo para arrastrarlo
  function insertNode(seg) {
    const s = byId(seg.id);
    ownAsset(s);
    if (seg.kind === 'cseg') {
      const fr0 = importFrame(s), cv = fr0.a.curves[seg.pi], ni = splitBezSeg(cv, seg.si, seg.t);
      reflat(fr0.a, seg.pi);
      nodeSel.clear(); nodeSel.add(nkey(seg.id, seg.pi, ni));
      evaluateParams(); drawCanvas();
      return { id: seg.id, edit: true, curve: true, x: seg.pt[0], y: seg.pt[1], key: nkey(seg.id, seg.pi, ni) };
    }
    const fr = importFrame(s), pl = fr.a.polys[seg.pi];
    pl.pts.splice(seg.si + 1, 0, [(seg.pt[0] - fr.x) / fr.w, (seg.pt[1] - fr.y) / fr.sy, 1]);
    nodeSel.clear(); nodeSel.add(nkey(seg.id, seg.pi, seg.si + 1));
    evaluateParams(); drawCanvas();
    return { id: seg.id, edit: true, x: seg.pt[0], y: seg.pt[1], key: nkey(seg.id, seg.pi, seg.si + 1) };
  }
  function deleteNodes() {
    if (!nodeSel.size) return false;
    const by = new Map();
    for (const k of nodeSel) { const { id, pi, vi } = nodeParts(k), kk = id + '|' + pi; if (!by.has(kk)) by.set(kk, { id, pi, vs: [] }); by.get(kk).vs.push(vi); }
    let removed = 0, kept = 0;
    for (const { id, pi, vs } of by.values()) {
      const s = byId(id); if (!s) continue;
      ownAsset(s);
      const fr = importFrame(s), pl = fr.a.polys[pi], min = pl.closed ? 3 : 2, cv = fr.a.curves && fr.a.curves[pi];
      if (cv) {
        for (const vi of vs.sort((a, b) => b - a)) { if (cv.n.length > min) { cv.n.splice(vi, 1); removed++; } else kept++; }
        reflat(fr.a, pi);
        continue;
      }
      for (const vi of vs.sort((a, b) => b - a)) { if (pl.pts.length > min) { pl.pts.splice(vi, 1); removed++; } else kept++; }
    }
    nodeSel.clear(); nodeHover = null;
    if (removed) { checkpoint(); fullRender(); }
    msg(removed ? `${removed} punto(s) borrado(s).` + (kept ? ' Algunos no se borraron: la figura necesita al menos 3 puntos (2 si es una línea).' : '') : 'No se pueden borrar: la figura necesita al menos 3 puntos (2 si es una línea).');
    return true;
  }
  function nudgeNodes(dx, dy) {
    const items = [], seen = new Set();
    for (const k of nodeSel) {
      const { id, pi, vi } = nodeParts(k), sh = byId(id), fr = sh && importFrame(sh);
      if (!fr) continue;
      ownAsset(sh);
      const cvn = fr.a.curves && fr.a.curves[pi];
      if (cvn) { const nd = cvn.n[vi]; if (nd) { const sig = id + '|' + pi + '|c' + vi; if (!seen.has(sig)) { seen.add(sig); items.push({ id, pi, vi, curve: true, u: nd.p[0], v: nd.p[1] }); } } continue; }
      const pl = importFrame(sh).a.polys[pi], p0 = pl && pl.pts[vi];
      if (!p0) continue;
      const same = pl.pts.map((q, i) => i).filter(i => Math.abs(pl.pts[i][0] - p0[0]) < 1e-9 && Math.abs(pl.pts[i][1] - p0[1]) < 1e-9);
      const sig = id + '|' + pi + '|' + same.join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      items.push({ id, pi, same, u: p0[0], v: p0[1] });
    }
    if (!items.length) return;
    const fr = importFrame(byId(items[0].id));
    moveNodeItems(items, dx / fr.w, dy / fr.sy);
    checkpoint(); fullRender();
  }
  // Selecciona los puntos que caen dentro de un recuadro
  function selectNodesIn(b, add) {
    if (!add) nodeSel.clear();
    for (const id of sel) {
      if (!nodeShow.has(id)) continue;
      for (const q of nodeList(id)) if (q.edit && q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) nodeSel.add(q.key);
    }
  }
  function updateNodeHover(p) {
    if (!nodeShow.size) { if (nodeHover) { nodeHover = null; drawOverlay(); } return; }
    const n = nodeNear(p), h = n || bezHandleNear(p) && { kind: 'bez' } || segNear(p) || csegNear(p);
    const same = (!h && !nodeHover) || (h && nodeHover && h.kind === nodeHover.kind && (h.kind === 'bez' ? true : h.kind === 'node' ? h.key === nodeHover.key : h.id === nodeHover.id && h.pi === nodeHover.pi && h.si === nodeHover.si && Math.hypot(h.pt[0] - nodeHover.pt[0], h.pt[1] - nodeHover.pt[1]) * view.s < 1));
    nodeHover = h;
    svg.style.cursor = h ? (h.kind === 'seg' || h.kind === 'cseg' ? 'copy' : 'pointer') : '';
    if (!same) drawOverlay();
  }

  /* ================= Reglas, guías e imán a objetos ================= */
  const RULER = 18;
  const rulerTop = $('#rulerTop'), rulerLeft = $('#rulerLeft');
  let guideDrag = null, snapLines = null;
  function niceRulerStep(pxPerUnit) {
    const base = isInch() ? [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 20, 50] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    return base.find(b => b * pxPerUnit >= 64) || base[base.length - 1];
  }
  function drawRulers() {
    if (!rulerTop || !rulerLeft) return;
    const dpr = window.devicePixelRatio || 1, W = stage.clientWidth, H = stage.clientHeight;
    const css = getComputedStyle(document.documentElement), fg = css.getPropertyValue('--muted').trim() || '#667', bg = css.getPropertyValue('--panel').trim() || '#fff', line = css.getPropertyValue('--border').trim() || '#ccd';
    const step = niceRulerStep(view.s * unitMM), minor = isInch() ? step / (step >= 1 ? 5 : 4) : step / 5;
    const draw = (cv, horizontal) => {
      const len2 = horizontal ? W - RULER : H - RULER, thick = RULER;
      cv.width = Math.max(1, Math.round((horizontal ? len2 : thick) * dpr)); cv.height = Math.max(1, Math.round((horizontal ? thick : len2) * dpr));
      cv.style.width = (horizontal ? len2 : thick) + 'px'; cv.style.height = (horizontal ? thick : len2) + 'px';
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height);
      c.strokeStyle = fg; c.fillStyle = fg; c.lineWidth = 1; c.font = '10px -apple-system, sans-serif';
      const v0 = (horizontal ? view.x : view.y) / unitMM, v1 = v0 + (len2 + RULER) / view.s / unitMM;
      const pos = v => ((v * unitMM) - (horizontal ? view.x : view.y)) * view.s - RULER;
      for (let v = Math.floor(v0 / minor) * minor; v <= v1 + 1e-9; v += minor) {
        const q = pos(v);
        if (q < -1 || q > len2 + 1) continue;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        c.beginPath();
        if (horizontal) { c.moveTo(q + 0.5, thick); c.lineTo(q + 0.5, thick - (major ? 10 : 4)); } else { c.moveTo(thick, q + 0.5); c.lineTo(thick - (major ? 10 : 4), q + 0.5); }
        c.stroke();
        if (major) {
          const label = fmt(v, isInch() ? 3 : 1);
          if (horizontal) c.fillText(label, q + 3, 9);
          else { c.save(); c.translate(9, q + 3); c.rotate(-Math.PI / 2); c.fillText(label, -c.measureText(label).width - 2, 0); c.restore(); }
        }
      }
      c.strokeStyle = line; c.beginPath();
      if (horizontal) { c.moveTo(0, thick - 0.5); c.lineTo(len2, thick - 0.5); } else { c.moveTo(thick - 0.5, 0); c.lineTo(thick - 0.5, len2); }
      c.stroke();
    };
    draw(rulerTop, true); draw(rulerLeft, false);
  }
  function drawGuides() {
    const gs = doc.guides || [];
    if (!gs.length && !snapLines) return;
    const vw = stage.clientWidth / view.s, vh = stage.clientHeight / view.s;
    for (const g of gs) svgEl('path', { d: g.axis === 'x' ? `M${r4(g.pos)} ${r4(view.y)}V${r4(view.y + vh)}` : `M${r4(view.x)} ${r4(g.pos)}H${r4(view.x + vw)}`, class: 'guide-line', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    if (snapLines) {
      if (snapLines.x != null) svgEl('path', { d: `M${r4(snapLines.x)} ${r4(view.y)}V${r4(view.y + vh)}`, class: 'snap-line', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      if (snapLines.y != null) svgEl('path', { d: `M${r4(view.x)} ${r4(snapLines.y)}H${r4(view.x + vw)}`, class: 'snap-line', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
  }
  function guideAt(p) {
    let best = null, bd = 4 / view.s;
    for (const g of doc.guides || []) { const d = Math.abs((g.axis === 'x' ? p.x : p.y) - g.pos); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  // Arrastrar desde una regla crea una guía; arrastrarla de vuelta a la regla la borra
  for (const [el, axis] of [[rulerLeft, 'x'], [rulerTop, 'y']]) {
    if (!el) continue;
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      const p = toWorld(e), g = { id: uid(), axis, pos: axis === 'x' ? p.x : p.y };
      (doc.guides = doc.guides || []).push(g);
      guideDrag = { g, el };
      drawOverlay();
    });
    el.addEventListener('pointermove', e => {
      if (!guideDrag) return;
      const p = toWorld(e), v = axis === 'x' ? p.x : p.y;
      guideDrag.g.pos = snapOn(e) ? snapV(v, e) : v;
      drawOverlay();
    });
    const up = e => {
      if (!guideDrag) return;
      const r = svg.getBoundingClientRect(), g = guideDrag.g, onRuler = axis === 'x' ? e.clientX - r.left < RULER : e.clientY - r.top < RULER;
      guideDrag = null;
      if (onRuler) doc.guides = doc.guides.filter(x => x !== g);
      checkpoint(); drawOverlay(); buildInspector();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  // Líneas a las que se pega lo que arrastras: guías, bordes, centros de las otras figuras y la hoja
  let guideSnapCache = { sig: '', xs: [], ys: [] };
  function snapCands(exclude) {
    const sig = evalVersion + '|' + [...exclude].sort().join(',') + '|' + (doc.guides || []).map(g => g.axis + g.pos).join(',') + '|' + doc.sheet.w + 'x' + doc.sheet.h;
    if (guideSnapCache.sig === sig) return guideSnapCache;
    const xs = [0, doc.sheet.w / 2, doc.sheet.w], ys = [0, doc.sheet.h / 2, doc.sheet.h];
    for (const g of doc.guides || []) (g.axis === 'x' ? xs : ys).push(g.pos);
    for (const [id, r] of evalCache) {
      const shx = byId(id);
      if (exclude.has(id) || !r.bbox || (shx && shx.hidden)) continue;
      const b = r.bbox;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    guideSnapCache = { sig, xs, ys };
    return guideSnapCache;
  }
  const nearestLine = (list, v, tol) => { let best = null, bd = tol; for (const l of list) { const d = Math.abs(l - v); if (d < bd) { bd = d; best = l; } } return best; };
  // Mueve la selección: sus bordes y su centro se pegan a las líneas de referencia; si no hay ninguna cerca, a la cuadrícula
  function snapMoveDelta(d, dx, dy, e) {
    snapLines = null;
    if (!snapOn(e)) return [dx, dy];
    const b = d.bbox0, c = snapCands(new Set(sel)), tol = 7 / view.s;
    let rx = null, ry = null;
    if (b) {
      for (const off of [0, b.w / 2, b.w]) { const L = nearestLine(c.xs, b.x + off + dx, tol); if (L !== null && (rx === null || Math.abs(L - (b.x + off + dx)) < Math.abs(rx.L - rx.pos))) rx = { L, pos: b.x + off + dx }; }
      for (const off of [0, b.h / 2, b.h]) { const L = nearestLine(c.ys, b.y + off + dy, tol); if (L !== null && (ry === null || Math.abs(L - (b.y + off + dy)) < Math.abs(ry.L - ry.pos))) ry = { L, pos: b.y + off + dy }; }
    }
    const nx = rx ? dx + (rx.L - rx.pos) : snapV(dx, e), ny = ry ? dy + (ry.L - ry.pos) : snapV(dy, e);
    if (rx || ry) snapLines = { x: rx ? rx.L : null, y: ry ? ry.L : null };
    return [nx, ny];
  }
  function guidesSection() {
    const gs = doc.guides || [];
    const axisSel = h('select', { 'aria-label': 'Tipo de guía' }, h('option', { value: 'x' }, 'Vertical (x)'), h('option', { value: 'y' }, 'Horizontal (y)'));
    const posIn = h('input', { type: 'number', step: 'any', value: '0', 'aria-label': 'Posición de la guía' });
    return h('div', { class: 'guides-box' }, h('div', { class: 'insp-sub' }, 'Guías'),
      h('p', { class: 'tip' }, 'Arrastra desde la regla de arriba o de la izquierda para crear una guía; las figuras se pegan a ellas. Arrástrala de vuelta a la regla para borrarla.'),
      ...gs.map(g => h('div', { class: 'guide-row' }, h('span', {}, `${g.axis === 'x' ? 'Vertical' : 'Horizontal'} · ${fmt(g.pos / unitMM, isInch() ? 3 : 2)} ${unitLabel()}`),
        h('button', { class: 'icon-btn del', 'aria-label': 'Borrar guía', onclick: () => { doc.guides = doc.guides.filter(x => x !== g); checkpoint(); drawOverlay(); buildInspector(); } }, '×'))),
      h('div', { class: 'btn-grid' }, axisSel, posIn),
      h('div', { class: 'btn-grid' },
        h('button', { onclick: () => { const v = parseFloat(posIn.value); if (!Number.isFinite(v)) return; (doc.guides = doc.guides || []).push({ id: uid(), axis: axisSel.value, pos: v * unitMM }); checkpoint(); drawOverlay(); buildInspector(); } }, 'Añadir guía'),
        gs.length ? h('button', { class: 'danger', onclick: () => { doc.guides = []; checkpoint(); drawOverlay(); buildInspector(); } }, 'Borrar todas') : null));
  }

  /* ----- Curvas Bézier: puntos suaves con manijas y herramienta Pluma ----- */
  // Los dibujos importados guardan sus trazos como polilíneas (a.polys). Un trazo curvo guarda además sus nodos
  // en a.curves[indice] = { closed, n: [{ p: [u, v], i: [du, dv] | null, o: [du, dv] | null, s: suave }] } y a.polys se recalcula de ahí.
  const r6 = v => Math.round(v * 1e6) / 1e6;
  function flattenBez(nodes, closed, sc) {
    const n = nodes.length, out = [], segN = closed ? n : n - 1;
    for (let i = 0; i < segN; i++) {
      const A = nodes[i], B = nodes[(i + 1) % n], P0 = A.p, P3 = B.p;
      const c1 = A.o ? [P0[0] + A.o[0], P0[1] + A.o[1]] : P0, c2 = B.i ? [P3[0] + B.i[0], P3[1] + B.i[1]] : P3;
      out.push([P0[0], P0[1]]);
      if (A.o || B.i) {
        const ln = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(6, Math.min(80, Math.ceil(Math.sqrt(Math.max(ln(P0, P3), ln(P0, c1) + ln(c1, c2) + ln(c2, P3)) * sc) * 4)));
        for (let k = 1; k < steps; k++) {
          const t = k / steps, m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
          out.push([a * P0[0] + b * c1[0] + c * c2[0] + d * P3[0], a * P0[1] + b * c1[1] + c * c2[1] + d * P3[1]]);
        }
      }
    }
    if (!closed && n) out.push([nodes[n - 1].p[0], nodes[n - 1].p[1]]);
    return out;
  }
  const bezAt = (A, B, t) => {
    const P0 = A.p, P3 = B.p, c1 = A.o ? [P0[0] + A.o[0], P0[1] + A.o[1]] : P0, c2 = B.i ? [P3[0] + B.i[0], P3[1] + B.i[1]] : P3, m = 1 - t;
    return [0, 1].map(k => m * m * m * P0[k] + 3 * m * m * t * c1[k] + 3 * m * t * t * c2[k] + t * t * t * P3[k]);
  };
  function reflat(a, pi) {
    const cv = a.curves && a.curves[pi];
    if (cv) a.polys[pi].pts = flattenBez(cv.n, cv.closed, a.realW || 1).map(([u, v]) => [r6(u), r6(v)]);
  }
  // Un trazo normal pasa a curva (cada punto es un nodo con esquina); devuelve null si tiene demasiados puntos
  function toCurve(a, pi) {
    a.curves = a.curves || {};
    if (a.curves[pi]) return a.curves[pi];
    const pl = a.polys[pi];
    let pts = pl.pts.map(q => [q[0], q[1]]);
    if (pl.closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
    if (pts.length > 150) return null;
    a.curves[pi] = { closed: !!pl.closed, n: pts.map(p => ({ p, i: null, o: null, s: false })) };
    return a.curves[pi];
  }
  // Suavizar o volver esquina los puntos elegidos
  function smoothSelected(smooth) {
    if (!nodeSel.size) { msg('Elige primero uno o más puntos (clic, o un recuadro).'); return; }
    let done = 0, tooMany = 0;
    for (const k of [...nodeSel]) {
      const { id, pi, vi } = nodeParts(k), sh = byId(id);
      if (!sh) continue;
      ownAsset(sh);
      const fr = importFrame(sh);
      if (!fr) continue;
      const cv = toCurve(fr.a, pi);
      if (!cv) { tooMany++; continue; }
      const n = cv.n, nd = n[vi];
      if (!nd) continue;
      if (smooth) {
        const prev = cv.closed || vi > 0 ? n[(vi - 1 + n.length) % n.length] : null, next = cv.closed || vi < n.length - 1 ? n[(vi + 1) % n.length] : null;
        const dist = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
        const dir = prev && next ? [next.p[0] - prev.p[0], next.p[1] - prev.p[1]] : next ? [next.p[0] - nd.p[0], next.p[1] - nd.p[1]] : prev ? [nd.p[0] - prev.p[0], nd.p[1] - prev.p[1]] : [1, 0];
        const dl = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / dl, dir[1] / dl];
        // manijas en la dirección de la curva, de un tercio del largo de cada tramo vecino
        nd.i = prev ? [-u[0] * dist(nd, prev) / 3, -u[1] * dist(nd, prev) / 3] : null;
        nd.o = next ? [u[0] * dist(nd, next) / 3, u[1] * dist(nd, next) / 3] : null;
        nd.s = true;
      } else { nd.i = null; nd.o = null; nd.s = false; }
      reflat(fr.a, pi);
      done++;
    }
    if (done) { checkpoint(); fullRender(); msg(smooth ? 'Punto(s) suavizado(s): arrastra las manijas para curvar.' : 'Punto(s) convertido(s) en punta.'); }
    else if (tooMany) msg('Esta figura tiene demasiados puntos para curvarla punto a punto (más de 150). Usa «Pluma» (N) para dibujar tu propia curva.');
  }
  // Manijas de los nodos elegidos (solo en trazos curvos)
  function bezHandlesOf(id) {
    const out = [], fr = importFrame(byId(id));
    if (!fr || fr.rotated || !fr.a.curves) return out;
    for (const k of nodeSel) {
      const q = nodeParts(k);
      if (q.id !== id) continue;
      const cv = fr.a.curves[q.pi], nd = cv && cv.n[q.vi];
      if (!nd) continue;
      const base = frameWorld(fr, nd.p);
      for (const which of ['i', 'o']) if (nd[which]) { const [x, y] = frameWorld(fr, [nd.p[0] + nd[which][0], nd.p[1] + nd[which][1]]); out.push({ id, pi: q.pi, vi: q.vi, which, x, y, bx: base[0], by: base[1] }); }
    }
    return out;
  }
  function drawBezHandles() {
    const px = 1 / view.s;
    for (const id of sel) {
      if (!nodeShow.has(id)) continue;
      for (const hd of bezHandlesOf(id)) {
        svgEl('path', { d: `M${r4(hd.bx)} ${r4(hd.by)}L${r4(hd.x)} ${r4(hd.y)}`, class: 'bez-line', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
        svgEl('circle', { cx: r4(hd.x), cy: r4(hd.y), r: r4(4.5 * px), class: 'bez-handle', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      }
    }
  }
  function bezHandleNear(p) {
    let best = null, bd = 9 / view.s;
    for (const id of sel) if (nodeShow.has(id)) for (const hd of bezHandlesOf(id)) { const d = Math.hypot(hd.x - p.x, hd.y - p.y); if (d < bd) { bd = d; best = hd; } }
    return best;
  }
  function startBezDrag(hd) { ownAsset(byId(hd.id)); return { mode: 'bez', hd: { id: hd.id, pi: hd.pi, vi: hd.vi, which: hd.which }, moved: false }; }
  function applyBezDrag(d, p, e) {
    const fr = importFrame(byId(d.hd.id));
    if (!fr) return;
    const cv = fr.a.curves[d.hd.pi], nd = cv.n[d.hd.vi], other = d.hd.which === 'i' ? 'o' : 'i';
    const hv = [(p.x - fr.x) / fr.w - nd.p[0], (p.y - fr.y) / fr.sy - nd.p[1]];
    nd[d.hd.which] = hv;
    if (nd.s && !e.altKey) { // nodo suave: la otra manija queda en línea recta, con su mismo largo
      const L = Math.hypot(hv[0], hv[1]) || 1e-9, lo = nd[other] ? Math.hypot(nd[other][0], nd[other][1]) : L;
      nd[other] = [-hv[0] / L * lo, -hv[1] / L * lo];
    } else if (e.altKey) nd.s = false;
    reflat(fr.a, d.hd.pi);
    d.moved = true;
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; evaluateParams(); drawCanvas(); });
  }
  // Punto más cercano sobre un tramo curvo (para añadir un punto sin cambiar la forma)
  function csegNear(p) {
    let best = null, bd = 8 / view.s;
    for (const id of sel) {
      if (!nodeShow.has(id)) continue;
      const fr = importFrame(byId(id));
      if (!fr || fr.rotated || !fr.a.curves) continue;
      for (const [pis, cv] of Object.entries(fr.a.curves)) {
        const pi = +pis, n = cv.n, last = cv.closed ? n.length : n.length - 1;
        for (let i = 0; i < last; i++) for (let k = 1; k < 24; k++) {
          const t = k / 24, q = frameWorld(fr, bezAt(n[i], n[(i + 1) % n.length], t)), d = Math.hypot(q[0] - p.x, q[1] - p.y);
          if (d < bd) { bd = d; best = { kind: 'cseg', id, pi, si: i, t, pt: q }; }
        }
      }
    }
    return best;
  }
  function splitBezSeg(cv, i, t) {
    const n = cv.n, A = n[i], B = n[(i + 1) % n.length], P0 = A.p, P3 = B.p;
    const P1 = A.o ? [P0[0] + A.o[0], P0[1] + A.o[1]] : P0, P2 = B.i ? [P3[0] + B.i[0], P3[1] + B.i[1]] : P3;
    const lp = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
    const Q0 = lp(P0, P1), Q1 = lp(P1, P2), Q2 = lp(P2, P3), R0 = lp(Q0, Q1), R1 = lp(Q1, Q2), M = lp(R0, R1);
    const straight = !A.o && !B.i;
    A.o = straight ? null : sub(Q0, P0); B.i = straight ? null : sub(Q2, P3);
    n.splice(i + 1, 0, { p: M, i: straight ? null : sub(R0, M), o: straight ? null : sub(R1, M), s: !straight });
    return i + 1;
  }

  // ----- Pluma: clic = punto de esquina, arrastrar = punto suave; clic en el primer punto cierra; Enter o doble clic termina -----
  const pen = { nodes: [], cur: null };
  function penCancel() { pen.nodes = []; pen.cur = null; }
  function penFinish(closed) {
    const nodes = pen.nodes;
    if (nodes.length < 2) { penCancel(); drawOverlay(); return; }
    const pts = flattenBez(nodes, closed, 1);
    const o = importObject(nextName('Curva'), [{ closed, op: 'corte', pts }], []);
    const a = doc.assets[o.p.asset], W = a.realW;
    a.curves = { 0: { closed, n: nodes.map(nd => ({ p: [(nd.p[0] - a.ox) / W, (nd.p[1] - a.oy) / W], i: nd.i ? [nd.i[0] / W, nd.i[1] / W] : null, o: nd.o ? [nd.o[0] / W, nd.o[1] / W] : null, s: !!nd.s })) } };
    reflat(a, 0);
    doc.shapes.push(o);
    penCancel();
    sel = new Set([o.id]); nodeShow.add(o.id); nodeSel.clear();
    setTool('select');
    checkpoint(); fullRender();
    msg('Curva creada. Arrastra los puntos o sus manijas para ajustarla; «Suavizar» y «Punta» están en el panel.');
  }
  function drawPen() {
    if (tool !== 'pen' || !pen.nodes.length) return;
    const px = 1 / view.s, preview = pen.nodes.slice();
    if (pen.cur && !(drag && drag.mode === 'pen')) preview.push({ p: [pen.cur.x, pen.cur.y], i: null, o: null });
    const pts = flattenBez(preview, false, 1);
    svgEl('path', { d: pathD([{ closed: false, pts }]), class: 'preview', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    pen.nodes.forEach((nd, i) => {
      const hs = 7 * px;
      svgEl('rect', { x: r4(nd.p[0] - hs / 2), y: r4(nd.p[1] - hs / 2), width: r4(hs), height: r4(hs), class: 'node-pt edit' + (i === 0 ? ' on' : ''), 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      if (i === pen.nodes.length - 1) for (const w of ['i', 'o']) if (nd[w]) {
        const x = nd.p[0] + nd[w][0], y = nd.p[1] + nd[w][1];
        svgEl('path', { d: `M${r4(nd.p[0])} ${r4(nd.p[1])}L${r4(x)} ${r4(y)}`, class: 'bez-line', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
        svgEl('circle', { cx: r4(x), cy: r4(y), r: r4(4 * px), class: 'bez-handle', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      }
    });
  }
  // Herramientas de curvas en el panel de la figura (cuando se ven sus puntos)
  function nodeToolsSection() {
    return [h('div', { class: 'insp-sub' }, 'Puntos y curvas'),
      h('p', { class: 'tip' }, 'Elige uno o varios puntos (clic, Shift o recuadro). «Suavizar» crea manijas para curvar; arrástralas. Alt mientras arrastras una manija rompe la curva en punta.'),
      h('div', { class: 'btn-grid' },
        h('button', { class: 'primary', onclick: () => smoothSelected(true), title: 'Convierte los puntos elegidos en curva suave' }, 'Suavizar'),
        h('button', { onclick: () => smoothSelected(false), title: 'Quita las manijas: el punto vuelve a ser una esquina' }, 'Punta'),
        h('button', { onclick: () => { if (nodeSel.size) deleteNodes(); else msg('Elige primero los puntos que quieres borrar.'); } }, 'Borrar punto'),
        h('button', { onclick: () => { for (const id of [...sel]) nodeShow.delete(id); nodeSel.clear(); buildInspector(); drawCanvas(); } }, 'Ocultar puntos'))];
  }

  /* ----- Texto en arco: flecha para encorvarlo más o menos arrastrando ----- */
  function textArcInfo(s) {
    if (!s || s.type !== 'text' || !['arriba', 'abajo'].includes(s.p.curva)) return null;
    const str = String(s.p.texto || '');
    if (!str) return null;
    const x = len(s, 'x'), y = len(s, 'y'), size = Math.abs(len(s, 'tam', 10)), track = s.p.espaciado && String(s.p.espaciado).trim() ? len(s, 'espaciado') : 0;
    const chars = [...str], total = chars.reduce((a, c) => a + measureTextWidth(c, size, s.p.fuente), 0) + track * (chars.length - 1);
    const R = Math.max(size * 0.8, Math.abs(s.p.radioC && String(s.p.radioC).trim() ? len(s, 'radioC') : 40));
    if (![x, y, size, total, R].every(Number.isFinite) || !(total > 0)) return null;
    const top = s.p.curva === 'arriba', cx = x + total / 2;
    return { x, y, size, total, R, cx, cy: top ? y + R : y - R, top, arcDeg: Math.min(360, total / R / DEG) };
  }
  // Flechas ↕ en los dos extremos del texto: jálalas hacia abajo (o hacia arriba, si el arco va por abajo) para encorvarlo más
  const ARC_OFF = 0.9; // la flecha queda debajo de la línea base, a esta distancia (en tamaños de letra)
  function arcEnds(a) {
    const th = Math.min(Math.PI, a.total / 2 / a.R), dx = a.R * Math.sin(th), y = a.top ? a.cy - a.R * Math.cos(th) : a.cy + a.R * Math.cos(th);
    return [[a.cx - dx, y], [a.cx + dx, y]];
  }
  function drawArcHandle() {
    if (tool !== 'select' || sel.size !== 1) return;
    const s = byId([...sel][0]), a = textArcInfo(s);
    if (!a) return;
    const px = 1 / view.s;
    arcEnds(a).forEach(([x, y], i) => {
      const g = svgEl('g', { 'data-arc': s.id, class: 'arc-handle', transform: `translate(${r4(x)} ${r4(y + a.size * ARC_OFF)}) scale(${r4(px)})` }, layerOverlay);
      svgEl('circle', { r: 12 }, g);
      svgEl('path', { d: 'M0 -8L-4.5 -2.5H4.5ZM0 8L-4.5 2.5H4.5Z', class: 'arc-arrow' }, g);
    });
  }
  function startArcDrag(id) { return { mode: 'arc', id, moved: false }; }
  // Con el largo del texto fijo (arco) y cuánto baja el extremo, se calcula el radio
  function radiusForDrop(half, drop) {
    if (drop < 0.3) return 2000;
    const g = th => half * (1 - Math.cos(th)) / th;
    if (drop >= g(Math.PI)) return half / Math.PI;
    let lo = 1e-4, hi = Math.PI;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; g(mid) < drop ? lo = mid : hi = mid; }
    return half / ((lo + hi) / 2);
  }
  function applyArcDrag(d, p) {
    const s = byId(d.id), a = textArcInfo(s);
    if (!a) return;
    const target = p.y - a.size * ARC_OFF, drop = a.top ? target - a.y : a.y - target;
    s.p.radioC = fmt(Math.max(a.size * 0.8, Math.min(2000, radiusForDrop(a.total / 2, drop))) / unitMM, isInch() ? 3 : 2);
    d.moved = true;
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; evaluateParams(); drawCanvas(); });
    $('#stCoords').textContent = `Arco de ${fmt(textArcInfo(s).arcDeg, 0)}° · radio ${s.p.radioC} ${unitLabel()}`;
  }
  function bendText(s, factor) {
    const a = textArcInfo(s);
    if (!a) return;
    s.p.radioC = fmt(Math.max(a.size * 0.8, Math.min(2000, a.R * factor)) / unitMM, isInch() ? 3 : 2);
    checkpoint(); fullRender();
  }

  function drawOverlay() {
    layerOverlay.replaceChildren();
    drawGuides();
    const pad = 3 / view.s;
    for (const id of sel) {
      const items = worldCache.get(id);
      if (!items) continue;
      const b = bboxOfItems(items);
      if (!b) continue;
      if (!evalCache.has(id)) renderItems(items, svgEl('g', { class: 'child-sel' }, layerOverlay), ' child', false);
      svgEl('rect', { x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, class: 'sel-box', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
    drawNodes();
    drawHandles();
    if (drag && drag.mode === 'marquee') {
      const b = rectFrom(drag.start, drag.cur);
      svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'marquee', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
    if (drag && drag.mode === 'draw') {
      const it = primitive(shapeFromDrag(drag.start, drag.cur, false));
      if (it && it.polys.length) svgEl('path', { d: pathD(it.polys), class: 'preview', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
    drawArcHandle();
    drawPen();
    drawMeasures();
  }

  const rectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

  /* ================= Medir (como la regla de xTool) ================= */
  // Dos modos: entre dos puntos (se pega a esquinas, centros, puntos medios y bordes) y "ranura o contorno"
  // (un clic mide el ancho y alto reales de la figura, aunque esté girada). Las medidas se quedan en el diseño.
  let evalVersion = 0;
  let measureMode = 'two';
  const meas = { a: null, cur: null, snap: null, hover: null };
  const snapCache = { version: -1, polys: [], centers: [] };

  function circleOf(pts) {
    if (pts.length < 12) return null;
    const c = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length], [0, 0]);
    const rs = pts.map(q => Math.hypot(q[0] - c[0], q[1] - c[1])), mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    return mean > 0 && (Math.max(...rs) - Math.min(...rs)) / mean < 0.012 ? { c, r: mean } : null;
  }
  function snapData() {
    if (snapCache.version === evalVersion) return snapCache;
    const polys = [], centers = [];
    for (const r of evalCache.values()) for (const it of r.items) for (const pl of it.polys) {
      polys.push(pl);
      if (pl.closed) { const ci = circleOf(pl.pts); if (ci) centers.push(ci.c); }
    }
    Object.assign(snapCache, { version: evalVersion, polys, centers });
    return snapCache;
  }
  function snapAt(p, tol) {
    const { polys, centers } = snapData();
    let bd = tol, bp = null;
    for (const pl of polys) for (const q of pl.pts) { const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < bd) { bd = d; bp = q; } }
    if (bp) return { pt: bp, kind: 'esquina' };
    for (const c of centers) { const d = Math.hypot(c[0] - p.x, c[1] - p.y); if (d < bd) { bd = d; bp = c; } }
    if (bp) return { pt: bp, kind: 'centro' };
    let md = tol * 0.9, mp = null, ed = tol, ep = null;
    for (const pl of polys) {
      const pts = pl.pts, n = pts.length, last = pl.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dm = Math.hypot(mx - p.x, my - p.y);
        if (dm < md) { md = dm; mp = [mx, my]; }
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2)), qx = a[0] + dx * t, qy = a[1] + dy * t, de = Math.hypot(qx - p.x, qy - p.y);
        if (de < ed) { ed = de; ep = [qx, qy]; }
      }
    }
    if (mp) return { pt: mp, kind: 'medio' };
    if (ep) return { pt: ep, kind: 'borde' };
    return null;
  }
  function measurePoint(e, p) {
    if (e.shiftKey && meas.a) { // Shift: recto (horizontal o vertical)
      return { pt: Math.abs(p.x - meas.a[0]) >= Math.abs(p.y - meas.a[1]) ? [p.x, meas.a[1]] : [meas.a[0], p.y], kind: 'recto' };
    }
    if (e.altKey) return { pt: [p.x, p.y], kind: '' };
    return snapAt(p, 10 / view.s) || { pt: [p.x, p.y], kind: '' };
  }
  // Contorno cerrado más pequeño que contiene el punto (una ranura, un agujero o la pieza completa)
  function contourAt(p) {
    let best = null, ba = Infinity;
    for (const pl of snapData().polys) {
      if (!pl.closed || pl.pts.length < 3) continue;
      const b = polyBox(pl.pts);
      if (p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) continue;
      const a = (b[2] - b[0]) * (b[3] - b[1]);
      if (a < ba && inPoly([p.x, p.y], pl.pts)) { best = pl; ba = a; }
    }
    return best;
  }
  // Rectángulo mínimo que contiene la figura (mide bien aunque esté girada)
  function minRect(pts) {
    const P = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    const hull = lo.slice(0, -1).concat(up.slice(0, -1));
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), sn = Math.sin(ang);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const q of hull) { const u = q[0] * c + q[1] * sn, v = -q[0] * sn + q[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) best = { area, ang, u0, u1, v0, v1 };
    }
    if (!best) return null;
    const c = Math.cos(best.ang), sn = Math.sin(best.ang), back = (u, v) => [u * c - v * sn, u * sn + v * c];
    return { w: best.u1 - best.u0, h: best.v1 - best.v0, corners: [back(best.u0, best.v0), back(best.u1, best.v0), back(best.u1, best.v1), back(best.u0, best.v1)] };
  }
  function contourInfo(pl) {
    const ci = pl.closed ? circleOf(pl.pts) : null;
    if (ci) return { circle: true, c: ci.c, d: 2 * ci.r };
    const r = minRect(pl.pts);
    return r ? { circle: false, w: Math.min(r.w, r.h), h: Math.max(r.w, r.h), corners: r.corners } : null;
  }

  const vTxt = v => `${fmt(v / unitMM, isInch() ? 3 : 2)} ${unitLabel()}`;                    // en la unidad del diseño
  const vAlt = v => isInch() ? `${fmt(v, 2)} mm` : `${fmt(v / 25.4, 3)} in`;                  // en la otra unidad
  // Texto de cada medida (para el lienzo y la lista)
  function measureText(m) {
    if (m.kind === 'dos') {
      const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1], L = Math.hypot(dx, dy);
      return { main: vTxt(L), alt: vAlt(L), detail: `Δx ${vTxt(Math.abs(dx))} · Δy ${vTxt(Math.abs(dy))} · ${fmt(Math.atan2(-dy, dx) / DEG, 1)}°` };
    }
    const pl = contourAt({ x: m.p[0], y: m.p[1] }), info = pl && contourInfo(pl);
    if (!info) return { main: 'sin contorno', alt: '', detail: 'Ya no hay una figura en ese punto.' };
    return info.circle
      ? { main: `Ø ${vTxt(info.d)}`, alt: `Ø ${vAlt(info.d)}`, detail: 'Diámetro del círculo' }
      : { main: `${fmt(info.w / unitMM, isInch() ? 3 : 2)} × ${vTxt(info.h)}`, alt: `${isInch() ? fmt(info.w, 2) : fmt(info.w / 25.4, 3)} × ${vAlt(info.h)}`, detail: 'Ancho × largo del contorno (se actualiza si cambias las medidas)' };
  }

  function drawLabel(parent, x, y, main, alt, rot = 0) {
    const px = 1 / view.s, fs = 12 * px;
    const t = svgEl('text', { x: 0, y: 0, 'font-size': fs, 'text-anchor': 'middle', class: 'meas-label', style: `stroke-width:${r4(3 * px)}px`, transform: `translate(${r4(x)} ${r4(y)}) rotate(${r4(rot)})` }, parent);
    svgEl('tspan', { x: 0 }, t).textContent = main;
    if (alt) { const b = svgEl('tspan', { x: 0, dy: fs * 1.2, class: 'meas-sub', 'font-size': fs * 0.85 }, t); b.textContent = alt; }
  }
  function drawMeasure(m, parent, preview) {
    const px = 1 / view.s, cls = 'meas-line' + (preview ? ' dash' : '');
    if (m.kind === 'dos') {
      const [ax, ay] = m.a, [bx, by] = m.b, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      svgEl('path', { d: `M${r4(ax)} ${r4(ay)}L${r4(bx)} ${r4(by)}`, class: cls, 'vector-effect': 'non-scaling-stroke' }, parent);
      for (const [x, y] of [m.a, m.b]) svgEl('circle', { cx: r4(x), cy: r4(y), r: 3 * px, class: 'meas-dot' }, parent);
      if (L < 1e-6) return;
      const ux = dx / L, uy = dy / L; let nx = -uy, ny = ux;
      if (ny > 0) { nx = -nx; ny = -ny; }                   // la etiqueta queda por encima de la línea
      const tk = 6 * px;
      for (const [x, y] of [m.a, m.b]) svgEl('path', { d: `M${r4(x - uy * tk)} ${r4(y + ux * tk)}L${r4(x + uy * tk)} ${r4(y - ux * tk)}`, class: 'meas-line', 'vector-effect': 'non-scaling-stroke' }, parent);
      let ang = Math.atan2(dy, dx) / DEG; if (ang > 90 || ang < -90) ang += 180;
      const mt = measureText(m);
      drawLabel(parent, (ax + bx) / 2 + nx * 24 * px, (ay + by) / 2 + ny * 24 * px, mt.main, mt.alt, ang);
      return;
    }
    const pl = contourAt({ x: m.p[0], y: m.p[1] });
    const info = pl && contourInfo(pl);
    if (!info) return;
    const mt = measureText(m);
    if (info.circle) {
      svgEl('circle', { cx: r4(info.c[0]), cy: r4(info.c[1]), r: r4(info.d / 2), class: cls, 'vector-effect': 'non-scaling-stroke' }, parent);
      svgEl('path', { d: `M${r4(info.c[0] - info.d / 2)} ${r4(info.c[1])}L${r4(info.c[0] + info.d / 2)} ${r4(info.c[1])}`, class: 'meas-line', 'vector-effect': 'non-scaling-stroke' }, parent);
      drawLabel(parent, info.c[0], info.c[1] - info.d / 2 - 16 * px, mt.main, mt.alt);
    } else {
      svgEl('path', { d: pathD([{ closed: true, pts: info.corners }]), class: cls, 'vector-effect': 'non-scaling-stroke' }, parent);
      const top = Math.min(...info.corners.map(q => q[1])), cx = info.corners.reduce((a, q) => a + q[0] / 4, 0);
      drawLabel(parent, cx, top - 16 * px, mt.main, mt.alt);
    }
  }
  function drawMeasures() {
    const g = svgEl('g', { class: 'measures' }, layerOverlay);
    for (const m of doc.measures || []) drawMeasure(m, g, false);
    if (tool !== 'measure') return;
    if (measureMode === 'two' && meas.cur) {
      if (meas.a) drawMeasure({ kind: 'dos', a: meas.a, b: meas.cur }, g, true);
      const px = 1 / view.s;
      svgEl('circle', { cx: r4(meas.cur[0]), cy: r4(meas.cur[1]), r: 7 * px, class: 'meas-snap' }, g);
      svgEl('path', { d: `M${r4(meas.cur[0] - 11 * px)} ${r4(meas.cur[1])}L${r4(meas.cur[0] + 11 * px)} ${r4(meas.cur[1])}M${r4(meas.cur[0])} ${r4(meas.cur[1] - 11 * px)}L${r4(meas.cur[0])} ${r4(meas.cur[1] + 11 * px)}`, class: 'meas-line' }, g);
      if (meas.snap && meas.snap.kind) {
        const t = svgEl('text', { x: r4(meas.cur[0] + 10 * px), y: r4(meas.cur[1] - 10 * px), 'font-size': 11 * px, class: 'meas-label meas-sub', style: `stroke-width:${r4(3 * px)}px` }, g);
        t.textContent = meas.snap.kind;
      }
    } else if (measureMode === 'shape' && meas.hover) {
      const info = contourInfo(meas.hover);
      if (info) drawMeasure({ kind: 'forma', p: meas.cur }, g, true);
    }
  }
  function measureMove(e, p) {
    if (measureMode === 'shape') { meas.cur = [p.x, p.y]; meas.hover = contourAt(p); }
    else { const sp = measurePoint(e, p); meas.cur = sp.pt; meas.snap = sp; }
    drawOverlay();
  }
  function measureClick(e, p) {
    if (measureMode === 'shape') {
      if (!contourAt(p)) { msg('Haz clic dentro de una ranura, un agujero o una pieza.'); return; }
      addMeasure({ kind: 'forma', p: [p.x, p.y] });
    } else {
      const sp = measurePoint(e, p);
      if (!meas.a) { meas.a = sp.pt; msg('Ahora haz clic en el segundo punto (Shift = recto, Alt = sin imán, Esc = cancelar).'); drawOverlay(); }
      else { const a = meas.a; meas.a = null; addMeasure({ kind: 'dos', a, b: sp.pt }); }
    }
  }
  function addMeasure(m) {
    doc.measures = doc.measures || [];
    doc.measures.push({ id: uid(), ...m });
    checkpoint(); fullRender();
    const mt = measureText(m);
    msg(`Medida: ${mt.main} (${mt.alt || mt.detail})`);
  }
  function setMeasureMode(mode) {
    measureMode = mode; meas.a = null; meas.hover = null;
    $('#btnMeasTwo').classList.toggle('active', mode === 'two');
    $('#btnMeasShape').classList.toggle('active', mode === 'shape');
    drawOverlay();
  }
  function buildMeasures() {
    const ul = $('#measureList');
    if (!ul) return;
    ul.replaceChildren();
    const list = doc.measures || [];
    if (!list.length) { ul.append(h('li', { class: 'empty' }, 'Aún no hay medidas. Usa la herramienta Medir (M) y haz clic en una ranura o entre dos puntos.')); return; }
    list.forEach((m, i) => {
      const mt = measureText(m);
      ul.append(h('li', { title: mt.detail }, h('span', { class: 'meas-item' }, h('strong', {}, `${i + 1} · ${mt.main}`), h('span', { class: 'meas-det' }, `${mt.alt}${mt.alt ? ' · ' : ''}${mt.detail}`)),
        h('button', { class: 'icon-btn del', 'aria-label': 'Borrar medida ' + (i + 1), title: 'Borrar esta medida', onclick: () => { doc.measures.splice(i, 1); checkpoint(); fullRender(); } }, '×')));
    });
  }

  /* ----- Controles sobre el lienzo: esquinas para escalar, círculo para girar ----- */
  // Solo objetos principales (no los de adentro de un grupo)
  const handleTargets = () => [...sel].filter(id => evalCache.has(id)).map(byId).filter(Boolean);
  function selectionBox() {
    const ts = handleTargets();
    return ts.length ? unionBox(ts.map(s => bboxOfItems(worldCache.get(s.id) || []))) : null;
  }
  function drawHandles() {
    if (drag && (drag.mode === 'move' || drag.mode === 'marquee' || drag.mode === 'draw' || drag.mode === 'pan')) return;
    const ts = handleTargets();
    const b = selectionBox();
    if (!ts.length || !b) return;
    if (ts.some(t => nodeShow.has(t.id))) return; // con los puntos visibles se editan puntos, no se escala
    if (ts.some(t => t.locked)) return;
    const px = 1 / view.s, hs = 9 * px, pad = 3 * px;
    const canScale = ts.every(s => SCALABLE.has(s.type));
    const canRotate = ts.every(s => s.type !== 'line');
    const x0 = b.x - pad, y0 = b.y - pad, x1 = b.x + b.w + pad, y1 = b.y + b.h + pad;
    if (canRotate) {
      const cx = (x0 + x1) / 2, ry = y0 - 26 * px;
      svgEl('path', { d: `M${cx} ${y0}V${ry}`, class: 'handle-line', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      svgEl('circle', { cx, cy: ry, r: 6 * px, class: 'handle rot', 'data-handle': 'rot', 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
    }
    if (canScale) {
      for (const [name, x, y] of [['nw', x0, y0], ['ne', x1, y0], ['se', x1, y1], ['sw', x0, y1]]) {
        svgEl('rect', { x: x - hs / 2, y: y - hs / 2, width: hs, height: hs, class: 'handle ' + name, 'data-handle': name, 'vector-effect': 'non-scaling-stroke' }, layerOverlay);
      }
    }
  }
  function startHandleDrag(kind, p) {
    const ts = handleTargets(), b = selectionBox();
    if (!b) return null;
    const orig = ts.map(s => ({ s, p: { ...s.p } })), params = doc.params.map(q => q.expr);
    const C = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (kind === 'rot') {
      // Centro de cada objeto (para girar varios juntos alrededor del centro común)
      const centers = ts.map(s => { const bb = bboxOfItems(worldCache.get(s.id) || []); return { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 }; });
      return { mode: 'rotate', C, a0: Math.atan2(p.y - C.y, p.x - C.x), orig, centers };
    }
    // La esquina opuesta queda fija
    const A = { x: kind.includes('w') ? b.x + b.w : b.x, y: kind.includes('n') ? b.y + b.h : b.y };
    return { mode: 'scale', A, start: p, orig, params };
  }
  function applyHandleDrag(d, p, e) {
    for (const o of d.orig) o.s.p = { ...o.p };
    if (d.params) d.params.forEach((ex, i) => { if (doc.params[i]) doc.params[i].expr = ex; });
    if (d.mode === 'scale') {
      const v0 = { x: d.start.x - d.A.x, y: d.start.y - d.A.y }, v = { x: p.x - d.A.x, y: p.y - d.A.y };
      let k = (v.x * v0.x + v.y * v0.y) / ((v0.x * v0.x + v0.y * v0.y) || 1);
      k = Math.max(0.02, k);
      if (!e.altKey) k = Math.round(k * 100) / 100; // pasos de 1 %
      rewriteScale(d.orig.map(o => o.s), null, d.A.x / unitMM, d.A.y / unitMM, k);
      syncParamInputs();
      $('#stCoords').textContent = `Escala ${fmt(k * 100, 0)} %`;
    } else {
      let deg = (Math.atan2(p.y - d.C.y, p.x - d.C.x) - d.a0) / DEG;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(deg * 10) / 10;
      const a = deg * DEG, c = Math.cos(a), sn = Math.sin(a);
      d.orig.forEach((o, i) => {
        const s = o.s;
        s.p.rot = shiftExpr(o.p.rot || '0', deg);
        if (d.orig.length > 1) {
          // Mueve el centro de cada objeto alrededor del centro común
          const q = d.centers[i], dx = q.x - d.C.x, dy = q.y - d.C.y;
          const nx = d.C.x + dx * c - dy * sn, ny = d.C.y + dx * sn + dy * c;
          moveShape(s, { ...s.p }, nx - q.x, ny - q.y);
        }
      });
      $('#stCoords').textContent = `Giro ${fmt(deg, 1)}°` + (e.shiftKey ? '' : ' (Shift: de 15° en 15°)');
    }
    d.changed = true;
    evaluateParams(); drawCanvas();
  }

  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    return { x: view.x + (e.clientX - r.left) / view.s, y: view.y + (e.clientY - r.top) / view.s };
  }
  const snapOn = e => snap && !(e && e.altKey);
  // Paso del imán en mm (doc.grid está en unidades del documento)
  const gridMM = () => doc.grid * unitMM;
  const snapV = (v, e) => snapOn(e) ? Math.round(v / gridMM()) * gridMM() : v;
  const snapPt = (p, e) => {
    if (!snapOn(e)) return { x: p.x, y: p.y };
    const c = snapCands(new Set(sel)), tol = 7 / view.s, lx = nearestLine(c.xs, p.x, tol), ly = nearestLine(c.ys, p.y, tol);
    return { x: lx !== null ? lx : snapV(p.x, e), y: ly !== null ? ly : snapV(p.y, e) };
  };

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
    const handle = tool === 'select' && e.target.closest && e.target.closest('[data-handle]');
    const arcH = tool === 'select' && e.target.closest && e.target.closest('[data-arc]');
    if (arcH) { drag = startArcDrag(arcH.dataset.arc); drag.start = p; return; }
    if (tool === 'select' && !handle && nodeShow.size) {
      const bh = bezHandleNear(p);
      if (bh) { drag = startBezDrag(bh); drag.start = p; return; }
      const hit = nodeNear(p) || segNear(p) || csegNear(p);
      if (hit) {
        let d = null;
        if (hit.kind === 'seg' || hit.kind === 'cseg') d = startNodeDrag(insertNode(hit), false);
        else d = startNodeDrag(hit, e.shiftKey);
        if (d) { d.start = p; drag = d; }
        return;
      }
      if (anyEditable() && !(e.target.closest && e.target.closest('[data-id]'))) {
        drag = { mode: 'nmarq', start: p, cur: p, add: e.shiftKey, had: nodeSel.size > 0 };
        return;
      }
    }
    if (handle) {
      drag = startHandleDrag(handle.dataset.handle, p);
      return;
    }
    if (tool === 'select') {
      const gh = !handle && guideAt(p);
      if (gh) { drag = { mode: 'guide', g: gh, del: false }; return; }
      const hit = e.target.closest && e.target.closest('[data-id]');
      const id = hit && hit.dataset.id;
      const dbl = isDoubleClick(e, id);
      if (dbl && enterGroup(id, p)) {
        drag = { mode: 'move', start: p, moved: false, orig: [...sel].map(byId).filter(Boolean).map(s => ({ s, p: { ...s.p } })) };
        return;
      }
      if (dbl && id) { toggleNodes(sel.size === 1 && topOf([...sel][0]) && topOf([...sel][0]).id === id ? [...sel][0] : id); return; }
      if (id) {
        // Si hay un hijo de este grupo seleccionado (desde la lista o con doble clic), se mueve el hijo.
        const insideSel = [...sel].some(sid => sid !== id && topOf(sid) && topOf(sid).id === id);
        if (e.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
        else if (!sel.has(id) && !insideSel) sel = new Set([id]);
        drag = { mode: 'move', start: p, moved: false, bbox0: selectionBox(), orig: [...sel].map(byId).filter(s => s && !s.locked).map(s => ({ s, p: { ...s.p } })) };
        buildInspector(); buildObjects(); drawCanvas();
      } else {
        drag = { mode: 'marquee', start: p, cur: p, base: e.shiftKey ? new Set(sel) : new Set() };
        if (!e.shiftKey && sel.size) { sel.clear(); buildInspector(); buildObjects(); drawCanvas(); }
      }
    } else if (tool === 'pen') {
      e.preventDefault();
      const now = performance.now();
      if (pen.last && now - pen.last.t < 350 && Math.hypot(e.clientX - pen.last.x, e.clientY - pen.last.y) < 6 && pen.nodes.length >= 2) { penFinish(false); return; }
      pen.last = { t: now, x: e.clientX, y: e.clientY };
      if (pen.nodes.length >= 3 && Math.hypot(pen.nodes[0].p[0] - p.x, pen.nodes[0].p[1] - p.y) * view.s < 9) { penFinish(true); return; }
      const q = snapPt(p, e);
      pen.nodes.push({ p: [q.x, q.y], i: null, o: null, s: false });
      drag = { mode: 'pen', start: p };
      drawOverlay();
    } else if (tool === 'measure') {
      e.preventDefault();
      measureClick(e, p);
    } else if (tool === 'text') {
      // Evita que el navegador le quite el foco al campo "Texto" después del clic (así se puede escribir enseguida)
      e.preventDefault();
      const q = snapPt(p, e);
      const d = defaultsFor('text');
      addShape({ id: uid(), type: 'text', name: '', op: d.op, p: { texto: 'Evergreen', x: fmt(q.x / unitMM), y: fmt(q.y / unitMM), tam: nice(10), rot: '0' } });
      const focusText = () => { const f = $('#inspector input[data-key="texto"]'); if (f) { f.focus(); f.select(); } };
      focusText();
      setTimeout(focusText, 0);
      msg('Escribe el texto en Propiedades → Texto (o usa el botón {{nombre}} para nombres por lote).');
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
    if (tool === 'measure' && !drag) measureMove(e, p);
    if (tool === 'pen' && !drag && pen.nodes.length) { pen.cur = { x: p.x, y: p.y }; drawOverlay(); }
    if (!drag && nodeShow.size) {
      updateNodeHover(p);
      const q = nodeHover && nodeHover.kind === 'node' && nodeHover;
      if (q) $('#stCoords').textContent = `Punto  x ${fmt(q.x / unitMM, isInch() ? 3 : 2)} · y ${fmt(q.y / unitMM, isInch() ? 3 : 2)} ${unitLabel()}`;
    }
    if (!drag) return;
    if (drag.mode === 'pan') {
      view.x = drag.vx - (e.clientX - drag.sx) / view.s;
      view.y = drag.vy - (e.clientY - drag.sy) / view.s;
      drawCanvas();
    } else if (drag.mode === 'guide') {
      const r = svg.getBoundingClientRect(), v = drag.g.axis === 'x' ? p.x : p.y;
      drag.g.pos = snapOn(e) ? snapV(v, e) : v;
      drag.del = drag.g.axis === 'x' ? e.clientX - r.left < RULER : e.clientY - r.top < RULER;
      drawOverlay();
    } else if (drag.mode === 'arc') {
      applyArcDrag(drag, p);
    } else if (drag.mode === 'bez') {
      applyBezDrag(drag, p, e);
    } else if (drag.mode === 'pen') {
      const nd = pen.nodes[pen.nodes.length - 1], hv = [p.x - nd.p[0], p.y - nd.p[1]];
      if (Math.hypot(hv[0], hv[1]) * view.s > 4) { nd.o = hv; nd.i = [-hv[0], -hv[1]]; nd.s = true; } else { nd.o = null; nd.i = null; nd.s = false; }
      drawOverlay();
    } else if (drag.mode === 'node') {
      applyNodeDrag(drag, p, e);
    } else if (drag.mode === 'nmarq') {
      drag.cur = p; drawOverlay();
    } else if (drag.mode === 'scale' || drag.mode === 'rotate') {
      applyHandleDrag(drag, p, e);
    } else if (drag.mode === 'move') {
      const [dx, dy] = snapMoveDelta(drag, p.x - drag.start.x, p.y - drag.start.y, e);
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.s < 3) return;
      drag.moved = true;
      for (const o of drag.orig) moveShape(o.s, o.p, dx, dy);
      evaluateParams(); drawCanvas();
    } else if (drag.mode === 'marquee') {
      drag.cur = p;
      const m = rectFrom(drag.start, drag.cur);
      sel = new Set(drag.base);
      for (const [id, r] of evalCache) {
        const b = r.bbox, sh = byId(id);
        if (sh && (sh.hidden || sh.locked)) continue;
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
    if (snapLines) { snapLines = null; drawOverlay(); }
    if (d.mode === 'guide') { if (d.del) doc.guides = doc.guides.filter(x => x !== d.g); checkpoint(); drawOverlay(); buildInspector(); }
    else     if (d.mode === 'arc') { if (d.raf) cancelAnimationFrame(d.raf); if (d.moved) { checkpoint(); buildInspector(); } drawCanvas(); }
    else     if (d.mode === 'bez') { if (d.raf) cancelAnimationFrame(d.raf); if (d.moved) { checkpoint(); buildInspector(); } drawCanvas(); }
    else if (d.mode === 'pen') { drawOverlay(); }
    else if (d.mode === 'node') { if (d.raf) cancelAnimationFrame(d.raf); if (d.moved) { checkpoint(); buildInspector(); } drawCanvas(); }
    else if (d.mode === 'nmarq') {
      const b = rectFrom(d.start, d.cur);
      if (b.w * view.s < 4 && b.h * view.s < 4) { if (d.had) { nodeSel.clear(); } else { sel.clear(); nodeHover = null; buildInspector(); buildObjects(); } }
      else selectNodesIn(b, d.add);
      drawCanvas();
    }
    else if (d.mode === 'move' && d.moved) { checkpoint(); buildInspector(); }
    else if ((d.mode === 'scale' || d.mode === 'rotate') && d.changed) { checkpoint(); buildInspector(); drawCanvas(); }
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
    $('#measureBar').hidden = t !== 'measure';
    if (t !== 'pen') penCancel();
    meas.a = null; meas.hover = null; meas.cur = null;
    if (t === 'measure') msg('Medir: haz clic en dos puntos (se pegan a esquinas, centros y bordes) o cambia a "Ranura o contorno".');
    if (doc) drawOverlay();
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

  function cutOrderSection() {
    const sel2 = selectEl({ auto: 'Agujeros primero, pieza por pieza (recomendado)', lista: 'Como están en el diseño' }, doc.cutOrder || 'auto', 'Orden de corte', v => { doc.cutOrder = v; checkpoint(); });
    return h('div', { class: 'cut-order-box' }, h('div', { class: 'insp-sub' }, 'Corte del láser'), propRow('Orden de corte', sel2),
      h('p', { class: 'tip' }, 'Al exportar, el grabado va primero y el corte al final; en el corte, lo de adentro (agujeros, bisagras) antes que el contorno de cada pieza, para que nada se mueva.'),
      h('button', { class: 'wide', onclick: () => withFonts(openSimulation) }, 'Simular el corte (orden y tiempo)'));
  }
  // Resumen del último acomodo y exportación por hoja
  function nestSection() {
    const n = doc.nest;
    if (!n || !n.count) return h('div', { class: 'nest-box' }, h('div', { class: 'insp-sub' }, 'Acomodo de piezas'), h('button', { class: 'wide', onclick: openNest }, 'Acomodar piezas (ahorrar madera)'));
    const area = n.w * n.h, u = v => fmt(v / unitMM, isInch() ? 1 : 0);
    const lines = n.used.map((a, i) => `Hoja ${i + 1}: ${n.pieces[i]} pieza(s), madera usada ${fmt(a / area * 100, 0)} %`);
    return h('div', { class: 'nest-box' }, h('div', { class: 'insp-sub' }, 'Acomodo de piezas'),
      h('p', { class: 'tip' }, `${n.count} hoja(s) de ${u(n.w)} × ${u(n.h)} ${unitLabel()}. ` + lines.join(' · ') + (n.failed && n.failed.length ? `. No caben en la hoja: ${n.failed.join(', ')}.` : '')),
      h('div', { class: 'btn-grid' }, h('button', { onclick: openNest }, 'Volver a acomodar'),
        n.count > 1 ? h('button', { onclick: () => exportSheets('svg') }, 'SVG por hoja') : h('button', { onclick: () => withFonts(exportSVG) }, 'Exportar SVG')),
      n.count > 1 ? h('button', { class: 'wide', onclick: () => exportSheets('dxf') }, 'DXF por hoja') : null);
  }

  // Material: madera + grosor (+ kerf). Escribe los parámetros «grosor» y «kerf», que usan todas las plantillas
  const WOODS = ['Basswood (tilo)', 'Walnut (nogal)', 'Mahogany (caoba)', 'Contrachapado (plywood)', 'Acrílico', 'Otro'];
  const THICKNESSES = [[1.5, '1.5 mm (.059")'], [2, '2 mm (.079")'], [3, '3 mm (.118")'], [3.175, '1/8" (.125")'], [4, '4 mm (.157")'], [5, '5 mm (.197")'], [6, '6 mm (.236")'], [6.2, '6.2 mm (.244")'], [6.35, '1/4" (.250")']];
  function setParamMM(name, mm) {
    const v = fmt(mm / unitMM, isInch() ? 4 : 3);
    const p = doc.params.find(q => q.name === name);
    if (p) p.expr = v; else doc.params.push({ name, expr: v });
    checkpoint(); fullRender();
  }
  /* ================= Biblioteca de materiales (tus valores del láser) ================= */
  const MAT_KEY = 'creaciones-evergreen:materials';
  const BUILTIN_MATS = [
    { id: 'basswood', name: 'Basswood (tilo)', thick: [3, 3.175, 6] }, { id: 'walnut', name: 'Walnut (nogal)', thick: [3, 6] },
    { id: 'mahogany', name: 'Mahogany (caoba)', thick: [3, 6] }, { id: 'abedul', name: 'Contrachapado de abedul (plywood)', thick: [3, 4, 6] },
    { id: 'mdf', name: 'MDF', thick: [3, 6] }, { id: 'bambu', name: 'Bambú', thick: [3] }, { id: 'acrilico', name: 'Acrílico', thick: [2, 3, 5] },
    { id: 'carton', name: 'Cartón / cartulina', thick: [1, 1.5] }, { id: 'cuero', name: 'Cuero', thick: [2] }, { id: 'fieltro', name: 'Fieltro', thick: [3] },
  ];
  const loadMats = () => { try { return JSON.parse(localStorage.getItem(MAT_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const saveMats = m => { try { localStorage.setItem(MAT_KEY, JSON.stringify(m)); return true; } catch (e) { return false; } };
  function allMaterials() {
    const st = loadMats(), out = BUILTIN_MATS.map(m => ({ ...m, ...(st[m.id] || {}), thick: [...new Set([...(m.thick), ...((st[m.id] && st[m.id].thick) || [])])].sort((a, b) => a - b) }));
    for (const [id, m] of Object.entries(st)) if (m.custom && !BUILTIN_MATS.some(b => b.id === id)) out.push({ id, ...m, thick: m.thick || [] });
    return out;
  }
  function currentMaterial() {
    const all = allMaterials();
    return all.find(m => m.id === doc.materialId) || all.find(m => m.name === doc.wood) || null;
  }
  const thickKey = mm => fmt(mm, 2);
  function materialSettings(mat, tMM) { const st = loadMats(), rec = st[mat.id] || {}; return (rec.byThick && rec.byThick[thickKey(tMM)]) || null; }
  // Nota con el material y tus valores, para los archivos que exportas (los programas de corte la ignoran)
  function materialNote() {
    const mat = currentMaterial();
    if (!mat) return '';
    const tMM = vars.grosor !== undefined ? vars.grosor * unitMM : null;
    const set = tMM ? materialSettings(mat, tMM) : null;
    const parts = [`Material: ${mat.name}${tMM ? ' ' + fmt(tMM, 2) + ' mm' : ''}`];
    if (set) for (const op of ['corte', 'grabado', 'marcado']) { const v = set[op]; if (v && (v.p || v.v)) parts.push(`${op}: ${v.p ? v.p + '% ' : ''}${v.v ? v.v + ' mm/s ' : ''}${v.n && v.n > 1 ? v.n + ' pasadas' : ''}`.trim()); }
    if (set && set.notas) parts.push(set.notas.replace(/[-<>&\r\n]+/g, ' '));
    return parts.join(' · ');
  }
  function chooseMaterial(id) {
    const mat = allMaterials().find(m => m.id === id);
    if (!mat) return;
    doc.materialId = id; doc.wood = mat.name;
    const st = loadMats(), rec = st[id] || {};
    const gMM = vars.grosor !== undefined ? vars.grosor * unitMM : null;
    if (rec.kerf > 0) { const q = doc.params.find(p => p.name === 'kerf'); const v = fmt(rec.kerf / unitMM, isInch() ? 4 : 3); if (q) q.expr = v; else doc.params.push({ name: 'kerf', expr: v }); }
    if (mat.thick.length && (gMM === null || !mat.thick.some(t => Math.abs(t - gMM) < 0.01)) && doc.params.some(p => p.name === 'grosor')) {
      const q = doc.params.find(p => p.name === 'grosor'); q.expr = fmt(mat.thick[0] / unitMM, isInch() ? 4 : 3);
    }
    checkpoint(); fullRender();
    msg(`Material: ${mat.name}.` + (rec.kerf > 0 ? ` Kerf ${fmt(rec.kerf, 3)} mm de tu biblioteca.` : ' Aún no guardaste tus valores del láser para él: usa «Mis ajustes del láser…».'));
  }
  function openMaterialDialog(isNew) {
    evaluateParams();
    const st = loadMats();
    let mat = isNew ? null : currentMaterial();
    const tMM = vars.grosor !== undefined ? vars.grosor * unitMM : 3;
    const dialog = h('dialog', { class: 'batch-dialog', 'aria-label': 'Material y ajustes del láser' });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    const name = h('input', { value: mat ? mat.name : '', placeholder: 'Ej.: Cerezo 3 mm' });
    if (mat && BUILTIN_MATS.some(b => b.id === mat.id)) name.disabled = true;
    const thick = h('input', { type: 'number', step: 'any', min: '0.1', value: fmt(tMM / unitMM, isInch() ? 4 : 3) });
    const rec = mat && st[mat.id] || {};
    const kerf = h('input', { type: 'number', step: 'any', min: '0', value: rec.kerf > 0 ? String(fmt(rec.kerf / unitMM, isInch() ? 4 : 3)) : '' , placeholder: isInch() ? '0.004' : '0.1' });
    const cur = mat ? materialSettings(mat, tMM) || {} : {};
    const field = (op, key, ph) => h('input', { type: 'number', step: 'any', min: '0', value: cur[op] && cur[op][key] ? String(cur[op][key]) : '', placeholder: ph, 'aria-label': `${op} ${key}` });
    const rows = { corte: [field('corte', 'p', '%'), field('corte', 'v', 'mm/s'), field('corte', 'n', '1')], grabado: [field('grabado', 'p', '%'), field('grabado', 'v', 'mm/s'), field('grabado', 'n', '1')], marcado: [field('marcado', 'p', '%'), field('marcado', 'v', 'mm/s'), field('marcado', 'n', '1')] };
    const notes = h('textarea', { rows: '3', placeholder: 'Ej.: probado con el soplador al máximo, sale bien con 2 pasadas' }); notes.value = cur.notas || '';
    const status = h('p', { class: 'tip', role: 'status' });
    const table = h('table', { class: 'mat-table' }, h('tr', {}, h('th', {}, ''), h('th', {}, 'Potencia %'), h('th', {}, 'Velocidad mm/s'), h('th', {}, 'Pasadas')),
      ...Object.entries(rows).map(([op, cells]) => h('tr', {}, h('td', {}, op[0].toUpperCase() + op.slice(1)), ...cells.map(c => h('td', {}, c)))));
    const save = h('button', { class: 'primary' }, 'Guardar');
    save.onclick = () => {
      const nm = name.value.trim(), tm = parseFloat(thick.value) * unitMM, km = kerf.value === '' ? 0 : parseFloat(kerf.value) * unitMM;
      if (!nm) { status.textContent = 'Ponle un nombre al material.'; return; }
      if (!(tm > 0)) { status.textContent = 'Escribe el grosor real de la madera.'; return; }
      let id = mat ? mat.id : 'u-' + uid();
      const s2 = loadMats(), r = s2[id] || {};
      if (!BUILTIN_MATS.some(b => b.id === id)) { r.custom = true; r.name = nm; }
      r.thick = [...new Set([...(r.thick || []), +fmt(tm, 2)])].sort((a, b) => a - b);
      if (km > 0) r.kerf = km; else delete r.kerf;
      r.byThick = r.byThick || {};
      const sv = {}; for (const [op, cells] of Object.entries(rows)) { const [p, v, n] = cells.map(c => parseFloat(c.value)); if (p || v || n) sv[op] = { p: p || 0, v: v || 0, n: n || 1 }; }
      if (notes.value.trim()) sv.notas = notes.value.trim();
      if (Object.keys(sv).length) r.byThick[thickKey(tm)] = sv; else delete r.byThick[thickKey(tm)];
      s2[id] = r;
      if (!saveMats(s2)) { status.textContent = 'No se pudo guardar en este navegador.'; return; }
      doc.materialId = id; doc.wood = nm;
      setParamMM('grosor', tm);
      if (km > 0) setParamMM('kerf', km);
      close(); msg(`Guardado «${nm}» (${fmt(tm, 2)} mm). Tus valores se recuerdan en este navegador y salen como nota en los archivos exportados.`);
    };
    const del = mat && !BUILTIN_MATS.some(b => b.id === mat.id) ? h('button', { class: 'danger', onclick: () => { const s2 = loadMats(); delete s2[mat.id]; saveMats(s2); if (doc.materialId === mat.id) doc.materialId = null; close(); fullRender(); msg('Material borrado de tu biblioteca.'); } }, 'Borrar este material') : null;
    dialog.append(h('h2', {}, isNew ? 'Nuevo material' : 'Mis ajustes del láser'),
      h('p', { class: 'tip' }, 'Escribe los valores que TÚ probaste en tu xTool con este material y este grosor. La app los recuerda (en este navegador) y los pone como nota en los SVG y DXF que exportas. Haz siempre una prueba en un recorte antes de cortar la pieza buena.'),
      h('label', {}, 'Material', name), h('div', { class: 'nest-grid' }, h('label', {}, `Grosor real (${unitLabel()})`, thick), h('label', {}, `Kerf medido (${unitLabel()})`, kerf)),
      table, h('label', {}, 'Notas', notes), status, h('div', { class: 'dialog-actions' }, ...(del ? [del] : []), h('button', { onclick: close }, 'Cancelar'), save));
    document.body.append(dialog); dialog.showModal();
  }
  // Plantilla de prueba: ranuras de distinto ancho para medir el kerf de tu madera
  function kerfTestTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    const u = mm => fmt(units === 'in' ? mm / 25.4 : mm, units === 'in' ? 4 : 3);
    d.name = 'Prueba de kerf (ajuste de ranuras)';
    d.params = [['grosor', units === 'in' ? '0.118' : '3']].map(([name, expr]) => ({ name, expr }));
    const deltas = [-0.4, -0.3, -0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05], step = 12, x0 = 12;
    const W = x0 * 2 + (deltas.length - 1) * step, kids = [node('rect', 'Placa', 'corte', { x: '0', y: '0', w: u(W), h: u(60), r: '2', rot: '0' })];
    deltas.forEach((dl, i) => {
      const cx = x0 + i * step;
      kids.push(node('rect', `Ranura ${dl.toFixed(2)}`, 'corte', { x: `${u(cx)} - (grosor + (${u(dl)}))/2`, y: u(22), w: `grosor + (${u(dl)})`, h: u(26), r: '0', rot: '0' }));
    });
    d.shapes = [node('group', 'Placa con ranuras', 'corte', { mode: 'restar', x: '0', y: '0', rot: '0' }, kids)];
    deltas.forEach((dl, i) => d.shapes.push(node('text', `Número ${dl.toFixed(2)}`, 'grabado', { texto: dl.toFixed(2), fuente: 'arial', x: u(x0 + i * step - 4), y: u(16), tam: u(3.5), rot: '0' })));
    d.shapes.push(node('text', 'Instrucción', 'grabado', { texto: 'Prueba tu madera: la ranura donde entra justa da el kerf = -(número)', fuente: 'arial', x: u(3), y: u(56), tam: u(2.6), rot: '0' }));
    return d;
  }

  function materialSection() {
    const gMM = vars.grosor !== undefined ? vars.grosor * unitMM : null;
    const near = THICKNESSES.find(([mm]) => gMM !== null && Math.abs(mm - gMM) < 0.005);
    const opts = { '': gMM === null ? 'Elige el grosor…' : 'Otro grosor' };
    THICKNESSES.forEach(([mm, l]) => { opts[mm] = l; });
    const gIn = h('input', { value: gMM === null ? '' : fmt(gMM / unitMM, isInch() ? 4 : 3), 'aria-label': 'Grosor real' });
    gIn.addEventListener('change', () => { const v = parseFloat(gIn.value); if (v > 0) setParamMM('grosor', v * unitMM); else fullRender(); });
    const kIn = h('input', { value: vars.kerf !== undefined ? fmt(vars.kerf, 4) : '', placeholder: isInch() ? '0.004' : '0.1', 'aria-label': 'Kerf' });
    kIn.addEventListener('change', () => { const v = parseFloat(kIn.value); if (v >= 0) setParamMM('kerf', v * unitMM); else fullRender(); });
    return h('div', { class: 'material-box' },
      h('div', { class: 'insp-sub' }, 'Material'),
      propRow('Material', (() => {
        const cm = currentMaterial(), opts2 = Object.fromEntries(allMaterials().map(m => [m.id, m.name]));
        opts2.__nuevo = '＋ Nuevo material…';
        return selectEl(opts2, cm ? cm.id : '', 'Material', v => { if (v === '__nuevo') { openMaterialDialog(true); fullRender(); } else chooseMaterial(v); });
      })()),
      h('button', { class: 'wide', onclick: () => openMaterialDialog(false), title: 'Guarda la potencia y la velocidad que te funcionaron para este material y grosor' }, 'Mis ajustes del láser…'),
      propRow('Grosor', selectEl(opts, near ? String(near[0]) : '', 'Grosor de la madera', v => { if (v !== '') setParamMM('grosor', parseFloat(v)); })),
      propRow(`Grosor real (${unitLabel()})`, gIn),
      propRow(`Kerf (${unitLabel()})`, kIn),
      (() => { const nt = materialNote(); return nt ? h('p', { class: 'tip' }, nt) : null; })(),
      h('p', { class: 'tip' }, 'Mide tu madera con un calibre y escribe el grosor real. Todas las cajas, dedos y ranuras se recalculan solas con ese grosor. La especie (basswood, walnut, mahogany) no cambia las medidas, solo el grosor; el kerf sí puede variar un poco por madera.'));
  }

  // Resumen de las piezas de cubierta y cuánto crece la caja por fuera
  function coverText(s) {
    const m = modelOf(s, true);
    const cv = m ? m.panels.filter(q => q.name.startsWith('Cubierta')) : [];
    if (!cv.length) return 'Las medidas no alcanzan para la cubierta: revisa su grosor.';
    const c = cv[0].th, u = v => fmt(v / unitMM, isInch() ? 3 : 2), ul = unitLabel();
    return `Piezas de cubierta (grosor ${u(c)} ${ul}) — ` + cv.map(q => `${q.name.replace('Cubierta ', '')}: ${u(q.w)} × ${u(q.h)} ${ul}`).join(' · ')
      + `. La caja crece ${u(c)} ${ul} por cada lado cubierto (hacia afuera), así que mide ${u(2 * c)} ${ul} más en ancho y profundo.`;
  }
  const coverTip = s => h('p', { class: 'tip', id: 'covTip' }, coverText(s));
  function updateCoverTip(s) { const el = $('#covTip'); if (el && s.p.cubierta === 'si') el.textContent = coverText(s); }

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
        guidesSection(),
        cutOrderSection(),
        nestSection(),
        materialSection(),
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
        ...(() => { const f = shapes.find(x => x.from && doc.origins && doc.origins[x.from.gid]); return f ? [h('button', { class: 'wide', onclick: () => restoreOrigin(f.from.gid) }, `Volver a «${f.from.name}» con parámetros`)] : []; })(),
        ...(shapes.some(s => SEPARABLE.has(s.type) || (s.type === 'import' && doc.assets[s.p.asset] && doc.assets[s.p.asset].kind === 'vector' && splitPieces(doc.assets[s.p.asset].polys).length > 1))
          ? [h('button', { class: 'primary wide', onclick: () => separateMany(shapes.filter(s => s.type === 'import' || SEPARABLE.has(s.type))) }, 'Separar en piezas independientes')]
          : []),
        ...(shapes.length >= 4 ? [h('button', { class: 'wide', title: 'Elige qué cara es cada pieza y míralas montadas en 3D', onclick: () => openAssembleDialog(shapes) }, 'Armar como caja en 3D…')] : []),
        ...alignmentSection(shapes),
        ...scaleSection(shapes),
        propRow('Operación', selectEl(OPS, shapes.every(s => s.op === shapes[0].op) ? shapes[0].op : '', 'Operación', v => { shapes.forEach(s => { s.op = v; }); checkpoint(); fullRender(); })),
        h('div', { class: 'insp-sub' }, 'Combinar'),
        sameList
          ? h('div', { class: 'btn-grid' },
            h('button', { onclick: () => groupSel('unir'), title: 'Une las figuras en una sola silueta' }, 'Unir'),
            h('button', { onclick: () => groupSel('restar'), title: 'A la figura de más abajo en la lista le quita las demás (ej. agujeros)' }, 'Restar'),
            h('button', { onclick: () => groupSel('intersectar'), title: 'Deja solo la parte donde se cruzan' }, 'Intersectar'),
            h('button', { onclick: () => groupSel('excluir'), title: 'Deja todo menos la parte donde se cruzan' }, 'Excluir'),
            h('button', { onclick: () => groupSel('grupo'), title: 'Agrupa sin combinar (Ctrl+G)' }, 'Agrupar'))
          : h('p', { class: 'tip' }, 'Para combinar, los objetos deben estar en el mismo nivel.'),
        h('p', { class: 'tip' }, 'Restar: la figura de más abajo en la lista de Objetos es la pieza; las demás se recortan de ella.'),
        h('div', { class: 'insp-actions' },
          h('button', { onclick: duplicateSel }, 'Duplicar'),
          h('button', { onclick: () => copySel(false), title: 'Cmd+C' }, 'Copiar'),
          h('button', { onclick: () => pasteClip(false), title: 'Cmd+V' }, 'Pegar'),
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
    if (nodeShow.has(s.id) && importFrame(s) && !importFrame(s).rotated) box.append(...nodeToolsSection());
    if (s.from && doc.origins && doc.origins[s.from.gid]) {
      box.append(h('div', { class: 'origin-note' },
        h('p', {}, (doc.origins[s.from.gid] && doc.origins[s.from.gid].shape === null) ? `Esta pieza es parte de la caja «${s.from.name}» armada desde un archivo. Puedes verlas montadas en 3D.` : `Esta pieza viene de «${s.from.name}», que se desagrupó. Aquí abajo puedes cambiar los dedos; para otras medidas hay que volver a la caja. También puedes verlas armadas en 3D.`),
        (doc.origins[s.from.gid] && doc.origins[s.from.gid].shape === null) ? null : originFingerEditor(s.from.gid),
        (doc.origins[s.from.gid] && doc.origins[s.from.gid].shape === null) ? null : h('button', { class: 'primary wide', onclick: () => restoreOrigin(s.from.gid) }, `Volver a «${s.from.name}» con parámetros`),
        s.asm ? h('button', { class: 'wide', title: 'Arma las piezas sueltas en 3D; si las agrandas o achicas, el 3D las sigue', onclick: () => open3D(s.from.gid) }, 'Ver las piezas armadas en 3D') : null));
    }
    const isPlainGroup = s.type === 'group' && (s.p.mode || 'grupo') === 'grupo';
    if (!isPlainGroup) box.append(propRow('Operación', selectEl(s.type === 'import' ? IMPORT_OPS : OPS, s.op, 'Operación', v => { s.op = v; checkpoint(); fullRender(); })));

    for (const [key, label0, kind] of TYPES[s.type].props) {
      const label = boxLabel(s, key, label0);
      if (key === 'cubierta' && (s.type === 'box' ? !boxFieldHidden(s, key) : s.type === 'taper')) box.append(h('div', { class: 'insp-sub' }, 'Cubierta de otra madera (chapa por fuera)'));
      if (kind === 'edge') {
        box.append(propRow(label, selectEl(EDGE_OPTS, s.p[key] || 'plano', label, v => { s.p[key] = v; checkpoint(); liveRender(); })));
      } else if (s.type === 'box' && boxFieldHidden(s, key)) {
        continue;
      } else if (s.type === 'import' && key === 'h' && s.p.prop !== 'no') {
        continue;
      } else if (s.type === 'polygon' && key === 'profEst' && s.p.forma !== 'estrella') {
        continue;
      } else if (s.type === 'taper' && taperFieldHidden(s, key)) {
        continue;
      } else if (s.type === 'panel' && ((key === 'dedo' && s.p.dedoModo === 'cantidad') || ((key === 'nH' || key === 'nV') && s.p.dedoModo !== 'cantidad'))) {
        continue;
      } else if (s.type === 'basket' && ((['asaAlto', 'asaArco', 'asaAncho', 'asaTexto'].includes(key) && s.p.asa === 'no') || (key === 'marco' && s.p.frente !== 'si'))) {
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
        if (s.type === 'box' && key === 'pared' && s.p.pared === 'si') {
          // (se muestra el aviso justo después de la lista)
        }
        box.append(propRow(label, selectEl(kind, s.p[key] || Object.keys(kind)[0], label, v => {
          s.p[key] = v;
          if (s.type === 'box' && key === 'dedoModo' && v === 'cantidad') fingerDefaults(s);
          if (s.type === 'panel' && key === 'dedoModo' && v === 'cantidad') panelFingerDefaults(s);
          if (s.type === 'polygon' && key === 'forma' && v === 'estrella' && !s.p.profEst) s.p.profEst = '50';
          if (s.type === 'taper' && key === 'dedoModo' && v === 'cantidad') {
            // misma cantidad de dedos que con el ancho actual, para que la caja no cambie al cambiar de modo
            s.p.dedoModo = 'ancho'; // se calcula con el modo anterior
            const m = taperModel(s, true);
            s.p.dedoModo = 'cantidad';
            if (m) { s.p.nEsq = String((m.taper.nSeg + 1) / 2); s.p.nBaseT = String(Math.max(1, Math.round((Math.min(m.taper.nbW, m.taper.nbD) - 1) / 2))); }
          }
          checkpoint(); fullRender();
        })));
        if (key === 'cubiertaLargas' && (s.type === 'box' || s.type === 'taper')) box.append(coverTip(s));
        if (key === 'dedoModo' && ['taper', 'box', 'panel'].includes(s.type) && s.p.dedoModo !== 'cantidad') {
          box.append(h('p', { class: 'tip' }, 'Para escoger cuántos dedos quieres, cambia a «Por cantidad»: aparecen los campos para escribir la cantidad.'));
        }
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
      } else if (s.type === 'text' && ((key === 'radioC' && !['arriba', 'abajo'].includes(s.p.curva)) || (['trazo', 'desde', 'sepTrazo'].includes(key) && s.p.curva !== 'trazo') || (key === 'espaciado' && (s.p.curva || 'no') === 'no'))) {
        continue;
      } else if (kind === 'shape') {
        const sl = h('select', { 'aria-label': label }, h('option', { value: '' }, 'Elige una figura…'));
        for (const o2 of allShapes()) if (o2.id !== s.id && o2.type !== 'text') sl.append(h('option', { value: o2.id }, o2.name));
        sl.value = s.p[key] || '';
        sl.addEventListener('change', () => { s.p[key] = sl.value; checkpoint(); fullRender(); });
        box.append(propRow(label, sl));
        if (!s.p[key]) box.append(h('p', { class: 'tip' }, 'Dibuja antes una línea, una curva (Pluma) o una figura, y elígela aquí: el texto sigue su recorrido.'));
      } else if (kind === 'font') {
        const sl = h('select', { 'aria-label': label });
        for (const f of FONTS) sl.append(h('option', { value: f.id, style: f.id === 'arial' ? null : `font-family:${fontCss(f.id)}` }, f.name));
        const own = Object.entries(doc.assets || {}).filter(([, a]) => a.kind === 'font');
        if (own.length) {
          const g = h('optgroup', { label: 'Mis tipografías' });
          for (const [id, a] of own) g.append(h('option', { value: id }, a.name));
          sl.append(g);
        }
        sl.append(h('option', { value: '__upload' }, '＋ Cargar tipografía propia (.ttf / .otf)…'));
        sl.value = s.p[key] || 'arial';
        const sampleText = String((key === 'fuente' ? s.p.texto : key === 'asaFuente' ? s.p.asaTexto : s.p.grabadoTexto) || 'Evergreen Love').replace(/\{\{nombre\}\}/g, 'María');
        const sample = h('div', { class: 'font-sample', style: `font-family:${fontCss(s.p[key])}` }, sampleText.slice(0, 40));
        sl.addEventListener('change', () => {
          if (sl.value === '__upload') {
            sl.value = s.p[key] || 'arial';
            pickFont(id => { s.p[key] = id; checkpoint(); fullRender(); });
            return;
          }
          s.p[key] = sl.value;
          loadFont(sl.value);
          checkpoint(); fullRender();
        });
        loadFont(s.p[key]);
        box.append(propRow(label, sl), sample);
      } else if (kind === 'text') {
        const inp = h('input', { value: s.p[key] ?? '', spellcheck: 'false', 'data-key': key, 'aria-label': label, placeholder: key === 'grabadoTexto' ? 'Ej.: Evergreen Love' : null });
        inp.addEventListener('input', () => { s.p[key] = inp.value; liveRender(); });
        inp.addEventListener('change', checkpoint);
        // Botón para poner {{nombre}} (para Nombres por lote) sin escribirlo
        const nameBtn = ['texto', 'grabadoTexto', 'asaTexto'].includes(key) ? h('button', {
          class: 'name-chip', type: 'button', title: 'Pone {{nombre}} en este texto: se reemplaza por cada nombre de la lista en "Nombres por lote"',
          onclick: () => {
            const v = inp.value, start = inp.selectionStart ?? v.length, end = inp.selectionEnd ?? v.length;
            // Si el texto es el de ejemplo, se reemplaza todo; si no, se inserta donde está el cursor
            const before = v.slice(0, start), after = v.slice(end);
            const next = (!v || v === 'Evergreen' || (start === 0 && end === v.length)) ? BATCH_MARKER
              : before + (before && !/\s$/.test(before) ? ' ' : '') + BATCH_MARKER + (after && !/^\s/.test(after) ? ' ' : '') + after;
            inp.value = next; s.p[key] = next;
            checkpoint(); liveRender();
            inp.focus();
            msg('Listo: {{nombre}} se cambiará por cada nombre de tu lista en "Nombres por lote".');
          },
        }, '{{nombre}}') : null;
        box.append(propRow(label, inp, null, nameBtn));
        if (key === 'grabadoTexto' && s.p.cajon === 'si' && Math.round(num(s, 'nCaj', 1)) > 1) {
          box.append(h('p', { class: 'tip' }, 'Un nombre por cajón (de arriba a abajo): sepáralos con ', h('code', {}, '|'), ', por ejemplo ', h('code', {}, 'Hilos | Botones | Agujas'), '.'));
        }
      } else {
        const row = exprRow(s, key, label);
        if (s.type === 'box' && key === 'nCaj') row.querySelector('input').addEventListener('change', () => fullRender());
        if (key === 'redond') row.querySelector('input').placeholder = '0 (sin redondeo)';
        if (s.type === 'taper' && key === 'bandaAnillo') row.querySelector('input').placeholder = 'auto (14 mm)';
        if (s.type === 'taper' && key === 'nAnillos') row.querySelector('input').addEventListener('change', () => fullRender());
        if (s.type === 'box' && key === 'holguraC') row.querySelector('input').placeholder = 'auto (1 mm por lado)';
        if (s.type === 'box' && key === 'grabadoTam') row.querySelector('input').placeholder = 'auto';
        box.append(row);
        if (s.type === 'box' && key === 'nAlto') box.append(h('p', { class: 'tip', id: 'fingerTip' }));
        if (s.type === 'panel' && key === 'nV') box.append(h('p', { class: 'tip', id: 'fingerTip' }));
        if (s.type === 'box' && key === 'pared' && s.p.pared === 'si') box.append(h('p', { class: 'tip' }, 'La bandeja se arma "acostada": el fondo es la pared que se cuelga y el frente queda abierto. Las columnas y filas forman los compartimentos.'));
      }
    }

    // Contorno y repetición
    box.append(h('div', { class: 'insp-sub' }, canOffset(s) ? 'Contorno y repetición' : 'Repetición'));
    if (canOffset(s)) {
      box.append(exprRow(s, 'off', 'Contorno ±'));
      if (!CL) box.append(h('p', { class: 'tip' }, 'No se encontró lib/clipper.js: el contorno está desactivado.'));
    }
    if (!TYPES[s.type].open || s.type === 'hinge') {
      box.append(exprRow(s, 'puentes', 'Puentes (cantidad)'), exprRow(s, 'puenteAncho', 'Ancho de cada puente'));
      if (s.op === 'corte' && Math.round(num(s, 'puentes', 0) || 0) > 0) box.append(h('p', { class: 'tip' }, 'Los puentes son tramos del contorno que el láser no corta, para que la pieza no se mueva. Se rompen con la mano o con un cuchillo. En madera fina usa 3 o 4 puentes de 1 a 2 mm.'));
    }
    box.append(propRow('Repetir', selectEl(REP_OPTS, s.p.rep || 'no', 'Repetir', v => {
      s.p.rep = v; repDefaults(s, v); checkpoint(); fullRender();
    })));
    for (const [key, label] of REP_FIELDS[s.p.rep] || []) box.append(exprRow(s, key, label));

    if (s.type === 'box') { updateCompTip(s); updateFingerTip(s); }
    if (s.type === 'panel') updateFingerTip(s);
    if (s.type === 'text') {
      box.append(h('div', { class: 'insp-sub' }, 'Letras'),
        ...(textArcInfo(s) ? [
          h('p', { class: 'tip' }, `Arco de ${fmt(textArcInfo(s).arcDeg, 0)}°. Jala las flechas ↕ de los extremos del texto (en el lienzo) o usa los botones.`),
          h('div', { class: 'btn-grid' },
            h('button', { onclick: () => bendText(s, 0.8), title: 'Cierra la curva: el radio baja' }, '⌒ Encorvar más'),
            h('button', { onclick: () => bendText(s, 1.25), title: 'Abre la curva: el radio sube' }, '⌣ Encorvar menos'))] : []),
        h('button', { class: 'wide', onclick: () => withFonts(() => openWeldTool(s)), title: 'Une las letras en un solo contorno (cursivas, nombres para llaveros)' }, 'Soldar letras…'),
        h('p', { class: 'tip' }, 'Funciona con las tipografías de la lista (no con Arial del sistema). Convierte el texto en curvas: después ya no se puede cambiar el texto.'));
    }
    if (s.type === 'import') {
      const a = doc.assets && doc.assets[s.p.asset];
      if (a) {
        const pieces = a.kind === 'vector' ? splitPieces(a.polys).length : 1;
        box.append(h('p', { class: 'tip' }, `${a.name} · ${a.kind === 'image' ? 'imagen para grabar' : `${a.polys.length} trazo(s)`}.`
          + (a.kind === 'vector' ? ' Puedes combinarlo con otras figuras (Unir/Restar), darle contorno o repetirlo.' : '')));
        if (a.kind === 'vector' && pieces > 1) {
          box.append(h('button', { class: 'wide', onclick: () => explodeImport(s) }, `Separar en ${pieces} piezas (cada una con sus agujeros)`));
        }
        if (a.kind === 'vector' && pieces === 1) box.append(h('button', { class: 'wide', title: 'Suma una medida al ancho o al alto sin deformar dedos ni ranuras', onclick: () => openStretchDialog(s) }, 'Agrandar sumando una medida…'));
        if (a.kind === 'vector' && pieces >= 4 && pieces <= 40) {
          box.append(h('button', { class: 'primary wide', title: 'Separa el archivo en piezas y te deja elegir qué cara es cada una para verlas montadas', onclick: () => openAssembleDialog([s]) }, 'Armar como caja en 3D…'));
        }
        if (a.kind === 'vector' && a.polys.length > 1 && a.polys.length <= 300) {
          box.append(h('button', { class: 'wide', onclick: () => explodeImport(s, true) }, `Separar cada trazo (${a.polys.length})`));
        }
        if (a.kind === 'image') {
          box.append(h('div', { class: 'insp-sub' }, 'Editar la imagen'),
            h('div', { class: 'btn-grid' },
              h('button', { class: 'primary', onclick: () => openBgTool(s), title: 'Quita el fondo por color o con un pincel' }, 'Quitar fondo…'),
              h('button', { class: 'primary', onclick: () => openTraceTool(s), title: 'Convierte la imagen en contornos que se pueden cortar o grabar' }, 'Vectorizar…'),
              h('button', { class: 'primary', onclick: () => openCropTool(s), title: 'Recorta la imagen con un recuadro' }, 'Recortar…')));
        }
        if (a.realW) box.append(h('button', { class: 'wide', onclick: () => { s.p.w = fmt(a.realW / unitMM); s.p.prop = 'si'; checkpoint(); fullRender(); } }, 'Volver al tamaño original'));
      }
    }
    if (s.type === 'box' && s.p.cajon === 'si') {
      const m = boxModel(s, true);
      box.append(h('p', { class: 'tip', id: 'drawerTip' }, m
        ? (m.drawer.n > 1 ? `${m.drawer.n} cajones. ` : '') + `Cada cajón por dentro: ${fmt((m.drawer.Wd - 2 * m.t) / unitMM, isInch() ? 3 : 1)} × ${fmt((m.drawer.Dd - 2 * m.t) / unitMM, isInch() ? 3 : 1)} × ${fmt((m.drawer.Hd - m.t) / unitMM, isInch() ? 3 : 1)} ${unitLabel()} (ancho × fondo × alto). El frente decorativo se pega al frente del cajón.`
        : 'Las medidas no alcanzan para el cajón: agranda la caja o baja la holgura.'));
    }
    if (s.type === 'taper' || s.type === 'cone' || s.type === 'planter') {
      box.append(h('p', { class: 'tip', id: 'shapeTip' }));
      updateShapeTip(s);
      box.append(h('button', { class: 'primary wide', onclick: () => open3D(s.id) }, s.type === 'cone' ? 'Ver cono armado en 3D' : s.type === 'planter' ? 'Ver la maceta armada en 3D' : 'Ver caja armada en 3D'));
    }
    if (s.type === 'basket') {
      box.append(h('p', { class: 'tip', id: 'basketTip' }));
      updateBasketTip(s);
      box.append(h('button', { class: 'primary wide', onclick: () => open3D(s.id) }, 'Ver canasta armada en 3D'));
    }
    if (s.type === 'box') {
      box.append(h('button', { class: 'primary wide', onclick: () => open3D(s.id) }, 'Ver caja armada en 3D'));
      if (!boxModel(s)) box.append(h('p', { class: 'tip err-tip' }, 'Revisa las medidas: la caja debe ser más grande que dos veces el grosor.'));
    }
    if (SEPARABLE.has(s.type)) box.append(h('p', { class: 'tip' }, 'Desagrupar convierte cada pieza en un objeto independiente (con sus agujeros, bisagra y grabado) para moverla o editarla por separado. Después ya no cambian con los parámetros; puedes volver con Deshacer.'));
    const list = listOf(s.id), idx = list.indexOf(s);
    box.append(h('div', { class: 'insp-actions' },
      h('button', { onclick: duplicateSel }, 'Duplicar'),
      h('button', { onclick: () => toggleLayer(s, 'hidden'), title: 'Oculta la figura: no se ve ni se exporta' }, s.hidden ? 'Mostrar' : 'Ocultar'),
      h('button', { onclick: () => toggleLayer(s, 'locked'), title: 'Bloquea la figura: no se puede mover por accidente' }, s.locked ? 'Desbloquear' : 'Bloquear'),
      s.type === 'group' || SEPARABLE.has(s.type) ? h('button', { onclick: ungroupSel, title: 'Convierte cada pieza en un objeto independiente (Ctrl+Shift+G)' }, 'Desagrupar') : null,
      h('button', { class: 'icon-btn', title: 'Subir en la lista (queda encima)', 'aria-label': 'Subir', disabled: idx >= list.length - 1 ? '' : null, onclick: () => reorder(1) }, '↑'),
      h('button', { class: 'icon-btn', title: 'Bajar en la lista (queda debajo)', 'aria-label': 'Bajar', disabled: idx <= 0 ? '' : null, onclick: () => reorder(-1) }, '↓'),
      h('button', { class: 'danger', onclick: deleteSel }, 'Eliminar')));
    if (!shapes[0].from || true) { const al = sheetPositionSection(); box.append(...al); }
  }

  // Cantidad de dedos equivalente al ancho de dedo actual (para que al cambiar de modo la caja no cambie)
  function fingerDefaults(s) {
    const fw = len(s, 'dedo', 10);
    const n = mm => { let k = fw > 0 ? Math.floor(mm / fw) : 1; if (k < 1) k = 1; if (k % 2 === 0) k--; return String((k + 1) / 2); };
    const W = len(s, 'ancho', 100), D = len(s, 'profundo', 80), H = len(s, 'alto', 60);
    if (!s.p.nAncho) s.p.nAncho = n(W);
    if (!s.p.nProf) s.p.nProf = n(D);
    if (!s.p.nAlto) s.p.nAlto = n(H);
  }
  // Panel suelto: misma cantidad de dedos que con el ancho de dedo actual
  function panelFingerDefaults(s) {
    const fw = len(s, 'dedo', 10);
    const n = mm => { let k = fw > 0 ? Math.floor(mm / fw) : 1; if (k < 1) k = 1; if (k % 2 === 0) k--; return String((k + 1) / 2); };
    if (!s.p.nH) s.p.nH = n(Math.abs(len(s, 'w')));
    if (!s.p.nV) s.p.nV = n(Math.abs(len(s, 'h')));
  }
  // Muestra cuánto mide cada dedo con la cantidad elegida
  function updateFingerTip(s) {
    const el = $('#fingerTip');
    if (!el) return;
    if (s.type === 'panel') {
      const seg = k => 2 * Math.max(1, Math.round(num(s, k, 3)) || 1) - 1;
      const u = v => fmt(v / unitMM, isInch() ? 3 : 1);
      el.textContent = `Cada dedo mide ≈ ${u(Math.abs(len(s, 'w')) / seg('nH'))} ${unitLabel()} arriba y abajo, y ${u(Math.abs(len(s, 'h')) / seg('nV'))} a los lados. Para que encaje con otra pieza, usa la misma cantidad en el borde que se une.`;
      return;
    }
    const m = boxModel(s, true);
    if (!m) { el.textContent = ''; return; }
    const u = v => fmt(v / unitMM, isInch() ? 3 : 1);
    const seg = k => 2 * Math.max(1, Math.round(num(s, k, 3)) || 1) - 1;
    const W = m.drawer ? m.W : m.W, D = m.D, H = m.H;
    el.textContent = `Cada dedo mide ≈ ${u(W / seg('nAncho'))} ${unitLabel()} a lo ancho, ${u(D / seg('nProf'))} a lo profundo y ${u(H / seg('nAlto'))} a lo alto.`;
  }

  function updateShapeTip(s) {
    const el = $('#shapeTip');
    if (!el) return;
    const m = modelOf(s, true);
    el.classList.toggle('err-tip', !m);
    const u = v => fmt(v / unitMM, isInch() ? 3 : 1);
    if (!m) { el.textContent = s.type === 'planter' ? 'Revisa las medidas: el diámetro debe ser al menos 12 veces el grosor y el alto mayor que 6 grosores.' : s.type === 'cone' ? 'Revisa las medidas: usa dos diámetros distintos (al menos 2 mm de diferencia) y un alto mayor que el grosor.' : 'Las medidas no alcanzan: cada lado debe ser mayor que 4 veces el grosor.'; return; }
    if (s.type === 'planter') {
      const p = m.planter, wl = p.L, over = wl > doc.sheet.w ? ` Ojo: la pared mide ${u(wl)} ${unitLabel()} de largo y la cama de la máquina ${u(doc.sheet.w)}: reduce el diámetro.` : '';
      el.textContent = `La pared (${u(wl)} ${unitLabel()} de largo) se curva sola alrededor de la base y se cierra con ${s.p.cierre === 'dedos' ? 'dedos' : 'rompecabezas'}; la base entra por ${p.nTab} muescas (${m.panels.some(q => q.name.startsWith('Refuerzo')) ? 'más un disco de refuerzo pegado encima' : 'sin refuerzo'})`
        + (p.rings.length ? ` y ${p.rings.length} aro(s) cruzan la pared por ranuras.` : '.') + ' Una vez cerrada no se desarma. Pega con cola de madera el cierre y la base.' + over;
      return;
    }
    const tp = m.taper;
    el.textContent = s.type === 'taper'
      ? `Inclinación de las paredes: ${fmt(Math.abs(tp.angW), 1)}° a los lados y ${fmt(Math.abs(tp.angD), 1)}° al frente y atrás. `
        + (!tp.corners && !tp.baseF ? 'Se arma pegando: las paredes se apoyan sobre la base y el pegamento rellena las rendijas. Para reforzarla, elige dedos o agrega anillos.'
          : `${tp.corners === 4 ? 'Las 4 esquinas inclinadas llevan' : tp.corners ? `${tp.corners} esquina(s) llevan` : 'Ninguna esquina lleva'} ${(tp.nSeg + 1) / 2} dedos`
            + (tp.baseF ? ' y la base se une a las paredes con pestañas' : tp.corners ? ' (la base va pegada)' : '') + '.')
        + (tp.nRings ? ` ${tp.nRings} anillo(s) de refuerzo cruzan las paredes por ranuras.` : '')
      : `La pared se corta como un abanico de ${fmt(m.cone.theta / DEG, 0)}° y radio ${u(m.cone.Aout)} ${unitLabel()}. Enróllala siguiendo las líneas de la bisagra, cierra con las pestañas y pega la base por dentro.`;
  }
  function updateBasketTip(s) {
    const el = $('#basketTip');
    if (!el) return;
    const m = basketModel(s, true);
    el.classList.toggle('err-tip', !m);
    el.textContent = m
      ? `${m.basket.N} tablillas de ${fmt(m.basket.sw / unitMM, isInch() ? 3 : 1)} ${unitLabel()} de ancho. Las ranuras miden lo mismo que el grosor, así que siempre encajan con tu madera.`
      : 'Las medidas no alcanzan: usa menos tablillas, menos separación o una canasta más grande.';
  }

  /* ----- Escalar varias piezas juntas ----- */
  const SCALE_POS_X = ['x', 'x2', 'repCx'], SCALE_POS_Y = ['y', 'y2', 'repCy'];
  const SCALE_SIZE = ['w', 'h', 'r', 'd', 'redond', 'tam', 'repDx', 'repDy', 'largo', 'puente', 'paso'];
  // Las cajas escalan solo sus medidas (ancho, alto…); el grosor de la madera, el dedo y el kerf no cambian
  const SCALE_BOX_SIZE = {
    box: ['ancho', 'profundo', 'alto', 'divH', 'grabadoTam', 'logoTam'],
    taper: ['ancho', 'prof', 'anchoArr', 'largoArr', 'alto', 'bandaAnillo'],
    cone: ['d', 'dArr', 'alto', 'largo'],
    planter: ['d', 'alto'],
    basket: ['ancho', 'alto', 'profundo', 'radio', 'asaAlto', 'asaArco', 'asaAncho', 'marco'],
  };
  const SCALABLE = new Set(['import', 'rect', 'circle', 'polygon', 'line', 'text', 'hinge', ...Object.keys(SCALE_BOX_SIZE)]);

  function scaleSection(shapes) {
    const ok = shapes.filter(s => SCALABLE.has(s.type));
    if (!ok.length) return [];
    const pct = h('input', { value: '100', type: 'number', min: '1', step: 'any', 'aria-label': 'Escala en porcentaje' });
    const hasParam = doc.params.some(p => p.name === 'escala');
    return [
      h('div', { class: 'insp-sub' }, 'Tamaño de todo lo seleccionado'),
      propRow('Escala %', pct),
      h('div', { class: 'btn-grid' },
        h('button', { title: 'Cambia el tamaño de todas las piezas a la vez, manteniendo sus posiciones', onclick: () => scaleShapes(ok, parseFloat(pct.value)) }, 'Escalar juntas'),
        h('button', { title: 'Conecta las piezas al parámetro "escala": cambias ese número y todo se ajusta a la vez', onclick: () => linkScale(ok) }, hasParam ? 'Vincular a "escala"' : 'Crear parámetro "escala"')),
      h('p', { class: 'tip' }, 'Ojo: en figuras sueltas y piezas importadas también cambian las ranuras (madera de 3 mm al 150 % = 4.5 mm). Las cajas de plantilla solo cambian sus medidas y conservan el grosor de tu madera.'
        + (shapes.length > ok.length ? ' Los grupos no se escalan aquí: cámbialos con sus propias medidas.' : '')),
    ];
  }

  // ¿El parámetro es un número que solo usan estas figuras en sus medidas de tamaño? Entonces se puede escalar el parámetro mismo.
  function paramOnlyFor(name, shapes) {
    const q = doc.params.find(x => x.name === name);
    if (!q || !isNumeric(q.expr)) return false;
    const uses = v => wordRe(name).test(String(v));
    if (doc.params.some(o => o !== q && uses(o.expr))) return false;
    for (const sh of allShapes()) {
      const keys = new Set(shapes.includes(sh) ? SCALE_BOX_SIZE[sh.type] || [] : []);
      for (const [k, v] of Object.entries(sh.p)) if (uses(v) && !(keys.has(k) && String(v).trim() === name)) return false;
    }
    return true;
  }
  function syncParamInputs() {
    const rows = document.querySelectorAll('#params .pexpr');
    doc.params.forEach((p, i) => { if (rows[i] && rows[i].value !== p.expr) rows[i].value = p.expr; });
  }

  // Aplica a cada medida: posiciones respecto a la esquina (X0, Y0) de la selección; tamaños multiplicados.
  function rewriteScale(shapes, factorText, X0, Y0, kNum) {
    const mul = (e, v) => factorText ? `${e} * ${factorText}` : fmt(v * kNum);
    const pos = (e, o) => {
      if (e === undefined || e === '') return e;
      if (isNumeric(e)) { const d = parseFloat(e) - o; return factorText ? `${fmt(o)} + ${fmt(d)} * ${factorText}` : fmt(o + d * kNum); }
      return `${fmt(o)} + ((${e}) - ${fmt(o)}) * ${factorText || fmt(kNum)}`;
    };
    const size = e => {
      if (e === undefined || e === '') return e;
      if (isNumeric(e)) return mul(fmt(parseFloat(e)), parseFloat(e));
      return `(${e}) * ${factorText || fmt(kNum)}`;
    };
    const scaledParams = new Set();
    for (const s of shapes) {
      for (const key of SCALE_POS_X) if (key in s.p) s.p[key] = pos(s.p[key], X0);
      for (const key of SCALE_POS_Y) if (key in s.p) s.p[key] = pos(s.p[key], Y0);
      for (const key of SCALE_BOX_SIZE[s.type] || SCALE_SIZE) {
        if (!(key in s.p) || String(s.p[key]).trim() === '') continue;
        // Si la medida es un parámetro propio de esta figura, se cambia el número del parámetro (así se ve en la lista de Parámetros)
        const nm = String(s.p[key]).trim();
        if (!factorText && SCALE_BOX_SIZE[s.type] && paramOnlyFor(nm, shapes)) { scaledParams.add(nm); continue; }
        s.p[key] = size(s.p[key]);
      }
    }
    for (const nm of scaledParams) { const q = doc.params.find(x => x.name === nm); q.expr = fmt(parseFloat(q.expr) * kNum); }
  }
  function selectionCorner(shapes) {
    evaluateParams(); evaluateAll();
    const b = unionBox(shapes.map(s => bboxOfItems(worldCache.get(s.id) || [])));
    return b ? [b.x / unitMM, b.y / unitMM] : null;
  }
  function scaleShapes(shapes, pct) {
    if (!(pct > 0)) { msg('Escribe un porcentaje mayor que 0.'); return; }
    const c = selectionCorner(shapes);
    if (!c) return;
    rewriteScale(shapes, null, c[0], c[1], pct / 100);
    checkpoint(); fullRender();
    msg(`${shapes.length} piezas escaladas al ${fmt(pct)} %.`);
  }
  // Conecta las piezas a "escala" (en %) sin cambiar su tamaño actual; luego basta con cambiar ese parámetro.
  function linkScale(shapes) {
    const c = selectionCorner(shapes);
    if (!c) return;
    let p = doc.params.find(q => q.name === 'escala');
    if (!p) { p = { name: 'escala', expr: '100' }; doc.params.unshift(p); }
    const cur = (vars.escala > 0 ? vars.escala : 100) / 100;
    // Se toma el tamaño actual como si fuera el de "escala" actual, para que nada salte al vincular
    if (Math.abs(cur - 1) > 1e-9) rewriteScale(shapes, null, c[0], c[1], 1 / cur);
    rewriteScale(shapes, 'escala / 100', c[0], c[1], 1);
    checkpoint(); fullRender();
    msg(`${shapes.length} piezas conectadas al parámetro "escala" (arriba en Parámetros). Cambia 100 por 120, 80… y todo se ajusta a la vez.`);
    const inp = [...document.querySelectorAll('#params .pname')].find(i => i.value === 'escala');
    if (inp) { const ex = inp.parentElement.querySelector('.pexpr'); if (ex) { ex.focus(); ex.select(); } }
  }

  // Caja cónica: solo se muestran los campos de dedos y anillos que aplican según las opciones
  function taperFieldHidden(s, key) {
    const joint = s.p.uniones || 'planas', byCount = s.p.dedoModo === 'cantidad';
    if (['cFI', 'cFD', 'cAI', 'cAD', 'baseDedos'].includes(key)) return joint !== 'custom';
    const baseOn = joint === 'dedos' || (joint === 'custom' && s.p.baseDedos !== 'no');
    if (key === 'dedoModo') return joint === 'planas';
    if (key === 'dedo') return joint === 'planas' || byCount;
    if (key === 'nEsq') return joint === 'planas' || !byCount;
    if (key === 'nBaseT') return !baseOn || !byCount;
    if (key === 'bandaAnillo') return !(Math.round(num(s, 'nAnillos', 0)) > 0);
    if (key === 'grosorCub' || key === 'cubiertaCaras' || key === 'cubiertaLargas' || key === 'margenCub') return s.p.cubierta !== 'si';
    return false;
  }
  // En modo bandeja de pared los nombres de las medidas cambian (la caja "acostada")
  function boxLabel(s, key, label) {
    if (s.type === 'polygon' && s.p.forma === 'estrella' && key === 'n') return 'Puntas';
    if (s.type !== 'box' || s.p.pared !== 'si') return label;
    return ({ ancho: 'Ancho', profundo: 'Alto de la bandeja', alto: 'Fondo (profundidad)', divX: 'Columnas', divZ: 'Filas', divH: 'Fondo de las divisiones' })[key] || label;
  }
  // Campos de la caja que no aplican según las opciones elegidas
  function boxFieldHidden(s, key) {
    if (key === 'colgar') return s.p.pared !== 'si';
    if (key === 'grosorCub' || key === 'cubiertaCaras' || key === 'cubiertaLargas') return s.p.cubierta !== 'si';
    if (s.p.pared === 'si' && ['tapa', 'cajon', 'nCaj', 'holguraC', 'borde', 'holgura', 'agarre'].includes(key)) return true;
    const drawer = s.p.cajon === 'si';
    if (key === 'holguraC' || key === 'nCaj') return !drawer;
    const planas = s.p.uniones === 'planas', byCount = s.p.dedoModo === 'cantidad';
    if (key === 'dedoModo') return planas;
    if (key === 'nAncho' || key === 'nProf' || key === 'nAlto') return planas || !byCount;
    if (key === 'dedo') return planas || byCount;
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
  /* ----- Capas: ocultar y bloquear figuras ----- */
  const ICON_EYE = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.9A17 17 0 0 0 2 12s4 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const ICON_UNLOCK = '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>';
  function layerBtn(svg, title, active, onclick) {
    const b = h('button', { class: 'layer-btn' + (active ? ' on' : ''), title, 'aria-label': title, onclick: e => { e.stopPropagation(); onclick(); } });
    b.innerHTML = svg;
    return b;
  }
  function toggleLayer(s, key) {
    s[key] = !s[key];
    if (key === 'locked' && s.locked) nodeShow.delete(s.id);
    checkpoint(); fullRender();
  }
  function layerButtons() {
    const all = [...allShapes()];
    const anyHidden = all.some(s => s.hidden), anyLocked = all.some(s => s.locked);
    const box = $('#layerBtns');
    if (!box) return;
    box.replaceChildren();
    if (anyHidden) box.append(h('button', { class: 'small', onclick: () => { all.forEach(s => { s.hidden = false; }); checkpoint(); fullRender(); } }, 'Mostrar todo'));
    if (anyLocked) box.append(h('button', { class: 'small', onclick: () => { all.forEach(s => { s.locked = false; }); checkpoint(); fullRender(); } }, 'Desbloquear todo'));
  }

  function buildObjects() {
    const ul = $('#objects');
    ul.replaceChildren();
    layerButtons();
    if (!doc.shapes.length) {
      ul.append(h('li', { class: 'empty' }, 'Aún no hay objetos. Dibuja con las herramientas de la izquierda.'));
      return;
    }
    const add = (list, depth) => {
      for (const s of [...list].reverse()) {
        const type = s.type === 'group' ? `Grupo · ${MODES[s.p.mode || 'grupo']}` : TYPES[s.type].label;
        const isPlain = s.type === 'group' && (s.p.mode || 'grupo') === 'grupo';
        ul.append(h('li', {
          class: (sel.has(s.id) ? 'selected' : '') + (depth ? ' child' : '') + (s.hidden ? ' is-hidden' : '') + (s.locked ? ' is-locked' : ''),
          style: depth ? `padding-left:${8 + depth * 14}px` : null,
          onclick: e => {
            if (e.shiftKey) { sel.has(s.id) ? sel.delete(s.id) : sel.add(s.id); }
            else sel = new Set([s.id]);
            buildInspector(); buildObjects(); drawCanvas();
          },
        }, h('span', {}, isPlain ? h('span', { class: 'dot group' }) : h('span', { class: 'dot op-' + s.op }), s.name), h('span', { class: 'type' }, type),
          h('span', { class: 'layer-ctrls' }, layerBtn(s.hidden ? ICON_EYE_OFF : ICON_EYE, s.hidden ? 'Mostrar' : 'Ocultar', !!s.hidden, () => toggleLayer(s, 'hidden')), layerBtn(s.locked ? ICON_LOCK : ICON_UNLOCK, s.locked ? 'Desbloquear' : 'Bloquear (no se puede mover)', !!s.locked, () => toggleLayer(s, 'locked')))));
        if (s.children) add(s.children, depth + 1);
      }
    };
    add(doc.shapes, 0);
  }

  /* ================= Personalización local por lotes ================= */
  function selectedRoots() {
    return [...sel].map(byId).filter(s => s && !parentOf(s.id));
  }
  /* ----- Recorte: dividir figuras con una línea ----- */
  const clipEO = (type, subj, clp) => { const c = new CL.Clipper(); c.AddPaths(subj, CL.PolyType.ptSubject, true); c.AddPaths(clp, CL.PolyType.ptClip, true); const sol = new CL.Paths(); c.Execute(type, sol, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftNonZero); return sol; };
  function divideWithLine() {
    evaluateParams(); evaluateAll();
    const roots = selectedRoots(), lines = roots.filter(s => s.type === 'line'), targets = roots.filter(s => s.type !== 'line');
    if (lines.length !== 1 || !targets.length) { msg('Dibuja una línea sobre la figura, selecciona la línea y la figura (Shift + clic) y pulsa «Dividir con la línea».'); return; }
    const L = lines[0], p1 = [len(L, 'x'), len(L, 'y')], p2 = [len(L, 'x2'), len(L, 'y2')], d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (!(d > 0.01)) { msg('La línea es demasiado corta.'); return; }
    const u = [(p2[0] - p1[0]) / d, (p2[1] - p1[1]) / d], n = [-u[1], u[0]], B = 1e5;
    const half = sg => [[-B, 0], [B, 0], [B, B], [-B, B]].map(([a, b]) => ({ X: Math.round((p1[0] + u[0] * a + n[0] * b * sg) * SC), Y: Math.round((p1[1] + u[1] * a + n[1] * b * sg) * SC) }));
    const sides = [half(1), half(-1)];
    const made = [], skipped = [], notCrossed = [], replaced = [];
    for (const t of targets) {
      const r = evalCache.get(t.id);
      if (!r || SEPARABLE.has(t.type) || r.items.some(it => it.texts.length || (it.images || []).length || it.polys.some(p => !p.closed))) { skipped.push(t.name); continue; }
      const pieces = [];
      for (const sd of sides) for (const it of r.items) {
        const closed = it.polys.filter(p => p.closed && p.pts.length >= 3);
        if (!closed.length) continue;
        const part = fromC(clipEO(CL.ClipType.ctIntersection, toC(closed), [sd])).filter(p => Math.abs(polyArea(p.pts)) > 0.01);
        if (part.length) for (const grp of splitPieces(part)) pieces.push(grp.map(p => ({ ...p, op: it.op })));
      }
      const sideHits = sides.map(sd => r.items.some(it => fromC(clipEO(CL.ClipType.ctIntersection, toC(it.polys.filter(p => p.closed)), [sd])).length)).filter(Boolean).length;
      if (pieces.length < 2 || sideHits < 2) { notCrossed.push(t.name); continue; }
      const list = listOf(t.id), at = list.indexOf(t);
      const objs = pieces.map((pl, i) => { const o = importObject(`${t.name} · parte ${i + 1}`, pl, []); o.op = t.op; return o; });
      list.splice(at, 1, ...objs);
      made.push(...objs); replaced.push(t.name);
    }
    if (!made.length) { msg(skipped.length ? `No se puede dividir «${skipped[0]}» (tiene líneas abiertas, texto o es una caja: sepárala en piezas primero).` : 'La línea no cruza la figura: dibújala de lado a lado.'); return; }
    const li = listOf(L.id), lx = li.indexOf(L); if (lx >= 0) li.splice(lx, 1);
    sel = new Set(made.map(o => o.id));
    checkpoint(); fullRender();
    msg(`${replaced.length} figura(s) dividida(s) en ${made.length} piezas.` + (skipped.length ? ` No se pudo dividir: ${skipped.join(', ')}.` : '') + (notCrossed.length ? ` La línea no cruzaba: ${notCrossed.join(', ')}.` : ''));
  }

  let alignRef = 'seleccion';
  const ALIGN_REFS = { seleccion: 'La selección', hoja: 'La hoja de trabajo', primera: 'La primera figura elegida' };
  function alignmentSection(shapes) {
    if (shapes.some(s => parentOf(s.id))) return [h('p', { class: 'tip' }, 'Alinea los grupos completos desde el nivel principal.')];
    const gap = h('input', { type: 'number', min: '0', step: 'any', value: fmt(3 / unitMM, 3), 'aria-label': 'Separación' });
    const gapMM = () => Math.max(0, parseFloat(gap.value) * unitMM || 0);
    return [h('div', { class: 'insp-sub' }, 'Alinear selección'),
      propRow('Alinear respecto a', selectEl(ALIGN_REFS, alignRef, 'Alinear respecto a', v => { alignRef = v; })),
      h('div', { class: 'btn-grid' }, ...[
        ['left', 'Izquierda'], ['cx', 'Centro horizontal'], ['right', 'Derecha'],
        ['top', 'Arriba'], ['cy', 'Centro vertical'], ['bottom', 'Abajo'],
        ['dx', 'Distribuir horizontal'], ['dy', 'Distribuir vertical']
      ].map(([mode, label]) => h('button', { onclick: () => alignSelection(mode) }, label))),
      propRow(`Separación (${unitLabel()})`, gap),
      h('div', { class: 'btn-grid' },
        h('button', { title: 'Pone las figuras una al lado de otra, con esta separación exacta', onclick: () => stackSelection('x', gapMM()) }, 'En fila'),
        h('button', { title: 'Pone las figuras una debajo de otra, con esta separación exacta', onclick: () => stackSelection('y', gapMM()) }, 'En columna')),
      ...flipSection(),
      ...recortarSection(shapes)];
  }
  // Para una sola figura: colocarla en la hoja
  function sheetPositionSection() {
    return [h('div', { class: 'insp-sub' }, 'Posición en la hoja'),
      h('div', { class: 'btn-grid' }, ...[
        ['left', 'A la izquierda'], ['cx', 'Centrar ↔'], ['right', 'A la derecha'],
        ['top', 'Arriba'], ['cy', 'Centrar ↕'], ['bottom', 'Abajo']
      ].map(([mode, label]) => h('button', { onclick: () => alignSelection(mode, 'hoja') }, label))),
      h('button', { class: 'wide', onclick: () => { alignSelection('cx', 'hoja'); alignSelection('cy', 'hoja'); } }, 'Centrar en la hoja'),
      ...flipSection(),
      h('div', { class: 'btn-grid' }, h('button', { onclick: () => copySel(false), title: 'Cmd+C' }, 'Copiar'), h('button', { onclick: () => pasteClip(false), title: 'Cmd+V' }, 'Pegar'))];
  }
  // Recortar: dividir con una línea (se muestra si hay una línea y alguna figura elegidas)
  function recortarSection(shapes) {
    const hasLine = shapes.filter(s => s.type === 'line').length === 1 && shapes.some(s => s.type !== 'line');
    return [h('div', { class: 'insp-sub' }, 'Recortar'),
      h('button', { class: 'wide', title: 'Las figuras elegidas se quedan solo con la parte que cae dentro de la figura de más arriba', onclick: cropWithShape }, 'Recortar con la figura de encima'),
      h('button', { class: hasLine ? 'primary wide' : 'wide', title: 'Elige una línea dibujada sobre la figura y la figura: se divide en piezas independientes', onclick: divideWithLine }, 'Dividir con la línea'),
      hasLine ? null : h('p', { class: 'tip' }, 'Dibuja una línea que cruce la figura, elige la línea y la figura (Shift + clic) y pulsa el botón. Para quitar la parte que se cruza usa «Excluir», o «Restar» para recortar un agujero.')];
  }
  function alignSelection(mode, refOverride) {
    evaluateParams(); evaluateAll();
    const ref = refOverride || alignRef;
    const entries = selectedRoots().map(s => ({ s, b: bboxOfItems(worldCache.get(s.id) || []) })).filter(e => e.b);
    if (!entries.length || (entries.length < 2 && ref !== 'hoja')) return;
    let b = unionBox(entries.map(e => e.b));
    if (ref === 'hoja') b = { x: 0, y: 0, w: doc.sheet.w, h: doc.sheet.h };
    else if (ref === 'primera') { const first = [...sel].map(byId).find(s => s && entries.some(e => e.s === s)); const fe = entries.find(e => e.s === first); if (fe) b = fe.b; }
    if (mode === 'dx' || mode === 'dy') {
      if (entries.length < 3) { msg('Selecciona al menos tres objetos para distribuir.'); return; }
      b = unionBox(entries.map(e => e.b));
      const axis = mode === 'dx' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
      entries.sort((a, c) => a.b[axis] - c.b[axis]);
      const gap = (b[size] - entries.reduce((n, e) => n + e.b[size], 0)) / (entries.length - 1);
      let at = b[axis];
      for (const e of entries) { const d = at - e.b[axis]; moveShape(e.s, { ...e.s.p }, axis === 'x' ? d : 0, axis === 'y' ? d : 0); at += e.b[size] + gap; }
    } else {
      for (const e of entries) {
        const dx = mode === 'left' ? b.x - e.b.x : mode === 'right' ? b.x + b.w - e.b.x - e.b.w : mode === 'cx' ? b.x + b.w / 2 - e.b.x - e.b.w / 2 : 0;
        const dy = mode === 'top' ? b.y - e.b.y : mode === 'bottom' ? b.y + b.h - e.b.y - e.b.h : mode === 'cy' ? b.y + b.h / 2 - e.b.y - e.b.h / 2 : 0;
        moveShape(e.s, { ...e.s.p }, dx, dy);
      }
    }
    checkpoint(); fullRender();
  }
  // Fila o columna con separación exacta, empezando por la figura de más a la izquierda / más arriba
  function stackSelection(axis, gapMM) {
    evaluateParams(); evaluateAll();
    const entries = selectedRoots().map(s => ({ s, b: bboxOfItems(worldCache.get(s.id) || []) })).filter(e => e.b);
    if (entries.length < 2) { msg('Selecciona al menos dos objetos.'); return; }
    const size = axis === 'x' ? 'w' : 'h';
    entries.sort((a, c) => a.b[axis] - c.b[axis]);
    let at = entries[0].b[axis];
    for (const e of entries) { const d = at - e.b[axis]; moveShape(e.s, { ...e.s.p }, axis === 'x' ? d : 0, axis === 'y' ? d : 0); at += e.b[size] + gapMM; }
    checkpoint(); fullRender();
    msg(`${entries.length} figuras en ${axis === 'x' ? 'fila' : 'columna'}, ${fmt(gapMM / unitMM, 3)} ${unitLabel()} entre cada una.`);
  }
  const BATCH_MARKER = '{{nombre}}';
  function personalizeShapes(shapes, name, maxWidthMM) {
    let replacements = 0;
    function visit(s) {
      for (const key of ['texto', 'grabadoTexto', 'asaTexto']) {
        if (typeof s.p[key] === 'string' && s.p[key].includes(BATCH_MARKER)) {
          s.p[key] = s.p[key].split(BATCH_MARKER).join(name); replacements++;
          if (key === 'texto' && maxWidthMM > 0) {
            const size = len(s, 'tam', 10);
            const width = measureTextWidth(s.p[key], size, s.p.fuente);
            if (width > maxWidthMM) s.p.tam = String(size * maxWidthMM / width / unitMM);
          }
        }
      }
      (s.children || []).forEach(visit);
    }
    shapes.forEach(visit);
    return replacements;
  }
  function measureTextWidth(str, size, fontId) {
    const f = getFont(fontId);
    if (f) return f.getAdvanceWidth(str, size);
    const canvas = measureTextWidth.canvas || (measureTextWidth.canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = '100px ' + fontCss(fontId);
    return ctx.measureText(str).width * size / 100;
  }

  /* ================= Tipografías ================= */
  // Fuentes libres incluidas (licencia SIL Open Font License, en lib/fonts). Arial es la del sistema.
  const FONTS = [
    { id: 'arial', name: 'Arial (del sistema)' },
    { id: 'montserrat', name: 'Montserrat', file: 'Montserrat.ttf' },
    { id: 'bebas', name: 'Bebas Neue', file: 'BebasNeue.ttf' },
    { id: 'playfair', name: 'Playfair Display', file: 'PlayfairDisplay.ttf' },
    { id: 'cinzel', name: 'Cinzel', file: 'Cinzel.ttf' },
    { id: 'amatic', name: 'Amatic SC', file: 'AmaticSC.ttf' },
    { id: 'lobster', name: 'Lobster', file: 'Lobster.ttf' },
    { id: 'pacifico', name: 'Pacifico', file: 'Pacifico.ttf' },
    { id: 'dancing', name: 'Dancing Script', file: 'DancingScript.ttf' },
    { id: 'kaushan', name: 'Kaushan Script', file: 'KaushanScript.ttf' },
    { id: 'greatvibes', name: 'Great Vibes', file: 'GreatVibes.ttf' },
    { id: 'sacramento', name: 'Sacramento', file: 'Sacramento.ttf' },
    { id: 'allura', name: 'Allura', file: 'Allura.ttf' },
  ];
  const FONT_BY_ID = Object.fromEntries(FONTS.map(f => [f.id, f]));
  const fontCache = new Map(); // id → fuente lista | promesa de carga | 'error'
  const fontFamilyName = id => 'ELS-' + String(id).replace(/[^\w-]/g, '');
  function fontCss(id) {
    if (!id || id === 'arial' || (!FONT_BY_ID[id] && !(doc.assets && doc.assets[id]))) return 'Arial, Helvetica, sans-serif';
    return `'${fontFamilyName(id)}', Arial, sans-serif`;
  }
  // Carga la fuente (una sola vez). Devuelve una promesa; al terminar, redibuja.
  function loadFont(id) {
    if (!id || id === 'arial') return Promise.resolve(null);
    const cached = fontCache.get(id);
    if (cached && typeof cached.then === 'function') return cached;
    if (cached === 'error') return Promise.resolve(null);
    if (cached) return Promise.resolve(cached);
    const a = doc.assets && doc.assets[id];
    const src = FONT_BY_ID[id] ? fetch('lib/fonts/' + FONT_BY_ID[id].file).then(r => { if (!r.ok) throw new Error('no se encontró'); return r.arrayBuffer(); })
      : a && a.kind === 'font' ? Promise.resolve(Uint8Array.from(atob(a.data), c => c.charCodeAt(0)).buffer)
      : Promise.reject(new Error('fuente desconocida'));
    const pr = src.then(buf => {
      if (!window.opentype) throw new Error('falta lib/opentype.min.js');
      const font = opentype.parse(buf);
      fontCache.set(id, font);
      // También se registra en la página para las vistas previas del menú
      try { const ff = new FontFace(fontFamilyName(id), buf.slice(0)); ff.load().then(x => document.fonts.add(x)).catch(() => {}); } catch (e) { /* sin FontFace */ }
      scheduleRender();
      return font;
    }).catch(err => {
      fontCache.set(id, 'error');
      msg('No se pudo cargar la tipografía (' + err.message + '). Se usa Arial.');
      return null;
    });
    fontCache.set(id, pr);
    return pr;
  }
  function getFont(id) {
    if (!id || id === 'arial') return null;
    const c = fontCache.get(id);
    if (c && typeof c.then !== 'function' && c !== 'error') return c;
    if (!c) loadFont(id);
    return null;
  }
  let renderTimer = 0;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { liveRender(); if (v3.open) build3D(); }, 30);
  }
  // Antes de exportar, espera a que estén cargadas todas las tipografías usadas
  function usedFonts() {
    const ids = new Set();
    for (const sh of allShapes()) for (const k of ['fuente', 'grabadoFuente', 'asaFuente']) if (sh.p[k] && sh.p[k] !== 'arial') ids.add(sh.p[k]);
    return [...ids];
  }
  function withFonts(fn) {
    const ids = usedFonts();
    if (!ids.length) return fn();
    msg('Preparando tipografías…');
    Promise.all(ids.map(loadFont)).then(() => fn());
  }

  // Convierte los textos con tipografía en contornos: se ven igual en cualquier programa y las letras
  // cursivas que se enciman quedan unidas (el láser no pasa dos veces).
  const outlineCache = new Map();
  function fontOutlines(it) {
    if (!it || !it.texts || !it.texts.some(t => t.font && t.font !== 'arial')) return it;
    const polys = it.polys.slice(), texts = [];
    for (const t of it.texts) {
      const f = getFont(t.font);
      if (!f || !t.str) { texts.push(t); continue; }
      const key = [t.font, t.str, t.size, t.x, t.y, t.rot, t.anchor].join('|');
      let out = outlineCache.get(key);
      if (!out) {
        const x0 = t.anchor === 'middle' ? t.x - f.getAdvanceWidth(t.str, t.size) / 2 : t.x;
        let pl = flattenPathD(f.getPath(t.str, x0, t.y, t.size).toPathData(3), Math.max(0.01, t.size / 500));
        if (t.rot) { const m = mR(t.rot, t.x, t.y); pl = pl.map(p => ({ closed: p.closed, pts: p.pts.map(q => apply(m, q)) })); }
        const closed = pl.filter(p => p.closed && p.pts.length >= 3);
        out = CL && closed.length ? fromC(normalize(toC(closed))) : closed;
        if (outlineCache.size > 800) outlineCache.clear();
        outlineCache.set(key, out);
      }
      polys.push(...out);
    }
    return { ...it, polys, texts };
  }

  // Sube una fuente propia (.ttf / .otf); queda guardada dentro del diseño
  function pickFont(onDone) {
    const input = h('input', { type: 'file', accept: '.ttf,.otf,font/ttf,font/otf' });
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buf = reader.result;
          if (!window.opentype) throw new Error('falta lib/opentype.min.js');
          const font = opentype.parse(buf);
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          const id = 'f' + uid();
          const family = (font.names && font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) || file.name.replace(/\.[^.]+$/, '');
          doc.assets = doc.assets || {};
          doc.assets[id] = { kind: 'font', name: family, file: file.name, data: btoa(bin) };
          fontCache.set(id, font);
          try { const ff = new FontFace(fontFamilyName(id), buf.slice(0)); ff.load().then(x => document.fonts.add(x)).catch(() => {}); } catch (e) { /* sin FontFace */ }
          onDone(id);
          msg(`Tipografía cargada: ${family}. Queda guardada dentro de este diseño.`);
        } catch (err) { msg('No se pudo leer esa fuente: ' + err.message); }
      };
      reader.readAsArrayBuffer(file);
    });
    input.click();
  }
  function buildBatch(base, names, columns, gap, maxWidth) {
    if (!names.length || names.length > 300) throw new Error('Escribe entre 1 y 300 nombres, uno por línea.');
    if (!Number.isInteger(columns) || columns < 1 || columns > 30 || !Number.isFinite(gap) || gap < 0 || !Number.isFinite(maxWidth) || maxWidth < 0) throw new Error('Revisa las columnas (1–30) y las medidas (0 o más).');
    const groups = names.map(name => {
      const children = base.map(cloneShape);
      if (!personalizeShapes(children, name, maxWidth)) throw new Error('Añade {{nombre}} a un texto editable del arte. Los nombres convertidos a curvas o en fotos no se pueden sustituir.');
      const validate = s => {
        if (!evalShape(s)) throw new Error('Una pieza tiene medidas inválidas. Corrígela antes de generar el lote.');
        (s.children || []).forEach(validate);
      };
      children.forEach(validate);
      const g = { id: uid(), type: 'group', name, op: 'corte', p: { mode: 'grupo', x: '0', y: '0', rot: '0' }, children };
      const result = evalShape(g);
      if (!result || !result.bbox || ![result.bbox.x, result.bbox.y, result.bbox.w, result.bbox.h].every(Number.isFinite)) throw new Error('El arte tiene medidas inválidas o está vacío.');
      return { g, b: result.bbox };
    });
    const cellW = Math.max(...groups.map(e => e.b.w)), cellH = Math.max(...groups.map(e => e.b.h));
    groups.forEach(({ g, b }, i) => { g.p.x = String(((i % columns) * (cellW + gap) - b.x) / unitMM); g.p.y = String((Math.floor(i / columns) * (cellH + gap) - b.y) / unitMM); });
    return groups.map(e => e.g);
  }
  /* ================= Acomodo automático de piezas (ahorra madera) ================= */
  // Cada pieza se trata como un rectángulo (su caja) y se acomoda con MaxRects, girándola 90° si así cabe mejor.
  // Si no caben en una hoja, se crean más hojas en fila hacia la derecha; cada hoja se exporta por separado.
  const NEST_GAP = 20; // mm entre hojas en el lienzo
  const SHEET_PRESETS = [
    ['Área de la máquina (la actual)', null],
    ['xTool P2S · listones (600 × 305 mm)', [600, 305]],
    ['xTool P2S · panal (556 × 280 mm)', [556, 280]],
    ['Madera 12 × 24 in (610 × 305 mm)', [609.6, 304.8]],
    ['Madera 12 × 18 in (457 × 305 mm)', [457.2, 304.8]],
    ['Madera 12 × 12 in (305 × 305 mm)', [304.8, 304.8]],
    ['Madera 24 × 24 in (610 × 610 mm)', [609.6, 609.6]],
    ['Acrílico 300 × 600 mm', [600, 300]],
  ];
  function maxRectsPack(items, W, H, allowRot) {
    const bins = [];
    const newBin = () => ({ free: [{ x: 0, y: 0, w: W, h: H }], placed: [] });
    const split = (bin, r) => {
      const out = [];
      for (const f of bin.free) {
        if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { out.push(f); continue; }
        if (r.x > f.x) out.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
        if (r.x + r.w < f.x + f.w) out.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
        if (r.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
        if (r.y + r.h < f.y + f.h) out.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
      }
      bin.free = out.filter((a, i) => !out.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (a.w < b.w || a.h < b.h || i > j)));
    };
    const tryBin = (bin, it) => {
      let best = null;
      for (const f of bin.free) {
        for (const rot of allowRot && it.canRot ? [false, true] : [false]) {
          const w = rot ? it.h : it.w, h = rot ? it.w : it.h;
          if (w > f.w + 1e-6 || h > f.h + 1e-6) continue;
          const s1 = Math.min(f.w - w, f.h - h), s2 = Math.max(f.w - w, f.h - h);
          if (!best || s1 < best.s1 - 1e-9 || (Math.abs(s1 - best.s1) < 1e-9 && s2 < best.s2)) best = { x: f.x, y: f.y, w, h, rot, s1, s2 };
        }
      }
      return best;
    };
    const failed = [];
    for (const it of items) {
      if (!(it.w <= W + 1e-6 && it.h <= H + 1e-6) && !(allowRot && it.canRot && it.h <= W + 1e-6 && it.w <= H + 1e-6)) { failed.push(it); continue; }
      let placed = null, bi = -1;
      for (let i = 0; i < bins.length && !placed; i++) { placed = tryBin(bins[i], it); bi = i; }
      if (!placed) { bins.push(newBin()); bi = bins.length - 1; placed = tryBin(bins[bi], it); }
      if (!placed) { failed.push(it); continue; }
      bins[bi].placed.push({ it, x: placed.x, y: placed.y, w: placed.w, h: placed.h, rot: placed.rot });
      split(bins[bi], { x: placed.x, y: placed.y, w: placed.w, h: placed.h });
    }
    return { bins, failed };
  }
  // Área real de madera de una pieza (contornos menos agujeros), en mm²
  function pieceArea(items) {
    const polys = items.flatMap(it => it.polys.filter(p => p.closed && p.pts.length > 2));
    let a = 0;
    for (const p of polys) {
      const depth = polys.filter(q => q !== p && inPoly(p.pts[0], q.pts)).length;
      a += (depth % 2 === 0 ? 1 : -1) * Math.abs(polyArea(p.pts));
    }
    return Math.max(0, a);
  }

  function runNest(o) {
    evaluateParams(); evaluateAll();
    let roots = selectedRoots();
    if (!roots.length) roots = doc.shapes.filter(s => !s.hidden);
    roots = roots.filter(s => !s.hidden && !s.locked);
    const boxes = roots.filter(s => SEPARABLE.has(s.type));
    if (boxes.length) {
      if (!confirm(`Para acomodar mejor, ${boxes.length > 1 ? 'las cajas se separan' : '«' + boxes[0].name + '» se separa'} en piezas independientes (dejan de cambiar con los parámetros). Deshacer las vuelve a juntar. ¿Continuar?`)) return false;
      const keep = roots.filter(s => !SEPARABLE.has(s.type));
      separateMany(boxes);
      roots = [...keep, ...[...sel].map(byId).filter(x => x && !parentOf(x.id))];
      evaluateParams(); evaluateAll();
    }
    const units = [];
    for (const s of roots) {
      const r = evalCache.get(s.id);
      if (!r || !r.bbox) continue;
      const canRot = o.rotate && s.type !== 'text' && s.type !== 'line' && 'rot' in s.p && (!s.p.rep || s.p.rep === 'no');
      units.push({ s, w: r.bbox.w, h: r.bbox.h, area: pieceArea(r.items), canRot });
    }
    if (!units.length) { msg('No hay piezas para acomodar.'); return false; }
    const W = o.w - 2 * o.margin + o.gap, H = o.h - 2 * o.margin + o.gap;
    const items = units.map(u => ({ ...u, w: u.w + o.gap, h: u.h + o.gap })).sort((a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h));
    const { bins, failed } = maxRectsPack(items, W, H, o.rotate);
    checkpoint();
    // 1) gira las piezas que lo pidieron; 2) vuelve a medir; 3) mueve cada una a su lugar
    const jobs = [];
    bins.forEach((bin, k) => { for (const p of bin.placed) jobs.push({ u: p.it, k, x: p.x, y: p.y, rot: p.rot }); });
    for (const j of jobs) if (j.rot) { const cur = j.u.s.p.rot; j.u.s.p.rot = shiftExpr(cur === undefined || cur === '' ? '0' : String(cur), 90); }
    evaluateParams(); evaluateAll();
    for (const j of jobs) {
      const r = evalCache.get(j.u.s.id);
      if (!r || !r.bbox) continue;
      const tx = j.k * (o.w + NEST_GAP) + o.margin + j.x, ty = o.margin + j.y;
      moveShape(j.u.s, { ...j.u.s.p }, tx - r.bbox.x, ty - r.bbox.y);
    }
    const used = bins.map(bin => bin.placed.reduce((a, p) => a + p.it.area, 0));
    doc.sheet = { w: o.w, h: o.h };
    doc.nest = { count: Math.max(1, bins.length), w: o.w, h: o.h, gap: NEST_GAP, used, pieces: bins.map(b => b.placed.length), failed: failed.map(f => f.s.name) };
    sel = new Set(jobs.map(j => j.u.s.id));
    checkpoint(); fullRender(); fitView();
    const pct = used.reduce((a, b) => a + b, 0) / (doc.nest.count * o.w * o.h) * 100;
    msg(`${jobs.length} pieza(s) en ${doc.nest.count} hoja(s) · madera usada ${fmt(pct, 0)} %` + (failed.length ? ` · ${failed.length} no cabe(n) en la hoja` : ''));
    return true;
  }

  function openNest() {
    evaluateParams(); evaluateAll();
    if (!doc.shapes.length) { msg('Primero crea o abre un diseño con piezas para acomodar.'); return; }
    const dialog = h('dialog', { class: 'batch-dialog', 'aria-labelledby': 'nestTitle' });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    const cur = doc.nest && doc.nest.w ? doc.nest : doc.sheet;
    const presetSel = h('select', { 'aria-label': 'Tamaño de la hoja de madera' }, ...SHEET_PRESETS.map(([l], i) => h('option', { value: String(i) }, l)));
    const wIn = h('input', { type: 'number', min: '1', step: 'any', value: fmt(cur.w / unitMM, 3) });
    const hIn = h('input', { type: 'number', min: '1', step: 'any', value: fmt(cur.h / unitMM, 3) });
    const gapIn = h('input', { type: 'number', min: '0', step: 'any', value: fmt(3 / unitMM * (isInch() ? 1 : 1), 3) });
    const marIn = h('input', { type: 'number', min: '0', step: 'any', value: fmt(5 / unitMM, 3) });
    const rot = h('input', { type: 'checkbox', checked: '' });
    presetSel.onchange = () => {
      const p = SHEET_PRESETS[+presetSel.value][1] || [doc.sheet.w, doc.sheet.h];
      wIn.value = fmt(p[0] / unitMM, 3); hIn.value = fmt(p[1] / unitMM, 3);
    };
    const roots = selectedRoots();
    const status = h('p', { class: 'tip', role: 'status' }, roots.length ? `Se acomodan las ${roots.length} figura(s) seleccionada(s).` : `Se acomodan todas las figuras del diseño (${doc.shapes.length}).`);
    const go = h('button', { class: 'primary' }, 'Acomodar');
    go.onclick = () => {
      const o = { w: parseFloat(wIn.value) * unitMM, h: parseFloat(hIn.value) * unitMM, gap: parseFloat(gapIn.value) * unitMM, margin: parseFloat(marIn.value) * unitMM, rotate: rot.checked };
      if (![o.w, o.h, o.gap, o.margin].every(Number.isFinite) || o.w < 10 || o.h < 10 || o.gap < 0 || o.margin < 0) { status.textContent = 'Revisa los números: la hoja debe medir al menos 10 mm y la separación no puede ser negativa.'; return; }
      close();
      runNest(o);
    };
    const cancel = h('button', { onclick: close }, 'Cancelar');
    const row = (l, el) => h('label', {}, l, el);
    dialog.append(h('h2', { id: 'nestTitle' }, 'Acomodar piezas (ahorrar madera)'),
      h('p', {}, 'Coloca las piezas lo más juntas posible dentro de la hoja de madera; si no caben en una, usa más hojas.'),
      row('Hoja de madera', presetSel),
      h('div', { class: 'nest-grid' }, row(`Ancho (${unitLabel()})`, wIn), row(`Alto (${unitLabel()})`, hIn), row(`Separación entre piezas (${unitLabel()})`, gapIn), row(`Margen del borde (${unitLabel()})`, marIn)),
      h('label', { class: 'check' }, rot, ' Permitir girar las piezas 90° (ahorra más madera)'),
      status,
      h('div', { class: 'dialog-actions' }, cancel, go));
    document.body.append(dialog);
    dialog.showModal();
  }
  // Una hoja del acomodo: las piezas cuyo centro cae dentro de ella
  function sheetItems(k) {
    const { items } = exportItems(), n = doc.nest, x0 = k * (n.w + n.gap);
    return { x0, items: items.filter(it => { const b = bboxOfItems([it]); return b && b.x + b.w / 2 >= x0 - 1 && b.x + b.w / 2 <= x0 + n.w + 1; }) };
  }
  function exportSheets(kind) {
    if (!doc.nest || !doc.nest.count) return;
    let k = 0;
    const next = () => {
      if (k >= doc.nest.count) return;
      const idx = k; withFonts(() => (kind === 'dxf' ? exportDXF : exportSVG)({ sheet: idx }));
      k++; setTimeout(next, 900);
    };
    next();
    msg(`Exportando ${doc.nest.count} archivo(s), uno por hoja. Si tu navegador pregunta, permite las descargas múltiples.`);
  }

  /* ================= Imágenes: quitar el fondo y vectorizar (trace) ================= */
  const loadImage = href => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagen no válida')); i.src = href; });
  function workCanvas(img, maxSide) {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, c.width, c.height);
    return { c, x, w: c.width, h: c.height };
  }
  // Luminosidad 0-255 (lo transparente cuenta como blanco)
  function grayOf(data, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      const a = data[p + 3] / 255;
      g[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) * a + 255 * (1 - a);
    }
    return g;
  }
  function otsuLevel(g) {
    const hist = new Array(256).fill(0);
    for (const v of g) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
    const total = g.length;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, lvl = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sB += t * hist[t];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; lvl = t; }
    }
    return lvl;
  }
  function boxBlurField(src, w, h, r) {
    if (r <= 0) return src;
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * w + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / n;
        acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / n;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  // Curvas de nivel (marching squares): devuelve lazos cerrados [[x, y], …] donde el valor cruza "level"; lo que está por debajo queda dentro
  function contoursAt(f, w, h, level) {
    const val = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 255 : f[y * w + x];
    const stride = w + 2, eid = (horiz, x, y) => ((y + 1) * stride + (x + 1)) * 2 + (horiz ? 0 : 1);
    const edges = new Map(), segs = [];
    const lerp = (a, b) => { const d = b - a; return d === 0 ? 0.5 : (level - a) / d; };
    const getEdge = (id, pt) => { let e = edges.get(id); if (!e) { e = { pt, s: [] }; edges.set(id, e); } return e; };
    const TABLE = [[], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]], [[3, 2]], [[0, 2]], [[0, 1], [3, 2]], [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], []];
    for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
      const tl = val(x, y), tr = val(x + 1, y), br = val(x + 1, y + 1), bl = val(x, y + 1);
      const idx = (tl < level ? 1 : 0) | (tr < level ? 2 : 0) | (br < level ? 4 : 0) | (bl < level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const pts = [
        () => getEdge(eid(true, x, y), [x + lerp(tl, tr), y]),       // 0: arriba
        () => getEdge(eid(false, x + 1, y), [x + 1, y + lerp(tr, br)]), // 1: derecha
        () => getEdge(eid(true, x, y + 1), [x + lerp(bl, br), y + 1]),  // 2: abajo
        () => getEdge(eid(false, x, y), [x, y + lerp(tl, bl)]),         // 3: izquierda
      ];
      for (const [a, b] of TABLE[idx]) { const ea = pts[a](), eb = pts[b](); const sg = { a: ea, b: eb, used: false }; ea.s.push(sg); eb.s.push(sg); segs.push(sg); }
    }
    const loops = [];
    for (const sg0 of segs) {
      if (sg0.used) continue;
      sg0.used = true;
      const path = [sg0.a.pt]; let cur = sg0.b, start = sg0.a, guard = 0;
      while (cur !== start && guard++ < 5e6) {
        path.push(cur.pt);
        const nx = cur.s.find(q => !q.used);
        if (!nx) break;
        nx.used = true;
        cur = nx.a === cur ? nx.b : nx.a;
      }
      if (path.length >= 3) loops.push(path);
    }
    return loops;
  }
  const loopArea = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return a / 2; };
  function simplifyLoop(pts, tol) {
    if (tol <= 0 || pts.length < 6) return pts;
    const sd = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; if (!L) return Math.hypot(p[0] - a[0], p[1] - a[1]); const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); };
    const dp = (arr) => {
      const keep = new Array(arr.length).fill(false); keep[0] = keep[arr.length - 1] = true;
      const stack = [[0, arr.length - 1]];
      while (stack.length) {
        const [i, j] = stack.pop(); let md = 0, mi = -1;
        for (let k = i + 1; k < j; k++) { const d = sd(arr[k], arr[i], arr[j]); if (d > md) { md = d; mi = k; } }
        if (md > tol && mi > 0) { keep[mi] = true; stack.push([i, mi], [mi, j]); }
      }
      return arr.filter((_, k) => keep[k]);
    };
    // lazo cerrado: se parte por el punto más lejano del primero
    let far = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
    const a = dp(pts.slice(0, far + 1)), b = dp([...pts.slice(far), pts[0]]);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
  }
  function traceImageData(id, w, h, o) {
    let g = grayOf(id.data, w, h);
    if (o.invert) g = g.map(v => 255 - v);
    g = boxBlurField(g, w, h, o.blur);
    const loops = contoursAt(g, w, h, o.level);
    const out = [];
    for (const lp of loops) {
      if (Math.abs(loopArea(lp)) < o.minArea) continue;
      const s = simplifyLoop(lp, o.tol);
      if (s.length >= 3) out.push(s);
    }
    return out;
  }

  // Ventana común (vista previa a la izquierda, controles a la derecha)
  function imageDialog(title, help) {
    const dialog = h('dialog', { class: 'batch-dialog imgtool-dialog', 'aria-label': title });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    return { dialog, close, head: [h('h2', {}, title), h('p', { class: 'tip' }, help)] };
  }
  const sliderRow = (label, min, max, step, value, onInput, fmtv = v => v) => {
    const out = h('span', { class: 'slider-val' }, String(fmtv(value))), inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    inp.addEventListener('input', () => { out.textContent = String(fmtv(+inp.value)); onInput(+inp.value); });
    return { el: h('label', { class: 'slider-row' }, h('span', {}, label, ' ', out), inp), inp, out };
  };

  async function openTraceTool(s) {
    const a = doc.assets[s.p.asset];
    if (!a || a.kind !== 'image') return;
    let img;
    try { img = await loadImage(a.href); } catch (e) { msg('No se pudo leer la imagen.'); return; }
    const W = workCanvas(img, 700), id = W.x.getImageData(0, 0, W.w, W.h);
    const { dialog, close, head } = imageDialog('Vectorizar imagen (trace)', 'Convierte la imagen en contornos que se pueden cortar o grabar. Funciona mejor con logos, dibujos y siluetas con buen contraste.');
    const st = { level: otsuLevel(grayOf(id.data, W.w, W.h)), blur: 1, tol: 0.6, minArea: 30, invert: false, mode: 'corte', keep: false };
    const view = h('canvas', { class: 'imgtool-canvas' });
    view.width = W.w; view.height = W.h;
    const status = h('p', { class: 'tip', role: 'status' });
    let loops = [], timer = 0;
    const draw = () => {
      const c = view.getContext('2d');
      c.clearRect(0, 0, W.w, W.h); c.globalAlpha = 0.35; c.drawImage(W.c, 0, 0); c.globalAlpha = 1;
      c.lineWidth = Math.max(1, W.w / 400); c.strokeStyle = '#e0301e'; c.fillStyle = st.mode === 'grabado' ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0)';
      c.beginPath();
      for (const lp of loops) { lp.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); }
      if (st.mode === 'grabado') c.fill('evenodd'); c.stroke();
    };
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        loops = traceImageData(id, W.w, W.h, st);
        draw();
        const pts = loops.reduce((n, l) => n + l.length, 0);
        status.textContent = loops.length ? `${loops.length} contorno(s), ${pts} puntos.` + (pts > 20000 ? ' Son muchos puntos: sube «Suavidad».' : '') : 'No se encontró ninguna forma: mueve el umbral o cambia «La forma es lo oscuro / lo claro».';
        go.disabled = !loops.length;
      }, 90);
    };
    const levelRow = sliderRow('Umbral (qué es forma)', 1, 254, 1, Math.round(st.level), v => { st.level = v; run(); });
    const blurRow = sliderRow('Suavizar la imagen', 0, 5, 1, st.blur, v => { st.blur = v; run(); });
    const tolRow = sliderRow('Suavidad del contorno (menos puntos)', 0, 5, 0.1, st.tol, v => { st.tol = v; run(); }, v => v.toFixed(1));
    const areaRow = sliderRow('Ignorar manchas menores a (px²)', 0, 500, 5, st.minArea, v => { st.minArea = v; run(); });
    const auto = h('button', { onclick: () => { st.level = otsuLevel(grayOf(id.data, W.w, W.h)); levelRow.inp.value = st.level; levelRow.out.textContent = Math.round(st.level); run(); } }, 'Umbral automático');
    const inv = h('select', { 'aria-label': 'Qué parte es la forma' }, h('option', { value: 'no' }, 'La forma es lo oscuro'), h('option', { value: 'si' }, 'La forma es lo claro'));
    inv.onchange = () => { st.invert = inv.value === 'si'; run(); };
    const modeSel = h('select', { 'aria-label': 'Resultado' }, h('option', { value: 'corte' }, 'Contorno para cortar (rojo)'), h('option', { value: 'grabado' }, 'Relleno para grabar (negro)'));
    modeSel.onchange = () => { st.mode = modeSel.value; draw(); };
    const keep = h('input', { type: 'checkbox' }); keep.onchange = () => { st.keep = keep.checked; };
    const go = h('button', { class: 'primary', disabled: '' }, 'Crear vectores');
    go.onclick = () => {
      if (!loops.length) return;
      const x = len(s, 'x'), y = len(s, 'y'), wmm = Math.abs(len(s, 'w')), hmm = s.p.prop === 'no' ? Math.abs(len(s, 'h')) : wmm * a.h / a.w;
      const rot = num(s, 'rot', 0) || 0, cx = x + wmm / 2, cy = y + hmm / 2, cs = Math.cos(rot * DEG), sn = Math.sin(rot * DEG);
      const place = ([px, py]) => { const X = x + px * wmm / W.w, Y = y + py * hmm / W.h; return rot ? [cx + (X - cx) * cs - (Y - cy) * sn, cy + (X - cx) * sn + (Y - cy) * cs] : [X, Y]; };
      const polys = loops.map(lp => ({ closed: true, op: st.mode, pts: lp.map(place) }));
      const o = importObject(nextName((s.name || 'Imagen') + ' vectorizada'), polys, []);
      o.op = st.mode;
      const list = listOf(s.id), i = list.indexOf(s);
      list.splice(st.keep ? i + 1 : i, st.keep ? 0 : 1, o);
      sel = new Set([o.id]);
      close(); checkpoint(); fullRender();
      msg(`Vectorizada: ${loops.length} contorno(s). Edita sus puntos con doble clic y conviértelos en curvas con la Pluma.`);
    };
    const side = h('div', { class: 'imgtool-side' },
      h('label', {}, 'Qué parte es la forma', inv), levelRow.el, auto, blurRow.el, tolRow.el, areaRow.el,
      h('label', {}, 'Resultado', modeSel), h('label', { class: 'check' }, keep, ' Conservar la imagen original'), status);
    dialog.append(...head, h('div', { class: 'imgtool' }, h('div', { class: 'imgtool-view' }, view), side),
      h('div', { class: 'dialog-actions' }, h('button', { onclick: close }, 'Cancelar'), go));
    document.body.append(dialog); dialog.showModal();
    run();
  }

  async function openBgTool(s) {
    const a = doc.assets[s.p.asset];
    if (!a || a.kind !== 'image') return;
    let img;
    try { img = await loadImage(a.href); } catch (e) { msg('No se pudo leer la imagen.'); return; }
    const W = workCanvas(img, 900), src = W.x.getImageData(0, 0, W.w, W.h), n = W.w * W.h;
    const { dialog, close, head } = imageDialog('Quitar el fondo', 'Haz clic en el fondo para elegir su color; ajusta la tolerancia. Con el pincel borras o recuperas a mano.');
    const st = { target: [src.data[0], src.data[1], src.data[2]], tol: 40, contiguous: true, feather: 1, tool: 'pick', size: 18 };
    const manual = new Int16Array(n).fill(-1);
    let alpha = new Uint8Array(n).fill(255), timer = 0;
    const view = h('canvas', { class: 'imgtool-canvas checker' });
    view.width = W.w; view.height = W.h;
    const status = h('p', { class: 'tip', role: 'status' });
    const dist = i => { const p = i * 4; return Math.sqrt(((src.data[p] - st.target[0]) ** 2 + (src.data[p + 1] - st.target[1]) ** 2 + (src.data[p + 2] - st.target[2]) ** 2) / 3); };
    const compute = () => {
      const bg = new Uint8Array(n), isBg = i => src.data[i * 4 + 3] < 12 || dist(i) <= st.tol;
      if (st.contiguous) {
        const stack = [];
        const push = i => { if (!bg[i] && isBg(i)) { bg[i] = 1; stack.push(i); } };
        for (let x = 0; x < W.w; x++) { push(x); push((W.h - 1) * W.w + x); }
        for (let y = 0; y < W.h; y++) { push(y * W.w); push(y * W.w + W.w - 1); }
        if (st.seed !== undefined) push(st.seed);
        while (stack.length) {
          const i = stack.pop(), x = i % W.w, y = (i - x) / W.w;
          if (x > 0) push(i - 1); if (x < W.w - 1) push(i + 1); if (y > 0) push(i - W.w); if (y < W.h - 1) push(i + W.w);
        }
      } else for (let i = 0; i < n; i++) if (isBg(i)) bg[i] = 1;
      let f = Float32Array.from(bg, v => v ? 0 : 255);
      f = boxBlurField(f, W.w, W.h, st.feather);
      alpha = Uint8Array.from(f, v => Math.max(0, Math.min(255, Math.round(v))));
    };
    const render = () => {
      const out = W.x.createImageData(W.w, W.h);
      let kept = 0;
      for (let i = 0; i < n; i++) {
        const a2 = manual[i] >= 0 ? manual[i] : alpha[i], p = i * 4;
        out.data[p] = src.data[p]; out.data[p + 1] = src.data[p + 1]; out.data[p + 2] = src.data[p + 2]; out.data[p + 3] = Math.round(src.data[p + 3] * a2 / 255);
        if (a2 > 127) kept++;
      }
      view.getContext('2d').putImageData(out, 0, 0);
      status.textContent = `Se conserva el ${Math.round(kept / n * 100)} % de la imagen.`;
      return out;
    };
    const recompute = () => { clearTimeout(timer); timer = setTimeout(() => { compute(); render(); }, 70); };
    compute(); render();
    const posOf = e => { const r = view.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) * W.w / r.width), Math.floor((e.clientY - r.top) * W.h / r.height)]; };
    const paint = (x, y, restore) => {
      const r = st.size * W.w / view.getBoundingClientRect().width / 2;
      for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(W.h - 1, Math.ceil(y + r)); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(W.w - 1, Math.ceil(x + r)); xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) manual[yy * W.w + xx] = restore ? 255 : 0;
    };
    let painting = false;
    view.addEventListener('pointerdown', e => {
      const [x, y] = posOf(e);
      if (x < 0 || y < 0 || x >= W.w || y >= W.h) return;
      if (st.tool === 'pick') { const p = (y * W.w + x) * 4; st.target = [src.data[p], src.data[p + 1], src.data[p + 2]]; st.seed = y * W.w + x; swatch.style.background = `rgb(${st.target.join(',')})`; manual.fill(-1); compute(); render(); return; }
      painting = true; view.setPointerCapture(e.pointerId); paint(x, y, st.tool === 'restore'); render();
    });
    view.addEventListener('pointermove', e => { if (!painting) return; const [x, y] = posOf(e); paint(x, y, st.tool === 'restore'); render(); });
    view.addEventListener('pointerup', () => { painting = false; });
    const swatch = h('span', { class: 'swatch' }); swatch.style.background = `rgb(${st.target.join(',')})`;
    const tolRow = sliderRow('Tolerancia del color', 0, 150, 1, st.tol, v => { st.tol = v; recompute(); });
    const featRow = sliderRow('Suavizar el borde', 0, 4, 1, st.feather, v => { st.feather = v; recompute(); });
    const sizeRow = sliderRow('Tamaño del pincel', 4, 80, 2, st.size, v => { st.size = v; });
    const toolSel = h('select', { 'aria-label': 'Herramienta' }, h('option', { value: 'pick' }, 'Elegir el color del fondo (clic)'), h('option', { value: 'erase' }, 'Pincel: borrar'), h('option', { value: 'restore' }, 'Pincel: recuperar'));
    toolSel.onchange = () => { st.tool = toolSel.value; view.style.cursor = st.tool === 'pick' ? 'crosshair' : 'cell'; };
    const cont = h('input', { type: 'checkbox', checked: '' }); cont.onchange = () => { st.contiguous = cont.checked; recompute(); };
    const reset = h('button', { onclick: () => { manual.fill(-1); render(); } }, 'Deshacer el pincel');
    const go = h('button', { class: 'primary' }, 'Quitar fondo');
    go.onclick = () => {
      const out = render(), c = document.createElement('canvas');
      c.width = W.w; c.height = W.h; c.getContext('2d').putImageData(out, 0, 0);
      const nid = 'a' + uid();
      doc.assets[nid] = { ...a, w: W.w, h: W.h, href: c.toDataURL('image/png') };
      s.p.asset = nid;
      close(); checkpoint(); fullRender();
      msg('Fondo quitado. Ahora puedes vectorizar la imagen para cortarla o dejarla para grabar.');
    };
    const side = h('div', { class: 'imgtool-side' }, h('label', {}, 'Herramienta', toolSel), h('div', { class: 'swatch-row' }, 'Color del fondo ', swatch),
      tolRow.el, h('label', { class: 'check' }, cont, ' Solo el fondo que toca el borde'), featRow.el, sizeRow.el, reset, status);
    dialog.append(...head, h('div', { class: 'imgtool' }, h('div', { class: 'imgtool-view' }, view), side),
      h('div', { class: 'dialog-actions' }, h('button', { onclick: close }, 'Cancelar'), go));
    document.body.append(dialog); dialog.showModal();
  }

  /* ================= Recortar (crop) ================= */
  // Aplica un recorte (en píxeles de trabajo) a la imagen de una figura, dejando lo que queda en su mismo lugar
  function applyImageCrop(s, a, W, r) {
    const x = len(s, 'x'), y = len(s, 'y'), wmm = Math.abs(len(s, 'w')), hmm = s.p.prop === 'no' ? Math.abs(len(s, 'h')) : wmm * a.h / a.w;
    const kx = wmm / W.w, ky = hmm / W.h;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w)); c.height = Math.max(1, Math.round(r.h));
    c.getContext('2d').drawImage(W.c, Math.round(r.x), Math.round(r.y), c.width, c.height, 0, 0, c.width, c.height);
    const nid = 'a' + uid();
    doc.assets[nid] = { ...a, w: c.width, h: c.height, href: c.toDataURL('image/png'), realW: a.realW ? a.realW * c.width / W.w : a.realW };
    s.p.asset = nid;
    s.p.x = fmt((x + Math.round(r.x) * kx) / unitMM); s.p.y = fmt((y + Math.round(r.y) * ky) / unitMM);
    s.p.w = fmt(c.width * kx / unitMM, 3);
    if (s.p.prop === 'no') s.p.h = fmt(c.height * ky / unitMM, 3);
  }
  async function openCropTool(s) {
    const a = doc.assets[s.p.asset];
    if (!a || a.kind !== 'image') return;
    if ((num(s, 'rot', 0) || 0) !== 0) { msg('Pon la rotación de la imagen en 0° para recortarla.'); return; }
    let img;
    try { img = await loadImage(a.href); } catch (e) { msg('No se pudo leer la imagen.'); return; }
    const W = workCanvas(img, 1600);
    const { dialog, close, head } = imageDialog('Recortar imagen', 'Arrastra el recuadro o sus bordes y esquinas para elegir lo que se queda. Arrastra fuera del recuadro para dibujar uno nuevo.');
    let r = { x: W.w * 0.1, y: W.h * 0.1, w: W.w * 0.8, h: W.h * 0.8 }, ratio = 0, act = null;
    const view = h('canvas', { class: 'imgtool-canvas' });
    view.width = W.w; view.height = W.h;
    const info = h('p', { class: 'tip', role: 'status' });
    const clamp = () => {
      r.w = Math.max(8, Math.min(W.w, r.w)); r.h = Math.max(8, Math.min(W.h, r.h));
      r.x = Math.max(0, Math.min(W.w - r.w, r.x)); r.y = Math.max(0, Math.min(W.h - r.h, r.y));
    };
    const draw = () => {
      const c = view.getContext('2d');
      c.clearRect(0, 0, W.w, W.h); c.drawImage(W.c, 0, 0);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.rect(0, 0, W.w, W.h); c.rect(r.x, r.y, r.w, r.h); c.fill('evenodd');
      const f = W.w / 700 + 0.5;
      c.strokeStyle = '#fff'; c.lineWidth = 2 * f; c.strokeRect(r.x, r.y, r.w, r.h);
      c.fillStyle = '#fff'; c.strokeStyle = '#2f7d4f'; c.lineWidth = 1.5 * f;
      for (const [hx, hy] of handles()) { c.beginPath(); c.rect(hx - 5 * f, hy - 5 * f, 10 * f, 10 * f); c.fill(); c.stroke(); }
      const k = a.realW ? a.realW / W.w : 0;
      info.textContent = `Recorte: ${Math.round(r.w)} × ${Math.round(r.h)} px (${fmt(r.w / W.w * 100, 0)} % del ancho).`;
    };
    const handles = () => [[r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h / 2], [r.x + r.w, r.y + r.h], [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h / 2]];
    const NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const pos = e => { const b = view.getBoundingClientRect(); return [(e.clientX - b.left) * W.w / b.width, (e.clientY - b.top) * W.h / b.height, W.w / b.width]; };
    view.addEventListener('pointerdown', e => {
      const [px, py, f] = pos(e);
      const hs = handles(), hi = hs.findIndex(([x, y]) => Math.abs(x - px) < 12 * f && Math.abs(y - py) < 12 * f);
      view.setPointerCapture(e.pointerId);
      if (hi >= 0) act = { kind: NAMES[hi], r0: { ...r } };
      else if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) act = { kind: 'move', r0: { ...r }, sx: px, sy: py };
      else act = { kind: 'new', sx: px, sy: py };
    });
    view.addEventListener('pointermove', e => {
      if (!act) return;
      const [px, py] = pos(e), o = act.r0;
      if (act.kind === 'move') { r.x = o.x + px - act.sx; r.y = o.y + py - act.sy; clamp(); }
      else if (act.kind === 'new') { r = { x: Math.min(act.sx, px), y: Math.min(act.sy, py), w: Math.abs(px - act.sx), h: Math.abs(py - act.sy) }; if (ratio) r.h = r.w / ratio; clamp(); }
      else {
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        const k = act.kind;
        if (k.includes('w')) x0 = Math.min(px, x1 - 8); if (k.includes('e')) x1 = Math.max(px, x0 + 8);
        if (k.includes('n')) y0 = Math.min(py, y1 - 8); if (k.includes('s')) y1 = Math.max(py, y0 + 8);
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W.w, x1); y1 = Math.min(W.h, y1);
        r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        if (ratio) {
          if (k === 'n' || k === 's') { const nw = r.h * ratio; r.x += (r.w - nw) / 2; r.w = nw; }
          else { const nh = r.w / ratio; if (k.includes('n')) r.y = y1 - nh; r.h = nh; }
        }
        clamp();
      }
      draw();
    });
    const end = () => { act = null; };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    const ratioSel = h('select', { 'aria-label': 'Proporción' }, ...[['Libre', 0], ['Cuadrado 1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['Como la imagen', W.w / W.h]].map(([l, v]) => h('option', { value: String(v) }, l)));
    ratioSel.onchange = () => { ratio = +ratioSel.value; if (ratio) { r.h = r.w / ratio; clamp(); if (r.h > W.h) { r.h = W.h; r.w = r.h * ratio; clamp(); } } draw(); };
    const all = h('button', { onclick: () => { r = { x: 0, y: 0, w: W.w, h: W.h }; draw(); } }, 'Toda la imagen');
    const go = h('button', { class: 'primary' }, 'Recortar');
    go.onclick = () => { applyImageCrop(s, a, W, r); close(); checkpoint(); fullRender(); msg('Imagen recortada; sigue en su mismo lugar. Puedes quitarle el fondo o vectorizarla.'); };
    dialog.append(...head, h('div', { class: 'imgtool' }, h('div', { class: 'imgtool-view' }, view), h('div', { class: 'imgtool-side' }, h('label', {}, 'Proporción', ratioSel), all, info)),
      h('div', { class: 'dialog-actions' }, h('button', { onclick: close }, 'Cancelar'), go));
    document.body.append(dialog); dialog.showModal();
    draw();
  }
  // Recortar con la figura de encima: las demás figuras se quedan solo con la parte que cae dentro de ella (las imágenes, dentro de su caja)
  async function cropWithShape() {
    evaluateParams(); evaluateAll();
    const order = selectedRoots().sort((p, q) => doc.shapes.indexOf(p) - doc.shapes.indexOf(q));
    if (order.length < 2) { msg('Dibuja un rectángulo (o cualquier figura cerrada) encima de lo que quieres recortar, elige todo con Shift + clic y pulsa «Recortar con la figura de encima».'); return; }
    const cutter = order[order.length - 1], targets = order.slice(0, -1), cr = evalCache.get(cutter.id);
    const closed = cr ? cr.items.flatMap(it => it.polys.filter(p => p.closed && p.pts.length >= 3)) : [];
    if (!closed.length) { msg('La figura de encima debe ser cerrada (rectángulo, círculo, polígono…).'); return; }
    const clipPaths = normalize(toC(closed)), cb = cr.bbox;
    const made = [], skipped = [], empty = [];
    for (const t of targets) {
      const r = evalCache.get(t.id), a = t.type === 'import' && doc.assets && doc.assets[t.p.asset];
      if (!r || SEPARABLE.has(t.type)) { skipped.push(t.name); continue; }
      if (a && a.kind === 'image') {
        if ((num(t, 'rot', 0) || 0) !== 0) { skipped.push(t.name); continue; }
        let img; try { img = await loadImage(a.href); } catch (e) { skipped.push(t.name); continue; }
        const Wc = workCanvas(img, 1600), x = len(t, 'x'), y = len(t, 'y'), wmm = Math.abs(len(t, 'w')), hmm = t.p.prop === 'no' ? Math.abs(len(t, 'h')) : wmm * a.h / a.w;
        const x0 = Math.max(x, cb.x), y0 = Math.max(y, cb.y), x1 = Math.min(x + wmm, cb.x + cb.w), y1 = Math.min(y + hmm, cb.y + cb.h);
        if (x1 - x0 < 0.2 || y1 - y0 < 0.2) { empty.push(t.name); continue; }
        applyImageCrop(t, a, Wc, { x: (x0 - x) / wmm * Wc.w, y: (y0 - y) / hmm * Wc.h, w: (x1 - x0) / wmm * Wc.w, h: (y1 - y0) / hmm * Wc.h });
        made.push(t);
        continue;
      }
      if (r.items.some(it => (it.images || []).length)) { skipped.push(t.name); continue; }
      const pieces = [];
      for (const it of r.items) {
        const cl = it.polys.filter(p => p.closed && p.pts.length >= 3);
        if (!cl.length) continue;
        const part = fromC(clipEO(CL.ClipType.ctIntersection, toC(cl), clipPaths)).filter(p => Math.abs(polyArea(p.pts)) > 0.01);
        if (part.length) for (const grp of splitPieces(part)) pieces.push(grp.map(p => ({ ...p, op: it.op })));
      }
      if (!pieces.length) { empty.push(t.name); continue; }
      const list = listOf(t.id), at = list.indexOf(t);
      const objs = pieces.map((pl, i) => { const o = importObject(pieces.length > 1 ? `${t.name} · parte ${i + 1}` : t.name, pl, []); o.op = t.op; return o; });
      list.splice(at, 1, ...objs);
      made.push(...objs);
    }
    if (!made.length) { msg(empty.length ? 'Ninguna figura toca la de encima: colócala sobre lo que quieres conservar.' : `No se pudo recortar: ${skipped.join(', ')}.`); return; }
    const li = listOf(cutter.id), lx = li.indexOf(cutter); if (lx >= 0) li.splice(lx, 1);
    sel = new Set(made.map(o => o.id));
    checkpoint(); fullRender();
    msg(`Recortado: ${made.length} figura(s).` + (empty.length ? ` Quedaron fuera: ${empty.join(', ')}.` : '') + (skipped.length ? ` No se pudo recortar: ${skipped.join(', ')}.` : ''));
  }

  /* ================= Soldar letras (unir las letras en un solo contorno) ================= */
  function roundGrow(paths, d) {
    const co = new CL.ClipperOffset(2, 0.01 * SC);
    co.AddPaths(paths, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    const sol = new CL.Paths();
    co.Execute(sol, d * SC);
    return sol;
  }
  async function openWeldTool(s) {
    if (!s || s.type !== 'text') return;
    const fid = s.p.fuente || 'arial';
    if (fid === 'arial') { msg('Para soldar las letras elige una de las tipografías de la lista (no «Arial del sistema»): así se pueden convertir en curvas.'); return; }
    try { await loadFont(fid); } catch (e) { msg('No se pudo cargar la tipografía.'); return; }
    evaluateParams(); evaluateAll();
    const r = evalCache.get(s.id);
    if (!r) return;
    const base = r.items.flatMap(it => fontOutlines(it).polys).filter(p => p.closed && p.pts.length >= 3);
    if (!base.length) { msg('No hay letras que convertir: escribe el texto primero.'); return; }
    const dialog = h('dialog', { class: 'batch-dialog imgtool-dialog', 'aria-label': 'Soldar letras' });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    const st = { grow: 0, fill: false, op: 'corte', keep: false };
    const bb = ptsBoxAll(base), pad = 4, W = 760, sc = W / (bb.x1 - bb.x0 + 2 * pad), CW = Math.round((bb.x1 - bb.x0 + 2 * pad) * sc), CH = Math.max(60, Math.round((bb.y1 - bb.y0 + 2 * pad) * sc));
    const cv = h('canvas', { class: 'imgtool-canvas', width: String(CW), height: String(CH) });
    const status = h('p', { class: 'tip', role: 'status' });
    let polys = [];
    const compute = () => {
      let u = normalize(toC(base));
      if (st.grow > 0) u = roundGrow(u, st.grow);
      polys = fromC(u);
      if (st.fill) polys = polys.filter(p => !polys.some(q => q !== p && inPoly(p.pts[0], q.pts)));
      const c = cv.getContext('2d');
      c.clearRect(0, 0, CW, CH);
      c.beginPath();
      for (const p of polys) { p.pts.forEach(([x, y], i) => { const X = (x - bb.x0 + pad + (st.grow > 0 ? 0 : 0)) * sc, Y = (y - bb.y0 + pad) * sc; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); }
      c.fillStyle = st.op === 'grabado' ? 'rgba(0,0,0,0.8)' : 'rgba(224,48,30,0.15)'; c.fill('evenodd');
      c.strokeStyle = '#e0301e'; c.lineWidth = 1.4; c.stroke();
      const pieces = splitPieces(polys).length;
      status.textContent = `${pieces} pieza(s) y ${polys.length} contorno(s)` + (pieces === 1 ? ': todo el texto queda unido en una sola pieza.' : `: las letras no se tocan, quedan ${pieces} piezas sueltas. Sube «Engrosar» para unirlas.`);
    };
    const growRow = sliderRow('Engrosar para unir letras (mm)', 0, 4, 0.1, 0, v => { st.grow = v * unitMM / unitMM; compute(); }, v => v.toFixed(1));
    const fillCb = h('input', { type: 'checkbox' }); fillCb.onchange = () => { st.fill = fillCb.checked; compute(); };
    const opSel = h('select', { 'aria-label': 'Resultado' }, h('option', { value: 'corte' }, 'Cortar el contorno (rojo)'), h('option', { value: 'grabado' }, 'Grabar relleno (negro)'));
    opSel.onchange = () => { st.op = opSel.value; compute(); };
    const keepCb = h('input', { type: 'checkbox' }); keepCb.onchange = () => { st.keep = keepCb.checked; };
    const go = h('button', { class: 'primary' }, 'Soldar letras');
    go.onclick = () => {
      if (!polys.length) return;
      const o = importObject(nextName((s.name || 'Texto') + ' soldado'), polys.map(p => ({ ...p, op: st.op })), []);
      o.op = st.op;
      const list = listOf(s.id), i = list.indexOf(s);
      list.splice(st.keep ? i + 1 : i, st.keep ? 0 : 1, o);
      sel = new Set([o.id]);
      close(); checkpoint(); fullRender();
      msg('Letras soldadas: ahora es un dibujo editable (ya no cambia con el texto). Puedes mover sus puntos o darle contorno.');
    };
    const side = h('div', { class: 'imgtool-side' }, growRow.el,
      h('label', { class: 'check' }, fillCb, ' Rellenar los huecos de las letras (O, A, B…)'),
      h('label', {}, 'Resultado', opSel), h('label', { class: 'check' }, keepCb, ' Conservar el texto original'), status);
    dialog.append(h('h2', {}, 'Soldar letras'), h('p', { class: 'tip' }, 'Une las letras que se tocan o se enciman en un solo contorno, para que el láser no pase dos veces por el mismo lugar. Con «Engrosar» también une letras que quedan muy cerca.'),
      h('div', { class: 'imgtool' }, h('div', { class: 'imgtool-view' }, cv), side),
      h('div', { class: 'dialog-actions' }, h('button', { onclick: close }, 'Cancelar'), go));
    document.body.append(dialog); dialog.showModal();
    compute();
  }
  function ptsBoxAll(polys) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of polys) for (const [x, y] of p.pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; }

  function openBatch() {
    evaluateParams(); evaluateAll();
    if (!doc.shapes.length) { msg('Primero crea o abre un arte y escribe {{nombre}} en el texto que deseas personalizar.'); return; }
    if ([...sel].some(id => parentOf(id))) { msg('Selecciona el grupo completo del arte para crear el lote.'); return; }
    const base = JSON.parse(JSON.stringify(selectedRoots().length ? selectedRoots() : doc.shapes));
    const dialog = h('dialog', { class: 'batch-dialog', 'aria-labelledby': 'batchTitle' });
    const names = h('textarea', { rows: '8', placeholder: 'María\nJosé\nAna', 'aria-label': 'Nombres, uno por línea' });
    const cols = h('input', { type: 'number', value: '3', min: '1', max: '30', step: '1' });
    const gap = h('input', { type: 'number', value: nice(5), min: '0', step: 'any' });
    const width = h('input', { type: 'number', value: '0', min: '0', step: 'any' });
    const status = h('p', { role: 'status', 'aria-live': 'polite' });
    const preview = svgEl('svg', { class: 'batch-preview', role: 'img', 'aria-label': 'Vista previa del lote' });
    const generate = h('button', { class: 'primary', disabled: '' }, 'Crear lote en el lienzo');
    let pending = null;
    let debounce;
    const refresh = () => {
      clearTimeout(debounce); pending = null; generate.disabled = true; preview.replaceChildren();
      try {
        const list = names.value.split(/\r?\n/).map(n => n.trim()).filter(Boolean);
        const generated = buildBatch(base, list, Number(cols.value), Number(gap.value) * unitMM, Number(width.value) * unitMM);
        const items = generated.flatMap(g => evalShape(g).items);
        const b = bboxOfItems(items);
        preview.setAttribute('viewBox', `${b.x - 3} ${b.y - 3} ${b.w + 6} ${b.h + 6}`);
        renderItems(items, preview, '', false);
        const over = b.w > doc.sheet.w || b.h > doc.sheet.h;
        status.textContent = `${list.length} diseños · ${fmt(b.w / unitMM, 2)} × ${fmt(b.h / unitMM, 2)} ${unitLabel()}.` + (over ? ' No cabe en una sola tabla: ajusta las columnas o exporta para repartir las piezas.' : ' Cabe en el área de trabajo.');
        pending = generated; generate.disabled = false;
      } catch (err) { status.textContent = err.message; }
    };
    const close = () => { clearTimeout(debounce); dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    generate.onclick = () => {
      refresh(); if (!pending) return;
      checkpoint();
      doc.batchOriginal = { shapes: JSON.parse(JSON.stringify(doc.shapes)), name: doc.name };
      doc.shapes = pending; doc.name = doc.name + ' · lote'; sel.clear();
      checkpoint(); fullRender(); fitView(); close(); msg('Lote creado. Cada nombre es un grupo editable. Puedes exportar SVG o DXF, guardar y deshacer.');
    };
    dialog.append(h('h2', { id: 'batchTitle' }, 'Un arte, muchos nombres'),
      h('p', {}, 'Usa {{nombre}} en uno o varios textos de tu arte. Se copiará la selección completa; sin selección se usará todo el lienzo.'),
      h('p', { class: 'tip' }, 'El lote reemplaza el lienzo. Puedes deshacer o recuperar el arte anterior desde este panel.'),
      h('label', {}, 'Nombres — uno por línea (hasta 300)', names),
      h('div', { class: 'batch-fields' }, h('label', {}, 'Columnas', cols), h('label', {}, `Separación (${unitLabel()})`, gap), h('label', {}, `Ancho máximo del texto (${unitLabel()})`, width)),
      h('p', { class: 'tip' }, 'Ancho 0 conserva el tamaño. El límite reduce textos normales largos; no modifica el grabado paramétrico de cajas o canastas. Los nombres repetidos crean copias repetidas.'), status, preview,
      h('div', { class: 'batch-actions' }, h('button', { onclick: close }, 'Cancelar'), generate));
    if (doc.batchOriginal) dialog.append(h('button', { onclick: () => {
      checkpoint(); doc.shapes = doc.batchOriginal.shapes; doc.name = doc.batchOriginal.name; delete doc.batchOriginal;
      sel.clear(); checkpoint(); fullRender(); fitView(); close();
    } }, 'Recuperar arte anterior al último lote'));
    for (const input of [names, cols, gap, width]) input.addEventListener('input', () => { pending = null; generate.disabled = true; clearTimeout(debounce); debounce = setTimeout(refresh, 180); });
    document.body.append(dialog); dialog.showModal(); names.focus(); refresh();
  }
  $('#btnBatch').onclick = openBatch;
  $('#btnNest').onclick = openNest;

  /* ================= Acciones ================= */
  // Al borrar figuras se borran también las medidas tomadas sobre ellas
  function boxOfShape(id) { const ev = evalCache.get(id); return ev ? bboxOfItems(ev.items) : null; }
  function dropMeasuresOf(ids) {
    if (!(doc.measures || []).length) return 0;
    const gone = [...ids].map(boxOfShape).filter(Boolean);
    if (!gone.length) return 0;
    const keep = allShapes().filter(x => !ids.has(x.id)).map(x => boxOfShape(x.id)).filter(Boolean);
    const tol = 0.5, inside = (b, q) => q[0] >= b.x - tol && q[0] <= b.x + b.w + tol && q[1] >= b.y - tol && q[1] <= b.y + b.h + tol;
    const orphan = q => gone.some(b => inside(b, q)) && !keep.some(b => inside(b, q));
    const before = doc.measures.length;
    doc.measures = doc.measures.filter(m => !(m.kind === 'dos' ? orphan(m.a) || orphan(m.b) : orphan(m.p)));
    return before - doc.measures.length;
  }
  function deleteSel() {
    if (!sel.size) return;
    if ([...sel].some(id => (byId(id) || {}).locked)) { msg('Hay figuras bloqueadas: desbloquéalas (candado) para borrarlas.'); return; }
    dropMeasuresOf(new Set(sel));
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
  /* ----- Copiar, cortar y pegar (Cmd+C / Cmd+X / Cmd+V; también pega SVG e imágenes de otros programas) ----- */
  const CLIP_KEY = 'creaciones-evergreen:clip';
  let clipboardData = null, pasteCount = 0;
  function walkShapes(list, fn) { for (const s of list) { fn(s); if (s.children) walkShapes(s.children, fn); } }
  function copySel(cut) {
    const roots = selectedRoots();
    if (!roots.length) { msg('Elige primero lo que quieres copiar.'); return; }
    const shapes = roots.map(s => JSON.parse(JSON.stringify(s)));
    const assets = {}, used = [];
    walkShapes(shapes, s => {
      for (const k of ['asset', 'grabadoLogo']) if (s.p[k] && doc.assets && doc.assets[s.p[k]]) assets[s.p[k]] = doc.assets[s.p[k]];
      used.push(...Object.values(s.p).map(String));
    });
    // Parámetros que usan las figuras (y los que esos usan), para poder pegar en otro diseño
    const params = [], seen = new Set();
    const add = text => { for (const q of doc.params) if (!seen.has(q.name) && wordRe(q.name).test(text)) { seen.add(q.name); params.push({ name: q.name, expr: q.expr }); add(q.expr); } };
    add(used.join(' '));
    clipboardData = { shapes, assets: JSON.parse(JSON.stringify(assets)), params, units: doc.units };
    pasteCount = 0;
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clipboardData)); } catch (e) { /* si no cabe, queda solo en memoria */ }
    msg(`${shapes.length} figura(s) ${cut ? 'cortada(s)' : 'copiada(s)'}. Pega con Cmd+V (Cmd+Mayús+V pega en el mismo lugar).`);
    if (cut) deleteSel();
  }
  function pasteClip(inPlace) {
    let cd = clipboardData;
    if (!cd) { try { cd = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch (e) { cd = null; } }
    if (!cd || !Array.isArray(cd.shapes) || !cd.shapes.length) { msg('No hay nada copiado todavía: elige figuras y pulsa Cmd+C.'); return; }
    for (const q of cd.params || []) if (!doc.params.some(x => x.name === q.name)) doc.params.push({ name: q.name, expr: q.expr });
    doc.assets = doc.assets || {};
    for (const [id, a] of Object.entries(cd.assets || {})) if (!doc.assets[id]) doc.assets[id] = JSON.parse(JSON.stringify(a));
    pasteCount++;
    const off = inPlace ? 0 : parseFloat(nice(10)) * unitMM * pasteCount;
    const added = [];
    for (const src of cd.shapes) {
      if (!TYPES[src.type]) continue;
      const c = cloneShape(src);
      if (off) moveShape(c, src.p, off, off);
      doc.shapes.push(c);
      added.push(c);
    }
    if (!added.length) return;
    sel = new Set(added.map(c => c.id));
    checkpoint(); fullRender();
    msg(`${added.length} figura(s) pegada(s)` + (cd.units && cd.units !== doc.units ? '. Ojo: se copiaron con otras unidades; revisa las medidas.' : '.'));
  }
  // Pegar desde el portapapeles del sistema: SVG, imágenes o texto SVG
  document.addEventListener('paste', async e => {
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea, select, [contenteditable]')) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [...(dt.files || [])].filter(f => /^image\//.test(f.type) || /\.(svg|dxf)$/i.test(f.name));
    const text = dt.getData('text/plain') || '';
    e.preventDefault();
    try {
      if (files.length) { for (const f of files) await importFile(f); return; }
      if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) { await importFile(new File([text], 'pegado.svg', { type: 'image/svg+xml' })); return; }
    } catch (err) { msg('No se pudo pegar eso: ' + err.message); return; }
    pasteClip(false);
  });

  /* ----- Voltear (espejo) ----- */
  function flipSelection(axis) {
    evaluateParams(); evaluateAll();
    const roots = selectedRoots().filter(s => evalCache.get(s.id) && evalCache.get(s.id).bbox);
    if (!roots.length) { msg('Elige primero lo que quieres voltear.'); return; }
    const b = unionBox(roots.map(s => evalCache.get(s.id).bbox));
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const fp = ([x, y]) => axis === 'x' ? [2 * cx - x, y] : [x, 2 * cy - y];
    let texts = 0;
    const made = [];
    for (const s of roots) {
      const items = evalCache.get(s.id).items;
      const polys = items.flatMap(it => it.polys.map(p => ({ closed: p.closed, op: it.op, pts: p.pts.map(fp) })));
      const tx = items.flatMap(it => it.texts.map(t => ({ ...t, op: it.op, ...(() => { const [x, y] = fp([t.x, t.y]); return { x, y }; })() })));
      texts += tx.length;
      if (items.some(it => (it.images || []).length)) { msg('Las imágenes (PNG/JPG) no se pueden voltear aquí: voltea el archivo original.'); return; }
      if (!polys.length && !tx.length) continue;
      const o = importObject(s.name || 'Figura', polys, tx);
      if (polys.length === 0 || new Set(polys.map(p => p.op)).size === 1) o.op = s.op;
      const list = listOf(s.id), i = list.indexOf(s);
      list.splice(i, 1, o);
      made.push(o);
    }
    sel = new Set(made.map(o => o.id));
    checkpoint(); fullRender();
    msg(`${made.length} figura(s) volteada(s) ${axis === 'x' ? 'de izquierda a derecha' : 'de arriba abajo'}; ahora son dibujos editables.` + (texts ? ' Los textos cambian de lugar pero sus letras no se invierten.' : ''));
  }
  function flipSection() {
    return [h('div', { class: 'insp-sub' }, 'Voltear (espejo)'),
      h('div', { class: 'btn-grid' },
        h('button', { title: 'Espejo de izquierda a derecha', onclick: () => flipSelection('x') }, 'Voltear ↔'),
        h('button', { title: 'Espejo de arriba abajo', onclick: () => flipSelection('y') }, 'Voltear ↕'))];
  }

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
    for (const id of sel) { const s = byId(id); if (s && !s.locked) moveShape(s, { ...s.p }, dx, dy); }
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
    const label = { grupo: 'Grupo', unir: 'Unión', restar: 'Resta', intersectar: 'Intersección', excluir: 'Exclusión' }[mode];
    const g = { id: uid(), type: 'group', name: nextName(label), op: OPS[members[0].op] ? members[0].op : 'corte', p: { mode, x: '0', y: '0', rot: '0' }, children: members };
    for (const m of members) list.splice(list.indexOf(m), 1);
    list.splice(at, 0, g);
    sel = new Set([g.id]);
    checkpoint(); fullRender();
    if (mode === 'restar') msg(`"${members[0].name}" es la pieza; las demás figuras se recortan de ella.`);
  }
  function ungroupSel() {
    const boxes = [...sel].map(byId).filter(s => s && SEPARABLE.has(s.type));
    if (boxes.length) {
      if (!confirm(`Desagrupar convierte ${boxes.length > 1 ? 'estas cajas' : `«${boxes[0].name}»`} en piezas sueltas: ya no podrás cambiar los dedos, los anillos ni las medidas con parámetros.\n\nSi cambias de opinión, el botón «Volver a la caja con parámetros» (o Deshacer) la repone.\n\n¿Desagrupar?`)) return;
      separateMany(boxes); return;
    }
    const groups = [...sel].map(byId).filter(s => s && s.type === 'group');
    if (!groups.length) return;
    const newSel = new Set();
    // Conservar los efectos hasta que puedan transferirse sin alterar las piezas.
    if (groups.some(g => (num(g, 'rot', 0) || 0) !== 0 || (g.p.rep && g.p.rep !== 'no') || (g.p.off && len(g, 'off')) || (g.p.mode && g.p.mode !== 'grupo'))) {
      msg('Este grupo tiene efectos. Se conserva para no cambiar el diseño; edita sus piezas con doble clic.'); return;
    }
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

  /* ================= Orden de corte y simulación del láser ================= */
  const shoelace = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); };
  const ptsBox = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; };
  // Contornos en el orden en que conviene cortarlos: primero lo de adentro (líneas, agujeros), después el contorno de cada pieza; pieza por pieza, de izquierda a derecha y de arriba abajo
  function orderContours(group) {
    // Los tramos de un contorno con puentes forman un solo contorno (se cortan juntos, al final de la pieza)
    const byRef = new Map(), cs = [];
    for (const it of group) for (const p of it.polys) {
      if (p.pts.length < 2) continue;
      if (p.ref) {
        const key = p.refId + '|' + p.ref[0].join(',');
        let c = byRef.get(key);
        if (!c) { c = { pieces: [], b: ptsBox(p.ref), area: shoelace(p.ref), contain: p.ref, test: p.pts[0], kids: [], parent: null, solid: true }; byRef.set(key, c); cs.push(c); }
        c.pieces.push(p);
      } else cs.push({ pieces: [p], b: ptsBox(p.pts), area: p.closed ? shoelace(p.pts) : 0, contain: p.pts, test: p.pts[0], kids: [], parent: null, solid: !!(p.closed && p.pts.length >= 3) });
    }
    const closed = cs.filter(c => c.solid);
    const place = c => ({ row: Math.round(c.b.y0 / 25), x: c.b.x0 });
    const byPos = (a, b) => { const A = place(a), B = place(b); return A.row - B.row || A.x - B.x; };
    if (closed.length > 800) return cs.sort((a, b) => a.area - b.area).flatMap(c => c.pieces);
    for (const c of cs) {
      let best = null;
      for (const d of closed) {
        if (d === c || d.b.x0 > c.b.x0 + 1e-6 || d.b.y0 > c.b.y0 + 1e-6 || d.b.x1 < c.b.x1 - 1e-6 || d.b.y1 < c.b.y1 - 1e-6) continue;
        if (c.solid && d.area <= c.area) continue;
        if (!inPoly(c.test, d.contain)) continue;
        if (!best || d.area < best.area) best = d;
      }
      if (best) { c.parent = best; best.kids.push(c); }
    }
    const out = [], visit = c => { for (const k of c.kids.sort(byPos)) visit(k); out.push(...c.pieces); };
    for (const r of cs.filter(c => !c.parent).sort(byPos)) visit(r);
    return out;
  }
  // Todo lo que hace el láser, en orden: grabado, marcado y corte
  function laserSequence() {
    const { items } = exportItems(), seq = [];
    for (const op of ['grabado', 'marcado', 'corte']) {
      const group = items.filter(it => it.op === op);
      if (!group.length) continue;
      if (op === 'grabado') {
        const sorted = group.slice().sort((a, b) => { const A = bboxOfItems([a]) || { x: 0, y: 0 }, B = bboxOfItems([b]) || { x: 0, y: 0 }; return Math.round(A.y / 25) - Math.round(B.y / 25) || A.x - B.x; });
        for (const it of sorted) for (const p of it.polys) seq.push({ op, pts: p.pts, closed: p.closed });
      } else for (const p of (doc.cutOrder === 'lista' ? group.flatMap(it => it.polys) : orderContours(group))) seq.push({ op, pts: p.pts, closed: p.closed });
    }
    return seq;
  }
  function openSimulation() {
    evaluateParams(); evaluateAll();
    const seq = laserSequence();
    if (!seq.length) { msg('No hay nada que cortar o grabar todavía.'); return; }
    const dialog = h('dialog', { class: 'batch-dialog imgtool-dialog', 'aria-label': 'Simulación del láser' });
    const close = () => { running = false; cancelAnimationFrame(raf); dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    const all = seq.flatMap(s => s.pts), b = ptsBox(all), pad = 6;
    const W = 900, sc = Math.min(W / (b.x1 - b.x0 + 2 * pad), 560 / (b.y1 - b.y0 + 2 * pad)), CW = Math.round((b.x1 - b.x0 + 2 * pad) * sc), CH = Math.round((b.y1 - b.y0 + 2 * pad) * sc);
    const cv = h('canvas', { class: 'imgtool-canvas', width: String(CW), height: String(CH) });
    const tx = x => (x - b.x0 + pad) * sc, ty = y => (y - b.y0 + pad) * sc;
    // longitudes
    const lens = seq.map(s => { let L = 0; for (let i = 1; i < s.pts.length; i++) L += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); if (s.closed) L += Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]); return L; });
    const cutLen = lens.reduce((a, l, i) => a + (seq[i].op === 'corte' ? l : 0), 0), markLen = lens.reduce((a, l, i) => a + (seq[i].op === 'marcado' ? l : 0), 0);
    const engArea = seq.reduce((a, s) => a + (s.op === 'grabado' && s.closed ? shoelace(s.pts) : 0), 0);
    const inp = (v, min) => h('input', { type: 'number', min: String(min), step: 'any', value: String(v) });
    const vCut = inp(10, 0.1), vEng = inp(150, 1), vMove = inp(300, 10), dens = inp(0.1, 0.02);
    const timeEl = h('p', { class: 'tip' }), progEl = h('p', { role: 'status', 'aria-live': 'polite' });
    const estimate = () => {
      const travel = seq.reduce((a, s, i) => i ? a + Math.hypot(s.pts[0][0] - seq[i - 1].pts[seq[i - 1].pts.length - 1][0], s.pts[0][1] - seq[i - 1].pts[seq[i - 1].pts.length - 1][1]) : a, 0);
      const secs = cutLen / +vCut.value + markLen / +vCut.value + (engArea / +dens.value) / +vEng.value + travel / +vMove.value;
      timeEl.textContent = `Corte: ${fmt(cutLen / unitMM, isInch() ? 1 : 0)} ${unitLabel()} · ${seq.length} trazo(s) · tiempo aproximado ${secs >= 90 ? fmt(secs / 60, 1) + ' min' : Math.round(secs) + ' s'} (cambia las velocidades para tu madera).`;
    };
    for (const e of [vCut, vEng, vMove, dens]) e.oninput = estimate;
    estimate();
    let idx = 0, along = 0, running = false, raf = 0, speed = 60, showNum = false;
    const drawAll = () => {
      const c = cv.getContext('2d');
      c.clearRect(0, 0, CW, CH);
      c.strokeStyle = '#999'; c.setLineDash([6, 4]); c.strokeRect(tx(0), ty(0), doc.sheet.w * sc, doc.sheet.h * sc); c.setLineDash([]);
      const trace = (s, upto) => {
        c.beginPath();
        let rem = upto;
        s.pts.forEach(([x, y], i) => {
          if (!i) { c.moveTo(tx(x), ty(y)); return; }
          const px = s.pts[i - 1][0], py = s.pts[i - 1][1], d = Math.hypot(x - px, y - py);
          if (rem >= d) { c.lineTo(tx(x), ty(y)); rem -= d; } else if (rem > 0) { const t = rem / d; c.lineTo(tx(px + (x - px) * t), ty(py + (y - py) * t)); rem = 0; }
        });
        if (s.closed && rem > 0) c.closePath();
        c.stroke();
      };
      seq.forEach((s, i) => {
        if (i > idx) { c.globalAlpha = 0.18; c.strokeStyle = s.op === 'corte' ? '#e0301e' : s.op === 'grabado' ? '#222' : '#2c7be5'; c.lineWidth = 1; trace(s, Infinity); c.globalAlpha = 1; return; }
        c.strokeStyle = s.op === 'corte' ? '#e0301e' : s.op === 'grabado' ? '#111' : '#2c7be5'; c.lineWidth = s.op === 'grabado' ? 1.4 : 1.8;
        trace(s, i < idx ? Infinity : along);
      });
      if (showNum) { c.fillStyle = '#1a6b3c'; c.font = '11px sans-serif'; seq.forEach((s, i) => c.fillText(String(i + 1), tx(s.pts[0][0]) + 2, ty(s.pts[0][1]) - 2)); }
      // posición del láser
      const s = seq[Math.min(idx, seq.length - 1)];
      let rem = along, px = s.pts[0][0], py = s.pts[0][1];
      for (let i = 1; i < s.pts.length; i++) { const d = Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); if (rem <= d) { const t = d ? rem / d : 0; px = s.pts[i - 1][0] + (s.pts[i][0] - s.pts[i - 1][0]) * t; py = s.pts[i - 1][1] + (s.pts[i][1] - s.pts[i - 1][1]) * t; rem = -1; break; } rem -= d; px = s.pts[i][0]; py = s.pts[i][1]; }
      c.fillStyle = '#ff2d55'; c.beginPath(); c.arc(tx(px), ty(py), 5, 0, 7); c.fill();
      progEl.textContent = `Trazo ${Math.min(idx + 1, seq.length)} de ${seq.length} · ${seq[Math.min(idx, seq.length - 1)].op === 'corte' ? 'corte' : seq[Math.min(idx, seq.length - 1)].op}`;
    };
    const frame = () => {
      if (!running) return;
      along += speed * 0.4 / sc * 8;
      while (idx < seq.length && along >= lens[idx]) { along -= lens[idx]; idx++; }
      if (idx >= seq.length) { idx = seq.length - 1; along = lens[idx]; running = false; playBtn.textContent = 'Reproducir otra vez'; drawAll(); return; }
      drawAll(); raf = requestAnimationFrame(frame);
    };
    const playBtn = h('button', { class: 'primary' }, 'Reproducir');
    playBtn.onclick = () => {
      if (running) { running = false; playBtn.textContent = 'Continuar'; return; }
      if (idx >= seq.length - 1 && along >= lens[seq.length - 1]) { idx = 0; along = 0; }
      running = true; playBtn.textContent = 'Pausa'; raf = requestAnimationFrame(frame);
    };
    const resetBtn = h('button', { onclick: () => { running = false; idx = 0; along = 0; playBtn.textContent = 'Reproducir'; drawAll(); } }, 'Reiniciar');
    const sp = sliderRow('Velocidad de la animación', 1, 300, 1, speed, v => { speed = v; });
    const num2 = h('input', { type: 'checkbox' }); num2.onchange = () => { showNum = num2.checked; drawAll(); };
    const orderSel = h('select', { 'aria-label': 'Orden de corte' }, h('option', { value: 'auto' }, 'Agujeros primero, pieza por pieza (recomendado)'), h('option', { value: 'lista' }, 'Como están en el diseño'));
    orderSel.value = doc.cutOrder || 'auto';
    orderSel.onchange = () => { doc.cutOrder = orderSel.value; checkpoint(); close(); openSimulation(); };
    const side = h('div', { class: 'imgtool-side' }, progEl, h('label', {}, 'Orden de corte', orderSel), sp.el, h('label', { class: 'check' }, num2, ' Mostrar el número de cada trazo'),
      h('div', { class: 'insp-sub' }, 'Tiempo aproximado'), h('label', {}, `Velocidad de corte (${isInch() ? 'in/s' : 'mm/s'} aprox.)`, vCut), h('label', {}, 'Velocidad de grabado (mm/s)', vEng), h('label', {}, 'Separación de líneas del grabado (mm)', dens), h('label', {}, 'Velocidad de desplazamiento (mm/s)', vMove), timeEl);
    dialog.append(h('h2', {}, 'Simulación del láser'), h('p', { class: 'tip' }, 'Así recorrerá el láser tu diseño: primero el grabado, después el marcado y al final el corte (lo de adentro antes que el contorno de cada pieza).'),
      h('div', { class: 'imgtool' }, h('div', { class: 'imgtool-view' }, cv), side), h('div', { class: 'dialog-actions' }, resetBtn, playBtn, h('button', { onclick: close }, 'Cerrar')));
    document.body.append(dialog); dialog.showModal();
    drawAll();
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
    const items = doc.shapes.filter(s => !s.hidden).flatMap(s => (evalCache.get(s.id) || { items: [] }).items);
    const bad = doc.shapes.filter(s => !s.hidden).length - doc.shapes.filter(s => !s.hidden && evalCache.has(s.id)).length;
    return { items, bad, bbox: bboxOfItems(items) };
  }

  function exportSVG(opts) {
    let { items, bad, bbox: b } = exportItems();
    const sh = opts && opts.sheet !== undefined ? sheetItems(opts.sheet) : null;
    if (sh) { items = sh.items; b = bboxOfItems(items); }
    if (!b) { msg('No hay nada que exportar.'); return; }
    const m = 1;
    const x = b.x - m, y = b.y - m, w = b.w + 2 * m, hgt = b.h + 2 * m;
    const STROKE = { corte: '#FF0000', grabado: '#000000', marcado: '#0000FF' };
    // El SVG siempre sale en mm reales: xTool Creative Space lo importa al tamaño exacto.
    const out = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${r4(w)}mm" height="${r4(hgt)}mm" viewBox="${r4(x)} ${r4(y)} ${r4(w)} ${r4(hgt)}">`,
      `<!-- ${esc(doc.name)} · Evergreen Love Studio · rojo = corte, negro = grabado, azul = marcado -->`,
      ...(materialNote() ? [`<!-- ${esc(materialNote())} -->`] : []),
      // Copia del diseño editable: al abrir este SVG en Evergreen Love Studio se recupera todo (los programas de corte la ignoran)
      `<metadata id="evergreen-love-studio">${designPayload()}</metadata>`,
    ];
    const autoOrder = doc.cutOrder !== 'lista';
    for (const op of autoOrder ? ['grabado', 'marcado', 'corte'] : Object.keys(OPS)) {
      const group = items.filter(it => it.op === op);
      if (!group.length) continue;
      out.push(`<g id="${op}">`);
      const line = `fill="none" stroke="${STROKE[op]}" stroke-width="0.1"`;
      for (const it of group) {
        const closed = it.polys.filter(p => p.closed), open = it.polys.filter(p => !p.closed);
        if (op === 'grabado') {
          if (closed.length) out.push(`<path d="${pathD(closed)}" fill="#000000" fill-rule="evenodd" stroke="none"/>`);
          if (open.length) out.push(`<path d="${pathD(open)}" ${line}/>`);
        } else if (it.polys.length && !autoOrder) {
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
      if (autoOrder && op !== 'grabado') for (const c of orderContours(group)) out.push(`<path d="${pathD([c])}" fill="none" stroke="${STROKE[op]}" stroke-width="0.1"/>`);
      out.push('</g>');
    }
    out.push('</svg>');
    download(safeName() + (sh ? `-hoja-${opts.sheet + 1}` : '') + '.svg', out.join('\n'), 'image/svg+xml');
    msg(`SVG exportado: ${fmt(b.w / unitMM, 2)} × ${fmt(b.h / unitMM, 2)} ${unitLabel()}` + (bad ? ` (${bad} objeto(s) con error omitidos)` : ''));
  }

  // DXF (R12, en mm): capas CORTE (rojo), GRABADO (negro/blanco) y MARCADO (azul).
  function exportDXF(opts) {
    let { items, bad, bbox: b } = exportItems();
    const sh = opts && opts.sheet !== undefined ? sheetItems(opts.sheet) : null;
    if (sh) { items = sh.items; b = bboxOfItems(items); }
    const dx0 = sh ? sh.x0 : 0;
    if (!b) { msg('No hay nada que exportar.'); return; }
    const LAYERS = { corte: ['CORTE', 1], grabado: ['GRABADO', 7], marcado: ['MARCADO', 5] };
    let skippedImages = 0;
    const out = [];
    const g = (code, val) => { out.push(String(code), String(val)); };
    const dxfStr = s => s.replace(/[^\x20-\x7E]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    // Copia del diseño editable en comentarios (código 999), que los programas de CAD y corte ignoran
    const payload = designPayload();
    g(999, 'Evergreen Love Studio: ' + dxfStr(doc.name || ''));
    if (materialNote()) g(999, dxfStr(materialNote()));
    for (let i = 0; i < payload.length; i += 200) g(999, 'ELS:' + payload.slice(i, i + 200));
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
    const autoOrder = doc.cutOrder !== 'lista', rank = { grabado: 0, marcado: 1, corte: 2 };
    const emitPoly = (layer, p) => {
      g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, p.closed ? 1 : 0);
      for (const [x, y] of p.pts) { g(0, 'VERTEX'); g(8, layer); g(10, r4(x - dx0)); g(20, r4(-y)); g(30, 0); }
      g(0, 'SEQEND'); g(8, layer);
    };
    for (const it of autoOrder ? items.slice().sort((a, c) => rank[a.op] - rank[c.op]) : items) {
      const layer = LAYERS[it.op][0];
      if (!autoOrder || it.op === 'grabado') for (const p of it.polys) emitPoly(layer, p);
      for (const t of it.texts) {
        g(0, 'TEXT'); g(8, layer); g(10, r4(t.x - dx0)); g(20, r4(-t.y)); g(30, 0); g(40, r4(t.size * 0.7)); g(1, dxfStr(t.str)); g(50, r4(-t.rot));
        if (t.anchor === 'middle') { g(72, 1); g(11, r4(t.x - dx0)); g(21, r4(-t.y)); g(31, 0); }
      }
      skippedImages += (it.images || []).length;
    }
    if (autoOrder) for (const op of ['marcado', 'corte']) for (const c of orderContours(items.filter(i => i.op === op))) emitPoly(LAYERS[op][0], c);
    g(0, 'ENDSEC'); g(0, 'EOF');
    download(safeName() + (sh ? `-hoja-${opts.sheet + 1}` : '') + '.dxf', out.join('\r\n') + '\r\n', 'application/dxf');
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
      if (!OPS[c.op] && !(c.type === 'import' && c.op === 'archivo')) c.op = 'corte';
      if (c.type === 'group') c.children = (s.children || []).filter(k => k && TYPES[k.type]).map(clean);
      return c;
    };
    doc = { ...base, ...d, sheet: { ...base.sheet, ...(d.sheet || {}) }, assets: { ...(d.assets || {}) } };
    doc.measures = (Array.isArray(d.measures) ? d.measures : []).filter(m => m && (m.kind === 'dos' ? Array.isArray(m.a) && Array.isArray(m.b) : m.kind === 'forma' && Array.isArray(m.p)))
      .map(m => ({ ...m, id: m.id || uid() }));
    doc.shapes = doc.shapes.filter(s => s && TYPES[s.type]).map(clean);
    sel.clear();
  }

  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // SVG, DXF e imágenes se importan como objetos editables dentro del diseño actual
    if (/\.(svg|dxf|png|jpe?g)$/i.test(file.name) || /^image\//.test(file.type)) {
      try { await importFile(file); } catch (err) { msg('No se pudo importar ese archivo: ' + err.message); }
      return;
    }
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
        const m = el.getCTM();
        if (!m) continue;
        polys.push(...svgShapePolys(el, m, 1, 0.3));
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

  /* ================= Importar SVG, DXF e imágenes como objetos editables ================= */
  const OP_BY_NAME = n => /grab|engrav/i.test(n) ? 'grabado' : /marc|score/i.test(n) ? 'marcado' : null;

  // Diseño completo en base64 (UTF-8) para guardarlo dentro de los archivos exportados
  function designPayload() {
    const bytes = new TextEncoder().encode(JSON.stringify(doc));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function readPayload(b64) {
    const bin = atob(b64.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  // ¿El archivo fue exportado por esta aplicación? Devuelve el diseño guardado dentro
  function embeddedDesign(text, isDxf) {
    try {
      if (isDxf) {
        const parts = [], lines = text.split(/\r?\n/);
        for (let i = 0; i + 1 < lines.length; i++) if (lines[i].trim() === '999' && lines[i + 1].startsWith('ELS:')) parts.push(lines[i + 1].slice(4).trim());
        return parts.length ? readPayload(parts.join('')) : null;
      }
      const m = /<metadata id="evergreen-love-studio">([\s\S]*?)<\/metadata>/.exec(text);
      return m ? readPayload(m[1]) : null;
    } catch (e) { return null; }
  }

  async function importFile(file) {
    let asset;
    const isDxf = /\.dxf$/i.test(file.name), isSvg = /\.svg$/i.test(file.name) || /svg/.test(file.type);
    const text = isDxf || isSvg ? await file.text() : null;
    const design = text && embeddedDesign(text, isDxf);
    if (design && confirm(`"${file.name}" se hizo con Evergreen Love Studio.\n\nAceptar: abrirlo como diseño editable (con sus medidas, parámetros y opciones). Reemplaza el diseño actual; puedes volver con Deshacer.\nCancelar: agregarlo al diseño actual como figuras.`)) {
      checkpoint();
      loadDoc(design);
      checkpoint(); fullRender(); fitView();
      msg('Diseño abierto para editar: ' + file.name);
      return;
    }
    if (isDxf) asset = importDxf(text, file.name);
    else if (isSvg) asset = importSvgFile(text, file.name);
    else { asset = await importImageLogo(file); asset.realW = 50; }
    const id = 'a' + uid();
    doc.assets = doc.assets || {};
    doc.assets[id] = asset;
    // Se coloca a la derecha de lo que ya hay en el diseño
    evaluateParams(); evaluateAll();
    const b = unionBox([...evalCache.values()].map(r => r.bbox));
    const x = b ? b.x + b.w + 10 : 0, y = b ? b.y : 0;
    const w = asset.realW || 100;
    const s = {
      id: uid(), type: 'import', name: file.name.replace(/\.[^.]+$/, ''), op: asset.kind === 'image' ? 'grabado' : 'archivo',
      p: { asset: id, x: fmt(x / unitMM), y: fmt(y / unitMM), w: fmt(w / unitMM, 3), h: fmt(w * asset.h / asset.w / unitMM, 3), prop: 'si', rot: '0' },
    };
    doc.shapes.push(s);
    sel = new Set([s.id]);
    checkpoint(); fullRender(); fitView();
    const size = `${fmt(w / unitMM, 2)} × ${fmt(w * asset.h / asset.w / unitMM, 2)} ${unitLabel()}`;
    // Si el archivo trae varias piezas, cada una queda como objeto independiente (Deshacer las vuelve a juntar)
    const pieces = asset.kind === 'vector' ? splitPieces(asset.polys).length : 1;
    if (pieces > 1 && pieces <= 300) {
      const created = splitImport(s, false);
      if (created) {
        sel = new Set(created.map(c => c.id));
        checkpoint(); fullRender();
        msg(`Importado: ${file.name} · ${size} · ${created.length} piezas independientes (Deshacer para dejarlas juntas)` + (asset.warning ? ` · ${asset.warning}` : ''));
        return;
      }
    }
    msg(`Importado: ${file.name} · ${size}` + (asset.kind === 'vector' ? ` · ${asset.polys.length} trazo(s)` : '') + (asset.warning ? ` · ${asset.warning}` : ''));
  }

  // Normaliza trazos en mm a ancho 1 (para poder escalarlos) y guarda su tamaño real
  function vectorAsset(polys, name, extra = {}) {
    polys = polys.filter(pl => pl.pts.length >= 2);
    const texts = extra.texts || [];
    if (!polys.length && !texts.length) throw new Error('no se encontraron figuras');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = ([x, y]) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
    for (const pl of polys) pl.pts.forEach(add);
    for (const t of texts) textCorners(t).forEach(add);
    const W = (x1 - x0) || 1, H = (y1 - y0) || 1;
    const r6 = v => Math.round(v * 1e6) / 1e6;
    return {
      kind: 'vector', name, w: 1, h: H / W, realW: W, realH: H, ox: x0, oy: y0, ...extra,
      polys: polys.map(pl => ({ closed: pl.closed, op: pl.op, pts: pl.pts.map(([x, y]) => [r6((x - x0) / W), r6((y - y0) / W)]) })),
      texts: texts.map(t => ({ ...t, x: r6((t.x - x0) / W), y: r6((t.y - y0) / W), size: r6(t.size / W) })),
    };
  }

  const MM_PER = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
  // Color → operación: rojo = corte, azul = marcado, relleno oscuro sin trazo = grabado
  function opFromStyle(cs) {
    const rgb = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || ''); return m && (m[4] === undefined || +m[4] > 0) ? [+m[1], +m[2], +m[3]] : null; };
    const st = cs.stroke !== 'none' ? rgb(cs.stroke) : null, fl = cs.fill !== 'none' ? rgb(cs.fill) : null;
    const kind = ([r, g, b]) => r > 150 && g < 110 && b < 110 ? 'corte' : b > 150 && r < 110 && g < 160 ? 'marcado' : null;
    if (st) return kind(st) || 'corte';
    if (fl) { if (fl[0] > 240 && fl[1] > 240 && fl[2] > 240) return null; return kind(fl) || 'grabado'; }
    return 'corte';
  }

  // Lee la geometría de un elemento SVG directamente (rápido aun con miles de trazos) y la aplana en polilíneas.
  // m: matriz del elemento (getCTM); k: factor a mm; tolMM: precisión de las curvas.
  function svgShapePolys(el, m, k, tolMM) {
    const A = (n, d = 0) => { const v = parseFloat(el.getAttribute(n)); return Number.isFinite(v) ? v : d; };
    let d = '';
    switch (el.nodeName.toLowerCase()) {
      case 'path': d = el.getAttribute('d') || ''; break;
      case 'rect': {
        const x = A('x'), y = A('y'), w = A('width'), hh = A('height');
        let rx = A('rx', NaN), ry = A('ry', NaN);
        if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
        if (!Number.isFinite(ry)) ry = rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, hh / 2);
        d = rx > 0 && ry > 0
          ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + hh - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + hh}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + hh - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
          : `M${x} ${y}H${x + w}V${y + hh}H${x}Z`;
        break;
      }
      case 'circle': case 'ellipse': {
        const cx = A('cx'), cy = A('cy'), rx = el.nodeName === 'circle' ? A('r') : A('rx'), ry = el.nodeName === 'circle' ? A('r') : A('ry');
        d = `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
        break;
      }
      case 'line': d = `M${A('x1')} ${A('y1')}L${A('x2')} ${A('y2')}`; break;
      case 'polyline': case 'polygon': {
        const nums = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push(`${nums[i]} ${nums[i + 1]}`);
        d = pts.length ? 'M' + pts.join('L') + (el.nodeName.toLowerCase() === 'polygon' ? 'Z' : '') : '';
        break;
      }
    }
    const scale = (Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1) * k;
    const out = flattenPathD(d, tolMM / scale);
    return out.map(pl => ({ closed: pl.closed, pts: pl.pts.map(([x, y]) => [(m.a * x + m.c * y + m.e) * k, (m.b * x + m.d * y + m.f) * k]) }))
      .filter(pl => pl.pts.length >= 2);
  }

  // Convierte el atributo "d" de un path SVG en polilíneas (líneas, curvas de Bézier y arcos, absolutos y relativos).
  function flattenPathD(d, tol) {
    const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    const out = [];
    let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null, cur = null;
    const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
    const num = () => parseFloat(toks[i++]);
    const flag = () => { const t = toks[i]; if (t.length > 1 && /^[01]/.test(t)) { toks[i] = t.slice(1); return +t[0]; } i++; return +t; };
    const start = (px, py) => { if (cur && cur.pts.length > 1) out.push(cur); cur = { closed: false, pts: [[px, py]] }; sx = px; sy = py; };
    const lineTo = (px, py) => { if (!cur) start(x, y); cur.pts.push([px, py]); };
    const cubic = (x1, y1, x2, y2, x3, y3) => {
      const L = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(L / (tol || 1e-3)))));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        lineTo(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
      }
    };
    const arc = (rx, ry, phi, fa, fs, x2, y2) => {
      if (!rx || !ry) { lineTo(x2, y2); return; }
      rx = Math.abs(rx); ry = Math.abs(ry);
      const c = Math.cos(phi * DEG), s = Math.sin(phi * DEG);
      const dx = (x - x2) / 2, dy = (y - y2) / 2, x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
      const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const nu = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, de = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
      let co = Math.sqrt(Math.max(0, nu / (de || 1)));
      if (fa === fs) co = -co;
      const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
      const cx = c * cxp - s * cyp + (x + x2) / 2, cy = s * cxp + c * cyp + (y + y2) / 2;
      const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
      let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
      const R = Math.max(rx, ry), step = 2 * Math.acos(Math.max(-1, 1 - Math.min(tol / R, 1)));
      const n = Math.max(2, Math.min(720, Math.ceil(Math.abs(dt) / (step || 0.1))));
      for (let k = 1; k <= n; k++) {
        const t = t1 + dt * k / n;
        lineTo(cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c);
      }
    };
    while (i < toks.length) {
      if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
      else if (!cmd) { i++; continue; }
      const rel = cmd !== cmd.toUpperCase(), C = cmd.toUpperCase();
      if (C === 'Z') {
        if (cur) { cur.closed = true; out.push(cur); cur = null; }
        x = sx; y = sy; lc = lq = null;
        continue;
      }
      do {
        const ox = rel ? x : 0, oy = rel ? y : 0;
        switch (C) {
          case 'M': { const px = num() + ox, py = num() + oy; start(px, py); x = px; y = py; cmd = rel ? 'l' : 'L'; lc = lq = null; break; }
          case 'L': { const px = num() + ox, py = num() + oy; lineTo(px, py); x = px; y = py; lc = lq = null; break; }
          case 'H': { const px = num() + ox; lineTo(px, y); x = px; lc = lq = null; break; }
          case 'V': { const py = num() + oy; lineTo(x, py); y = py; lc = lq = null; break; }
          case 'C': { const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy; cubic(x1, y1, x2, y2, x3, y3); lc = [x2, y2]; lq = null; x = x3; y = y3; break; }
          case 'S': { const x1 = lc ? 2 * x - lc[0] : x, y1 = lc ? 2 * y - lc[1] : y, x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy; cubic(x1, y1, x2, y2, x3, y3); lc = [x2, y2]; lq = null; x = x3; y = y3; break; }
          case 'Q': case 'T': {
            let qx, qy;
            if (C === 'Q') { qx = num() + ox; qy = num() + oy; } else { qx = lq ? 2 * x - lq[0] : x; qy = lq ? 2 * y - lq[1] : y; }
            const x3 = num() + ox, y3 = num() + oy;
            cubic(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x3 + 2 / 3 * (qx - x3), y3 + 2 / 3 * (qy - y3), x3, y3);
            lq = [qx, qy]; lc = null; x = x3; y = y3; break;
          }
          case 'A': { const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag(), px = num() + ox, py = num() + oy; arc(rx, ry, phi, fa, fs, px, py); x = px; y = py; lc = lq = null; break; }
          default: i++;
        }
      } while (isNum());
    }
    if (cur && cur.pts.length > 1) out.push(cur);
    // Si el trazo termina donde empezó, se considera cerrado
    for (const pl of out) {
      const a = pl.pts[0], b = pl.pts[pl.pts.length - 1];
      if (!pl.closed && pl.pts.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < Math.max(tol * 2, 1e-6)) pl.closed = true;
      if (pl.closed && pl.pts.length > 2) { const z = pl.pts[pl.pts.length - 1]; if (Math.hypot(a[0] - z[0], a[1] - z[1]) < 1e-9) pl.pts.pop(); }
    }
    return out;
  }

  function importSvgFile(text, name) {
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('no es un SVG válido');
    root.querySelectorAll('script, foreignObject').forEach(e => e.remove());
    for (const el of root.querySelectorAll('*')) for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    // Tamaño real: width/height con unidades; sin unidades se toman como píxeles (96 por pulgada)
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const dim = (attr, fallback) => {
      const m = /^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/.exec((root.getAttribute(attr) || '').trim());
      return m ? +m[1] * MM_PER[m[2] || ''] : fallback * MM_PER.px;
    };
    const wMM = dim('width', vb.length === 4 ? vb[2] : 1000), hMM = dim('height', vb.length === 4 ? vb[3] : 1000);
    root.setAttribute('width', wMM + 'mm'); root.setAttribute('height', hMM + 'mm');
    const host = h('div', { style: 'position:fixed;left:-30000px;top:0;opacity:0;pointer-events:none' });
    const svgNode = document.importNode(root, true);
    host.append(svgNode);
    document.body.append(host);
    const polys = [], texts = [];
    let skippedText = 0;
    try {
      // Textos: se conservan como texto (posición, tamaño, giro y operación según su color)
      for (const el of svgNode.querySelectorAll('text')) {
        if (el.closest('defs, clipPath, mask, symbol')) continue;
        const str = el.textContent.trim(), m = el.getCTM();
        if (!str || !m) { skippedText++; continue; }
        const cs = getComputedStyle(el), k = 25.4 / 96;
        const x = parseFloat(el.getAttribute('x')) || 0, y = parseFloat(el.getAttribute('y')) || 0;
        const size = parseFloat(cs.fontSize) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * k;
        texts.push({
          x: (m.a * x + m.c * y + m.e) * k, y: (m.b * x + m.d * y + m.f) * k, size, str,
          rot: Math.atan2(m.b, m.a) / DEG, anchor: cs.textAnchor === 'middle' ? 'middle' : null, op: opFromStyle(cs) || 'grabado',
        });
      }
      for (const el of svgNode.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')) {
        if (el.closest('defs, clipPath, mask, symbol, marker, pattern')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const op = opFromStyle(cs);
        if (!op) continue; // relleno blanco: fondo
        const m = el.getCTM();
        if (!m) continue;
        for (const pl of svgShapePolys(el, m, 25.4 / 96, 0.05)) polys.push({ ...pl, op }); // px CSS → mm
      }
    } finally { host.remove(); }
    if (!polys.length && !texts.length) throw new Error('no se encontraron figuras');
    return vectorAsset(polys, name, { texts, ...(skippedText ? { warning: `${skippedText} texto(s) vacíos no se importaron` } : {}) });
  }

  // DXF: líneas, polilíneas (con arcos), círculos, arcos, elipses y splines. Unidades según $INSUNITS.
  function importDxf(text, name) {
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
    let unit = 1;
    const UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
    const iu = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
    if (iu >= 0 && pairs[iu + 1] && UNITS[pairs[iu + 1][1]]) unit = UNITS[pairs[iu + 1][1]];
    const start = pairs.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && pairs[i - 1] && pairs[i - 1][1] === 'SECTION');
    if (start < 0) throw new Error('no tiene sección ENTITIES');
    const ents = [];
    let cur = null;
    for (let i = start + 1; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) {
        if (v === 'ENDSEC') break;
        cur = { type: v, codes: [] };
        ents.push(cur);
      } else if (cur) cur.codes.push([c, v]);
    }
    const get = (e, c, d = 0) => { const f = e.codes.find(x => x[0] === c); return f ? parseFloat(f[1]) : d; };
    const layerOp = e => { const l = (e.codes.find(x => x[0] === 8) || [0, ''])[1]; const col = get(e, 62, 0); return OP_BY_NAME(l) || (col === 5 ? 'marcado' : 'corte'); };
    const segs = [], polys = [];
    let skipped = 0;
    const bulgePts = (p1, p2, b) => {
      if (!b) return [];
      const th = 4 * Math.atan(b), dx = p2[0] - p1[0], dy = p2[1] - p1[1], c = Math.hypot(dx, dy);
      if (!c) return [];
      const r = c / (2 * Math.sin(th / 2)), d = r * Math.cos(th / 2);
      const cx = (p1[0] + p2[0]) / 2 - dy / c * d, cy = (p1[1] + p2[1]) / 2 + dx / c * d;
      const a1 = Math.atan2(p1[1] - cy, p1[0] - cx), n = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI / 36)));
      return Array.from({ length: n - 1 }, (_, i) => [cx + Math.abs(r) * Math.cos(a1 + th * (i + 1) / n), cy + Math.abs(r) * Math.sin(a1 + th * (i + 1) / n)]);
    };
    const polyFrom = (verts, closed, op) => {
      const pts = [];
      verts.forEach((v, i) => {
        pts.push([v.x, v.y]);
        const nx = verts[i + 1] || (closed ? verts[0] : null);
        if (nx) pts.push(...bulgePts([v.x, v.y], [nx.x, nx.y], v.b));
      });
      if (pts.length >= 2) polys.push({ closed, op, pts });
    };
    const arc = (cx, cy, r, a0, a1) => {
      if (a1 <= a0) a1 += 360;
      const n = Math.max(6, Math.ceil((a1 - a0) / 5));
      return Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * DEG; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    };
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i], op = layerOp(e);
      if (e.type === 'LINE') segs.push({ op, pts: [[get(e, 10), get(e, 20)], [get(e, 11), get(e, 21)]] });
      else if (e.type === 'LWPOLYLINE') {
        const verts = [];
        for (const [c, v] of e.codes) {
          if (c === 10) verts.push({ x: +v, y: 0, b: 0 });
          else if (c === 20 && verts.length) verts[verts.length - 1].y = +v;
          else if (c === 42 && verts.length) verts[verts.length - 1].b = +v;
        }
        polyFrom(verts, (get(e, 70) & 1) === 1, op);
      } else if (e.type === 'POLYLINE') {
        const verts = [];
        let j = i + 1;
        for (; j < ents.length && ents[j].type === 'VERTEX'; j++) verts.push({ x: get(ents[j], 10), y: get(ents[j], 20), b: get(ents[j], 42) });
        polyFrom(verts, (get(e, 70) & 1) === 1, op);
        i = j; // salta SEQEND
      } else if (e.type === 'CIRCLE') {
        const pts = arc(get(e, 10), get(e, 20), get(e, 40), 0, 360); pts.pop();
        polys.push({ closed: true, op, pts });
      } else if (e.type === 'ARC') segs.push({ op, pts: arc(get(e, 10), get(e, 20), get(e, 40), get(e, 50), get(e, 51)) });
      else if (e.type === 'ELLIPSE') {
        const cx = get(e, 10), cy = get(e, 20), mx = get(e, 11), my = get(e, 21), ratio = get(e, 40, 1);
        let t0 = get(e, 41, 0), t1 = get(e, 42, 2 * Math.PI);
        if (t1 <= t0) t1 += 2 * Math.PI;
        const R = Math.hypot(mx, my), rot = Math.atan2(my, mx), n = Math.max(12, Math.ceil((t1 - t0) / (Math.PI / 36)));
        const pts = Array.from({ length: n + 1 }, (_, k) => { const t = t0 + (t1 - t0) * k / n, px = R * Math.cos(t), py = R * ratio * Math.sin(t); return [cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot)]; });
        if (Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6) { pts.pop(); polys.push({ closed: true, op, pts }); } else segs.push({ op, pts });
      } else if (e.type === 'SPLINE') {
        const pts = [], fit = e.codes.some(([c]) => c === 11);
        for (const [c, v] of e.codes) {
          if (c === (fit ? 11 : 10)) pts.push([+v, 0]);
          else if (c === (fit ? 21 : 20) && pts.length) pts[pts.length - 1][1] = +v;
        }
        if (pts.length >= 2) ((get(e, 70) & 1) ? polys.push({ closed: true, op, pts }) : segs.push({ op, pts }));
      } else if (!['VERTEX', 'SEQEND', 'POINT'].includes(e.type)) skipped++;
    }
    // Une líneas y arcos sueltos que se tocan en cadenas (y las cierra si vuelven al inicio)
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01; // tolerancia en unidades del DXF
    const pool = segs.slice();
    while (pool.length) {
      const chain = pool.shift();
      let pts = chain.pts.slice(), grew = true;
      while (grew) {
        grew = false;
        for (let k = 0; k < pool.length; k++) {
          const q = pool[k].pts;
          if (pool[k].op !== chain.op) continue;
          const end = pts[pts.length - 1], st = pts[0];
          if (near(end, q[0])) pts = pts.concat(q.slice(1));
          else if (near(end, q[q.length - 1])) pts = pts.concat(q.slice(0, -1).reverse());
          else if (near(st, q[q.length - 1])) pts = q.slice(0, -1).concat(pts);
          else if (near(st, q[0])) pts = q.slice(1).reverse().concat(pts);
          else continue;
          pool.splice(k, 1); grew = true; break;
        }
      }
      const closed = pts.length > 2 && near(pts[0], pts[pts.length - 1]);
      polys.push({ closed, op: chain.op, pts: closed ? pts.slice(0, -1) : pts });
    }
    // DXF tiene la Y hacia arriba; el lienzo hacia abajo
    const mm = polys.map(pl => ({ ...pl, pts: pl.pts.map(([x, y]) => [x * unit, -y * unit]) }));
    return vectorAsset(mm, name, skipped ? { warning: `${skipped} elemento(s) no compatibles (textos, bloques o rellenos) no se importaron` } : {});
  }

  // Agrupa trazos en piezas: cada contorno exterior con los agujeros que tiene adentro
  function splitPieces(polys) {
    const box = pl => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pl.pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; };
    const inside = ([x, y], pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const items = polys.map((pl, i) => ({ pl, i, b: box(pl), parent: -1 }));
    const closed = items.filter(it => it.pl.closed);
    for (const it of items) {
      let best = null;
      for (const o of closed) {
        if (o === it || o.b.x0 > it.b.x0 || o.b.y0 > it.b.y0 || o.b.x1 < it.b.x1 || o.b.y1 < it.b.y1) continue;
        if (!inside(it.pl.pts[0], o.pl.pts)) continue;
        const area = (o.b.x1 - o.b.x0) * (o.b.y1 - o.b.y0);
        if (!best || area < best.area) best = { o, area };
      }
      it.parent = best ? best.o.i : -1;
    }
    // Sube hasta el contorno exterior (profundidad par = exterior)
    const depth = it => { let d = 0, p = it.parent; while (p >= 0 && d < 50) { d++; p = items[p].parent; } return d; };
    const rootOf = it => { let r = it; while (r.parent >= 0 && depth(r) % 2 === 1) r = items[r.parent]; return r; };
    const groups = new Map();
    for (const it of items) { const r = rootOf(it); if (!groups.has(r.i)) groups.set(r.i, []); groups.get(r.i).push(it.pl); }
    return [...groups.values()].slice(0, 300);
  }

  // Convierte un archivo importado en varios objetos (uno por pieza) en la misma posición
  /* ----- Desagrupar cajas, canastas, conos y bandejas en piezas independientes ----- */
  const SEPARABLE = new Set(['box', 'basket', 'taper', 'cone', 'planter']);
  const polyBox = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
  const polyArea = pts => { const b = polyBox(pts); return (b[2] - b[0]) * (b[3] - b[1]); };
  const inPoly = ([x, y], pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

  // Crea un objeto "importado" (editable, movible) con estos trazos y textos, ya en su posición actual
  function importObject(name, polys, texts) {
    const asset = vectorAsset(polys.map(pl => ({ closed: pl.closed, op: pl.op, pts: pl.pts })), name, { texts });
    const id = 'a' + uid();
    doc.assets[id] = asset;
    const ops = new Set([...polys.map(pl => pl.op), ...texts.map(t => t.op)].filter(Boolean));
    return { id: uid(), type: 'import', name, op: ops.size === 1 ? [...ops][0] : 'archivo',
      p: { asset: id, x: fmt(asset.ox / unitMM), y: fmt(asset.oy / unitMM), w: fmt(asset.realW / unitMM, 3), h: fmt(asset.realH / unitMM, 3), prop: 'si', rot: '0' } };
  }
  function imageObject(name, g) {
    const c = imageCorners(g).reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const id = 'a' + uid();
    doc.assets[id] = { kind: 'image', name, w: Math.max(1, Math.round(g.w * 100)), h: Math.max(1, Math.round(g.h * 100)), href: g.href, realW: g.w };
    return { id: uid(), type: 'import', name, op: 'grabado',
      p: { asset: id, x: fmt((c[0] - g.w / 2) / unitMM), y: fmt((c[1] - g.h / 2) / unitMM), w: fmt(g.w / unitMM, 3), h: fmt(g.h / unitMM, 3), prop: 'si', rot: fmt(g.rot || 0, 3) } };
  }

  // Reparte lo que dibuja un objeto en piezas: cada contorno con sus agujeros, sus líneas de bisagra y su grabado
  function separateShape(s) {
    if (!evalCache.has(s.id)) { msg('Esta caja está dentro de un grupo: primero desagrupa el grupo.'); return null; }
    const closed = [], open = [], engr = [];
    for (const it of evalCache.get(s.id).items) {
      if (it.op === 'grabado') { engr.push(it); continue; }
      for (const pl of it.polys) (pl.closed ? closed : open).push({ ...pl, op: it.op });
      for (const t of it.texts) engr.push({ op: it.op, polys: [], texts: [t], images: [] });
    }
    const groups = closed.length ? splitPieces(closed) : [];
    if (groups.length < 2 && !(groups.length && (engr.length || open.length))) { msg('Esta pieza no se puede separar en más partes.'); return null; }
    const info = groups.map(g => ({ polys: [...g], texts: [], images: [], outer: g.reduce((a, b) => polyArea(b.pts) > polyArea(a.pts) ? b : a) }));
    const holder = pt => { let best = null, ba = Infinity; for (const inf of info) { const a = polyArea(inf.outer.pts); if (a < ba && inPoly(pt, inf.outer.pts)) { best = inf; ba = a; } } return best; };
    const lose = { polys: [], texts: [], images: [] };
    for (const pl of open) (holder(pl.pts[0]) || lose).polys.push(pl);
    for (const it of engr) {
      for (const pl of it.polys) (holder(pl.pts[0]) || lose).polys.push({ ...pl, op: it.op });
      for (const t of it.texts) { const c = textCorners(t).reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]); (holder(c) || lose).texts.push({ ...t, op: it.op }); }
      for (const g of it.images || []) { const c = imageCorners(g).reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]); (holder(c) || lose).images.push(g); }
    }
    const created = [];
    let n = 0;
    for (const inf of info) {
      created.push(importObject(inf.outer.name ? `${s.name} · ${inf.outer.name}` : `${s.name} ${++n}`, inf.polys, inf.texts));
    }
    for (const inf of info) for (const g of inf.images || []) created.push(imageObject(`${s.name} · logo`, g));
    if (lose.polys.length || lose.texts.length) created.push(importObject(`${s.name} · grabado`, lose.polys, lose.texts));
    for (const g of lose.images) created.push(imageObject(`${s.name} · logo`, g));
    // Se guarda la caja original para poder volver a ella (con todos sus parámetros)
    const gid = 'o' + uid();
    doc.origins = doc.origins || {};
    // Cómo se arma cada pieza en 3D (posición y orientación), para poder verlas armadas aunque ya estén sueltas
    const mdl = modelOf(s, false);
    if (mdl) {
      info.forEach((inf, i) => {
        const q = inf.outer.name && [...mdl.panels, ...(mdl.dividers || [])].find(x => x.name === inf.outer.name), ax = q && axesOf(mdl, q);
        if (ax) created[i].asm = { name: inf.outer.name, ax: JSON.parse(JSON.stringify(ax)) };
      });
    }
    doc.origins[gid] = { shape: JSON.parse(JSON.stringify(s)), asm: mdl ? { name: s.name, t: mdl.t, W: mdl.W, H: mdl.H, D: mdl.D, wall: !!mdl.wall } : null };
    created.forEach(c => { c.from = { gid, name: s.name }; });
    if (v3.open && v3.id === s.id && mdl) { v3.id = null; v3.gid = gid; } // la vista 3D abierta sigue con las piezas sueltas
    const list = listOf(s.id), at = list.indexOf(s);
    list.splice(at, 1, ...created);
    return created;
  }
  // Vuelve a la caja con parámetros: quita las piezas sueltas y repone el objeto original
  // Cambia los dedos (u otras uniones) de una caja desagrupada: se regeneran sus piezas en el mismo lugar
  const ORIGIN_FINGER_KEYS = {
    box: ['t', 'kerf', 'cubierta', 'grosorCub', 'margenCub', 'cubiertaCaras', 'cubiertaLargas', 'uniones', 'dedoModo', 'dedo', 'nAncho', 'nProf', 'nAlto'],
    taper: ['t', 'kerf', 'cubierta', 'grosorCub', 'margenCub', 'cubiertaCaras', 'cubiertaLargas', 'uniones', 'cFI', 'cFD', 'cAI', 'cAD', 'baseDedos', 'dedoModo', 'dedo', 'nEsq', 'nBaseT', 'nAnillos', 'bandaAnillo'],
  };
  function regenOrigin(gid, key, value) {
    const og = doc.origins && doc.origins[gid], snap = og && (og.shape || og);
    const pieces = allShapes().filter(x => x.from && x.from.gid === gid);
    if (!snap || !pieces.length) return;
    snap.p[key] = value;
    if (snap.type === 'box' && key === 'dedoModo' && value === 'cantidad') fingerDefaults(snap);
    if (snap.type === 'taper' && key === 'dedoModo' && value === 'cantidad') {
      snap.p.dedoModo = 'ancho';
      const m = taperModel(snap, true);
      snap.p.dedoModo = 'cantidad';
      if (m) { snap.p.nEsq = String((m.taper.nSeg + 1) / 2); snap.p.nBaseT = String(Math.max(1, Math.round((Math.min(m.taper.nbW, m.taper.nbD) - 1) / 2))); }
    }
    const list = listOf(pieces[0].id), at = Math.min(...pieces.map(x => list.indexOf(x)).filter(i => i >= 0));
    for (const x of pieces) { const l = listOf(x.id), i = l.indexOf(x); if (i >= 0) l.splice(i, 1); }
    const orig = JSON.parse(JSON.stringify(snap));
    list.splice(Math.max(0, Math.min(at, list.length)), 0, orig);
    delete doc.origins[gid];
    separateMany([orig]);
    const first = allShapes().find(x => x.from && sel.has(x.id));
    if (first) { sel = new Set([first.id]); fullRender(); }
    msg('Dedos cambiados: las piezas sueltas se regeneraron con la nueva unión (Deshacer vuelve atrás).');
  }
  function originFingerEditor(gid) {
    const og = doc.origins && doc.origins[gid], snap = og && (og.shape || og), keys = snap && ORIGIN_FINGER_KEYS[snap.type];
    if (!keys) return null;
    const hidden = k => snap.type === 'box' ? boxFieldHidden(snap, k) : taperFieldHidden(snap, k);
    const rows = [];
    for (const [key, label, kind] of TYPES[snap.type].props) {
      if (!keys.includes(key) || hidden(key)) continue;
      if (kind && typeof kind === 'object') rows.push(propRow(label, selectEl(kind, snap.p[key] || Object.keys(kind)[0], label, v => regenOrigin(gid, key, v))));
      else {
        const inp = h('input', { value: snap.p[key] == null ? '' : String(snap.p[key]), 'aria-label': label });
        inp.addEventListener('change', () => regenOrigin(gid, key, inp.value));
        rows.push(propRow(label, inp));
      }
    }
    return h('div', { class: 'origin-fingers' }, h('div', { class: 'insp-sub' }, 'Madera y dedos (finger joint) de la caja original'),
      h('p', { class: 'tip' }, '«Grosor material» es el grosor real de tu madera: la profundidad de los dedos y ranuras sale de ahí. Al cambiar algo se vuelven a crear las piezas sueltas en su mismo lugar; se pierden los cambios que les hayas hecho una por una.'), ...rows);
  }

  function restoreOrigin(gid) {
    const og = doc.origins && doc.origins[gid], snap = og && (og.shape || og);
    const pieces = allShapes().filter(x => x.from && x.from.gid === gid);
    if (!snap || !pieces.length) { msg('No se encontró la caja original de estas piezas.'); return; }
    if (!confirm(`Volver a "${snap.name}" con parámetros reemplaza sus ${pieces.length} piezas sueltas. Se pierden los cambios que les hayas hecho a las piezas (posición, tamaño, borrados…). Puedes volver con Deshacer. ¿Continuar?`)) return;
    const list = listOf(pieces[0].id), at = Math.min(...pieces.map(x => list.indexOf(x)).filter(i => i >= 0));
    for (const x of pieces) { const l = listOf(x.id), i = l.indexOf(x); if (i >= 0) l.splice(i, 1); }
    const orig = JSON.parse(JSON.stringify(snap));
    list.splice(Math.max(0, Math.min(at, list.length)), 0, orig);
    sel = new Set([orig.id]);
    checkpoint(); fullRender();
    msg(`Listo: "${orig.name}" vuelve a tener sus parámetros (dedos, anillos, medidas…).`);
  }

  // Ejes 3D de una pieza del modelo (algunas piezas usan "place" en vez de ejes propios)
  function axesOf(m, q) {
    if (q.axes) return { eu: q.axes.eu, ev: q.axes.ev, ew: q.axes.ew, o: q.axes.o, out: q.axes.out || [0, 0, 0] };
    const P = PLACE[q.place];
    return P ? { eu: P.eu, ev: P.ev, ew: P.ew, o: placeOrigin(m, q), out: P.out } : null;
  }

  // Separa cajas, canastas, conos, bandejas y archivos importados en piezas independientes
  function separateMany(shapes) {
    evaluateParams(); evaluateAll();
    const all = [];
    for (const s of shapes) {
      const c = s.type === 'import' ? splitImport(s, false) : SEPARABLE.has(s.type) ? separateShape(s) : null;
      if (c) all.push(...c);
    }
    if (!all.length) { msg('No hay piezas para separar.'); return; }
    sel = new Set(all.map(c => c.id));
    checkpoint(); fullRender();
    msg(`Separado en ${all.length} piezas independientes. Ya no cambian con los parámetros; Deshacer las vuelve a juntar.`);
  }

  // Separa uno o varios objetos importados; cada pieza queda como objeto independiente en su mismo lugar.
  function explodeImport(s, eachStroke = false) {
    const created = splitImport(s, eachStroke);
    if (!created) return;
    sel = new Set(created.map(c => c.id));
    checkpoint(); fullRender();
    msg(`Separado en ${created.length} piezas: ahora puedes mover, borrar o cambiar cada una.`);
  }
  function explodeMany(shapes) {
    const all = [];
    for (const s of shapes) { const c = splitImport(s, false); if (c) all.push(...c); }
    if (!all.length) { msg('No hay piezas para separar.'); return; }
    sel = new Set(all.map(c => c.id));
    checkpoint(); fullRender();
    msg(`Separado en ${all.length} piezas independientes.`);
  }
  function splitImport(s, eachStroke = false) {
    const a = doc.assets[s.p.asset];
    if (!a || a.kind !== 'vector') return null;
    const x = len(s, 'x'), y = len(s, 'y'), w = Math.abs(len(s, 'w'));
    const sy = (s.p.prop === 'no' ? Math.abs(len(s, 'h')) : w * a.h / a.w) / (a.h / a.w);
    // Si el objeto está rotado, la rotación se aplica a cada pieza (quedan en el mismo lugar, con rotación 0)
    const rot = num(s, 'rot', 0) || 0;
    const rm = rot ? mR(rot, x + w / 2, y + a.h * sy / 2) : null;
    const place = ([u, v]) => { const p = [x + u * w, y + v * sy]; return rm ? apply(rm, p) : p; };
    const list = listOf(s.id), at = list.indexOf(s);
    const groups = eachStroke ? a.polys.map(pl => [pl]) : splitPieces(a.polys);
    if (groups.length < 2 && !(a.texts || []).length) return null;
    const created = groups.map((group, k) => {
      const polys = group.map(pl => ({ ...pl, pts: pl.pts.map(place) }));
      const asset = vectorAsset(polys, `${a.name} · pieza ${k + 1}`);
      const id = 'a' + uid();
      doc.assets[id] = asset;
      const all = polys.flatMap(pl => pl.pts);
      const px = Math.min(...all.map(p => p[0])), py = Math.min(...all.map(p => p[1]));
      return { id: uid(), type: 'import', name: `${s.name} ${k + 1}`, op: s.op, p: { asset: id, x: fmt(px / unitMM), y: fmt(py / unitMM), w: fmt(asset.realW / unitMM, 3), h: fmt(asset.realH / unitMM, 3), prop: 'si', rot: '0' } };
    });
    if ((a.texts || []).length) {
      // Los textos pasan juntos a un objeto propio
      const texts = a.texts.map(t => { const [tx, ty] = place([t.x, t.y]); return { ...t, x: tx, y: ty, size: t.size * w, rot: (t.rot || 0) + rot }; });
      const asset = vectorAsset([], `${a.name} · textos`, { texts });
      const id = 'a' + uid();
      doc.assets[id] = asset;
      const corners = texts.flatMap(textCorners);
      const px = Math.min(...corners.map(p => p[0])), py = Math.min(...corners.map(p => p[1]));
      created.push({ id: uid(), type: 'import', name: `${s.name} textos`, op: s.op, p: { asset: id, x: fmt(px / unitMM), y: fmt(py / unitMM), w: fmt(asset.realW / unitMM, 3), h: fmt(asset.realH / unitMM, 3), prop: 'si', rot: '0' } });
    }
    list.splice(at, 1, ...created);
    return created;
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

  function trayTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = 'Bandeja TypeTray';
    d.params = [['ancho', tv(240, units)], ['alto_bandeja', tv(150, units)], ['fondo', tv(35, units)], ['grosor', units === 'in' ? '0.125' : '3'],
      ['dedo', tv(10, units)], ['kerf', units === 'in' ? '0.004' : '0.1'], ['sep', tv(5, units)], ['columnas', '4'], ['filas', '3']].map(([name, expr]) => ({ name, expr }));
    d.shapes = [node('box', 'Bandeja', 'corte', {
      pared: 'si', colgar: 'si', uniones: 'dedos', cajon: 'no', tapa: 'no', medidas: 'exteriores', x: '0', y: '0',
      ancho: 'ancho', profundo: 'alto_bandeja', alto: 'fondo', t: 'grosor', dedo: 'dedo', kerf: 'kerf', sep: 'sep',
      divX: 'columnas', divZ: 'filas', rot: '0', rep: 'no',
    })];
    return d;
  }

  function taperTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = 'Caja cónica';
    d.params = [['ancho', tv(100, units)], ['largo', tv(80, units)], ['ancho_arriba', tv(140, units)], ['largo_arriba', tv(120, units)], ['alto', tv(80, units)],
      ['grosor', units === 'in' ? '0.125' : '3'], ['dedo', tv(10, units)], ['kerf', units === 'in' ? '0.004' : '0.1'], ['sep', tv(5, units)]].map(([name, expr]) => ({ name, expr }));
    d.shapes = [node('taper', 'Caja cónica', 'corte', {
      ancho: 'ancho', prof: 'largo', anchoArr: 'ancho_arriba', largoArr: 'largo_arriba', alto: 'alto', t: 'grosor', uniones: 'dedos', dedoModo: 'ancho', dedo: 'dedo',
      nAnillos: '0', tapa: 'no', kerf: 'kerf', sep: 'sep', x: '0', y: '0', rot: '0', rep: 'no',
    })];
    return d;
  }

  function coneTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = 'Cono con bisagra viva';
    d.params = [['diam_abajo', tv(60, units)], ['diam_arriba', tv(100, units)], ['alto', tv(110, units)], ['grosor', units === 'in' ? '0.125' : '3'],
      ['kerf', units === 'in' ? '0.004' : '0.1'], ['sep', tv(5, units)]].map(([name, expr]) => ({ name, expr }));
    d.shapes = [node('cone', 'Cono', 'corte', {
      d: 'diam_abajo', dArr: 'diam_arriba', alto: 'alto', t: 'grosor', largo: tv(20, units), puente: tv(3, units), paso: units === 'in' ? '0.08' : '2',
      cierre: 'si', baseDisco: 'si', kerf: 'kerf', sep: 'sep', x: '0', y: '0', rot: '0', rep: 'no',
    })];
    return d;
  }

  // Maceta / arreglo floral con bisagra viva: redonda o media redonda, cierre de rompecabezas, base reforzada
  function planterTemplate(half) {
    return (units, sheet) => {
      const d = newDoc(units);
      if (sheet) d.sheet = { ...sheet };
      d.name = half ? 'Maceta media redonda (arreglo floral)' : 'Maceta redonda (arreglo floral)';
      d.params = [['diametro', tv(half ? 160 : 130, units)], ['alto', tv(110, units)], ['grosor', units === 'in' ? '0.118' : '3'], ['dedo', tv(10, units)],
        ['kerf', units === 'in' ? '0.004' : '0.1'], ['sep', tv(5, units)]].map(([name, expr]) => ({ name, expr }));
      d.shapes = [node('planter', half ? 'Maceta media redonda' : 'Maceta redonda', 'corte', {
        forma: half ? 'media' : 'redonda', d: 'diametro', alto: 'alto', t: 'grosor', cierre: 'rompecabezas', dedo: 'dedo', nTab: '8', refuerzo: 'si', nAros: '1',
        largo: tv(20, units), puente: tv(3, units), paso: units === 'in' ? '0.08' : '2', kerf: 'kerf', sep: 'sep', x: '0', y: '0', rot: '0', rep: 'no',
      })];
      return d;
    };
  }

  function basketTemplate(units, sheet) {
    const d = newDoc(units);
    if (sheet) d.sheet = { ...sheet };
    d.name = 'Canasta';
    d.params = [['ancho', tv(150, units)], ['alto', tv(110, units)], ['largo', tv(220, units)], ['grosor', units === 'in' ? '0.125' : '3'],
      ['kerf', units === 'in' ? '0.004' : '0.1'], ['sep', tv(5, units)]].map(([name, expr]) => ({ name, expr }));
    d.shapes = [node('basket', 'Canasta', 'corte', {
      ancho: 'ancho', alto: 'alto', profundo: 'largo', t: 'grosor', nTab: '7', sepTab: tv(4, units), asa: 'si', asaTexto: "HAPPY MOTHER'S DAY",
      frente: 'si', kerf: 'kerf', sep: 'sep', x: '0', y: '0', rot: '0', rep: 'no',
    })];
    return d;
  }

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

  // Caja de regalo para madera de 6 mm (1/4"): 5.72 x 5.19 x 5.63 in por fuera, sin tapa
  function giftBoxQuarterTemplate(units, sheet) {
    const d = boxTemplate('dedos', units, sheet, 'no');
    const inch = units === 'in', q = mm => inch ? fmt(Math.round(mm / 25.4 * 1000) / 1000) : fmt(mm);
    d.name = 'Caja de regalo 1/4"';
    d.params = [['ancho', q(145.4)], ['profundo', q(131.9)], ['alto', q(143.1)], ['grosor', q(6.35)], ['dedo', q(15)], ['kerf', inch ? '0.004' : '0.1'], ['sep', q(5)]].map(([name, expr]) => ({ name, expr }));
    d.shapes[0].name = 'Caja de regalo';
    return d;
  }

  const TEMPLATES = {
    'box-gift-quarter': giftBoxQuarterTemplate,
    'box-dedos': (u, s) => boxTemplate('dedos', u, s),
    'box-planas': (u, s) => boxTemplate('planas', u, s),
    'box-slide': (u, s) => boxTemplate('dedos', u, s, 'deslizante'),
    'box-drawer': (u, s) => boxTemplate('dedos', u, s, 'si', 'si'),
    basket: basketTemplate,
    typetray: trayTemplate,
    taper: taperTemplate,
    cone: coneTemplate,
    'planter-round': planterTemplate(false),
    'planter-half': planterTemplate(true),
    keychain: keychainTemplate,
    coasters: coasterTemplate,
    hinge: hingeTemplate,
    'kerf-test': kerfTestTemplate,
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

  const v3 = { open: false, id: null, gid: null, renderer: null, scene: null, camera: null, controls: null, group: null, raf: 0, model: null };

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
    v3.pivot = new T.Group(); // permite girar el modelo (la bandeja de pared se ve de frente)
    v3.scene.add(v3.pivot);
    v3.pivot.add(v3.group);
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

  // Vista 3D de piezas que vienen de una caja desagrupada: cada una se arma en su lugar original,
  // con su contorno y tamaño actuales (si agrandas o achicas las piezas, el 3D las sigue)
  function build3DPieces() {
    const T = window.THREE, gid = v3.gid;
    const og = doc.origins && doc.origins[gid], info = og && og.asm;
    const pieces = allShapes().filter(x => x.type === 'import' && x.asm && x.from && x.from.gid === gid);
    const items = [];
    let kSum = 0, kN = 0;
    for (const x of pieces) {
      const a = doc.assets && doc.assets[x.p.asset];
      if (!a || a.kind !== 'vector') continue;
      const w = Math.abs(len(x, 'w')), aspect = a.h / a.w, hh = x.p.prop === 'no' ? Math.abs(len(x, 'h')) : w * aspect, sy = hh / aspect;
      if (![w, hh].every(Number.isFinite) || !w || !hh) continue;
      kSum += w / a.realW + hh / a.realH; kN += 2;
      const cuts = a.polys.filter(pl => pl.closed && pl.pts.length >= 3 && (pl.op || 'corte') === 'corte').map(pl => pl.pts.map(([u, v]) => [u * w, v * sy]));
      if (!cuts.length) continue;
      const outer = cuts.reduce((p, q) => polyArea(q) > polyArea(p) ? q : p);
      items.push({ x, outer, holes: cuts.filter(c => c !== outer && inPoly(c[0], outer)) });
    }
    if (!info || !items.length) { $('#view3dMsg').hidden = false; $('#view3dMsg').textContent = 'Ya no quedan piezas de esa caja. Usa «Volver a la caja con parámetros» o Deshacer.'; return; }
    $('#view3dMsg').hidden = true;
    for (const c of [...v3.group.children]) {
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      v3.group.remove(c);
    }
    const k = kN ? kSum / kN : 1, pv = [info.W / 2, info.H / 2, info.D / 2];
    for (const { x, outer, holes } of items) {
      const ax = x.asm.ax, o = [0, 1, 2].map(i => pv[i] + k * (ax.o[i] - pv[i])); // las posiciones crecen o se encogen con las piezas
      const shape = new T.Shape(outer.map(([u, v]) => new T.Vector2(u, v)));
      for (const hl of holes) shape.holes.push(new T.Path(hl.map(([u, v]) => new T.Vector2(u, v))));
      const geo = new T.ExtrudeGeometry(shape, { depth: info.t, bevelEnabled: false, curveSegments: 1 });
      const mat4 = new T.Matrix4().set(
        ax.eu[0], ax.ev[0], ax.ew[0], o[0],
        ax.eu[1], ax.ev[1], ax.ew[1], o[1],
        ax.eu[2], ax.ev[2], ax.ew[2], o[2],
        0, 0, 0, 1);
      const holder = new T.Group();
      holder.userData.out = ax.out;
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0xdcb887, roughness: 0.85, metalness: 0, side: T.DoubleSide }));
      const edges = new T.LineSegments(new T.EdgesGeometry(geo, 20), new T.LineBasicMaterial({ color: 0x6b4a2b }));
      for (const obj of [mesh, edges]) { obj.matrixAutoUpdate = false; obj.matrix.copy(mat4); holder.add(obj); }
      v3.group.add(holder);
    }
    $('#view3dTitle').textContent = `${info.name} · piezas desagrupadas, armadas en 3D (${items.length})`;
    v3.model = { W: info.W * k, H: info.H * k, D: info.D * k, t: info.t, wall: info.wall };
    const R3 = Math.hypot(v3.model.W, v3.model.H, v3.model.D);
    if (v3.lastR && Math.abs(R3 / v3.lastR - 1) > 0.005) {
      const kk = R3 / v3.lastR, tg = v3.controls.target, cp = v3.camera.position;
      cp.set(tg.x + (cp.x - tg.x) * kk, tg.y + (cp.y - tg.y) * kk, tg.z + (cp.z - tg.z) * kk);
      v3.controls.update();
    }
    v3.lastR = R3;
    v3.group.position.set(-pv[0], -pv[1], -pv[2]);
    v3.pivot.rotation.x = info.wall ? -Math.PI / 2 : 0;
    applyExplode();
  }

  // Vista 3D de un arte cualquiera (SVG importado, figuras dibujadas…): cada pieza cortada se extruye con el grosor de la madera
  function build3DArt() {
    const T = window.THREE;
    const { items } = exportItems();
    const cuts = items.filter(it => it.op === 'corte'), marks = items.filter(it => it.op !== 'corte');
    const tMM = vars.grosor !== undefined && vars.grosor * unitMM > 0 ? vars.grosor * unitMM : 3;
    const closed = cuts.flatMap(it => it.polys.filter(p => p.closed && p.pts.length >= 3));
    const allPts = items.flatMap(it => it.polys.flatMap(p => p.pts));
    for (const c of [...v3.group.children]) {
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      v3.group.remove(c);
    }
    const msgEl = $('#view3dMsg');
    if (!allPts.length) { msgEl.hidden = false; msgEl.textContent = 'No hay dibujo para mostrar en 3D todavía.'; return; }
    const b = ptsBox(allPts), cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2;
    const groups = splitPieces(closed).slice(0, 400);
    const wood = /walnut|nogal/i.test(doc.wood || '') ? 0x6b4a2f : /mahogany|caoba/i.test(doc.wood || '') ? 0x7a3b25 : /acr/i.test(doc.wood || '') ? 0xbfe3f0 : 0xe0bf8a;
    let n = 0;
    for (const grp of groups) {
      const outer = grp.reduce((a, c) => shoelace(c.pts) > shoelace(a.pts) ? c : a);
      const shape = new T.Shape(outer.pts.map(([x, y]) => new T.Vector2(x, -y)));
      for (const hl of grp) if (hl !== outer) shape.holes.push(new T.Path(hl.pts.map(([x, y]) => new T.Vector2(x, -y))));
      const geo = new T.ExtrudeGeometry(shape, { depth: tMM, bevelEnabled: false, curveSegments: 1 });
      geo.rotateX(-Math.PI / 2);
      const holder = new T.Group();
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: wood, roughness: 0.85, metalness: 0, side: T.DoubleSide }));
      const edges = new T.LineSegments(new T.EdgesGeometry(geo, 30), new T.LineBasicMaterial({ color: 0x6b4a2b }));
      holder.add(mesh, edges);
      holder.userData.out = [0, 0, 0];
      v3.group.add(holder); n++;
    }
    // Grabado, marcado y líneas de corte abiertas (bisagras): se dibujan sobre las piezas
    const W = b.x1 - b.x0 + 2, H = b.y1 - b.y0 + 2, sc = Math.min(8, 2048 / Math.max(W, H));
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(W * sc)); cv.height = Math.max(2, Math.round(H * sc));
    const c = cv.getContext('2d');
    const X = x => (x - b.x0 + 1) * sc, Y = y => (y - b.y0 + 1) * sc;
    const trace = list => { c.beginPath(); for (const p of list) { p.pts.forEach(([x, y], i) => i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))); if (p.closed) c.closePath(); } };
    let drawn = 0;
    for (const it of marks) {
      const col = it.op === 'marcado' ? 'rgba(40,70,140,0.9)' : 'rgba(58,32,14,0.88)';
      c.fillStyle = c.strokeStyle = col; c.lineWidth = Math.max(1, 0.25 * sc);
      const cl = it.polys.filter(p => p.closed), op = it.polys.filter(p => !p.closed);
      if (cl.length) { trace(cl); if (it.op === 'grabado') c.fill('evenodd'); else c.stroke(); drawn++; }
      if (op.length) { trace(op); c.stroke(); drawn++; }
      for (const t of it.texts) { c.font = `${t.size * sc}px Arial, sans-serif`; c.textAlign = t.anchor === 'middle' ? 'center' : 'left'; c.save(); c.translate(X(t.x), Y(t.y)); c.rotate((t.rot || 0) * DEG); c.fillText(t.str, 0, 0); c.restore(); drawn++; }
    }
    c.strokeStyle = 'rgba(58,32,14,0.7)'; c.lineWidth = Math.max(1, 0.2 * sc);
    for (const it of cuts) { const op = it.polys.filter(p => !p.closed); if (op.length) { trace(op); c.stroke(); drawn++; } }
    if (drawn) {
      const tex = new T.CanvasTexture(cv);
      tex.anisotropy = v3.renderer.capabilities.getMaxAnisotropy();
      const geo = new T.PlaneGeometry(W, H); geo.rotateX(-Math.PI / 2);
      const plane = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      plane.position.set((b.x0 + b.x1) / 2, tMM + 0.05, (b.y0 + b.y1) / 2);
      const holder = new T.Group(); holder.add(plane); holder.userData.out = [0, 0, 0];
      v3.group.add(holder);
    }
    v3.group.position.set(-cx, -tMM / 2, -cz);
    v3.pivot.rotation.x = 0;
    v3.model = { W: b.x1 - b.x0, H: tMM, D: b.y1 - b.y0, t: tMM, wall: false };
    msgEl.hidden = n > 0 || drawn > 0;
    if (!n && !drawn) msgEl.textContent = 'No hay nada para mostrar.';
    $('#view3dTitle').textContent = `${doc.name || 'Diseño'} · vista 3D · ${n} pieza(s) de ${fmt(tMM / unitMM, isInch() ? 3 : 1)} ${unitLabel()} de grosor` + (groups.length >= 400 ? ' (se muestran las primeras 400)' : '');
  }

  function build3D() {
    if (v3.art) { build3DArt(); return; }
    if (v3.gid) { build3DPieces(); return; }
    const T = window.THREE, s = byId(v3.id);
    const m = modelOf(s, true);
    $('#view3dMsg').hidden = !!m;
    // Con medidas momentáneamente inválidas (p. ej. al borrar un número) se deja el último modelo a la vista y se avisa
    if (!m) { $('#view3dMsg').textContent = 'Estas medidas no son válidas todavía: revisa que cada lado sea mayor que el grosor de la madera.'; return; }
    for (const c of [...v3.group.children]) {
      c.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      v3.group.remove(c);
    }
    v3.model = m;
    // Si cambió el tamaño del modelo, la cámara se acerca o se aleja en la misma proporción (mismo ángulo, mismo encuadre)
    const R3 = Math.hypot(m.W, m.H, m.D);
    if (v3.lastR && R3 > 0 && Math.abs(R3 / v3.lastR - 1) > 0.005) {
      const k3 = R3 / v3.lastR, tg = v3.controls.target, cp = v3.camera.position;
      cp.set(tg.x + (cp.x - tg.x) * k3, tg.y + (cp.y - tg.y) * k3, tg.z + (cp.z - tg.z) * k3);
      v3.controls.update();
    }
    v3.lastR = R3;
    const comps = m.dividers.length ? ` · ${Math.max(1, Math.round(num(s, 'divX', 1)))} × ${Math.max(1, Math.round(num(s, 'divZ', 1)))} compartimentos` : '';
    const du = v => fmt(v / unitMM, 3);
    $('#view3dTitle').textContent = s.type === 'taper'
      ? `${s.name} · base ${du(len(s, 'ancho'))} × ${du(len(s, 'prof'))} → boca ${du(len(s, 'anchoArr'))} × ${du(len(s, 'largoArr'))} · alto ${du(len(s, 'alto'))} ${unitLabel()}${s.p.cubierta === 'si' ? ' · con cubierta' : ''}`
      : `${s.name} · ${fmt(m.W / unitMM, 3)} × ${fmt(m.D / unitMM, 3)} × ${fmt(m.H / unitMM, 3)} ${unitLabel()} (exterior)${comps}${m.drawer ? ' · con cajón' : ''}`;
    if (m.planter) {
      build3DPlanter(m, window.THREE);
      v3.group.position.set(-m.W / 2, -m.H / 2, -m.D / 2);
      v3.pivot.rotation.x = 0;
      applyExplode();
      return;
    }
    if (m.cone) {
      build3DCone(m, window.THREE);
      v3.group.position.set(-m.W / 2, -m.H / 2, -m.D / 2);
      v3.pivot.rotation.x = 0;
      applyExplode();
      return;
    }
    const engQs = new Set(engraveTargets(s, m).map(tg => tg.q)), ovs = boxOverlays(s, m);
    for (const q of [...m.panels, ...m.dividers]) {
      const P = q.axes || PLACE[q.place], o = q.axes ? q.axes.o : placeOrigin(m, q);
      const shape = new T.Shape(q.pts.map(([u, v]) => new T.Vector2(u, v)));
      for (const hl of [...(q.holes || []), ...((ovs.get(q) || { holes: [] }).holes)]) shape.holes.push(new T.Path(hl.map(([u, v]) => new T.Vector2(u, v))));
      const geo = new T.ExtrudeGeometry(shape, { depth: q.th || m.t, bevelEnabled: false, curveSegments: 1 });
      const mat4 = new T.Matrix4().set(
        P.eu[0], P.ev[0], P.ew[0], o[0],
        P.eu[1], P.ev[1], P.ew[1], o[1],
        P.eu[2], P.ev[2], P.ew[2], o[2],
        0, 0, 0, 1);
      const holder = new T.Group();
      // Con cajón, el mueble queda fijo y el control desliza el cajón hacia afuera
      holder.userData.out = m.drawer ? [0, 0, 0] : q.axes ? q.axes.out : P.out;
      holder.userData.slide = !!q.drawer;
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: q.color || WOOD[q.place] || 0xe2bf8d, roughness: 0.85, metalness: 0, side: T.DoubleSide }));
      const edges = new T.LineSegments(new T.EdgesGeometry(geo, 20), new T.LineBasicMaterial({ color: 0x6b4a2b }));
      const parts = [mesh, edges];
      if (engQs.has(q) || ovs.has(q)) {
        const decal = engraveDecal(s, m, q, P, ovs.get(q));
        if (decal) parts.push(decal);
      }
      for (const obj of parts) { obj.matrixAutoUpdate = false; obj.matrix.copy(mat4); holder.add(obj); }
      v3.group.add(holder);
    }
    v3.group.position.set(-m.W / 2, -m.H / 2, -m.D / 2);
    v3.pivot.rotation.x = m.wall ? -Math.PI / 2 : 0; // bandeja de pared: el frente abierto mira hacia ti
    applyExplode();
  }
  // Maceta: pared curva (cilindro o medio cilindro con pared recta), base con pestañas, refuerzo y aros
  function build3DPlanter(m, T) {
    const p = m.planter, cx = m.W / 2, cz = p.half ? p.R : m.D / 2;
    const mat = c => new T.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, side: T.DoubleSide });
    const add = (geos, color, out, pos, rotX) => {
      const holder = new T.Group();
      for (const geo of geos) {
        const mesh = new T.Mesh(geo, mat(color));
        const edges = new T.LineSegments(new T.EdgesGeometry(geo, 25), new T.LineBasicMaterial({ color: 0x6b4a2b }));
        for (const o of [mesh, edges]) { o.position.set(...pos); holder.add(o); }
      }
      holder.userData.out = out;
      v3.group.add(holder);
    };
    const flat = (pts, holes, y, depth) => {
      const sh = new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z)));
      for (const hl of holes || []) sh.holes.push(new T.Path(hl.map(([x, z]) => new T.Vector2(x, -z))));
      const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      return g;
    };
    // Pared: cinta que sigue el recorrido real de la tira, con las líneas de la bisagra dibujadas encima
    const sc = Math.min(8, 2048 / Math.max(p.L, p.H)), cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(p.L * sc)); cv.height = Math.max(2, Math.round(p.H * sc));
    const cx2 = cv.getContext('2d');
    cx2.fillStyle = '#dcb887'; cx2.fillRect(0, 0, cv.width, cv.height);
    cx2.strokeStyle = '#4a2f16'; cx2.lineWidth = Math.max(1, 0.35 * sc); cx2.lineCap = 'round';
    cx2.beginPath();
    for (const [a, b] of p.hl) { cx2.moveTo(a[0] * sc, a[1] * sc); cx2.lineTo(b[0] * sc, b[1] * sc); }
    cx2.stroke();
    const tex = new T.CanvasTexture(cv);
    tex.anisotropy = v3.renderer.capabilities.getMaxAnisotropy();
    const N = Math.min(900, Math.max(24, Math.ceil(p.L / 2))), ribbon = off => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const sP = p.L * i / N, { p: pt, n } = p.pathAt(Math.min(sP, p.L - 1e-6));
        const x = pt[0] + n[0] * off, z = pt[1] + n[1] * off;
        pos.push(x, 0, z, x, m.H, z); uv.push(sP / p.L, 0, sP / p.L, 1);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const wallHolder = new T.Group();
    for (const off of [m.t / 2, -m.t / 2]) {
      const g = ribbon(off), mesh = new T.Mesh(g, new T.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: T.DoubleSide }));
      mesh.position.set(cx, 0, cz); wallHolder.add(mesh);
    }
    wallHolder.userData.out = [0, 0, 0];
    v3.group.add(wallHolder);
    add([flat(p.basePlan, null, 0, m.t)], 0xcfa878, [0, -1, 0], [cx, 0, cz]);
    if (p.reinf) add([flat(p.reinf, null, m.t, m.t)], 0xb98b5a, [0, 1, 0], [cx, 0, cz]);
    for (const rg of p.rings) add([flat(rg.outer, [rg.inner], m.H - rg.y - m.t / 2, m.t)], 0xb98b5a, [0, 1, 0], [cx, 0, cz]);
  }
  // Cono: la pared se dibuja como superficie cónica (la bisagra viva no se ve en 3D) y la base como disco
  function build3DCone(m, T) {
    const c = m.cone, cx = m.W / 2, cz = m.D / 2;
    const add = (geo, color, y, out) => {
      const holder = new T.Group();
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: T.DoubleSide }));
      const edges = new T.LineSegments(new T.EdgesGeometry(geo, 20), new T.LineBasicMaterial({ color: 0x6b4a2b }));
      for (const o of [mesh, edges]) { o.position.set(cx, y, cz); holder.add(o); }
      holder.userData.out = out;
      v3.group.add(holder);
    };
    add(new T.CylinderGeometry(c.Rt, c.Rb, c.H, 96, 1, true), 0xd9b384, m.t + c.H / 2, [0, 0, 0]);
    if (c.base) add(new T.CylinderGeometry(c.Rbase, c.Rbase, m.t, 96), 0xcfa878, m.t / 2, [0, -1, 0]);
  }
  // Grabado en 3D: se dibuja en una textura (color madera quemada) pegada a la cara exterior de la pieza.
  const imgCache = new Map();
  function engraveDecal(s, m, q, P, ov) {
    const T = window.THREE;
    const base = boxEngraving(s, m, new Map([[q, [0, 0]]]));
    const extra = ov && ov.engr, has = extra && (extra.polys.length || extra.texts.length || extra.images.length);
    const it0 = base || has ? { op: 'grabado', polys: [...(base ? base.polys : []), ...(has ? extra.polys : [])], texts: [...(base ? base.texts : []), ...(has ? extra.texts : [])], images: [...(base ? base.images : []), ...(has ? extra.images : [])] } : null;
    const it = it0 && fontOutlines(it0);
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
    if (v3.art) v3.camera.position.set(0, R * 1.25, R * 1.0); else v3.camera.position.set(R * 0.95, R * 0.8, -R * 1.45);
    v3.controls.target.set(0, 0, 0);
    v3.controls.update();
    v3.lastR = R;
  }
  function loop3D() {
    if (!v3.open) return;
    v3.controls.update();
    v3.renderer.render(v3.scene, v3.camera);
    v3.raf = requestAnimationFrame(loop3D);
  }
  /* ================= Armar en 3D las piezas planas de un archivo (caja con dedos o pegada) ================= */
  const FACES = { front: 'Frente', back: 'Atrás', left: 'Lado izquierdo', right: 'Lado derecho', bottom: 'Base', top: 'Tapa', none: 'No usar' };
  function suggestFaces(pcs) {
    const near = (a, b) => Math.abs(a - b) <= Math.max(1.5, 0.02 * Math.max(a, b));
    const same = (a, b) => Math.abs(a - b) <= Math.max(0.6, 0.004 * Math.max(a, b)); // piezas gemelas: casi idénticas
    const groups = [];
    for (const p of pcs) {
      const lo = Math.min(p.w, p.h), hi = Math.max(p.w, p.h);
      let g = groups.find(q => same(q.lo, lo) && same(q.hi, hi));
      if (!g) { g = { lo, hi, items: [] }; groups.push(g); }
      g.items.push(p);
    }
    groups.sort((a, b) => b.lo * b.hi - a.lo * a.hi);
    const out = new Map(pcs.map(p => [p.i, { face: 'none', rot: false }]));
    const pairs = groups.filter(g => g.items.length >= 2), singles = groups.filter(g => g.items.length === 1);
    let base = null, lid = null, walls = [];
    if (pairs.length >= 3) { base = pairs[0].items[0]; lid = pairs[0].items[1]; walls = [pairs[1], pairs[2]]; }
    else if (pairs.length === 2 && singles.length) { base = singles[0].items[0]; walls = pairs; }
    else if (pairs.length === 2) { walls = pairs; }
    if (!walls.length) return out;
    const bw = base ? Math.max(base.w, base.h) : Math.max(walls[0].hi, walls[1].hi), bd = base ? Math.min(base.w, base.h) : Math.min(walls[0].lo, walls[1].lo);
    if (base) out.set(base.i, { face: 'bottom', rot: base.w < base.h });
    if (lid) out.set(lid.i, { face: 'top', rot: lid.w < lid.h });
    // Frente y atrás comparten el ancho mayor de la base; los lados, el menor
    const frontG = walls.find(g => near(g.hi, bw) || near(g.lo, bw)) || walls[0], sideG = walls.find(g => g !== frontG) || walls[1];
    const place = (g, a, b, faceA, faceB, dim) => g.items.slice(0, 2).forEach((p, k) => out.set(p.i, { face: k ? faceB : faceA, rot: !near(p.w, dim) && !near(p.w, p.h) }));
    place(frontG, 0, 0, 'front', 'back', bw);
    if (sideG) place(sideG, 0, 0, 'left', 'right', bd);
    return out;
  }
  /* ================= Agrandar una pieza plana sumando una medida (sin deformar dedos ni ranuras) ================= */
  // Se busca una línea (en el centro, donde no haya dedos ni ranuras) y se separa todo lo que queda a un lado de ella.
  function stretchPolys(polys, texts, A, delta) {
    const closed = polys.filter(p => p.closed && p.pts.length >= 3);
    const outer = closed.length ? closed.reduce((a, c) => shoelace(c.pts) > shoelace(a.pts) ? c : a) : polys[0];
    if (!outer) return { polys, texts, at: null };
    const ob = ptsBox(outer.pts), lo = A ? ob.y0 : ob.x0, hi = A ? ob.y1 : ob.x1, L = hi - lo, m = Math.min(12, L * 0.15);
    const ext = p => { const b = ptsBox(p.pts); return A ? [b.y0, b.y1, b.x1 - b.x0, b.y1 - b.y0] : [b.x0, b.x1, b.x1 - b.x0, b.y1 - b.y0]; };
    // Los dedos del contorno (bordes rectos y cortos) no se estiran: su posición se conserva
    const pts = outer.pts, n = pts.length, prot = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), straight = Math.min(dx, dy) < 0.02 * Math.max(dx, dy, 1e-9);
      if (d < 12 && d > 0.8 && straight) prot.push([Math.min(a[A], b[A]) - 2, Math.max(a[A], b[A]) + 2]);
    }
    prot.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const r of prot) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([Math.max(lo, r[0]), Math.min(hi, r[1])]); }
    const prLen = merged.reduce((t, r) => t + Math.max(0, r[1] - r[0]), 0), Lu = L - prLen;
    if (!(Lu > L * 0.25)) return { polys, texts, at: null };
    const k = 1 + delta / Lu;
    // contorno y líneas largas: el estiramiento se reparte parejo en todo lo que no son dedos
    const fOut = x => {
      let free = Math.max(0, Math.min(x, hi) - lo);
      for (const r of merged) free -= Math.max(0, Math.min(x, r[1]) - Math.max(lo, r[0]));
      return x + (k - 1) * Math.max(0, free);
    };
    // adorno interior: se escala parejo desde las orillas (donde están los dedos y las ranuras)
    const kk = (L - 2 * m + delta) / (L - 2 * m);
    const fIn = x => x <= lo + m ? x : x >= hi - m ? x + delta : lo + m + (x - (lo + m)) * kk;
    const mv = (q, f) => A ? [q[0], f(q[1])] : [f(q[0]), q[1]];
    const out = polys.map(p => {
      if (p === outer) return { ...p, pts: p.pts.map(q => mv(q, fOut)) };
      const [c0, c1, w, h] = ext(p), mid = (c0 + c1) / 2;
      if (Math.max(w, h) <= 15) { const sh = (mid < lo + m ? mid : mid > hi - m ? mid + delta : fIn(mid)) - mid; return { ...p, pts: p.pts.map(q => A ? [q[0], q[1] + sh] : [q[0] + sh, q[1]]) }; } // ranuras y agujeros chicos: solo se mueven
      if (c0 >= lo + m - 0.5 && c1 <= hi - m + 0.5) return { ...p, pts: p.pts.map(q => mv(q, fIn)) };
      return { ...p, pts: p.pts.map(q => mv(q, fOut)) };
    });
    const txt = texts.map(t => { const v = A ? t.y : t.x, sh = (v < lo + m ? v : v > hi - m ? v + delta : fIn(v)) - v; return A ? { ...t, y: t.y + sh } : { ...t, x: t.x + sh }; });
    return { polys: out, texts: txt, at: (lo + hi) / 2 };
  }
  // Reemplaza una pieza importada por la misma pieza estirada (A: 0 = ancho, 1 = alto) en delta mm; devuelve la nueva figura
  function stretchShape(s, A, delta) {
    const r = evalCache.get(s.id);
    if (!r || !(delta > 0)) return s;
    const polys = r.items.flatMap(it => it.polys.map(p => ({ closed: p.closed, op: it.op, pts: p.pts.map(q => [q[0], q[1]]) })));
    const texts = r.items.flatMap(it => it.texts.map(t => ({ ...t, op: it.op })));
    if (r.items.some(it => (it.images || []).length) || !polys.length) return s;
    const res = stretchPolys(polys, texts, A, delta);
    if (res.at === null) return s;
    const o = importObject(s.name, res.polys, res.texts);
    o.op = s.op;
    if (s.from) o.from = s.from;
    const list = listOf(s.id), i = list.indexOf(s);
    list.splice(i, 1, o);
    return o;
  }
  function openStretchDialog(s) {
    const dialog = h('dialog', { class: 'batch-dialog', 'aria-label': 'Agrandar pieza' });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    const dx = h('input', { type: 'number', step: 'any', min: '0', value: '0' }), dy = h('input', { type: 'number', step: 'any', min: '0', value: '0' });
    const go = h('button', { class: 'primary' }, 'Agrandar');
    go.onclick = () => {
      evaluateParams(); evaluateAll();
      let cur = s;
      if (parseFloat(dx.value) > 0) cur = stretchShape(cur, 0, parseFloat(dx.value) * unitMM);
      evaluateParams(); evaluateAll();
      if (parseFloat(dy.value) > 0) cur = stretchShape(cur, 1, parseFloat(dy.value) * unitMM);
      sel = new Set([cur.id]); close(); checkpoint(); fullRender();
      msg(cur === s ? 'No se encontró un lugar donde estirar la pieza sin tocar los dedos o las ranuras.' : 'Pieza agrandada de forma pareja por los dos lados, sin cambiar dedos ni ranuras.');
    };
    dialog.append(h('h2', {}, 'Agrandar la pieza'), h('p', { class: 'tip' }, 'Suma esta medida al ancho o al alto. La app busca una línea en el centro, donde no haya dedos ni ranuras, y separa la pieza por ahí: los dedos y las ranuras no cambian de tamaño, solo el centro se alarga.'),
      h('div', { class: 'nest-grid' }, h('label', {}, `Sumar al ancho (${unitLabel()})`, dx), h('label', {}, `Sumar al alto (${unitLabel()})`, dy)),
      h('div', { class: 'dialog-actions' }, h('button', { onclick: close }, 'Cancelar'), go));
    document.body.append(dialog); dialog.showModal();
  }

  // Las piezas que quedan dentro de otra (trozos de un calado, agujeros) se juntan con ella: así cada cara es una sola pieza
  function mergeNestedPieces(shapes) {
    evaluateParams(); evaluateAll();
    const info = shapes.map(s => { const r = evalCache.get(s.id); return r && r.bbox ? { s, b: r.bbox, area: r.bbox.w * r.bbox.h, items: r.items, kids: [] } : null; }).filter(Boolean);
    info.sort((a, c) => c.area - a.area);
    const inside = (k, p) => k.b.x >= p.b.x - 0.5 && k.b.y >= p.b.y - 0.5 && k.b.x + k.b.w <= p.b.x + p.b.w + 0.5 && k.b.y + k.b.h <= p.b.y + p.b.h + 0.5;
    const parentOf2 = new Map();
    for (const k of info) {
      let best = null;
      for (const p of info) if (p !== k && p.area > k.area * 1.0001 && inside(k, p) && (!best || p.area < best.area)) best = p;
      if (best) { let top = best; while (parentOf2.get(top)) top = parentOf2.get(top); parentOf2.set(k, top); }
    }
    const out = [];
    for (const p of info) {
      if (parentOf2.get(p)) continue;
      const kids = info.filter(k => parentOf2.get(k) === p);
      if (!kids.length) { out.push(p.s); continue; }
      const polys = [p, ...kids].flatMap(q => q.items.flatMap(it => it.polys.map(pl => ({ closed: pl.closed, op: it.op, pts: pl.pts.map(z => [z[0], z[1]]) }))));
      const o = importObject(p.s.name, polys, []);
      o.op = new Set(polys.map(pl => pl.op)).size === 1 ? polys[0].op : 'archivo';
      const list = listOf(p.s.id), i = list.indexOf(p.s);
      list.splice(i, 1, o);
      for (const k of kids) { const l2 = listOf(k.s.id), j = l2.indexOf(k.s); if (j >= 0) l2.splice(j, 1); }
      out.push(o);
    }
    return out;
  }
  async function openAssembleDialog(shapesIn) {
    evaluateParams(); evaluateAll();
    // Un solo archivo con varias piezas: se separa primero
    let shapes = shapesIn.filter(Boolean);
    if (shapes.length === 1 && shapes[0].type === 'import') {
      const a = doc.assets[shapes[0].p.asset];
      if (a && a.kind === 'vector' && splitPieces(a.polys).length > 1) {
        const created = splitImport(shapes[0], false);
        if (created) { shapes = created; sel = new Set(created.map(c => c.id)); checkpoint(); fullRender(); evaluateParams(); evaluateAll(); }
      }
    }
    // Las figuras sencillas pasan a ser dibujos editables
    shapes = shapes.map(s => (s.type !== 'import' && CONVERTIBLE.has(s.type)) ? (convertToEditable(s) || s) : s).filter(s => s.type === 'import' && doc.assets[s.p.asset] && doc.assets[s.p.asset].kind === 'vector');
    shapes = mergeNestedPieces(shapes);
    if (sel.size) { sel = new Set(shapes.map(x => x.id)); }
    if (shapes.length < 4) { msg('Elige al menos 4 piezas planas (por ejemplo todo el archivo con Cmd+A) para armarlas como caja.'); return; }
    evaluateParams(); evaluateAll();
    const pcs = shapes.map((s, i) => { const r = evalCache.get(s.id), b = r && r.bbox; return b ? { i, s, w: b.w, h: b.h, items: r.items } : null; }).filter(Boolean);
    const sug = suggestFaces(pcs);
    const tDef = vars.grosor !== undefined && vars.grosor * unitMM > 0 ? vars.grosor * unitMM : 3;
    const dialog = h('dialog', { class: 'batch-dialog imgtool-dialog', 'aria-label': 'Armar en 3D' });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    const status = h('p', { class: 'tip', role: 'status' });
    const tIn = h('input', { type: 'number', step: 'any', min: '0.1', value: fmt(tDef / unitMM, isInch() ? 4 : 2) });
    const styleSel = h('select', { 'aria-label': 'Tipo de unión' }, h('option', { value: 'dedos' }, 'Con dedos (las piezas miden lo mismo que la caja)'), h('option', { value: 'pegada' }, 'Para pegar (las paredes van entre la base y la tapa)'), h('option', { value: 'espigas' }, 'Con espigas y ranuras (los lados y la base entran por ranuras del frente y el atrás)'));
    const rows = pcs.map(p => {
      const cv = h('canvas', { width: '90', height: '70', class: 'asm-thumb' });
      const c = cv.getContext('2d'), k = Math.min(80 / Math.max(p.w, 1), 60 / Math.max(p.h, 1));
      const b = evalCache.get(p.s.id).bbox;
      c.strokeStyle = '#2f7d4f'; c.lineWidth = 1; c.beginPath();
      for (const it of p.items) for (const pl of it.polys.filter(q => q.pts.length > 2 && q.closed)) { pl.pts.forEach(([x, y], i) => { const X = 5 + (x - b.x) * k, Y = 5 + (y - b.y) * k; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); }
      c.stroke();
      const face = h('select', { 'aria-label': 'Cara' }, ...Object.entries(FACES).map(([k2, l]) => h('option', { value: k2 }, l)));
      face.value = sug.get(p.i).face;
      const rot = h('input', { type: 'checkbox' }); rot.checked = sug.get(p.i).rot;
      return { p, face, rot, el: h('div', { class: 'asm-row' }, cv, h('div', {}, h('strong', {}, p.s.name), h('div', { class: 'tip' }, `${fmt(p.w / unitMM, isInch() ? 2 : 1)} × ${fmt(p.h / unitMM, isInch() ? 2 : 1)} ${unitLabel()}`)), face, h('label', { class: 'check' }, rot, ' girar 90°')) };
    });
    // Para la unión con espigas: dónde quedan los lados y la base, leído de las ranuras chicas del frente
    const frontRow0 = rows.find(r => r.face.value === 'front');
    const detect = () => {
      const r = frontRow0 && evalCache.get(frontRow0.p.s.id);
      if (!r) return { inset: 3, baseY: 3 };
      const b = r.bbox, sm = r.items.flatMap(it => it.polys).filter(p => p.closed && p.pts.length >= 3).map(p => ptsBox(p.pts)).filter(q => q.x1 - q.x0 <= 8 && q.y1 - q.y0 <= 8);
      const left = sm.filter(q => q.x0 - b.x <= 15).map(q => q.x0 - b.x), bottom = sm.filter(q => b.y + b.h - q.y1 <= 15).map(q => b.y + b.h - q.y1);
      return { inset: left.length ? Math.min(...left) : 3, baseY: bottom.length ? Math.min(...bottom) : 3 };
    };
    const det0 = detect();
    const insetIn = h('input', { type: 'number', step: 'any', min: '0', value: fmt(det0.inset / unitMM, isInch() ? 3 : 1) }), baseYIn = h('input', { type: 'number', step: 'any', min: '0', value: fmt(det0.baseY / unitMM, isInch() ? 3 : 1) });
    const espRow = h('div', { class: 'nest-grid', hidden: '' }, h('label', {}, `Distancia de los lados al borde (${unitLabel()})`, insetIn), h('label', {}, `Altura de la base sobre el borde de abajo (${unitLabel()})`, baseYIn));
    styleSel.addEventListener('change', () => { espRow.hidden = styleSel.value !== 'espigas'; });
    const incIn = () => h('input', { type: 'number', step: 'any', min: '0', value: '0' });
    const iW = incIn(), iD = incIn(), iH = incIn();
    const grow = h('button', { title: 'Alarga cada pieza según su cara, sin cambiar los dedos ni las ranuras' }, 'Agrandar las piezas');
    grow.onclick = () => {
      const dW = parseFloat(iW.value) * unitMM || 0, dD = parseFloat(iD.value) * unitMM || 0, dH = parseFloat(iH.value) * unitMM || 0;
      if (!(dW > 0 || dD > 0 || dH > 0)) { status.textContent = 'Escribe cuánto sumar al ancho, al fondo o al alto.'; return; }
      evaluateParams(); evaluateAll();
      const roles = { front: [dW, dH], back: [dW, dH], left: [dD, dH], right: [dD, dH], bottom: [dW, dD], top: [dW, dD] };
      let done = 0, failed = [];
      const targets = rows.filter(r => r.face.value !== 'none').map(r => ({ r, s: r.p.s, rot: r.rot.checked, f: r.face.value }));
      // las piezas que van giradas se estiran por el otro eje
      const plan = targets.map(t => { const [a, b] = roles[t.f]; return { ...t, dx: t.rot ? b : a, dy: t.rot ? a : b }; });
      for (const pl of plan) {
        let cur = pl.s;
        evaluateParams(); evaluateAll();
        if (pl.dx > 0) { const n = stretchShape(cur, 0, pl.dx); if (n === cur) failed.push(cur.name); else { cur = n; done++; } }
        evaluateParams(); evaluateAll();
        if (pl.dy > 0) { const n = stretchShape(cur, 1, pl.dy); if (n === cur) failed.push(cur.name + ' (alto)'); else { cur = n; done++; } }
      }
      close(); checkpoint(); fullRender();
      msg(`${done} estiramiento(s) hecho(s).` + (failed.length ? ` No se pudo en: ${[...new Set(failed)].join(', ')}.` : '') + ' Vuelve a pulsar «Armar como caja en 3D…» para verla.');
    };
    const go = h('button', { class: 'primary' }, 'Armar en 3D');
    go.onclick = () => {
      const t = parseFloat(tIn.value) * unitMM;
      if (!(t > 0)) { status.textContent = 'Escribe el grosor de la madera.'; return; }
      const used = rows.filter(r => r.face.value !== 'none');
      const pick = f => used.filter(r => r.face.value === f);
      const dims = r => r.rot.checked ? [r.p.h, r.p.w] : [r.p.w, r.p.h];
      const fr = pick('front')[0] || pick('back')[0], sd = pick('left')[0] || pick('right')[0], bs = pick('bottom')[0];
      if (!fr || !sd || !bs) { status.textContent = 'Hace falta al menos un frente, un lado y una base.'; return; }
      const style = styleSel.value, glued = style === 'pegada', tslot = style === 'espigas', hasTop = pick('top').length > 0;
      const W = glued ? dims(bs)[0] : dims(fr)[0], Dd = glued ? dims(bs)[1] : dims(sd)[0], Hh = glued ? dims(fr)[1] + t + (hasTop ? t : 0) : dims(fr)[1];
      const m = { W, D: Dd, H: Hh, t, fingers: !glued, wall: false };
      const inset = (parseFloat(insetIn.value) || 0) * unitMM, baseY = (parseFloat(baseYIn.value) || 0) * unitMM;
      // Las piezas que hay que girar se vuelven a crear ya giradas
      const gid = 'o' + uid();
      const names = { front: 'Frente', back: 'Atrás', left: 'Lado izquierdo', right: 'Lado derecho', bottom: 'Base', top: 'Tapa' };
      for (const r of used) {
        let s = r.p.s;
        if (r.rot.checked) {
          const b = evalCache.get(s.id).bbox, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const polys = r.p.items.flatMap(it => it.polys.map(pl => ({ closed: pl.closed, op: it.op, pts: pl.pts.map(([x, y]) => [cx - (y - cy), cy + (x - cx)]) })));
          const o = importObject(s.name, polys, []); o.op = s.op;
          const list = listOf(s.id), at = list.indexOf(s); list.splice(at, 1, o); s = o;
        }
        const f = r.face.value, [pw, ph] = dims(r), q = { name: names[f], place: f, h: ph, w: pw };
        let ax = axesOf(m, q);
        if (tslot) {
          const bw = dims(bs)[0], bd = dims(bs)[1];
          const A = {
            front: { eu: [1, 0, 0], ev: [0, -1, 0], ew: [0, 0, 1], o: [0, Hh, 0], out: [0, 0, -1] },
            back: { eu: [-1, 0, 0], ev: [0, -1, 0], ew: [0, 0, -1], o: [W, Hh, Dd], out: [0, 0, 1] },
            left: { eu: [0, 0, 1], ev: [0, -1, 0], ew: [1, 0, 0], o: [inset, ph + baseY * 0, 0], out: [-1, 0, 0] },
            right: { eu: [0, 0, -1], ev: [0, -1, 0], ew: [-1, 0, 0], o: [W - inset, ph, Dd], out: [1, 0, 0] },
            bottom: { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, 1, 0], o: [(W - bw) / 2, baseY, (Dd - bd) / 2], out: [0, -1, 0] },
            top: { eu: [1, 0, 0], ev: [0, 0, 1], ew: [0, -1, 0], o: [(W - bw) / 2, Hh, (Dd - bd) / 2], out: [0, 1, 0] },
          }[f];
          if (A) ax = A;
        }
        s.from = { gid, name: doc.name || 'Caja' };
        s.asm = { name: names[f], ax: JSON.parse(JSON.stringify(ax)) };
        s.name = names[f] + (pick(f).length > 1 ? ' ' + (pick(f).indexOf(r) + 1) : '');
      }
      doc.origins = doc.origins || {};
      doc.origins[gid] = { shape: null, asm: { name: doc.name || 'Caja', t, W, H: Hh, D: Dd, wall: false } };
      close(); checkpoint(); fullRender();
      open3D(gid);
      msg(`Caja armada: ${fmt(W / unitMM, isInch() ? 2 : 1)} × ${fmt(Dd / unitMM, isInch() ? 2 : 1)} × ${fmt(Hh / unitMM, isInch() ? 2 : 1)} ${unitLabel()}.`);
    };
    dialog.append(h('h2', {}, 'Armar la caja en 3D'),
      h('p', { class: 'tip' }, 'La app propone qué cara es cada pieza según su tamaño. Corrige las que no coincidan y, si una pieza está acostada, marca «girar 90°». Funciona con cajas rectas (con tapa o sin ella).'),
      h('div', { class: 'nest-grid' }, h('label', {}, `Grosor de la madera (${unitLabel()})`, tIn), h('label', {}, 'Tipo de unión', styleSel)),
      espRow,
      h('div', { class: 'asm-list' }, ...rows.map(r => r.el)),
      h('div', { class: 'insp-sub' }, 'Agrandar la caja (opcional)'),
      h('p', { class: 'tip' }, 'Suma una medida a cada cara de la caja. Los dedos y las ranuras no cambian de tamaño; el contorno y el adorno crecen parejo por los dos lados.'),
      h('div', { class: 'nest-grid' }, h('label', {}, `Sumar al ancho (${unitLabel()})`, iW), h('label', {}, `Sumar al fondo (${unitLabel()})`, iD), h('label', {}, `Sumar al alto (${unitLabel()})`, iH)),
      status,
      h('div', { class: 'dialog-actions' }, h('button', { onclick: close }, 'Cancelar'), grow, go));
    document.body.append(dialog); dialog.showModal();
  }

  function open3D(id) {
    let gid = null;
    if (id && id.startsWith('o')) { gid = id; id = null; } // se pidió una caja desagrupada
    if (!id && !gid) {
      const is3D = s => s && ['box', 'basket', 'taper', 'cone', 'planter'].includes(s.type);
      const pick = [...sel].map(byId).find(is3D);
      const any = allShapes().find(is3D);
      id = (pick || any || {}).id;
      if (!id) { // ¿hay piezas desagrupadas que se puedan armar?
        const pc = [...sel].map(byId).find(x => x && x.asm) || allShapes().find(x => x.type === 'import' && x.asm);
        if (pc) gid = pc.from.gid;
      }
    }
    let art = false;
    if (!id && !gid) {
      evaluateParams(); evaluateAll();
      art = allShapes().some(x => !x.hidden && evalCache.has(x.id) && (evalCache.get(x.id).items || []).length);
      if (!art) { msg('La vista 3D muestra tu diseño con el grosor de la madera. Dibuja algo, importa un SVG o crea una caja con Plantillas.'); return; }
    }
    // Con una figura elegida que no es caja (un SVG, un dibujo), se ve el arte en 3D aunque haya cajas en el diseño
    if (!gid && id && [...sel].length && ![...sel].map(byId).some(x => x && ['box', 'basket', 'taper', 'cone', 'planter'].includes(x.type)) && [...sel].map(byId).some(x => x && x.type === 'import')) { id = null; art = true; }
    if (!init3D()) return;
    v3.id = id; v3.gid = gid; v3.art = art; v3.open = true; v3.lastR = null;
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
    if (one && one.type === 'box') { updateCompTip(one); updateFingerTip(one); }
    if (one && one.type === 'panel') updateFingerTip(one);
    if (one && (one.type === 'box' || one.type === 'taper')) updateCoverTip(one);
    if (one && one.type === 'basket') updateBasketTip(one);
    if (one && (one.type === 'taper' || one.type === 'cone' || one.type === 'planter')) updateShapeTip(one);
    if (v3.open) build3D();
  }
  function fullRender() {
    evaluateParams();
    $('#docName').value = doc.name;
    $('#unitSelect').value = doc.units;
    $('#stCoords').textContent = `x ${fmt(lastPointer.x / unitMM, 3)} · y ${fmt(lastPointer.y / unitMM, 3)} ${unitLabel()}`;
    drawCanvas(); buildParams(); buildInspector(); buildObjects(); buildMeasures(); refreshHints(); updateButtons();
    if (v3.open) { if (v3.art || (v3.gid ? allShapes().some(x => x.from && x.from.gid === v3.gid && x.asm) : byId(v3.id))) build3D(); else close3D(); }
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
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#btnSave').onclick = saveFile;
  $('#btnExport').onclick = () => withFonts(exportSVG);
  $('#btnExportDxf').onclick = () => withFonts(exportDXF);
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnAddParam').onclick = () => addParam();
  $('#btnMeasTwo').onclick = () => setMeasureMode('two');
  $('#btnMeasShape').onclick = () => setMeasureMode('shape');
  const clearMeasures = () => { if (!(doc.measures || []).length) return; doc.measures = []; checkpoint(); fullRender(); msg('Medidas borradas.'); };
  $('#btnMeasClear').onclick = clearMeasures;
  $('#btnMeasClear2').onclick = clearMeasures;
  $('#btnZoomIn').onclick = () => zoomCenter(1.25);
  $('#btnZoomOut').onclick = () => zoomCenter(0.8);
  $('#btnFit').onclick = fitView;
  $('#unitSelect').onchange = e => setUnits(e.target.value);
  $('#chkSnap').onchange = e => { snap = e.target.checked; };
  $('#docName').addEventListener('input', e => { doc.name = e.target.value; });
  $('#docName').addEventListener('change', checkpoint);

  const menu = $('#menuTemplates');
  $('#btnTemplates').onclick = e => { e.stopPropagation(); if (menu.hidden) buildUserTemplates(); menu.hidden = !menu.hidden; };

  /* ----- Mis plantillas: diseños guardados en este navegador para reusarlos ----- */
  const TPL_KEY = 'evergreen-love-studio:plantillas';
  function readUserTemplates() {
    try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeUserTemplates(list) {
    try { localStorage.setItem(TPL_KEY, JSON.stringify(list)); return true; }
    catch (e) { msg('No hay espacio en el navegador para más plantillas. Guarda el diseño como archivo (Guardar) y ábrelo cuando lo necesites.'); return false; }
  }
  function buildUserTemplates() {
    const box = $('#userTemplates');
    box.replaceChildren();
    const list = readUserTemplates();
    box.append(h('div', { class: 'menu-title' }, 'Mis plantillas'));
    if (!list.length) box.append(h('p', { class: 'menu-empty' }, 'Todavía no tienes. Abre o importa un diseño y usa "Guardar como plantilla".'));
    for (const tpl of list) {
      box.append(h('div', { class: 'menu-row' },
        h('button', { class: 'menu-item', title: 'Abrir esta plantilla', onclick: () => {
          menu.hidden = true;
          if (doc.shapes.length && !confirm(`Abrir la plantilla "${tpl.name}" reemplaza el diseño actual (puedes volver con Deshacer). ¿Continuar?`)) return;
          checkpoint();
          loadDoc(JSON.parse(JSON.stringify(tpl.doc)));
          checkpoint(); fullRender(); fitView();
          msg(`Plantilla abierta: ${tpl.name}`);
        } }, ...(typeof tpl.thumbnail === 'string' && tpl.thumbnail.startsWith('data:image/svg+xml,') ? [h('img', { src: tpl.thumbnail, class: 'template-thumb', alt: '', loading: 'lazy' })] : []), h('span', {}, tpl.name)),
        h('button', { class: 'icon-btn del', title: 'Borrar esta plantilla', 'aria-label': 'Borrar ' + tpl.name, onclick: ev => {
          ev.stopPropagation();
          if (!confirm(`¿Borrar la plantilla "${tpl.name}"? Tu diseño actual no se toca.`)) return;
          writeUserTemplates(readUserTemplates().filter(x => x.id !== tpl.id));
          buildUserTemplates();
        } }, '×')));
    }
  }
  $('#btnSaveTemplate').onclick = e => {
    e.stopPropagation();
    menu.hidden = true;
    if (!doc.shapes.length) { msg('El diseño está vacío: primero abre, importa o dibuja algo.'); return; }
    const name = (prompt('Nombre de la plantilla:', doc.name || 'Mi plantilla') || '').trim();
    if (!name) return;
    const list = readUserTemplates();
    const same = list.find(x => x.name === name);
    if (same && !confirm(`Ya tienes una plantilla "${name}". ¿Reemplazarla?`)) return;
    evaluateParams(); evaluateAll();
    const thumbItems = [...evalCache.values()].flatMap(r => r.items);
    const thumbBox = bboxOfItems(thumbItems);
    let thumbnail = '';
    if (thumbBox) {
      const thumb = svgEl('svg', { xmlns: NS, viewBox: `${thumbBox.x - 2} ${thumbBox.y - 2} ${thumbBox.w + 4} ${thumbBox.h + 4}`, width: 180, height: 100 });
      renderItems(thumbItems, thumb, '', false);
      thumb.querySelectorAll('path').forEach(e => { e.setAttribute('fill', 'none'); e.setAttribute('stroke', '#2f7d4f'); e.setAttribute('stroke-width', '1'); });
      thumb.querySelectorAll('text').forEach(e => e.setAttribute('fill', '#1d2a21'));
      thumbnail = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(thumb));
    }
    const entry = { id: same ? same.id : uid(), name, thumbnail, date: new Date().toISOString(), doc: JSON.parse(JSON.stringify({ ...doc, name })) };
    const next = same ? list.map(x => x.id === same.id ? entry : x) : [...list, entry];
    if (writeUserTemplates(next)) msg(`Plantilla guardada: "${name}". Está en Plantillas → Mis plantillas.`);
  };
  document.addEventListener('click', () => { menu.hidden = true; });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-template]');
    if (!b || !TEMPLATES[b.dataset.template]) return;
    if (doc.shapes.length && !confirm('La plantilla reemplaza el diseño actual (puedes volver con Deshacer). ¿Continuar?')) return;
    checkpoint();
    doc = TEMPLATES[b.dataset.template](doc.units, doc.sheet);
    sel.clear(); checkpoint(); fullRender(); fitView();
  });

  // Caja cónica en pulgadas: base 5.5", boca 6.5" (alto y grosor se cambian en Parámetros)
  TEMPLATES['taper-55-65'] = (units, sheet) => {
    const d = taperTemplate('in', sheet);
    d.name = 'Caja cónica 5.5″ → 6.5″';
    const set = { ancho: '5.5', largo: '5.5', ancho_arriba: '6.5', largo_arriba: '6.5', alto: '4', grosor: '0.118', dedo: '0.4', kerf: '0.004', sep: '0.2' };
    for (const p of d.params) if (set[p.name]) p.expr = set[p.name];
    return d;
  };

  TEMPLATES['names-batch'] = (units, sheet) => {
    const d = newDoc(units); d.name = 'Etiquetas personalizadas'; d.sheet = { ...sheet };
    const u = UNIT_MM[units] || 1, v = n => String(n / u);
    d.shapes = [
      { id: uid(), type: 'rect', name: 'Base de etiqueta', op: 'corte', p: { x: '0', y: '0', w: v(75), h: v(25), r: v(3), rot: '0' } },
      { id: uid(), type: 'circle', name: 'Agujero', op: 'corte', p: { x: v(5), y: v(12.5), d: v(3), rot: '0' } },
      { id: uid(), type: 'text', name: 'Nombre personalizable', op: 'grabado', p: { x: v(12), y: v(15), tam: v(7), texto: '{{nombre}}', rot: '0' } }
    ]; return d;
  };

  const TOOL_KEYS = { m: 'measure', v: 'select', h: 'hand', r: 'rect', c: 'circle', p: 'polygon', l: 'line', n: 'pen', t: 'text', f: 'panel', b: 'hinge', k: 'box' };
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    const inField = e.target.matches && e.target.matches('input, textarea, select');
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); saveFile(); return; }
    if (mod && k === 'o') { e.preventDefault(); $('#fileInput').click(); return; }
    if (inField) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && k === 'c') { e.preventDefault(); copySel(false); return; }
    if (mod && k === 'x') { e.preventDefault(); copySel(true); return; }
    if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel('grupo'); return; }
    if (mod && k === 'a') { e.preventDefault(); sel = new Set(doc.shapes.map(s => s.id)); buildInspector(); buildObjects(); drawCanvas(); return; }
    if (mod) return;
    if (tool === 'pen') {
      if (e.key === 'Enter') { e.preventDefault(); penFinish(false); return; }
      if (e.key === 'Escape' && pen.nodes.length) { e.preventDefault(); penCancel(); drawOverlay(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && pen.nodes.length) { e.preventDefault(); pen.nodes.pop(); drawOverlay(); return; }
    }
    if (nodeSel.size && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteNodes(); return; }
    if (nodeSel.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const fine = isInch() ? 0.005 * 25.4 : 0.1, st = e.shiftKey ? gridMM() : fine, dv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      nudgeNodes(dv[0] * st, dv[1] * st); return;
    }
    if (!nodeSel.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && [...sel].some(id => nodeShow.has(id))) {
      e.preventDefault(); msg('Haz clic en un punto para elegirlo y muévelo con las flechas (con los puntos visibles, las flechas ya no mueven toda la figura).'); return;
    }
    if (e.key === 'Escape' && (nodeSel.size || nodeShow.size)) {
      if (nodeSel.size) nodeSel.clear(); else { nodeShow.clear(); nodeHover = null; svg.style.cursor = ''; msg('Puntos ocultos.'); }
      drawCanvas(); return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (e.key === ' ') { e.preventDefault(); spaceDown = true; stage.classList.add('panning'); return; }
    if (e.key === 'Escape' && v3.open) { close3D(); return; }
    if (e.key === 'Escape' && tool === 'measure' && meas.a) { meas.a = null; drawOverlay(); return; }
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
