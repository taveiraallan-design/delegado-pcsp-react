import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Papa from 'papaparse';
import {
  BookOpen, Brain, CheckCircle2, ChevronRight, Database, FileText, Flame,
  GraduationCap, Import, KeyRound, LayoutDashboard, LogOut, NotebookTabs,
  PlayCircle, Shield, Sparkles, Target, Trophy, XCircle
} from 'lucide-react';
import sampleQuestions from './data/sampleQuestions.json';
import { supabase, hasSupabase } from './lib/supabaseClient';
import { askProfessor } from './lib/professorAi';
import './styles/app.css';

const DISCIPLINES = [
  'Direito Penal','Direito Processual Penal','Legislação Especial','Direito Constitucional',
  'Direitos Humanos','Direito Administrativo','Direito Civil','Medicina Legal','Criminologia','Informática'
];

const starterDiscursivas = [
  {
    id: 'disc-001', disciplina: 'Direito Processual Penal', tema: 'Prisão preventiva',
    enunciado: 'Explique a natureza jurídica da prisão preventiva, seus pressupostos e fundamentos, diferenciando-a da prisão temporária.',
    espelho: 'Resposta esperada: mencionar natureza cautelar, não antecipação de pena, fumus comissi delicti, periculum libertatis, art. 312 do CPP, prova da materialidade, indícios de autoria, garantia da ordem pública/econômica, conveniência da instrução criminal, assegurar aplicação da lei penal e distinção da temporária, que possui prazo legal e hipóteses próprias.'
  },
  {
    id: 'disc-002', disciplina: 'Direito Penal', tema: 'Dolo eventual e culpa consciente',
    enunciado: 'Diferencie dolo eventual e culpa consciente, apontando o elemento psicológico que separa os institutos.',
    espelho: 'Resposta esperada: no dolo eventual, o agente prevê o resultado e aceita/assume o risco de produzi-lo; na culpa consciente, prevê o resultado, mas acredita sinceramente que ele não ocorrerá. A chave é aceitação do risco.'
  }
];

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
  const [flashcards, setFlashcards] = useLocalState('pcsp:flashcards', []);
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
      {view === 'study' && <StudyRoom questions={questions} saveAnswer={saveAnswer} settings={settings} />}
      {view === 'exam' && <Exam questions={questions} saveAnswer={saveAnswer} />}
      {view === 'errors' && <ErrorsDossier errors={errors} setErrors={setErrors} setView={setView} />}
      {view === 'flashcards' && <Flashcards cards={flashcards} setCards={setFlashcards} />}
      {view === 'discursive' && <Discursive settings={settings} />}
      {view === 'import' && <ImportQuestions questions={questions} setQuestions={setQuestions} syncQuestionsToSupabase={syncQuestionsToSupabase} />}
      {view === 'auth' && <Auth session={session} />}
      {view === 'professor' && <ProfessorIA questions={questions} settings={settings} setSettings={setSettings} />}
      {view === 'map' && <EditalMap stats={stats} />}
    </main>
  </div>;
}

function Splash(){ return <div className="splash"><Shield size={42}/><h1>Delegado PC-SP</h1><p>Carregando Central do Candidato...</p></div>; }

function Sidebar({ view, setView, session }) {
  const items = [
    ['dashboard','Central do Candidato',LayoutDashboard], ['study','Sala de Treinamento',Brain], ['exam','Prova Real',PlayCircle],
    ['errors','Dossiê de Erros',NotebookTabs], ['flashcards','Cartões',BookOpen], ['discursive','Peça Escrita',FileText],
    ['professor','Professor IA',Sparkles], ['map','Mapa do Edital',Target], ['import','Banco de Questões',Import], ['auth', session ? 'Conta' : 'Login', KeyRound]
  ];
  return <aside className="sidebar">
    <div className="brand"><div className="badge"><Shield size={24}/></div><div><b>Delegado PC-SP</b><span>Inteligência de Estudos</span></div></div>
    <nav>{items.map(([id,label,Icon]) => <button key={id} className={view===id?'active':''} onClick={()=>setView(id)}><Icon size={18}/>{label}</button>)}</nav>
  </aside>;
}

function Hero({ settings, setSettings, session }) {
  return <section className="hero">
    <div><p className="kicker">Central de investigação do edital</p><h1>Ambiente Inteligente de Estudos</h1><p>Simulados VUNESP • Correção imediata • Dossiê de erros • Flashcards • Professor IA</p></div>
    <div className="hero-actions"><span className="status-dot"></span>{session ? session.user.email : 'Modo local'}<button onClick={()=>setSettings({...settings, tdah: !settings.tdah})}>{settings.tdah ? 'Modo TDAH ON' : 'Modo TDAH OFF'}</button></div>
  </section>;
}

function Dashboard({ stats, questions, errors, flashcards, setView }) {
  return <div className="grid-page">
    <Metric icon={Database} label="Questões no banco" value={questions.length} />
    <Metric icon={CheckCircle2} label="Acertos gerais" value={`${stats.pct}%`} />
    <Metric icon={Flame} label="Erros no dossiê" value={errors.length} />
    <Metric icon={BookOpen} label="Flashcards" value={flashcards.length} />
    <section className="panel wide"><h2>Missão de hoje</h2><div className="mission"><p><b>Roteiro sugerido:</b> 20 questões, revisar 5 erros, fazer 3 flashcards e uma peça escrita curta.</p><button onClick={()=>setView('study')}>Iniciar treinamento <ChevronRight size={16}/></button></div></section>
    <section className="panel"><h2>Alerta de investigação</h2><p className="muted">{stats.weak ? `Disciplina crítica atual: ${stats.weak.disciplina} (${stats.weak.pct}% de acerto).` : 'Responda questões para gerar diagnóstico.'}</p></section>
    <section className="panel wide"><h2>Inteligência por disciplina</h2><div className="bars">{stats.byDisc.map(d=><div key={d.disciplina} className="bar-row"><span>{d.disciplina}</span><div><i style={{width:`${d.pct}%`}}></i></div><b>{d.total?`${d.pct}%`:'--'}</b></div>)}</div></section>
  </div>;
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
  const [size, setSize] = useState(10); const [running, setRunning] = useState(false); const [paper, setPaper] = useState([]); const [answers, setLocalAnswers] = useState({}); const [done, setDone] = useState(false);
  function start(){ setPaper([...questions].sort(()=>Math.random()-0.5).slice(0, size)); setRunning(true); setDone(false); setLocalAnswers({}); }
  async function finish(){ for (const q of paper) if (answers[q.id]) await saveAnswer(q, answers[q.id], 'exam'); setDone(true); }
  const correct = paper.filter(q => answers[q.id] === q.gabarito).length;
  if (!running) return <section className="panel"><h2>Prova Real</h2><p className="muted">Aqui a resposta não aparece na hora. Você treina como prova.</p><select value={size} onChange={e=>setSize(Number(e.target.value))}><option value="10">Rápida - 10 questões</option><option value="80">Modelo 2023 - 80 questões</option><option value="100">Modelo 2022/2018 - 100 questões</option></select><button className="primary" onClick={start}>Começar prova</button></section>;
  return <section className="panel"><h2>Prova Real</h2>{paper.map((q,n)=><div key={q.id} className="exam-item"><b>Questão {n+1} — {q.disciplina}</b><p>{q.enunciado}</p><div className="inline-answers">{Object.keys(q.alternativas).map(l=><button key={l} className={answers[q.id]===l?'selected':''} onClick={()=>setLocalAnswers({...answers,[q.id]:l})}>{l}</button>)}</div>{done && <small className={answers[q.id]===q.gabarito?'green':'red'}>Gabarito: {q.gabarito}</small>}</div>)}{!done ? <button className="primary" onClick={finish}>Finalizar prova</button> : <div className="result-big"><Trophy/> Resultado: {correct}/{paper.length} ({Math.round(correct/paper.length*100)}%)</div>}</section>;
}

function ErrorsDossier({ errors, setErrors }) {
  if (!errors.length) return <Empty title="Dossiê limpo" text="Quando você errar, o app arquiva automaticamente o caso aqui." />;
  return <section className="panel"><h2>Dossiê de Erros</h2>{errors.map(e=><div className="error-row" key={e.id}><b>{e.question.disciplina} • {e.question.tema}</b><p>{e.reason}</p><small>Marcada: {e.selected} | Correta: {e.question.gabarito}</small><button onClick={()=>setErrors(prev=>prev.filter(x=>x.id!==e.id))}>Marcar como entendido</button></div>)}</section>;
}
function Flashcards({ cards, setCards }){ if(!cards.length) return <Empty title="Sem cartões" text="Erre uma questão no modo estudo para gerar flashcards automáticos."/>; return <section className="panel"><h2>Cartões de Memorização</h2><div className="cards-grid">{cards.map(c=><div className="flash" key={c.id}><b>{c.frente}</b><p>{c.verso}</p><button onClick={()=>setCards(prev=>prev.map(x=>x.id===c.id?{...x,mastered:!x.mastered}:x))}>{c.mastered?'Dominado':'Marcar dominado'}</button></div>)}</div></section>; }

function Discursive({ settings }) {
  const [item, setItem] = useState(starterDiscursivas[0]); const [text, setText] = useState(''); const [ai, setAi] = useState(''); const [loading, setLoading] = useState(false);
  async function correct(){ setLoading(true); const res = await askProfessor({ question: `Corrija esta resposta discursiva para Delegado PC-SP. Enunciado: ${item.enunciado}\nEspelho: ${item.espelho}\nResposta do aluno: ${text}`, apiKey: settings.openaiKey }); setAi(res); setLoading(false); }
  return <section className="panel"><h2>Peça Escrita</h2><select onChange={e=>setItem(starterDiscursivas.find(x=>x.id===e.target.value))}>{starterDiscursivas.map(d=><option value={d.id} key={d.id}>{d.disciplina} — {d.tema}</option>)}</select><Info title="Enunciado" text={item.enunciado}/><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Digite sua resposta jurídica aqui..."/><div className="button-row"><button className="ghost" onClick={()=>setAi(item.espelho)}>Ver espelho</button><button className="primary" onClick={correct} disabled={!text || loading}>{loading?'Corrigindo...':'Corrigir com Professor IA'}</button></div>{ai && <div className="ai-box"><Sparkles/>{ai}</div>}</section>;
}

function ProfessorIA({ questions, settings, setSettings }) {
  const [prompt, setPrompt] = useState('Explique dolo eventual x culpa consciente com analogia simples.'); const [answer, setAnswer] = useState(''); const [loading, setLoading] = useState(false);
  async function ask(){ setLoading(true); setAnswer(await askProfessor({ question: prompt, apiKey: settings.openaiKey, context: questions.slice(0,5) })); setLoading(false); }
  return <section className="panel"><h2>Professor IA</h2><p className="muted">Para produção, use backend/Edge Function. Aqui a chave local é só para teste.</p><input type="password" placeholder="OpenAI API Key local opcional" value={settings.openaiKey||''} onChange={e=>setSettings({...settings, openaiKey:e.target.value})}/><textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/><button className="primary" onClick={ask} disabled={loading}>{loading?'Pensando...':'Perguntar'}</button>{answer && <div className="ai-box"><Sparkles/>{answer}</div>}</section>;
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
