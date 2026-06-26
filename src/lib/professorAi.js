const fallback = `Professor IA local: configure uma chave OpenAI para resposta real.\n\nModelo de explicação:\n1. Identifique o instituto jurídico.\n2. Procure o fundamento legal.\n3. Compare com institutos parecidos.\n4. Ache a pegadinha da banca.\n5. Crie uma frase de fixação.\n\nAnalogia: pense na questão como um inquérito. O enunciado é o fato, as alternativas são suspeitos, e o fundamento legal é a prova que confirma o culpado.`;

export async function askProfessor({ question, apiKey, context = [] }) {
  const key = apiKey || import.meta.env.VITE_OPENAI_API_KEY;
  if (!key) return fallback;
  try {
    const model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4.1-mini';
    const system = `Você é um professor jurídico especialista em concursos de Delegado PC-SP e banca VUNESP. Explique com clareza, lei seca, analogias, pegadinhas e modo TDAH. Não invente artigo, súmula ou jurisprudência. Quando não tiver certeza, diga que precisa validação.`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${question}\n\nContexto de questões cadastradas: ${JSON.stringify(context).slice(0,5000)}` }
        ],
        temperature: 0.3
      })
    });
    if (!res.ok) return `Erro na IA: ${res.status}. Confira chave/créditos/modelo.\n\n${fallback}`;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || fallback;
  } catch (e) {
    return `Não consegui chamar a IA: ${e.message}\n\n${fallback}`;
  }
}
