# Delegado PC-SP Estudos — React + Vite + Supabase

Projeto convertido do MVP em HTML para um app React + Vite com visual dark premium.

## O que já vem pronto

- Central do Candidato
- Sala de Treinamento com correção imediata
- Explicação, fundamento, analogia, macete e pegadinha
- Modo TDAH
- Prova Real sem resposta imediata
- Dossiê de Erros
- Flashcards automáticos
- Peça Escrita com espelho e Professor IA
- Professor IA para dúvidas
- Banco de Questões com importação CSV/JSON
- Login Supabase
- Schema SQL Supabase com RLS
- PWA básico

## Como rodar no Mac

```bash
npm install
npm run dev
```

Abra o endereço que aparecer no terminal, normalmente:

```bash
http://localhost:5173
```

## Configurar Supabase

1. Crie um projeto no Supabase.
2. Vá em SQL Editor.
3. Execute o arquivo:

```bash
supabase/schema.sql
```

4. Copie `.env.example` para `.env`.
5. Preencha:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
```

6. Reinicie o servidor:

```bash
npm run dev
```

## Professor IA

Para teste local, você pode colocar sua chave OpenAI no app, na tela Professor IA, ou no `.env`:

```env
VITE_OPENAI_API_KEY=sua-chave
VITE_OPENAI_MODEL=gpt-4.1-mini
```

Atenção: em produção, não deixe chave OpenAI no frontend. Use uma Supabase Edge Function, backend Node/FastAPI ou endpoint serverless.

## Importação de questões

O app aceita `.json` e `.csv`.

Campos recomendados:

```csv
ano,banca,cargo,disciplina,tema,enunciado,alternativa_a,alternativa_b,alternativa_c,alternativa_d,alternativa_e,gabarito,comentario,fundamento,analogia,macete,pegadinha,dificuldade,fonte,tags
```

## Observação jurídica/autoral

O projeto vem com questões demonstrativas. Para usar provas reais, importe somente conteúdo com fonte, gabarito e autorização/licença adequada. Não invente gabarito, artigo ou jurisprudência.

## Próximos upgrades recomendados

1. Persistir perguntas/flashcards também no Supabase em tempo real.
2. Criar painel admin com perfil de administrador.
3. Criar Edge Function para Professor IA.
4. Adicionar importação de PDF com validação humana.
5. Criar calendário de revisão espaçada.
6. Publicar na Vercel.
