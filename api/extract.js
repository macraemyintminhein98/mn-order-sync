// OpenRouter vision OCR with automatic model fallback chain
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

// Fallback chain: custom model → current free vision models → auto-router
function buildModelChain() {
  const chain = [];
  if (process.env.OPENROUTER_MODEL) chain.push(process.env.OPENROUTER_MODEL);
  chain.push(
    'google/gemma-4-31b-it:free',   // free + vision (June 2026)
    'openrouter/free',              // auto-picks an available free model
    'google/gemini-2.5-flash'       // paid fallback (~$0.0002/image) only if credits exist
  );
  return [...new Set(chain)];
}

// Robustly pull the first JSON object out of model output
function extractJson(text) {
  let t = text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new SyntaxError('No JSON found');
  return JSON.parse(t.slice(start, end + 1));
}

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

  const models = buildModelChain();
  const failures = [];

  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mn-order-sync.vercel.app',
          'X-Title': 'MN Order Sync'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          temperature: 0,
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
        const errText = await response.text();
        failures.push(`${model}: HTTP ${response.status}`);
        continue; // try next model
      }

      const data = await response.json();
      if (data.error) {
        failures.push(`${model}: ${data.error.message || 'API error'}`);
        continue;
      }

      const text = data.choices?.[0]?.message?.content || '';
      if (!text.trim()) {
        failures.push(`${model}: empty response`);
        continue;
      }

      const parsed = extractJson(text);
      if (!Array.isArray(parsed.rows)) parsed.rows = [];
      return res.status(200).json({ ...parsed, _model: model });

    } catch (err) {
      failures.push(`${model}: ${err.message}`);
      continue;
    }
  }

  return res.status(502).json({
    error: 'All AI models failed. Details: ' + failures.join(' | ')
  });
}
