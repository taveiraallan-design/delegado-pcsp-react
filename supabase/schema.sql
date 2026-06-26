-- Delegado PC-SP Estudos — Supabase Schema
-- 1) Crie um projeto no Supabase
-- 2) Abra SQL Editor
-- 3) Execute este arquivo
-- 4) Configure .env com URL e anon key

create extension if not exists "uuid-ossp";

create table if not exists public.questions (
  id text primary key,
  ano text,
  banca text,
  cargo text,
  disciplina text not null,
  tema text not null,
  enunciado text not null,
  alternatives jsonb not null,
  gabarito text not null,
  comentario text,
  fundamento text,
  analogia text,
  macete text,
  pegadinha text,
  dificuldade text,
  fonte text,
  tags text[] default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.attempts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  question_id text not null,
  selected_answer text not null,
  is_correct boolean not null,
  mode text not null default 'study',
  created_at timestamptz default now()
);

create table if not exists public.flashcards (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  question_id text,
  frente text not null,
  verso text not null,
  mastered boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.discursive_answers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  disciplina text,
  tema text,
  enunciado text,
  resposta text,
  feedback text,
  score numeric,
  created_at timestamptz default now()
);

alter table public.questions enable row level security;
alter table public.attempts enable row level security;
alter table public.flashcards enable row level security;
alter table public.discursive_answers enable row level security;

-- Questões podem ser lidas por usuários autenticados.
create policy "questions_select_authenticated" on public.questions
for select to authenticated using (true);

-- Usuários autenticados podem inserir questões; para produção, restrinja a admins.
create policy "questions_insert_authenticated" on public.questions
for insert to authenticated with check (auth.uid() = created_by or created_by is null);

create policy "questions_update_owner" on public.questions
for update to authenticated using (auth.uid() = created_by) with check (auth.uid() = created_by);

create policy "attempts_owner_all" on public.attempts
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "flashcards_owner_all" on public.flashcards
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "discursive_owner_all" on public.discursive_answers
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
