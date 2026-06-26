import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Papa from 'papaparse';
import {
  BarChart3, BookOpen, Brain, CheckCircle2, ChevronRight, Clock3, Database, FileText, Flame,
  GraduationCap, Import, KeyRound, LayoutDashboard, ListChecks, LogOut, NotebookTabs,
  PlayCircle, RotateCcw, Shield, Sparkles, Target, Trophy, XCircle
} from 'lucide-react';
import sampleQuestions from './data/sampleQuestions.json';
import libraryContent from './data/libraryContent.json';
import legalContent from './data/legalContent.json';
import comparativosJuridicos from './data/comparativosJuridicos.json';
import { supabase, hasSupabase } from './lib/supabaseClient';
import { askProfessor } from './lib/professorAi';
import './styles/app.css';

const DISCIPLINES = [
  'Direito Penal','Direito Processual Penal','Legislação Especial','Direito Constitucional',
  'Direitos Humanos','Direito Administrativo','Direito Civil','Medicina Legal','Criminologia','Informática'
];

const starterDiscursivas = libraryContent.discursivas;

function formatTime(totalSeconds = 0) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function getTodayKey(){ return new Date().toISOString().slice(0,10); }

function buildMission(stats, errors, flashcards) {
  const weak = stats.weak?.disciplina || 'Direito Penal';
  const second = stats.byDisc.filter(x => x.disciplina !== weak).sort((a,b)=>a.pct-b.pct)[0]?.disciplina || 'Direito Processual Penal';
  return [
    { id:'m1', type:'questoes', title:`20 questões de ${weak}`, detail:'Treino dirigido na disciplina crítica.' },
    { id:'m2', type:'questoes', title:`10 questões de ${second}`, detail:'Reforço do segundo ponto de atenção.' },
    { id:'m3', type:'revisao', title:`Revisar ${Math.min(5, Math.max(1, errors.length))} erro(s) do dossiê`, detail:'Transforme erro em acerto recorrente.' },
    { id:'m4', type:'flashcards', title:`Fazer ${Math.min(10, Math.max(5, flashcards.length || 5))} flashcards`, detail:'Memorização rápida de lei seca e conceitos.' },
    { id:'m5', type:'discursiva', title:'1 discursiva curta com espelho', detail:'Treino de escrita objetiva e fundamentada.' }
  ];
}

function computeTopicWeakness(errors) {
  const map = new Map();
  errors.forEach(e => {
    const key = `${e.disciplina || e.question?.disciplina}||${e.tema || e.question?.tema}`;
    const item = map.get(key) || { disciplina: e.disciplina || e.question?.disciplina, tema: e.tema || e.question?.tema, count:0, last:e.created_at };
    item.count += 1;
    if (!item.last || e.created_at > item.last) item.last = e.created_at;
    map.set(key, item);
  });
  return [...map.values()].sort((a,b)=>b.count-a.count);
}

const normalizeQuestion = (q, index = 0) => ({
  id: q.id || crypto.randomUUID?.() || `q-${Date.now()}-${index}`,
  ano: q.ano || q.year || '2026',
  banca: q.banca || 'VUNESP',
  cargo: q.cargo || 'Delegado PC-SP',
  disciplina: q.disciplina || q.subject || 'Direito Penal',
  tema: q.tema || q.topic || 'Tema não informado',
  enunciado: q.enunciado || q.question || '',
  alternativas: q.alternativas || {
    A: q.alternativa_a || q.A || '', B: q.alternativa_b || q.B || '', C: q.alternativa_c || q.C || '',
    D: q.alternativa_d || q.D || '', E: q.alternativa_e || q.E || ''
  },
  gabarito: String(q.gabarito || q.answer || '').trim().toUpperCase(),
  comentario: q.comentario || q.explanation || 'Comentário ainda não cadastrado.',
  fundamento: q.fundamento || q.legal || 'Fundamento não cadastrado.',
  analogia: q.analogia || 'Analogia ainda não cadastrada.',
  macete: q.macete || 'Macete ainda não cadastrado.',
  pegadinha: q.pegadinha || 'Pegadinha ainda não cadastrada.',
  dificuldade: q.dificuldade || 'Média',
  fonte: q.fonte || 'Questão demonstrativa/autoral',
  tags: Array.isArray(q.tags) ? q.tags : String(q.tags || '').split(',').map(t => t.trim()).filter(Boolean)
});

function useLocalState(key, initial) {
  const [state, setState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
  return [state, setState];
}

function App() {
  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [view, setView] = useLocalState('pcsp:view', 'dashboard');
  const [questions, setQuestions] = useLocalState('pcsp:questions', sampleQuestions.map(normalizeQuestion));
  const [answers, setAnswers] = useLocalState('pcsp:answers', []);
  const [errors, setErrors] = useLocalState('pcsp:errors', []);
  const [flashcards, setFlashcards] = useLocalState('pcsp:flashcards', libraryContent.flashcards || []);
  const [settings, setSettings] = useLocalState('pcsp:settings', { tdah: true, immediate: true, openaiKey: '' });

  useEffect(() => {
    if (!hasSupabase) { setLoadingAuth(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoadingAuth(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const stats = useMemo(() => {
    const total = answers.length;
    const correct = answers.filter(a => a.correct).length;
    const byDisc = DISCIPLINES.map(d => {
      const list = answers.filter(a => a.disciplina === d);
      const ok = list.filter(a => a.correct).length;
      return { disciplina: d, total: list.length, correct: ok, pct: list.length ? Math.round(ok / list.length * 100) : 0 };
    });
    const weak = [...byDisc].filter(x => x.total > 0).sort((a,b) => a.pct - b.pct)[0];
    return { total, correct, pct: total ? Math.round(correct / total * 100) : 0, byDisc, weak };
  }, [answers]);

  async function saveAnswer(q, selected, mode = 'study') {
    const correct = selected === q.gabarito;
    const record = { id: crypto.randomUUID(), question_id: q.id, disciplina: q.disciplina, tema: q.tema, selected, correct, mode, created_at: new Date().toISOString() };
    setAnswers(prev => [record, ...prev]);
    if (!correct) {
      const err = { ...record, question: q, reason: inferErrorReason(q, selected) };
      setErrors(prev => [err, ...prev]);
      setFlashcards(prev => [{ id: crypto.randomUUID(), frente: `(${q.disciplina}) ${q.tema}: qual é a ideia central?`, verso: `${q.comentario}\n\nFundamento: ${q.fundamento}`, sourceQuestionId: q.id, created_at: new Date().toISOString(), mastered: false }, ...prev]);
    }
    if (hasSupabase && session?.user) {
      await supabase.from('attempts').insert({ user_id: session.user.id, question_id: q.id, selected_answer: selected, is_correct: correct, mode });
    }
    return correct;
  }

  async function syncQuestionsToSupabase() {
    if (!hasSupabase || !session?.user) return alert('Configure Supabase e faça login para sincronizar.');
    const rows = questions.map(q => ({ ...q, alternatives: q.alternativas, created_by: session.user.id }));
    const { error } = await supabase.from('questions').upsert(rows);
    alert(error ? `Erro: ${error.message}` : 'Questões sincronizadas com Supabase.');
  }

  if (loadingAuth) return <Splash />;

  return <div className="app-shell">
    <Sidebar view={view} setView={setView} session={session} />
    <main className="main-panel">
      <Hero settings={settings} setSettings={setSettings} session={session} />
      {view === 'dashboard' && <Dashboard stats={stats} questions={questions} errors={errors} flashcards={flashcards} setView={setView} />}
      {view === 'stats' && <PerformanceIntel stats={stats} answers={answers} errors={errors} setView={setView} />}
      {view === 'review' && <SmartReview errors={errors} setErrors={setErrors} setView={setView} />}
      {view === 'study' && <StudyRoom questions={questions} saveAnswer={saveAnswer} settings={settings} />}
      {view === 'exam' && <Exam questions={questions} saveAnswer={saveAnswer} />}
      {view === 'errors' && <ErrorsDossier errors={errors} setErrors={setErrors} setView={setView} />}
      {view === 'flashcards' && <Flashcards cards={flashcards} setCards={setFlashcards} />}
      {view === 'discursive' && <Discursive settings={settings} />}
      {view === 'import' && <ImportQuestions questions={questions} setQuestions={setQuestions} syncQuestionsToSupabase={syncQuestionsToSupabase} />}
      {view === 'auth' && <Auth session={session} />}
      {view === 'professor' && <ProfessorIA questions={questions} settings={settings} setSettings={setSettings} />}
      {view === 'library' && <LibraryContent content={libraryContent} questions={questions} setView={setView} />}
      {view === 'laws' && <LegalCode content={legalContent} questions={questions} setView={setView} />}
      {view === 'comparisons' && <ComparativosJuridicos content={comparativosJuridicos} questions={questions} flashcards={flashcards} setView={setView} />}
      {view === 'map' && <EditalMap stats={stats} />}
    </main>
    <BottomNav view={view} setView={setView} />
  </div>;
}

function Splash(){ return <div className="splash"><Shield size={42}/><h1>Delegado PC-SP</h1><p>Carregando Central do Candidato...</p></div>; }

function Sidebar({ view, setView, session }) {
  const items = [
    ['dashboard','Central do Candidato',LayoutDashboard], ['study','Sala de Treinamento',Brain], ['exam','Prova Real',PlayCircle],
    ['stats','Inteligência',BarChart3], ['review','Revisão Inteligente',ListChecks], ['errors','Dossiê de Erros',NotebookTabs], ['flashcards','Cartões',BookOpen], ['discursive','Peça Escrita',FileText],
    ['professor','Professor IA',Sparkles], ['library','Biblioteca do Edital',GraduationCap], ['laws','Lei Seca Inteligente',BookOpen], ['comparisons','Não Confunda',Sparkles], ['map','Mapa do Edital',Target], ['import','Banco de Questões',Import], ['auth', session ? 'Conta' : 'Login', KeyRound]
  ];
  return <aside className="sidebar">
    <div className="brand"><div className="badge"><Shield size={24}/></div><div><b>Delegado PC-SP</b><span>Inteligência de Estudos</span><em className="brand-motto">Estuda o bichona do carai!!</em></div></div>
    <nav>{items.map(([id,label,Icon]) => <button key={id} className={view===id?'active':''} onClick={()=>setView(id)}><Icon size={18}/>{label}</button>)}</nav>
  </aside>;
}

function BottomNav({ view, setView }) {
  const items = [
    ['dashboard','Central',LayoutDashboard], ['study','Treino',Brain], ['exam','Prova',PlayCircle], ['review','Revisão',ListChecks], ['library','Mais',GraduationCap]
  ];
  return <nav className="bottom-nav">{items.map(([id,label,Icon]) => <button key={id} className={view===id?'active':''} onClick={()=>setView(id)}><Icon size={19}/><span>{label}</span></button>)}</nav>;
}

function Hero({ settings, setSettings, session }) {
  return <section className="hero">
    <div><p className="kicker">Central de investigação do edital</p><h1>Ambiente Inteligente de Estudos</h1><p>Simulados VUNESP • Correção imediata • Dossiê de erros • Flashcards • Professor IA</p></div>
    <div className="hero-actions"><span className="status-dot"></span>{session ? session.user.email : 'Modo local'}<button onClick={()=>setSettings({...settings, tdah: !settings.tdah})}>{settings.tdah ? 'Modo TDAH ON' : 'Modo TDAH OFF'}</button></div>
  </section>;
}

function Dashboard({ stats, questions, errors, flashcards, setView }) {
  const [done, setDone] = useLocalState(`pcsp:mission:${getTodayKey()}`, {});
  const mission = buildMission(stats, errors, flashcards);
  const completed = mission.filter(m => done[m.id]).length;
  return <div className="grid-page">
    <Metric icon={Database} label="Questões no banco" value={questions.length} />
    <Metric icon={CheckCircle2} label="Acertos gerais" value={`${stats.pct}%`} />
    <Metric icon={Flame} label="Erros no dossiê" value={errors.length} />
    <Metric icon={BookOpen} label="Flashcards" value={flashcards.length} />
    <section className="panel wide mission-panel"><div className="panel-title-row"><div><p className="kicker">Mentor de Estudos</p><h2>Missão de Hoje</h2></div><strong className="mission-score">{completed}/{mission.length}</strong></div>
      <div className="mission-progress"><i style={{width:`${Math.round(completed/mission.length*100)}%`}}></i></div>
      <div className="mission-list">{mission.map(m => <label key={m.id} className={done[m.id]?'mission-item done':'mission-item'}><input type="checkbox" checked={!!done[m.id]} onChange={e=>setDone({...done,[m.id]:e.target.checked})}/><span><b>{m.title}</b><small>{m.detail}</small></span></label>)}</div>
      <div className="button-row"><button className="primary" onClick={()=>setView('study')}>Iniciar treino <ChevronRight size={16}/></button><button className="ghost" onClick={()=>setView('review')}>Revisão inteligente</button></div></section>
    <section className="panel"><h2>Alerta de investigação</h2><p className="muted">{stats.weak ? `Disciplina crítica atual: ${stats.weak.disciplina} (${stats.weak.pct}% de acerto).` : 'Responda questões para gerar diagnóstico.'}</p><button className="ghost" onClick={()=>setView('stats')}>Ver inteligência</button></section>
    <section className="panel wide"><h2>Inteligência por disciplina</h2><div className="bars">{stats.byDisc.map(d=><div key={d.disciplina} className="bar-row"><span>{d.disciplina}</span><div><i style={{width:`${d.pct}%`}}></i></div><b>{d.total?`${d.pct}%`:'--'}</b></div>)}</div></section>
  </div>;
}

function PerformanceIntel({ stats, answers, errors, setView }) {
  const topics = computeTopicWeakness(errors);
  const last7 = answers.filter(a => Date.now() - new Date(a.created_at).getTime() < 7*24*60*60*1000);
  const today = answers.filter(a => a.created_at?.slice(0,10) === getTodayKey());
  return <section className="panel performance-page"><div className="toolbar"><div><p className="kicker">Inteligência de Desempenho</p><h2>Diagnóstico do candidato</h2><p className="muted">Tudo salvo localmente neste navegador até ativarmos login/Supabase.</p></div><button className="primary" onClick={()=>setView('study')}>Treinar agora</button></div>
    <div className="library-metrics"><Metric icon={CheckCircle2} label="Acertos gerais" value={`${stats.pct}%`}/><Metric icon={Clock3} label="Questões hoje" value={today.length}/><Metric icon={BarChart3} label="Últimos 7 dias" value={last7.length}/><Metric icon={Flame} label="Temas críticos" value={topics.length}/></div>
    <div className="intel-grid"><section className="intel-card"><h3>Ranking por disciplina</h3><div className="bars">{stats.byDisc.map(d=><div key={d.disciplina} className="bar-row"><span>{d.disciplina}</span><div><i style={{width:`${d.pct}%`}}></i></div><b>{d.total?`${d.pct}%`:'--'}</b></div>)}</div></section>
    <section className="intel-card"><h3>Temas mais errados</h3>{topics.length ? topics.slice(0,8).map(t=><div className="weak-topic" key={`${t.disciplina}-${t.tema}`}><b>{t.tema}</b><span>{t.disciplina}</span><em>{t.count} erro(s)</em></div>) : <p className="muted">Erre e revise questões para criar diagnóstico por tema.</p>}</section></div>
  </section>;
}

function SmartReview({ errors, setErrors, setView }) {
  const topics = computeTopicWeakness(errors);
  const queue = errors.slice(0,12);
  return <section className="panel review-page"><div className="toolbar"><div><p className="kicker">Revisão Inteligente</p><h2>Fila de revisão por erros</h2><p className="muted">Prioriza erros recentes e temas reincidentes. Quando ativarmos Supabase, isso sincroniza entre Mac e celular.</p></div><button className="primary" onClick={()=>setView('study')}>Fazer novas questões</button></div>
    <div className="review-layout"><div className="review-list"><h3>Revisar agora</h3>{queue.length ? queue.map(e => <article className="review-card" key={e.id}><span>{e.question.disciplina}</span><h4>{e.question.tema}</h4><p>{e.question.enunciado}</p><small>Você marcou {e.selected}; gabarito {e.question.gabarito}</small><details><summary>Ver correção</summary><p>{e.question.comentario}</p><b>Fundamento:</b><p>{e.question.fundamento}</p><b>Macete:</b><p>{e.question.macete}</p></details><button className="ghost" onClick={()=>setErrors(prev=>prev.filter(x=>x.id!==e.id))}>Marcar como dominado</button></article>) : <Empty title="Sem erros para revisar" text="Responda no modo estudo para gerar uma fila inteligente."/>}</div>
    <aside className="review-sidebar"><h3>Temas reincidentes</h3>{topics.slice(0,8).map(t=><div className="topic-pill" key={`${t.disciplina}-${t.tema}`}><b>{t.tema}</b><span>{t.count}x • {t.disciplina}</span></div>)}<div className="info"><b>Regra de revisão</b><p>Errou hoje: revise amanhã. Errou de novo: revise em 3 dias. Acertou várias vezes: marque como dominado.</p></div></aside></div>
  </section>;
}

function Metric({ icon:Icon, label, value }){ return <section className="metric"><Icon/><span>{label}</span><strong>{value}</strong></section>; }

function StudyRoom({ questions, saveAnswer, settings }) {
  const [discipline, setDiscipline] = useState('Todas');
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState(null);
  const filtered = questions.filter(q => discipline==='Todas' || q.disciplina === discipline);
  const q = filtered[idx % Math.max(filtered.length, 1)];
  if (!q) return <Empty title="Banco vazio" text="Importe questões para começar." />;
  async function answer(letter){ if (result) return; setSelected(letter); const correct = await saveAnswer(q, letter, 'study'); setResult({ correct, letter }); }
  function next(){ setSelected(''); setResult(null); setIdx(i => (i+1) % filtered.length); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  return <section className="panel question-panel focus-study">
    <div className="toolbar compact-toolbar"><div><p className="kicker small-kicker">Modo foco</p><h2>Sala de Treinamento</h2></div><select value={discipline} onChange={e=>{setDiscipline(e.target.value);setIdx(0);setResult(null)}}><option>Todas</option>{DISCIPLINES.map(d=><option key={d}>{d}</option>)}</select></div>
    <div className="study-layout">
      <QuestionCard q={q} selected={selected} answer={answer} locked={!!result} />
      {result && <Correction q={q} selected={result.letter} correct={result.correct} tdah={settings.tdah} next={next} />}
      {!result && <aside className="correction-placeholder"><b>Correção rápida</b><p>Responda uma alternativa para abrir o painel de explicação sem empurrar a tela para baixo.</p></aside>}
    </div>
    {result && <div className={`sticky-next ${result.correct?'ok':'bad'}`}><span>{result.correct ? '✅ Acerto' : '❌ Erro'} • Gabarito {q.gabarito}</span><button className="primary" onClick={next}>Próxima questão</button></div>}
  </section>;
}

function QuestionCard({ q, selected, answer, locked }) {
  return <div className="dossier-card compact-question"><div className="dossier-head"><span>INQUÉRITO DE ESTUDO</span><b>{q.disciplina}</b><em>{q.tema}</em></div><p className="statement">{q.enunciado}</p><div className="alternatives compact-alternatives">{Object.entries(q.alternativas).map(([letter,text]) => <button key={letter} disabled={locked} className={selected===letter?'selected':''} onClick={()=>answer(letter)}><b>{letter}</b><span>{text}</span></button>)}</div></div>;
}

function Correction({ q, selected, correct, tdah, next }) {
  const [deep, setDeep] = useState(false);
  const [tab, setTab] = useState('explicacao');
  const tabs = [
    ['explicacao','Explicação',q.comentario], ['fundamento','Fundamento',q.fundamento],
    ['analogia','Analogia',q.analogia], ['pegadinha','Pegadinha',q.pegadinha], ['flashcard','Flashcard',q.macete]
  ];
  const active = tabs.find(([id]) => id === tab) || tabs[0];
  return <aside className={`correction compact-correction ${correct?'ok':'bad'}`}>
    <div className="result-header"><h3>{correct ? <CheckCircle2/> : <XCircle/>}{correct ? 'ACERTO CONFIRMADO' : 'ERRO DETECTADO'}</h3><button className="primary desktop-next" onClick={next}>Próxima</button></div>
    <div className="quick-result"><span><b>Gabarito</b> {q.gabarito}</span><span><b>Sua</b> {selected}</span><span><b>Base</b> {q.fundamento}</span></div>
    <div className="tabs">{tabs.map(([id,label]) => <button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
    <div className="tab-content"><b>{active[1]}</b><p>{active[2]}</p></div>
    {tdah && <div className="tdah compact-tdah"><b>Resumo TDAH:</b><p>{q.macete}</p><p><b>Não confunda:</b> foque na palavra-chave da alternativa e no fundamento legal.</p></div>}
    <button className="ghost explain-btn" onClick={()=>setDeep(!deep)}>Não entendi — explicar de outro jeito</button>
    {deep && <div className="deep"><p>Pense como um Delegado analisando um caso concreto: primeiro identifique o fato, depois o instituto jurídico, depois o fundamento legal. A banca geralmente tenta trocar conceitos parecidos. Sua missão é achar a diferença pequena que muda tudo.</p></div>}
  </aside>;
}
function Info({ title, text }){ return <div className="info"><b>{title}</b><p>{text}</p></div>; }

function Exam({ questions, saveAnswer }) {
  const [size, setSize] = useState(10);
  const [running, setRunning] = useState(false);
  const [paper, setPaper] = useState([]);
  const [answers, setLocalAnswers] = useState({});
  const [done, setDone] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [marked, setMarked] = useState({});

  useEffect(() => {
    if (!running || done || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running, done, startedAt]);

  function start(){ setPaper([...questions].sort(()=>Math.random()-0.5).slice(0, size)); setRunning(true); setDone(false); setLocalAnswers({}); setMarked({}); setStartedAt(Date.now()); setElapsed(0); window.scrollTo({top:0, behavior:'smooth'}); }
  async function finish(){ for (const q of paper) if (answers[q.id]) await saveAnswer(q, answers[q.id], 'exam'); setDone(true); window.scrollTo({top:0, behavior:'smooth'}); }
  function restart(){ setRunning(false); setDone(false); setPaper([]); setLocalAnswers({}); setMarked({}); }
  const correct = paper.filter(q => answers[q.id] === q.gabarito).length;
  const answered = Object.keys(answers).length;
  const pending = paper.length - answered;
  const pct = paper.length ? Math.round(correct/paper.length*100) : 0;
  const byDisc = DISCIPLINES.map(d => {
    const list = paper.filter(q => q.disciplina === d);
    const ok = list.filter(q => answers[q.id] === q.gabarito).length;
    return { disciplina:d, total:list.length, correct:ok, pct:list.length ? Math.round(ok/list.length*100) : 0 };
  }).filter(x=>x.total);

  if (!running) return <section className="panel"><h2>Prova Real</h2><p className="muted">Aqui a resposta não aparece na hora. Você treina como prova, com cronômetro, progresso e resultado por disciplina.</p><select value={size} onChange={e=>setSize(Number(e.target.value))}><option value="10">Rápida - 10 questões</option><option value="80">Modelo 2023 - 80 questões</option><option value="100">Modelo 2022/2018 - 100 questões</option></select><button className="primary" onClick={start}>Começar prova</button></section>;
  return <section className="panel exam-panel"><div className="exam-sticky-head"><div><h2>Prova Real</h2><p className="muted">Respondidas {answered}/{paper.length} • Pendentes {pending} • Marcadas {Object.values(marked).filter(Boolean).length}</p></div><div className="exam-timer"><Clock3 size={18}/>{formatTime(elapsed)}</div></div>
    <div className="exam-progress"><i style={{width:`${Math.round(answered/paper.length*100)}%`}}></i></div>
    {done && <div className="result-summary"><Trophy/><div><h3>Resultado: {correct}/{paper.length} ({pct}%)</h3><p>Tempo total: {formatTime(elapsed)}</p></div><button className="ghost" onClick={restart}><RotateCcw size={16}/> Nova prova</button></div>}
    {done && <div className="result-disciplines"><h3>Resultado por disciplina</h3><div className="bars">{byDisc.map(d=><div key={d.disciplina} className="bar-row"><span>{d.disciplina}</span><div><i style={{width:`${d.pct}%`}}></i></div><b>{d.correct}/{d.total}</b></div>)}</div></div>}
    {paper.map((q,n)=><div key={q.id} className={marked[q.id]?'exam-item marked':'exam-item'}><div className="exam-head"><b>Questão {n+1} — {q.disciplina}</b><span>{q.tema}</span></div><p className="exam-statement">{q.enunciado}</p><div className="exam-alternatives">{Object.entries(q.alternativas || {}).map(([letter,text])=><button key={letter} className={answers[q.id]===letter?'selected':''} onClick={()=>!done && setLocalAnswers({...answers,[q.id]:letter})}><b>{letter}</b><span>{text}</span></button>)}</div><div className="exam-tools"><button className="ghost" onClick={()=>setMarked({...marked,[q.id]:!marked[q.id]})}>{marked[q.id]?'Desmarcar revisão':'Marcar para revisão'}</button></div>{done && <div className={answers[q.id]===q.gabarito?'exam-result green':'exam-result red'}><b>Gabarito: {q.gabarito}</b><span>Sua resposta: {answers[q.id] || 'não marcada'}</span><details><summary>Comentário</summary><p>{q.comentario}</p><b>Fundamento:</b><p>{q.fundamento}</p></details></div>}</div>)}{!done ? <div className="finish-bar"><span>{answered}/{paper.length} respondidas • {formatTime(elapsed)}</span><button className="primary finish-exam" onClick={finish}>Finalizar prova</button></div> : <div className="result-big"><Trophy/> Resultado final registrado no desempenho local</div>}</section>;
}

function ErrorsDossier({ errors, setErrors }) {
  if (!errors.length) return <Empty title="Dossiê limpo" text="Quando você errar, o app arquiva automaticamente o caso aqui." />;
  return <section className="panel"><h2>Dossiê de Erros</h2>{errors.map(e=><div className="error-row" key={e.id}><b>{e.question.disciplina} • {e.question.tema}</b><p>{e.reason}</p><small>Marcada: {e.selected} | Correta: {e.question.gabarito}</small><button onClick={()=>setErrors(prev=>prev.filter(x=>x.id!==e.id))}>Marcar como entendido</button></div>)}</section>;
}
function Flashcards({ cards, setCards }){ if(!cards.length) return <Empty title="Sem cartões" text="Erre uma questão no modo estudo para gerar flashcards automáticos."/>; return <section className="panel"><h2>Cartões de Memorização</h2><div className="cards-grid">{cards.map(c=><div className="flash" key={c.id}><b>{c.frente}</b><p>{c.verso}</p><button onClick={()=>setCards(prev=>prev.map(x=>x.id===c.id?{...x,mastered:!x.mastered}:x))}>{c.mastered?'Dominado':'Marcar dominado'}</button></div>)}</div></section>; }

function Discursive({ settings }) {
  const [discFilter, setDiscFilter] = useState('Todas');
  const filteredDisc = starterDiscursivas.filter(d => discFilter === 'Todas' || d.disciplina === discFilter);
  const [item, setItem] = useState(starterDiscursivas[0]); const [text, setText] = useState(''); const [ai, setAi] = useState(''); const [loading, setLoading] = useState(false);
  async function correct(){ setLoading(true); const res = await askProfessor({ question: `Corrija esta resposta discursiva para Delegado PC-SP. Enunciado: ${item.enunciado}\nEspelho: ${item.espelho}\nResposta do aluno: ${text}`, apiKey: settings.openaiKey }); setAi(res); setLoading(false); }
  return <section className="panel"><h2>Peça Escrita</h2><select value={discFilter} onChange={e=>{setDiscFilter(e.target.value); const first = starterDiscursivas.find(d=>e.target.value==='Todas'||d.disciplina===e.target.value); if(first) setItem(first)}}><option>Todas</option>{DISCIPLINES.map(d=><option key={d}>{d}</option>)}</select><select value={item?.id} onChange={e=>setItem(starterDiscursivas.find(x=>x.id===e.target.value))}>{filteredDisc.map(d=><option value={d.id} key={d.id}>{d.disciplina} — {d.tema}</option>)}</select><Info title="Enunciado" text={item.enunciado}/><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Digite sua resposta jurídica aqui..."/><div className="button-row"><button className="ghost" onClick={()=>setAi(item.espelho)}>Ver espelho</button><button className="primary" onClick={correct} disabled={!text || loading}>{loading?'Corrigindo...':'Corrigir com Professor IA'}</button></div>{ai && <div className="ai-box"><Sparkles/>{ai}</div>}</section>;
}

function ProfessorIA({ questions, settings, setSettings }) {
  const [prompt, setPrompt] = useState('Explique dolo eventual x culpa consciente com analogia simples.'); const [answer, setAnswer] = useState(''); const [loading, setLoading] = useState(false);
  async function ask(){ setLoading(true); setAnswer(await askProfessor({ question: prompt, apiKey: settings.openaiKey, context: questions.slice(0,5) })); setLoading(false); }
  return <section className="panel"><h2>Professor IA</h2><p className="muted">Para produção, use backend/Edge Function. Aqui a chave local é só para teste.</p><input type="password" placeholder="OpenAI API Key local opcional" value={settings.openaiKey||''} onChange={e=>setSettings({...settings, openaiKey:e.target.value})}/><textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/><button className="primary" onClick={ask} disabled={loading}>{loading?'Pensando...':'Perguntar'}</button>{answer && <div className="ai-box"><Sparkles/>{answer}</div>}</section>;
}


function LibraryContent({ content, questions, setView }) {
  const [tab, setTab] = useState('aulas');
  const [discipline, setDiscipline] = useState('Todas');
  const [query, setQuery] = useState('');
  const collections = {
    aulas: content.aulas || [],
    flashcards: content.flashcards || [],
    discursivas: content.discursivas || [],
    questoes: questions || []
  };
  const items = (collections[tab] || []).filter(item => {
    const discOk = discipline === 'Todas' || item.disciplina === discipline;
    const text = `${item.tema || ''} ${item.titulo || ''} ${item.enunciado || ''} ${item.resumo || ''}`.toLowerCase();
    return discOk && text.includes(query.toLowerCase());
  });
  const counts = DISCIPLINES.map(d => ({ disciplina: d, total: (content.aulas||[]).filter(x=>x.disciplina===d).length }));
  return <section className="panel library-page">
    <div className="toolbar"><div><p className="kicker">Biblioteca do Edital</p><h2>Conteúdo completo por matéria</h2><p className="muted">Aulas rápidas, flashcards, discursivas e questões autorais para cobrir o edital.</p></div><button className="primary" onClick={()=>setView('study')}>Treinar agora</button></div>
    <div className="library-metrics">
      <Metric icon={Database} label="Questões totais" value={questions.length}/>
      <Metric icon={BookOpen} label="Flashcards" value={(content.flashcards||[]).length}/>
      <Metric icon={GraduationCap} label="Aulas rápidas" value={(content.aulas||[]).length}/>
      <Metric icon={FileText} label="Discursivas" value={(content.discursivas||[]).length}/>
    </div>
    <div className="library-controls"><select value={discipline} onChange={e=>setDiscipline(e.target.value)}><option>Todas</option>{DISCIPLINES.map(d=><option key={d}>{d}</option>)}</select><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar tema, palavra-chave ou enunciado..."/></div>
    <div className="tabs library-tabs">{[['aulas','Aulas rápidas'],['flashcards','Flashcards'],['discursivas','Discursivas'],['questoes','Questões']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
    <div className="library-grid">
      {tab==='aulas' && items.map(a=><article className="library-card" key={a.id}><span>{a.disciplina}</span><h3>{a.titulo}</h3><p>{a.resumo}</p><Info title="Analogia" text={a.analogia}/><details><summary>Ver aula completa</summary><p>{a.explicacao}</p><ul>{(a.pontos_chave||[]).map(p=><li key={p}>{p}</li>)}</ul><b>Revisão 10s:</b><p>{a.revisao_10s}</p></details></article>)}
      {tab==='flashcards' && items.map(f=><article className="library-card" key={f.id}><span>{f.disciplina}</span><h3>{f.tema}</h3><b>{f.frente}</b><p>{f.verso}</p></article>)}
      {tab==='discursivas' && items.map(d=><article className="library-card" key={d.id}><span>{d.disciplina}</span><h3>{d.tema}</h3><p>{d.enunciado}</p><details><summary>Espelho de correção</summary><p>{d.espelho}</p><ul>{(d.criterios||[]).map(c=><li key={c}>{c}</li>)}</ul></details></article>)}
      {tab==='questoes' && items.slice(0,120).map(q=><article className="library-card" key={q.id}><span>{q.disciplina}</span><h3>{q.tema}</h3><p>{q.enunciado}</p><b>Gabarito: {q.gabarito}</b><p className="muted">{q.fundamento}</p></article>)}
    </div>
  </section>;
}


function ComparativosJuridicos({ content, questions, flashcards, setView }) {
  const [discipline, setDiscipline] = useState('Todas');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(null);
  const filtered = (content || []).filter(item => {
    const discOk = discipline === 'Todas' || item.disciplina === discipline;
    const text = `${item.disciplina} ${item.tema} ${item.instituto_a} ${item.instituto_b} ${item.diferenca_central} ${(item.tags||[]).join(' ')}`.toLowerCase();
    return discOk && text.includes(query.toLowerCase());
  });
  const selected = active ? filtered.find(x => x.id === active) || filtered[0] : filtered[0];
  const relatedQuestions = selected ? questions.filter(q => {
    const hay = `${q.disciplina} ${q.tema} ${(q.tags||[]).join(' ')} ${q.enunciado} ${q.fundamento}`.toLowerCase();
    return (selected.questoes_relacionadas_tags || []).some(tag => hay.includes(String(tag).toLowerCase().split(' ')[0]));
  }).slice(0, 8) : [];
  const relatedFlashcards = selected ? flashcards.filter(f => {
    const hay = `${f.disciplina||''} ${f.tema||''} ${f.frente||''} ${f.verso||''}`.toLowerCase();
    return (selected.questoes_relacionadas_tags || []).some(tag => hay.includes(String(tag).toLowerCase().split(' ')[0]));
  }).slice(0, 6) : [];
  return <section className="panel compare-page">
    <div className="toolbar"><div><p className="kicker">Não Confunda</p><h2>Comparativos jurídicos essenciais</h2><p className="muted">Diferença central, exemplo prático, analogia, pegadinha VUNESP, frase de memorização e vínculos com questões/flashcards.</p></div><button className="primary" onClick={()=>setView('study')}>Treinar com questões</button></div>
    <div className="library-metrics">
      <Metric icon={Sparkles} label="Comparativos" value={(content||[]).length}/>
      <Metric icon={Target} label="Disciplinas" value={new Set((content||[]).map(x=>x.disciplina)).size}/>
      <Metric icon={Database} label="Questões vinculáveis" value={questions.length}/>
      <Metric icon={BookOpen} label="Flashcards" value={flashcards.length}/>
    </div>
    <div className="library-controls"><select value={discipline} onChange={e=>{setDiscipline(e.target.value); setActive(null);}}><option>Todas</option>{DISCIPLINES.map(d=><option key={d}>{d}</option>)}</select><input value={query} onChange={e=>{setQuery(e.target.value); setActive(null);}} placeholder="Buscar comparativo, tema, instituto ou palavra-chave..."/></div>
    <div className="compare-layout">
      <aside className="compare-list">
        {filtered.map(item => <button key={item.id} className={selected?.id===item.id?'active':''} onClick={()=>setActive(item.id)}><span>{item.disciplina}</span><b>{item.tema}</b><small>{item.instituto_a} × {item.instituto_b}</small></button>)}
      </aside>
      {selected ? <article className="compare-detail">
        <div className="compare-title"><span>DOSSIÊ NÃO CONFUNDA</span><h3>{selected.tema}</h3><p>{selected.instituto_a} <b>×</b> {selected.instituto_b}</p><em>Importância: {selected.nivel_importancia}</em></div>
        <div className="compare-main-grid">
          <div className="compare-big"><b>Diferença central</b><p>{selected.diferenca_central}</p></div>
          <Info title="Exemplo prático" text={selected.exemplo_pratico}/>
          <Info title="Analogia" text={selected.analogia}/>
          <Info title="Pegadinha da VUNESP" text={selected.pegadinha_vunesp}/>
          <div className="info memory-phrase"><b>Frase para memorizar</b><p>{selected.frase_memorizacao}</p></div>
          <div className="info flash-law"><b>Flashcard relacionado</b><p><strong>Frente:</strong> {selected.flashcard_relacionado?.frente}</p><p><strong>Verso:</strong> {selected.flashcard_relacionado?.verso}</p></div>
        </div>
        <div className="related-box"><div className="panel-title-row"><h3>Questões relacionadas</h3><button className="ghost" onClick={()=>setView('study')}>Ir para Sala de Treinamento</button></div>{relatedQuestions.length ? relatedQuestions.map(q => <div className="related-question" key={q.id}><b>{q.disciplina} • {q.tema}</b><p>{q.enunciado}</p><small>Gabarito {q.gabarito} • {q.fundamento}</small></div>) : <p className="muted">Nenhuma questão relacionada encontrada ainda. Use as tags para vincular novas questões.</p>}</div>
        <div className="related-box"><div className="panel-title-row"><h3>Flashcards relacionados</h3><button className="ghost" onClick={()=>setView('flashcards')}>Abrir cartões</button></div>{relatedFlashcards.length ? relatedFlashcards.map(f => <div className="related-question" key={f.id}><b>{f.tema || selected.tema}</b><p>{f.frente}</p><small>{f.verso}</small></div>) : <p className="muted">Nenhum flashcard relacionado encontrado ainda. O card acima já pode virar flashcard oficial.</p>}</div>
      </article> : <Empty title="Nenhum comparativo encontrado" text="Ajuste os filtros para ver os comparativos jurídicos."/>}
    </div>
  </section>;
}


function LegalCode({ content, questions, setView }) {
  const [discipline, setDiscipline] = useState('Todas');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(null);
  const filtered = (content || []).filter(item => {
    const discOk = discipline === 'Todas' || item.disciplina === discipline;
    const text = `${item.disciplina} ${item.diploma} ${item.artigo} ${item.tema} ${item.resumo_simples}`.toLowerCase();
    return discOk && text.includes(query.toLowerCase());
  });
  const selected = active ? filtered.find(x => x.id === active) || filtered[0] : filtered[0];
  const relatedQuestions = selected ? questions.filter(q => {
    const hay = `${q.disciplina} ${q.tema} ${(q.tags||[]).join(' ')} ${q.enunciado}`.toLowerCase();
    return (selected.questoes_relacionadas_tags || []).some(tag => hay.includes(String(tag).toLowerCase().split(' ')[0]));
  }).slice(0, 6) : [];
  const counts = DISCIPLINES.map(d => ({ disciplina: d, total: (content || []).filter(x => x.disciplina === d).length }));
  return <section className="panel laws-page">
    <div className="toolbar"><div><p className="kicker">Lei Seca Inteligente</p><h2>Artigos essenciais do edital</h2><p className="muted">Resumo simples, por que cai, pegadinha, analogia, flashcard e questões relacionadas.</p></div><button className="primary" onClick={()=>setView('study')}>Treinar artigos</button></div>
    <div className="library-metrics">
      <Metric icon={BookOpen} label="Artigos mapeados" value={(content||[]).length}/>
      <Metric icon={Target} label="Disciplinas" value={counts.filter(c=>c.total).length}/>
      <Metric icon={Sparkles} label="Flashcards legais" value={(content||[]).length}/>
      <Metric icon={Database} label="Questões vinculáveis" value={questions.length}/>
    </div>
    <div className="library-controls"><select value={discipline} onChange={e=>{setDiscipline(e.target.value); setActive(null);}}><option>Todas</option>{DISCIPLINES.map(d=><option key={d}>{d}</option>)}</select><input value={query} onChange={e=>{setQuery(e.target.value); setActive(null);}} placeholder="Buscar artigo, lei, tema ou palavra-chave..."/></div>
    <div className="law-layout">
      <aside className="law-list">
        {filtered.map(item => <button key={item.id} className={selected?.id===item.id?'active':''} onClick={()=>setActive(item.id)}><span>{item.disciplina}</span><b>{item.diploma} • {item.artigo}</b><small>{item.tema}</small></button>)}
      </aside>
      {selected ? <article className="law-detail">
        <div className="law-title"><span>{selected.disciplina}</span><h3>{selected.diploma} — {selected.artigo}</h3><p>{selected.tema}</p></div>
        <div className="law-cards">
          <Info title="Resumo simples" text={selected.resumo_simples}/>
          <Info title="Por que cai" text={selected.por_que_cai}/>
          <Info title="Como a VUNESP cobra" text={selected.como_vunesp_cobra}/>
          <Info title="Pegadinha" text={selected.pegadinha}/>
          <Info title="Analogia" text={selected.analogia}/>
          <div className="info flash-law"><b>Flashcard relacionado</b><p><strong>Frente:</strong> {selected.flashcard?.frente}</p><p><strong>Verso:</strong> {selected.flashcard?.verso}</p></div>
        </div>
        <div className="related-box"><div className="panel-title-row"><h3>Questões relacionadas</h3><button className="ghost" onClick={()=>setView('study')}>Ir para treino</button></div>{relatedQuestions.length ? relatedQuestions.map(q => <div className="related-question" key={q.id}><b>{q.disciplina} • {q.tema}</b><p>{q.enunciado}</p><small>Gabarito {q.gabarito} • {q.fundamento}</small></div>) : <p className="muted">Ainda não localizei questão diretamente vinculada por tags. Use a busca da Sala de Treinamento pelo tema.</p>}</div>
        <p className="muted law-note">{selected.observacao}</p>
      </article> : <Empty title="Nenhum artigo encontrado" text="Ajuste os filtros para ver a Lei Seca Inteligente."/>}
    </div>
  </section>;
}

function ImportQuestions({ questions, setQuestions, syncQuestionsToSupabase }) {
  function handleFile(e){ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=()=>{ try{ if(file.name.endsWith('.json')){ const data=JSON.parse(reader.result); setQuestions([...questions, ...data.map(normalizeQuestion)]); } else { Papa.parse(reader.result,{header:true,skipEmptyLines:true,complete:(r)=>setQuestions([...questions, ...r.data.map(normalizeQuestion)])}); } } catch(err){ alert(err.message); } }; reader.readAsText(file); }
  return <section className="panel"><h2>Banco de Questões</h2><p className="muted">Importe JSON ou CSV. Não cadastre questões sem fonte e gabarito validado.</p><input type="file" accept=".json,.csv" onChange={handleFile}/><button className="ghost" onClick={syncQuestionsToSupabase}>Sincronizar com Supabase</button><p>Total atual: <b>{questions.length}</b></p><pre className="schema">CSV: ano,banca,cargo,disciplina,tema,enunciado,alternativa_a,alternativa_b,alternativa_c,alternativa_d,alternativa_e,gabarito,comentario,fundamento,analogia,macete,pegadinha,dificuldade,fonte,tags</pre></section>;
}

function Auth({ session }) {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [msg,setMsg]=useState('');
  if (!hasSupabase) return <Empty title="Supabase não configurado" text="Copie .env.example para .env e preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY." />;
  async function signIn(){ const { error } = await supabase.auth.signInWithPassword({ email, password }); setMsg(error?.message || 'Login realizado.'); }
  async function signUp(){ const { error } = await supabase.auth.signUp({ email, password }); setMsg(error?.message || 'Conta criada. Verifique o e-mail se confirmação estiver ativa.'); }
  async function signOut(){ await supabase.auth.signOut(); }
  if (session) return <section className="panel"><h2>Conta</h2><p>Logado como {session.user.email}</p><button onClick={signOut}><LogOut size={16}/> Sair</button></section>;
  return <section className="panel"><h2>Login</h2><input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)}/><input type="password" placeholder="senha" value={password} onChange={e=>setPassword(e.target.value)}/><div className="button-row"><button className="primary" onClick={signIn}>Entrar</button><button className="ghost" onClick={signUp}>Criar conta</button></div>{msg && <p className="muted">{msg}</p>}</section>;
}

function EditalMap({ stats }) { return <section className="panel"><h2>Mapa do Edital</h2><div className="map-grid">{DISCIPLINES.map(d=>{ const s=stats.byDisc.find(x=>x.disciplina===d); const status=!s?.total?'Não estudado':s.pct>=80?'Dominado':s.pct>=60?'Em revisão':'Crítico'; return <div key={d} className={`map-card ${status==='Crítico'?'danger':''}`}><b>{d}</b><span>{status}</span><small>{s?.total||0} questões respondidas</small></div>})}</div></section>; }
function Empty({ title, text }) { return <section className="panel empty"><GraduationCap size={42}/><h2>{title}</h2><p>{text}</p></section>; }
function inferErrorReason(q){ return `Possível causa: confusão no tema “${q.tema}”. Revise fundamento legal, diferença entre institutos parecidos e a pegadinha da banca.`; }

createRoot(document.getElementById('root')).render(<App />);
