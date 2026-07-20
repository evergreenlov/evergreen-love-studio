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

function TraceBoard({ char }: { char: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 22;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#c94435";
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
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
        onPointerUp={() => { drawing.current = false; }}
        onPointerLeave={() => { drawing.current = false; }}
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
  const [section, setSection] = useState<"learn" | "tones" | "write" | "practice" | "progress">("learn");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [kidGame, setKidGame] = useState<"home" | "toca" | "tonos" | "trazar">("home");
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

        {kidGame === "trazar" && <section className="kids-game">
          <p className="kid-question">Dibuja encima con tu dedo</p>
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
          ["learn", "📖", "Aprender"], ["tones", "🔊", "Pronunciar"], ["write", "✍️", "Escribir"],
          ["practice", "🎯", "Practicar"], ["progress", "📊", "Progreso"],
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
