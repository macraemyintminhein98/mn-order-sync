// Shared team storage via Upstash Redis (Vercel Marketplace)
// Enable: Vercel project → Storage tab → Create Database → Upstash Redis (free)
// Env vars are injected automatically. Supports both naming schemes.
const TYPES = ['mainSignInstalls','safetySignInstalls','onMarketRiders','mainSignRemovals','urgentRequests','barricades'];

// Editable columns per type (+ team_notes everywhere). Updates outside this list are rejected.
const EDITABLE = {
  mainSignInstalls: ['number','project','city','pm','possession_date','lao_name','lao_phone','date_completed','notes','cancelled','team_notes'],
  safetySignInstalls: ['number','project','city','pm','construction_start_date','date_completed','team_notes'],
  onMarketRiders: ['number','project','pm','listing_date','date_completed','notes','team_notes'],
  mainSignRemovals: ['number','project','pm','remove_by_date','date_removed','team_notes'],
  urgentRequests: ['number','street_address','pm','request','date_submitted','date_completed','team_notes'],
  barricades: ['number','project','pm','request','date_needed','date_submitted','date_completed','team_notes']
};

function cleanStr(v, max = 500) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}
function validNotes(v) {
  if (!Array.isArray(v)) return null;
  return v.slice(0, 100).map(n => ({
    by: cleanStr(n.by, 50),
    text: cleanStr(n.text, 500),
    at: cleanStr(n.at, 40)
  }));
}

// Per-IP rate limit (writes are cheap but cap anyway)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const h = hits.get(ip) || { n: 0, t: now };
  if (now - h.t > 60_000) { h.n = 0; h.t = now; }
  h.n++; hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.n > 120;
}

function redisCfg() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  // Auto-detect any prefix the Vercel/Upstash integration used (e.g. STORAGE_KV_REST_API_URL)
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!url && k.endsWith('REST_API_URL')) url = env[k];
      if (!token && k.endsWith('REST_API_TOKEN') && !k.includes('READ_ONLY')) token = env[k];
    }
  }
  return { url, token };
}

async function redis(cmd) {
  const { url, token } = redisCfg();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const d = await r.json();
  if (d.error) throw new Error('Redis: ' + d.error);
  return d.result;
}

const key = t => 'mnos:' + t;

async function getRows(type) {
  const raw = await redis(['GET', key(type)]);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
async function setRows(type, rows) {
  await redis(['SET', key(type), JSON.stringify(rows)]);
}

function toDb(type, r) {
  const added = r.addedDate || new Date().toLocaleDateString('en-US');
  if (type === 'mainSignInstalls') return { number:r.number||'', project:r.project||'', city:r.city||'', pm:r.pm||'', possession_date:r.possessionDate||'', lao_name:r.laoName||'', lao_phone:r.laoPhone||'', date_completed:r.dateCompleted||'', notes:r.notes||'', cancelled:!!r.cancelled, added_date:added };
  if (type === 'safetySignInstalls') return { number:r.number||'', project:r.project||'', city:r.city||'', pm:r.pm||'', construction_start_date:r.constructionStartDate||'', date_completed:r.dateCompleted||'', added_date:added };
  if (type === 'onMarketRiders') return { number:r.number||'', project:r.project||'', pm:r.pm||'', listing_date:r.listingDate||'', date_completed:r.dateCompleted||'', notes:r.notes||'', added_date:added };
  if (type === 'mainSignRemovals') return { number:r.number||'', project:r.project||'', pm:r.pm||'', remove_by_date:r.removeByDate||'', date_removed:r.dateRemoved||'', added_date:added };
  if (type === 'urgentRequests') return { number:r.number||'', street_address:r.streetAddress||'', pm:r.pm||'', request:r.request||'', date_submitted:r.dateSubmitted||'', date_completed:r.dateCompleted||'', added_date:added };
  if (type === 'barricades') return { number:r.number||'', project:r.project||'', pm:r.pm||'', request:r.request||'', date_needed:r.dateNeeded||'', date_submitted:r.dateSubmitted||'', date_completed:r.dateCompleted||'', added_date:added };
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests — slow down.' });

  const { url, token } = redisCfg();
  if (!url || !token) {
    return res.status(500).json({ error: 'Shared storage not enabled. In Vercel: Storage tab → Create Database → Upstash Redis → connect to this project → Redeploy.' });
  }

  try {
    if (req.method === 'GET') {
      const type = req.query.type;
      if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
      return res.status(200).json({ rows: await getRows(type) });
    }

    if (req.method === 'POST') {
      const { action, type, rows, id, field, value, raw } = req.body;
      if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });

      if (action === 'insert') {
        if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows' });
        if (rows.length > 500) return res.status(413).json({ error: 'Too many rows in one save (max 500)' });
        const all = await getRows(type);
        const end = await redis(['INCRBY', 'mnos:seq', rows.length]);
        const start = end - rows.length + 1;
        // raw=true means rows are already in snake_case (restore flow)
        const mapped = rows.map((r, i) => ({ ...(raw ? r : toDb(type, r)), id: start + i }));
        all.push(...mapped);
        await setRows(type, all);
        return res.status(200).json({ success: true, inserted: mapped.length });
      }

      if (action === 'update') {
        if (!EDITABLE[type].includes(field)) return res.status(400).json({ error: 'Field not editable: ' + field });
        const all = await getRows(type);
        const row = all.find(r => r.id === id);
        if (!row) return res.status(404).json({ error: 'Row not found (refresh and retry)' });
        if (field === 'team_notes') {
          const notes = validNotes(value);
          if (!notes) return res.status(400).json({ error: 'Invalid notes format' });
          row[field] = notes;
        } else if (field === 'cancelled') {
          row[field] = !!value;
        } else {
          row[field] = cleanStr(value);
        }
        await setRows(type, all);
        return res.status(200).json({ success: true });
      }

      if (action === 'delete') {
        const all = await getRows(type);
        await setRows(type, all.filter(r => r.id !== id));
        return res.status(200).json({ success: true });
      }

      if (action === 'clear') {
        await setRows(type, []);
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
