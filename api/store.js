// Shared team storage via Upstash Redis (Vercel Marketplace)
// Enable: Vercel project → Storage tab → Create Database → Upstash Redis (free)
// Env vars are injected automatically. Supports both naming schemes.
const TYPES = ['mainSignInstalls','safetySignInstalls','onMarketRiders','mainSignRemovals','urgentRequests'];

function redisCfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
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
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
        const all = await getRows(type);
        const row = all.find(r => r.id === id);
        if (!row) return res.status(404).json({ error: 'Row not found (refresh and retry)' });
        row[field] = value;
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
