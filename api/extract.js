// OpenRouter vision API — no SDK needed, pure fetch
const PROMPTS = {
  mainSignInstalls: `Extract the "Main Sign Installs (New Land)" table from this screenshot.
Return ONLY valid JSON, no markdown. Every row including orange/cancelled ones.
{
  "rows": [
    { "number":"740","project":"1923 5th St","city":"Kirkland","pm":"Chris S",
      "possessionDate":"5/16/2026","laoName":"Alex Murray","laoPhone":"509-630-8652",
      "dateCompleted":"","notes":"LAO-TBD","cancelled":false }
  ]
}
Set cancelled=true for orange-highlighted rows or rows with "Project Cancelled" in notes. Empty dateCompleted = "".`,

  safetySignInstalls: `Extract the "Safety Sign Installs" table from this screenshot.
Return ONLY valid JSON, no markdown.
{
  "rows": [
    { "number":"684","project":"4250 189th Ave SE","city":"Issaquah","pm":"Drew H",
      "constructionStartDate":"6/4/2026","dateCompleted":"" }
  ]
}
Empty dateCompleted = "".`,

  onMarketRiders: `Extract the "On-Market Riders Installs" table from this screenshot.
Return ONLY valid JSON, no markdown.
{
  "rows": [
    { "number":"664","project":"3120 109th Ave SE","pm":"Ryan G",
      "listingDate":"EST 5/28/2026","dateCompleted":"","notes":"" }
  ]
}
Preserve EST prefix. Empty dateCompleted = "".`,

  mainSignRemovals: `Extract the "Main Sign Removals" table from this screenshot.
Return ONLY valid JSON, no markdown.
{
  "rows": [
    { "number":"421","project":"12211 NE 134th St","pm":"Chad A",
      "removeByDate":"5/31/2026","dateRemoved":"" }
  ]
}
Empty dateRemoved = "".`
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set in Vercel environment variables.' });

  const { imageData, mediaType = 'image/jpeg', type } = req.body;
  if (!imageData) return res.status(400).json({ error: 'No image data provided' });
  const prompt = PROMPTS[type];
  if (!prompt) return res.status(400).json({ error: 'Invalid type: ' + type });

  const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free';

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://mn-order-sync.vercel.app',
        'X-Title': 'MN Order Sync – SignPros'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageData}` } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `OpenRouter error: ${err}` });
    }

    const data = await response.json();
    let text = data.choices?.[0]?.message?.content?.trim() || '';
    text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(422).json({ error: 'Could not parse table. Try a clearer screenshot or crop just the table.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}
