"use client";

import { useEffect, useRef, useState } from "react";

type Vocab = { hanzi: string; pinyin: string; spanish: string; example: string };

const vocabulary: Vocab[] = [
  { hanzi: "你", pinyin: "nǐ", spanish: "tú", example: "你好！ Nǐ hǎo!" },
  { hanzi: "好", pinyin: "hǎo", spanish: "bien / bueno", example: "很好。 Hěn hǎo." },
  { hanzi: "你好", pinyin: "nǐ hǎo", spanish: "hola", example: "你好，Ana！" },
  { hanzi: "我", pinyin: "wǒ", spanish: "yo", example: "我是 María。" },
  { hanzi: "叫", pinyin: "jiào", spanish: "llamarse", example: "我叫 Luis。" },
  { hanzi: "谢谢", pinyin: "xièxie", spanish: "gracias", example: "谢谢你！" },
];

const tones = [
  { char: "妈", py: "mā", label: "1.º alto y sostenido", mark: "—" },
  { char: "麻", py: "má", label: "2.º ascendente", mark: "↗" },
  { char: "马", py: "mǎ", label: "3.º baja y sube", mark: "∨" },
  { char: "骂", py: "mà", label: "4.º descendente", mark: "↘" },
];

type KidWord = { hanzi: string; pinyin: string; es: string; emoji: string };

const kidWords: KidWord[] = [
  { hanzi: "猫", pinyin: "māo", es: "gato", emoji: "🐱" },
  { hanzi: "狗", pinyin: "gǒu", es: "perro", emoji: "🐶" },
  { hanzi: "鱼", pinyin: "yú", es: "pez", emoji: "🐟" },
  { hanzi: "鸟", pinyin: "niǎo", es: "pájaro", emoji: "🐦" },
  { hanzi: "苹果", pinyin: "píngguǒ", es: "manzana", emoji: "🍎" },
  { hanzi: "水", pinyin: "shuǐ", es: "agua", emoji: "💧" },
  { hanzi: "你好", pinyin: "nǐ hǎo", es: "hola", emoji: "👋" },
  { hanzi: "谢谢", pinyin: "xièxie", es: "gracias", emoji: "🙏" },
];

const kidTones = [
  { char: "妈", py: "mā", emoji: "🐻", hint: "El oso canta plano y alto", mark: "—" },
  { char: "麻", py: "má", emoji: "🐵", hint: "El mono sube al árbol", mark: "↗" },
  { char: "马", py: "mǎ", emoji: "🐸", hint: "La rana baja y salta", mark: "∨" },
  { char: "骂", py: "mà", emoji: "🐯", hint: "El tigre ruge hacia abajo", mark: "↘" },
];

type Sound = { letter: string; hanzi: string; py: string; hint: string };

const pinyinFinals: Sound[] = [
  { letter: "a", hanzi: "啊", py: "ā", hint: "como la a de ‘mamá’" },
  { letter: "o", hanzi: "哦", py: "ō", hint: "como la o de ‘polo’, labios redondos" },
  { letter: "e", hanzi: "鹅", py: "é", hint: "entre e y o, con la garganta relajada" },
  { letter: "i", hanzi: "衣", py: "yī", hint: "como la i de ‘sí’" },
  { letter: "u", hanzi: "乌", py: "wū", hint: "como la u de ‘luna’" },
  { letter: "ü", hanzi: "鱼", py: "yú", hint: "una u dicha con labios de i (como la u francesa)" },
  { letter: "ai", hanzi: "爱", py: "ài", hint: "como ‘ay’" },
  { letter: "ei", hanzi: "诶", py: "éi", hint: "como ‘ei’ de ‘peine’" },
  { letter: "ao", hanzi: "袄", py: "ǎo", hint: "como ‘au’ de ‘auto’" },
  { letter: "ou", hanzi: "欧", py: "ōu", hint: "o + u seguidas" },
  { letter: "an", hanzi: "安", py: "ān", hint: "a + n, como ‘pan’ sin la p" },
  { letter: "en", hanzi: "恩", py: "ēn", hint: "e + n suave" },
  { letter: "ang", hanzi: "昂", py: "áng", hint: "a + ng nasal, como ‘tango’ sin el ‘to’" },
  { letter: "ong", hanzi: "红", py: "hóng", hint: "o + ng nasal (aquí suena en ‘hóng’, rojo)" },
];

const pinyinInitials: Sound[] = [
  { letter: "b", hanzi: "波", py: "bō", hint: "como una p suave de ‘bola’" },
  { letter: "p", hanzi: "坡", py: "pō", hint: "p con soplo de aire" },
  { letter: "m", hanzi: "妈", py: "mā", hint: "como la m de ‘mamá’" },
  { letter: "f", hanzi: "发", py: "fā", hint: "como la f de ‘foca’" },
  { letter: "d", hanzi: "大", py: "dà", hint: "t suave, sin aire" },
  { letter: "t", hanzi: "他", py: "tā", hint: "t con soplo de aire" },
  { letter: "n", hanzi: "你", py: "nǐ", hint: "como la n de ‘nube’" },
  { letter: "l", hanzi: "来", py: "lái", hint: "como la l de ‘luna’" },
  { letter: "g", hanzi: "哥", py: "gē", hint: "k suave, sin aire" },
  { letter: "k", hanzi: "看", py: "kàn", hint: "k con soplo de aire" },
  { letter: "h", hanzi: "好", py: "hǎo", hint: "como la j suave de ‘jamón’" },
  { letter: "j", hanzi: "家", py: "jiā", hint: "como ‘yi’ + ‘a’, muy suave" },
  { letter: "q", hanzi: "七", py: "qī", hint: "ch suave con aire" },
  { letter: "x", hanzi: "西", py: "xī", hint: "entre s y sh, con sonrisa" },
  { letter: "zh", hanzi: "中", py: "zhōng", hint: "ch con la lengua doblada atrás" },
  { letter: "ch", hanzi: "吃", py: "chī", hint: "ch fuerte con aire y lengua atrás" },
  { letter: "sh", hanzi: "是", py: "shì", hint: "sh con la lengua doblada atrás" },
  { letter: "r", hanzi: "人", py: "rén", hint: "r suave con zumbido, sin vibrar" },
  { letter: "z", hanzi: "字", py: "zì", hint: "como ‘ds’ juntas" },
  { letter: "c", hanzi: "菜", py: "cài", hint: "como ‘ts’ con aire" },
  { letter: "s", hanzi: "三", py: "sān", hint: "como la s de ‘sol’" },
  { letter: "y", hanzi: "一", py: "yī", hint: "como la i, apoya la vocal" },
  { letter: "w", hanzi: "五", py: "wǔ", hint: "como la u, apoya la vocal" },
];

const kidLetters: Sound[] = [
  { letter: "a", hanzi: "啊", py: "ā", hint: "a" },
  { letter: "o", hanzi: "哦", py: "ō", hint: "o" },
  { letter: "e", hanzi: "鹅", py: "é", hint: "e" },
  { letter: "i", hanzi: "衣", py: "yī", hint: "i" },
  { letter: "u", hanzi: "乌", py: "wū", hint: "u" },
  { letter: "ü", hanzi: "鱼", py: "yú", hint: "ü" },
  { letter: "b", hanzi: "波", py: "bō", hint: "b" },
  { letter: "p", hanzi: "坡", py: "pō", hint: "p" },
  { letter: "m", hanzi: "妈", py: "mā", hint: "m" },
  { letter: "d", hanzi: "大", py: "dà", hint: "d" },
  { letter: "n", hanzi: "你", py: "nǐ", hint: "n" },
  { letter: "l", hanzi: "来", py: "lái", hint: "l" },
];

const traceChars = [
  { char: "一", py: "yī", es: "uno" },
  { char: "二", py: "èr", es: "dos" },
  { char: "三", py: "sān", es: "tres" },
  { char: "人", py: "rén", es: "persona" },
  { char: "口", py: "kǒu", es: "boca" },
];

function speak(text: string, rate = 0.72) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = rate;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) ?? null;
  window.speechSynthesis.speak(utterance);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeRound(): { word: KidWord; options: KidWord[] } {
  const [word, ...rest] = shuffle(kidWords);
  return { word, options: shuffle([word, rest[0], rest[1]]) };
}

function makeLetterRound(): { sound: Sound; options: Sound[] } {
  const [sound, ...rest] = shuffle(kidLetters);
  return { sound, options: shuffle([sound, rest[0], rest[1]]) };
}

function TraceBoard({ char }: { char: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Un solo puntero activo a la vez: permite apoyar la palma en el iPad
  // mientras se escribe con el Apple Pencil sin que deje rayones.
  const activePointer = useRef<number | null>(null);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  };

  const strokeWidth = (e: React.PointerEvent<HTMLCanvasElement>) =>
    e.pointerType === "pen" && e.pressure > 0 ? 10 + e.pressure * 28 : 22;

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Si ya hay un dedo/palma dibujando y llega el lápiz, el lápiz manda;
    // si ya dibuja el lápiz, cualquier otro toque se ignora.
    if (activePointer.current !== null && e.pointerType !== "pen") return;
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== e.pointerId) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = strokeWidth(e);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#c94435";
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => { clear(); }, [char]);

  return (
    <div className="trace-board">
      <span className="trace-template" aria-hidden="true">{char}</span>
      <canvas
        ref={canvasRef}
        width={320}
        height={320}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label={`Traza el carácter ${char}`}
      />
      <button className="kid-small-btn" onClick={clear}>🧽 Borrar</button>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<"choose" | "kids" | "adult">("choose");
  const [name, setName] = useState("");
  const [started, setStarted] = useState(false);
  const [section, setSection] = useState<"learn" | "abc" | "tones" | "write" | "practice" | "progress">("learn");
  const [selectedSound, setSelectedSound] = useState<Sound | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [kidGame, setKidGame] = useState<"home" | "toca" | "tonos" | "trazar" | "letras">("home");
  const [letterRound, setLetterRound] = useState<{ sound: Sound; options: Sound[] } | null>(null);
  const [stars, setStars] = useState(0);
  const [round, setRound] = useState<{ word: KidWord; options: KidWord[] } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [wrongPick, setWrongPick] = useState<string | null>(null);
  const [traceIndex, setTraceIndex] = useState(0);

  useEffect(() => {
    const savedName = localStorage.getItem("lingomaster-name");
    const savedScore = Number(localStorage.getItem("lingomaster-score") || 0);
    const savedStars = Number(localStorage.getItem("lingomaster-stars") || 0);
    if (savedName) { setName(savedName); setStarted(true); }
    setScore(savedScore);
    setStars(savedStars);
  }, []);

  const begin = () => {
    const student = name.trim() || "Estudiante";
    setName(student);
    setStarted(true);
    localStorage.setItem("lingomaster-name", student);
  };

  const check = () => {
    const normalized = answer.trim().toLowerCase();
    if (["你好", "nǐ hǎo", "ni hao", "nǐhǎo"].includes(normalized)) {
      setFeedback("✓ 太棒了！Tài bàng le! — ¡Excelente! 你好 significa ‘hola’. ");
      const next = Math.max(score, 1);
      setScore(next);
      localStorage.setItem("lingomaster-score", String(next));
      setCompleted((items) => Array.from(new Set([...items, "saludo"])));
    } else {
      setFeedback("Casi. La respuesta es 你好 (nǐ hǎo). Piensa: ‘tú + bien’ = hola.");
    }
  };

  const addStar = () => {
    setStars((current) => {
      const next = current + 1;
      localStorage.setItem("lingomaster-stars", String(next));
      return next;
    });
  };

  const startToca = () => {
    setKidGame("toca");
    const first = makeRound();
    setRound(first);
    setWrongPick(null);
    setTimeout(() => speak(first.word.hanzi, 0.6), 350);
  };

  const pickOption = (option: KidWord) => {
    if (!round || celebrating) return;
    if (option.hanzi === round.word.hanzi) {
      addStar();
      setCelebrating(true);
      setWrongPick(null);
      speak("很好！", 0.75);
      setTimeout(() => {
        setCelebrating(false);
        const next = makeRound();
        setRound(next);
        setTimeout(() => speak(next.word.hanzi, 0.6), 300);
      }, 1400);
    } else {
      setWrongPick(option.hanzi);
      speak(round.word.hanzi, 0.55);
      setTimeout(() => setWrongPick(null), 700);
    }
  };

  const startLetterQuiz = () => {
    const first = makeLetterRound();
    setLetterRound(first);
    setWrongPick(null);
    setTimeout(() => speak(first.sound.hanzi, 0.55), 350);
  };

  const pickLetter = (option: Sound) => {
    if (!letterRound || celebrating) return;
    if (option.letter === letterRound.sound.letter) {
      addStar();
      setCelebrating(true);
      setWrongPick(null);
      speak("很好！", 0.75);
      setTimeout(() => {
        setCelebrating(false);
        const next = makeLetterRound();
        setLetterRound(next);
        setTimeout(() => speak(next.sound.hanzi, 0.55), 300);
      }, 1400);
    } else {
      setWrongPick(option.letter);
      speak(letterRound.sound.hanzi, 0.5);
      setTimeout(() => setWrongPick(null), 700);
    }
  };

  if (mode === "choose") {
    return (
      <main className="welcome-shell">
        <div className="sun-disc" aria-hidden="true">你好</div>
        <section className="welcome-card mode-card">
          <p className="eyebrow">TU TUTOR PERSONAL DE MANDARÍN</p>
          <h1>LingoMaster <span>AI</span></h1>
          <p className="hanzi-hero">中文</p>
          <p className="intro">¿Quién va a aprender hoy?</p>
          <div className="mode-grid">
            <button className="mode-btn kids" onClick={() => { setMode("kids"); setKidGame("home"); }}>
              <span className="mode-emoji">🧸</span>
              <b>Peques</b>
              <small>Juegos, dibujos y sonidos</small>
            </button>
            <button className="mode-btn adult" onClick={() => setMode("adult")}>
              <span className="mode-emoji">📚</span>
              <b>Adultos</b>
              <small>Lección completa paso a paso</small>
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (mode === "kids") {
    return (
      <main className="kids-shell">
        {celebrating && <div className="celebration" aria-hidden="true">
          {["⭐", "🎉", "⭐", "✨", "🌟", "🎊", "⭐", "✨"].map((icon, index) => <span key={index} className={`burst burst-${index}`}>{icon}</span>)}
          <div className="praise">很好! ¡Muy bien!</div>
        </div>}

        <header className="kids-topbar">
          <button className="kid-small-btn" onClick={() => { setMode("choose"); setKidGame("home"); }}>🏠 Salir</button>
          <div className="star-count" aria-label={`${stars} estrellas`}>⭐ {stars}</div>
        </header>

        {kidGame === "home" && <section className="kids-home">
          <h1 className="kids-title">¡A jugar! <span>玩</span></h1>
          <div className="kids-menu">
            <button className="kid-tile tile-red" onClick={startToca}>
              <span>👂</span><b>Escucha y toca</b>
            </button>
            <button className="kid-tile tile-gold" onClick={() => { setKidGame("tonos"); }}>
              <span>🎵</span><b>Animalitos que cantan</b>
            </button>
            <button className="kid-tile tile-green" onClick={() => { setKidGame("trazar"); }}>
              <span>✏️</span><b>Dibuja el carácter</b>
            </button>
            <button className="kid-tile tile-blue" onClick={() => { setKidGame("letras"); setLetterRound(null); }}>
              <span>🔤</span><b>Las letras chinas</b>
            </button>
          </div>
        </section>}

        {kidGame === "toca" && round && <section className="kids-game">
          <button className="kid-hear" onClick={() => speak(round.word.hanzi, 0.6)}>
            🔊<small>Escuchar otra vez</small>
          </button>
          <p className="kid-question">¿Qué escuchaste?</p>
          <div className="kid-options">
            {round.options.map((option) => (
              <button
                key={option.hanzi}
                className={`kid-option${wrongPick === option.hanzi ? " wrong" : ""}`}
                onClick={() => pickOption(option)}
              >
                <span className="kid-emoji">{option.emoji}</span>
                <small>{option.es}</small>
              </button>
            ))}
          </div>
          <button className="kid-small-btn" onClick={() => setKidGame("home")}>⬅️ Juegos</button>
        </section>}

        {kidGame === "tonos" && <section className="kids-game">
          <p className="kid-question">Toca un animalito y repite su canción</p>
          <div className="kid-tone-grid">
            {kidTones.map((tone) => (
              <button key={tone.py} className="kid-tone" onClick={() => { speak(tone.char, 0.5); }}>
                <span className="kid-emoji">{tone.emoji}</span>
                <b>{tone.py}</b>
                <span className="kid-mark">{tone.mark}</span>
                <small>{tone.hint}</small>
              </button>
            ))}
          </div>
          <button className="kid-small-btn" onClick={() => setKidGame("home")}>⬅️ Juegos</button>
        </section>}

        {kidGame === "letras" && !letterRound && <section className="kids-game">
          <p className="kid-question">Toca una letra y escúchala</p>
          <div className="kid-letter-grid">
            {kidLetters.map((sound) => (
              <button key={sound.letter} className="kid-letter" onClick={() => speak(sound.hanzi, 0.55)}>
                <b>{sound.letter}</b>
                <small>{sound.py}</small>
              </button>
            ))}
          </div>
          <button className="kid-tile tile-red quiz-tile" onClick={startLetterQuiz}>
            <span>👂</span><b>¿Cuál suena?</b>
          </button>
          <button className="kid-small-btn" onClick={() => setKidGame("home")}>⬅️ Juegos</button>
        </section>}

        {kidGame === "letras" && letterRound && <section className="kids-game">
          <button className="kid-hear" onClick={() => speak(letterRound.sound.hanzi, 0.55)}>
            🔊<small>Escuchar otra vez</small>
          </button>
          <p className="kid-question">¿Qué letra suena?</p>
          <div className="kid-options">
            {letterRound.options.map((option) => (
              <button
                key={option.letter}
                className={`kid-option kid-option-letter${wrongPick === option.letter ? " wrong" : ""}`}
                onClick={() => pickLetter(option)}
              >
                <span className="kid-letter-big">{option.letter}</span>
              </button>
            ))}
          </div>
          <button className="kid-small-btn" onClick={() => setLetterRound(null)}>⬅️ Las letras</button>
        </section>}

        {kidGame === "trazar" && <section className="kids-game">
          <p className="kid-question">Dibuja encima con tu dedo o tu lápiz</p>
          <div className="trace-picker">
            {traceChars.map((item, index) => (
              <button
                key={item.char}
                className={`kid-small-btn${traceIndex === index ? " active" : ""}`}
                onClick={() => { setTraceIndex(index); speak(item.char, 0.6); }}
              >{item.char}</button>
            ))}
          </div>
          <TraceBoard char={traceChars[traceIndex].char} />
          <p className="trace-caption">{traceChars[traceIndex].py} · {traceChars[traceIndex].es}</p>
          <div className="trace-actions">
            <button className="kid-small-btn" onClick={() => speak(traceChars[traceIndex].char, 0.6)}>🔊 Escuchar</button>
            <button className="kid-small-btn" onClick={() => { addStar(); speak("很好！", 0.75); }}>✅ ¡Listo!</button>
          </div>
          <button className="kid-small-btn" onClick={() => setKidGame("home")}>⬅️ Juegos</button>
        </section>}
      </main>
    );
  }

  if (!started) {
    return (
      <main className="welcome-shell">
        <div className="sun-disc" aria-hidden="true">你好</div>
        <section className="welcome-card">
          <p className="eyebrow">TU TUTOR PERSONAL DE MANDARÍN</p>
          <h1>LingoMaster <span>AI</span></h1>
          <p className="hanzi-hero">中文</p>
          <p className="intro">Aprende a hablar, escuchar, leer y escribir chino, una pequeña victoria a la vez.</p>
          <label htmlFor="student">¿Cómo te llamas?</label>
          <input id="student" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && begin()} placeholder="Escribe tu nombre" />
          <button className="primary" onClick={begin}>Comenzar mi viaje <span>→</span></button>
          <div className="feature-row">
            <span>🔊 Pronunciación</span><span>✍️ Escritura</span><span>🏮 Cultura</span>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-mark" onClick={() => setMode("choose")} aria-label="Cambiar de modo">语</button>
        <div><strong>LingoMaster</strong><small>Mandarín paso a paso</small></div>
        <div className="streak">🔥 <b>1</b><span>días</span></div>
        <button className="avatar" aria-label="Perfil">{name.charAt(0).toUpperCase()}</button>
      </header>

      <section className="hero-strip">
        <div>
          <p className="eyebrow light">NIVEL 1 · LECCIÓN 1</p>
          <h1>你好, {name}!</h1>
          <p>Hoy aprenderás tus primeras palabras, tonos y trazos.</p>
        </div>
        <div className="lesson-ring"><b>1</b><span>de 18</span></div>
      </section>

      <nav className="tabs" aria-label="Secciones de la lección">
        {([
          ["learn", "📖", "Aprender"], ["abc", "🔤", "Abecedario"], ["tones", "🔊", "Pronunciar"],
          ["write", "✍️", "Escribir"], ["practice", "🎯", "Practicar"], ["progress", "📊", "Progreso"],
        ] as const).map(([id, icon, label]) => (
          <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}><span>{icon}</span>{label}</button>
        ))}
      </nav>

      <div className="content">
        {section === "learn" && <section>
          <div className="section-heading"><div><p className="kicker">VOCABULARIO NUEVO</p><h2>Tu primer saludo</h2></div><button className="listen-all" onClick={() => speak("你好。我叫。谢谢。")}>🔊 Escuchar todo</button></div>
          <div className="vocab-grid">
            {vocabulary.map((word) => <article className="vocab-card" key={word.hanzi}>
              <button className="sound" onClick={() => speak(word.hanzi)} aria-label={`Escuchar ${word.pinyin}`}>🔊</button>
              <div className="big-hanzi">{word.hanzi}</div>
              <div className="pinyin">{word.pinyin}</div>
              <div className="translation">{word.spanish}</div>
              <small>{word.example}</small>
            </article>)}
          </div>
          <aside className="culture"><span>🏮</span><div><b>Un detalle cultural</b><p>En China, un saludo suele acompañarse con una sonrisa o una leve inclinación. Entre amigos cercanos, es frecuente preguntar “¿Has comido?” como muestra de cariño.</p></div></aside>
          <button className="next" onClick={() => setSection("tones")}>Practicar pronunciación <span>→</span></button>
        </section>}

        {section === "abc" && <section>
          <div className="section-heading"><div><p className="kicker">EL ABECEDARIO CHINO</p><h2>Pinyin: tus vocales y consonantes</h2></div><span className="pill">🔊 Toca y escucha</span></div>
          <p className="lead">El pinyin es el abecedario oficial del chino, con letras latinas. Igual que en español: <b>consonante + vocal + tono = sílaba</b>. Por ejemplo: m + a + tono 1 = <b>mā</b> (妈, mamá). Toca cualquier letra para escucharla en una palabra real.</p>
          {selectedSound && <article className="abc-detail">
            <div className="abc-detail-letter">{selectedSound.letter}</div>
            <div>
              <b>{selectedSound.hanzi} · {selectedSound.py}</b>
              <p>Suena {selectedSound.hint}.</p>
            </div>
            <button className="listen-all" onClick={() => speak(selectedSound.hanzi, 0.55)}>🔊 Escuchar</button>
          </article>}
          <h3 className="abc-group">Las “vocales” (finales)</h3>
          <div className="abc-grid">
            {pinyinFinals.map((sound) => (
              <button key={sound.letter} className={`abc-key${selectedSound?.letter === sound.letter ? " active" : ""}`} onClick={() => { setSelectedSound(sound); speak(sound.hanzi, 0.55); }}>
                <b>{sound.letter}</b><small>{sound.py}</small>
              </button>
            ))}
          </div>
          <h3 className="abc-group">Las “consonantes” (iniciales)</h3>
          <div className="abc-grid">
            {pinyinInitials.map((sound) => (
              <button key={sound.letter} className={`abc-key${selectedSound?.letter === sound.letter ? " active" : ""}`} onClick={() => { setSelectedSound(sound); speak(sound.hanzi, 0.55); }}>
                <b>{sound.letter}</b><small>{sound.py}</small>
              </button>
            ))}
          </div>
          <aside className="tip"><b>💡 Dato útil</b><p>El chino solo tiene unas 400 sílabas posibles — menos que el español. Los niños en China aprenden primero este abecedario en la escuela, igual que tú aprendiste a-e-i-o-u, y después van añadiendo los caracteres.</p></aside>
          <button className="next" onClick={() => setSection("tones")}>Ahora, los tonos <span>→</span></button>
        </section>}

        {section === "tones" && <section>
          <div className="section-heading"><div><p className="kicker">ESCUCHA Y REPITE</p><h2>Los cuatro tonos</h2></div><span className="pill">🔊 Sonido activado</span></div>
          <p className="lead">En mandarín, cambiar la melodía cambia el significado. Toca cada tarjeta, escucha y repite en voz alta.</p>
          <div className="tone-grid">
            {tones.map((tone, index) => <button className={`tone tone-${index + 1}`} key={tone.py} onClick={() => speak(tone.char, .58)}>
              <span className="tone-number">{index + 1}</span><span className="tone-mark">{tone.mark}</span>
              <b>{tone.char}</b><em>{tone.py}</em><small>{tone.label}</small><span className="play">▶ Escuchar</span>
            </button>)}
          </div>
          <article className="repeat-card"><div className="mic">🎙️</div><div><b>Práctica de repetición</b><p>Escucha “nǐ hǎo”, repítelo lentamente y luego a velocidad natural.</p></div><div className="repeat-actions"><button onClick={() => speak("你好", .55)}>Lento</button><button onClick={() => speak("你好", .9)}>Natural</button></div></article>
          <aside className="tip"><b>💡 Truco para 你好</b><p>Dos terceros tonos juntos cambian al hablar: el primero suena como segundo tono. Se dice casi “ní hǎo”, aunque se escribe nǐ hǎo.</p></aside>
          <button className="next" onClick={() => setSection("write")}>Ahora, a escribir <span>→</span></button>
        </section>}

        {section === "write" && <section>
          <div className="section-heading"><div><p className="kicker">ORDEN DE TRAZOS</p><h2>Escribe tu primer carácter</h2></div><span className="pill">Radical: 人</span></div>
          <div className="writing-layout">
            <article className="character-stage"><div className="grid-paper"><span>人</span></div><p className="pinyin">rén · persona</p><button className="listen-all" onClick={() => speak("人")}>🔊 Escuchar rén</button></article>
            <article className="stroke-card"><p>2 TRAZOS</p><h3>Orden correcto</h3>
              <ol><li><b>1</b><span className="stroke-symbol">丿</span><div><strong>Diagonal izquierda</strong><small>De arriba hacia abajo ↙</small></div></li><li><b>2</b><span className="stroke-symbol">㇏</span><div><strong>Diagonal derecha</strong><small>Abre hacia la derecha ↘</small></div></li></ol>
              <div className="mnemonic">🧠 Parece una persona caminando con dos piernas.</div>
            </article>
          </div>
          <div className="copy-practice"><b>✍️ Copia 人 tres veces</b><div className="copy-boxes"><span>人</span><span></span><span></span><span></span></div><p>Traza con el dedo o lápiz sobre los cuadros vacíos.</p></div>
          <button className="next" onClick={() => setSection("practice")}>Comprobar lo aprendido <span>→</span></button>
        </section>}

        {section === "practice" && <section>
          <div className="section-heading"><div><p className="kicker">EVALUACIÓN RÁPIDA</p><h2>¿Qué significa “hola”?</h2></div><span className="pill">1 de 3</span></div>
          <article className="quiz-card"><button className="quiz-audio" onClick={() => speak("你好")}>🔊 Escucha la respuesta</button><label htmlFor="answer">Escríbelo en caracteres o pīnyīn:</label><input id="answer" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Tu respuesta…"/><button className="primary" onClick={check}>Comprobar</button>{feedback && <div className={feedback.startsWith("✓") ? "feedback good" : "feedback"}>{feedback}</div>}</article>
          <div className="mini-game"><span>⚡</span><div><b>Reto rápido</b><p>Toca los tonos en orden: mā, má, mǎ, mà.</p></div><button onClick={() => { tones.forEach((t, i) => setTimeout(() => speak(t.char, .55), i * 950)); }}>Jugar</button></div>
          <button className="next" onClick={() => setSection("progress")}>Ver mi progreso <span>→</span></button>
        </section>}

        {section === "progress" && <section>
          <div className="section-heading"><div><p className="kicker">TU VIAJE</p><h2>¡Buen comienzo, {name}!</h2></div><span className="pill">Nivel Fundamentos</span></div>
          <div className="progress-card"><div className="progress-score"><span>{score}/3</span><small>ejercicios</small></div><div className="stats"><div><b>6</b><span>Palabras nuevas</span></div><div><b>1</b><span>Carácter practicado</span></div><div><b>1</b><span>Radical aprendido</span></div><div><b>{completed.length ? "✓" : "—"}</b><span>Saludo dominado</span></div></div></div>
          <div className="path"><h3>Tu ruta de aprendizaje</h3><div><span className="done">✓</span><i></i><span className="current">1</span><i></i><span>2</span><i></i><span>3</span></div><p>Bienvenida · Tonos · Saludos</p></div>
          <blockquote><b>加油！</b><span>Jiā yóu! — ¡Tú puedes!</span><p>学习是一段旅程。El aprendizaje es un viaje.</p></blockquote>
          <button className="next" onClick={() => setSection("learn")}>Repetir la lección <span>↻</span></button>
        </section>}
      </div>
      <footer><span>🀄 LingoMaster AI</span><span>Escucha · Habla · Lee · Escribe</span></footer>
    </main>
  );
}
