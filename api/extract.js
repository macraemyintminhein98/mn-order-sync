import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPTS = {
  mainSignInstalls: `Extract the "Main Sign Installs (New Land)" table from this email screenshot.
Return ONLY valid JSON, no markdown. Extract every row including cancelled ones (orange/highlighted rows).

Return this exact structure:
{
  "rows": [
    {
      "number": "740",
      "project": "1923 5th St",
      "city": "Kirkland",
      "pm": "Chris S",
      "possessionDate": "5/16/2026",
      "laoName": "Alex Murray",
      "laoPhone": "509-630-8652",
      "dateCompleted": "",
      "notes": "LAO-TBD",
      "cancelled": false
    }
  ]
}
Set cancelled=true for any row highlighted orange or with "Project Cancelled" in notes.
Leave dateCompleted as empty string if blank.`,

  safetySignInstalls: `Extract the "Safety Sign Installs" table from this email screenshot.
Return ONLY valid JSON, no markdown.

Return this exact structure:
{
  "rows": [
    {
      "number": "684",
      "project": "4250 189th Ave SE",
      "city": "Issaquah",
      "pm": "Drew H",
      "constructionStartDate": "6/4/2026",
      "dateCompleted": ""
    }
  ]
}
Leave dateCompleted as empty string if blank.`,

  onMarketRiders: `Extract the "On-Market Riders Installs" table from this email screenshot.
Return ONLY valid JSON, no markdown.

Return this exact structure:
{
  "rows": [
    {
      "number": "664",
      "project": "3120 109th Ave SE",
      "pm": "Ryan G",
      "listingDate": "EST 5/28/2026",
      "dateCompleted": "",
      "notes": "Requested Early On Market Install"
    }
  ]
}
Preserve the "EST" prefix on listing dates. Leave dateCompleted empty if blank.`,

  mainSignRemovals: `Extract the "Main Sign Removals" table from this email screenshot.
Return ONLY valid JSON, no markdown.

Return this exact structure:
{
  "rows": [
    {
      "number": "421",
      "project": "12211 NE 134th St",
      "pm": "Chad A",
      "removeByDate": "5/31/2026",
      "dateRemoved": ""
    }
  ]
}
Leave dateRemoved as empty string if not yet removed.`
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables.' });
  }

  const { imageData, mediaType = 'image/jpeg', type } = req.body;
  if (!imageData) return res.status(400).json({ error: 'No image data provided' });

  const prompt = PROMPTS[type];
  if (!prompt) return res.status(400).json({ error: 'Invalid type: ' + type });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    let text = response.content[0].text.trim();
    text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const data = JSON.parse(text);
    res.status(200).json(data);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(422).json({ error: 'Could not parse table. Try a clearer screenshot or crop just the table.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}
