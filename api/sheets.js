export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;

  if (!scriptUrl) {
    return res.status(500).json({
      error: 'GOOGLE_SCRIPT_URL not set in Vercel environment variables.',
      setup: 'See the Settings tab in the app for setup instructions.'
    });
  }

  try {
    let response;

    if (req.method === 'GET') {
      const params = new URLSearchParams(req.query).toString();
      response = await fetch(`${scriptUrl}${params ? '?' + params : ''}`, { redirect: 'follow' });
    } else if (req.method === 'POST') {
      response = await fetch(scriptUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const text = await response.text();
    try {
      const data = JSON.parse(text);
      res.status(200).json(data);
    } catch {
      res.status(200).send(text);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
