// /api/proxy.js — Vercel Serverless Function
// Faz o papel de intermediário entre o frontend e o Google Apps Script
// Necessário para evitar CORS diretamente do browser
//
// Variável de ambiente necessária no Vercel:
//   GAS_URL = URL do seu Web App do Apps Script
//   ex: https://script.google.com/macros/s/SEU_ID/exec

export default async function handler(req, res) {
  // CORS — permite o frontend chamar esta API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const GAS_URL = process.env.GAS_URL;
  if (!GAS_URL) {
    return res.status(500).json({ ok: false, error: 'GAS_URL não configurada nas env vars do Vercel' });
  }

  try {
    let gasResponse;

    if (req.method === 'GET') {
      // Repassar query params para o Apps Script
      const params = new URLSearchParams(req.query).toString();
      const url    = `${GAS_URL}${params ? '?' + params : ''}`;
      gasResponse  = await fetch(url);

    } else if (req.method === 'POST') {
      gasResponse = await fetch(GAS_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(req.body),
      });

    } else {
      return res.status(405).json({ ok: false, error: 'Método não permitido' });
    }

    const data = await gasResponse.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
