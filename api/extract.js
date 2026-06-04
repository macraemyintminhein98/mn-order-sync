import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables.' });
  }

  const { imageData, mediaType = 'image/jpeg' } = req.body;
  if (!imageData) return res.status(400).json({ error: 'No image data provided' });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageData }
          },
          {
            type: 'text',
            text: `You are extracting order data from an email screenshot sent by Ashley Myers at MN Custom Homes to SignPros.

Extract ALL visible table data. Return ONLY valid JSON with no markdown fences or extra text.

The email may contain any combination of these table types:
1. "Main Sign Installs (New Land)" - columns: #, Project, City, PM, Possession Date, LAO to list on rider, LAO's #, Date Completed, Notes
   - Rows highlighted orange/salmon = cancelled projects
2. "Safety Sign Installs" - columns: #, Project, City, PM, Construction Start Date, Date Completed
3. "On-Market Riders Installs" - columns: #, Project, PM, Listing Date (Install By Date), Date Completed, Notes
   - Listing dates often prefixed with "EST"
4. "Main Sign Removals" - columns: #, Project, PM, Remove By Date (one day before closing), Date Removed
5. "Urgent/One-off Requests" - columns: #, Street Address, PM, Request, Date Submitted

If a section says "None currently scheduled" or similar, return an empty array for that type.
Empty Date Completed cells = not yet done (leave as empty string).

Return exactly this JSON structure:
{
  "week": "detected week label or date like '5/24 Week' or empty string",
  "mainSignInstalls": [
    {
      "number": "740",
      "project": "1923 5th St",
      "city": "Kirkland",
      "pm": "Chris S",
      "possessionDate": "5/16/2026",
      "laoName": "Alex Murray",
      "laoPhone": "509-630-8652",
      "dateCompleted": "",
      "notes": "",
      "cancelled": false
    }
  ],
  "safetySignInstalls": [
    {
      "number": "684",
      "project": "4250 189th Ave SE",
      "city": "Issaquah",
      "pm": "Drew H",
      "constructionStartDate": "6/4/2026",
      "dateCompleted": "5/3/2026"
    }
  ],
  "onMarketRiders": [
    {
      "number": "664",
      "project": "3120 109th Ave SE",
      "pm": "Ryan G",
      "listingDate": "EST 5/28/2026",
      "dateCompleted": "",
      "notes": ""
    }
  ],
  "mainSignRemovals": [
    {
      "number": "421",
      "project": "12211 NE 134th St",
      "pm": "Chad A",
      "removeByDate": "5/31/2026",
      "dateRemoved": ""
    }
  ],
  "urgentRequests": [
    {
      "number": "649",
      "streetAddress": "12606 NE 102nd Pl",
      "pm": "Chris S",
      "request": "Live On Market date has been pushed up to 6/4",
      "dateSubmitted": "6/2/2026"
    }
  ]
}`
          }
        ]
      }]
    });

    let text = response.content[0].text.trim();
    text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    const data = JSON.parse(text);
    res.status(200).json(data);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(422).json({ error: 'Could not parse order data. Try a clearer screenshot or crop just the tables.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}
