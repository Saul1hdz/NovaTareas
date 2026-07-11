import 'dotenv/config';
const key = process.env.GEMINI_API_KEY;
const models = ['gemini-2.0-flash-lite','gemini-2.0-flash','gemini-1.5-flash-8b','gemini-2.5-flash'];
for (const model of models) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Hola' }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0.7 }
      })
    });
    const text = await res.text();
    console.log(model, res.status, res.statusText, text);
  } catch (e) {
    console.error(model, 'ERROR', e.message);
  }
}
