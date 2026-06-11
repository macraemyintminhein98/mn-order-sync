// OpenRouter vision OCR with automatic model fallback chain
const PROMPTS = {
  mainSignInstalls: `Extract the "Main Sign Installs (New Land)" table from this image.
Return ONLY valid JSON, no markdown. Every row including orange/cancelled ones.
{"rows":[{"number":"752","project":"9004 NE 42nd St","city":"Yarrow Point","pm":"Dalton B","possessionDate":"6/30/2026","laoName":"George Florit","laoPhone":"425-830-2777","dateCompleted":"","notes":"","cancelled":false}]}
Set cancelled=true for orange-highlighted rows or "Project Cancelled" notes. PM may be "TBD". Empty cells = "".
If this table is not in the image, return {"rows":[]}.`,

  safetySignInstalls: `Extract the "Safety Sign Installs" table from this image.
Return ONLY valid JSON, no markdown.
{"rows":[{"number":"684","project":"4250 189th Ave SE","city":"Issaquah","pm":"Drew H","constructionStartDate":"6/8/2026","dateCompleted":"5/3/2026"}]}
Empty cells = "". If this table is not in the image, return {"rows":[]}.`,

  onMarketRiders: `Extract the "On-Market Riders Installs" table from this image.
Return ONLY valid JSON, no markdown.
{"rows":[{"number":"664","project":"3120 109th Ave SE","pm":"Ryan G","listingDate":"EST 5/28/2026","dateCompleted":"","notes":""}]}
Preserve EST prefix. Empty cells = "". If the section says "None currently scheduled" or the table is absent, return {"rows":[]}.`,

  mainSignRemovals: `Extract the "Main Sign Removals" table from this image.
Return ONLY valid JSON, no markdown.
{"rows":[{"number":"421","project":"12211 NE 134th St","pm":"Spencer W","removeByDate":"5/31/2026","dateRemoved":""}]}
Empty cells = "". If this table is not in the image, return {"rows":[]}.`,

  urgentRequests: `Extract any urgent/one-off request table from this image. These have columns: #, Street Address, PM, Request, Date Submitted.
Return ONLY valid JSON, no markdown.
{"rows":[{"number":"618","streetAddress":"17716 NE 12th St","pm":"Zach N","request":"Safety sign is damaged and will need to be replaced","dateSubmitted":"6/4/2026"}]}
If no such table is in the image, return {"rows":[]}.`,

  fullEmail: `This is a page from an order email sent by MN Custom Homes to SignPros. It may contain any of these tables:
1. "Main Sign Installs (New Land)" — #, Project, City, PM, Possession date, LAO to list on rider, LAO's #, Date Completed (orange rows = cancelled)
2. "Safety Sign Installs" — #, Project, City, PM, Construction Start Date, Date Completed
3. "On-Market Riders Installs" — #, Project, PM, Listing Date, Date Completed, Notes
4. "Main Sign Removals" — #, Project, PM, Remove By Date, Date Removed
5. Urgent request tables — #, Street Address, PM, Request, Date Submitted

Extract ALL tables visible on this page. Return ONLY valid JSON, no markdown:
{
 "mainSignInstalls":[{"number":"","project":"","city":"","pm":"","possessionDate":"","laoName":"","laoPhone":"","dateCompleted":"","notes":"","cancelled":false}],
 "safetySignInstalls":[{"number":"","project":"","city":"","pm":"","constructionStartDate":"","dateCompleted":""}],
 "onMarketRiders":[{"number":"","project":"","pm":"","listingDate":"","dateCompleted":"","notes":""}],
 "mainSignRemovals":[{"number":"","project":"","pm":"","removeByDate":"","dateRemoved":""}],
 "urgentRequests":[{"number":"","streetAddress":"","pm":"","request":"","dateSubmitted":""}]
}
Use empty arrays for table types not on this page. Empty cells = "". Ignore email signatures, logos, badges.`
};

function buildModelChain() {
  const chain = [];
  if (process.env.OPENROUTER_MODEL) chain.push(process.env.OPENROUTER_MODEL);
  chain.push(
    'google/gemma-4-31b-it:free',
    'openrouter/free',
    'google/gemini-2.5-flash'
  );
  return [...new Set(chain)];
}

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
          model, max_tokens: 8192, temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageData}` } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      if (!response.ok) { failures.push(`${model}: HTTP ${response.status}`); continue; }
      const data = await response.json();
      if (data.error) { failures.push(`${model}: ${data.error.message || 'API error'}`); continue; }
      const text = data.choices?.[0]?.message?.content || '';
      if (!text.trim()) { failures.push(`${model}: empty`); continue; }

      const parsed = extractJson(text);
      if (type === 'fullEmail') {
        for (const k of ['mainSignInstalls','safetySignInstalls','onMarketRiders','mainSignRemovals','urgentRequests']) {
          if (!Array.isArray(parsed[k])) parsed[k] = [];
        }
      } else {
        if (!Array.isArray(parsed.rows)) parsed.rows = [];
      }
      return res.status(200).json({ ...parsed, _model: model });
    } catch (err) {
      failures.push(`${model}: ${err.message}`);
      continue;
    }
  }
  return res.status(502).json({ error: 'All AI models failed: ' + failures.join(' | ') });
}
