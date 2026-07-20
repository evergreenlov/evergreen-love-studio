"use client";

import { useEffect, useState } from "react";

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

export default function Home() {
  const [name, setName] = useState("");
  const [started, setStarted] = useState(false);
  const [section, setSection] = useState<"learn" | "tones" | "write" | "practice" | "progress">("learn");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);

  useEffect(() => {
    const savedName = localStorage.getItem("lingomaster-name");
    const savedScore = Number(localStorage.getItem("lingomaster-score") || 0);
    if (savedName) { setName(savedName); setStarted(true); }
    setScore(savedScore);
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
        <div className="brand-mark">语</div>
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
