// Supabase REST API proxy — no SDK, pure fetch
const TABLES = {
  mainSignInstalls:   'main_sign_installs',
  safetySignInstalls: 'safety_sign_installs',
  onMarketRiders:     'on_market_riders',
  mainSignRemovals:   'main_sign_removals'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not set.' });
  }

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const sb = (table, qs = '') =>
    `${url}/rest/v1/${table}${qs ? '?' + qs : ''}`;

  try {
    // GET /api/db?type=mainSignInstalls  → fetch all rows
    if (req.method === 'GET') {
      const table = TABLES[req.query.type];
      if (!table) return res.status(400).json({ error: 'Invalid type' });
      const r = await fetch(sb(table, 'select=*&order=created_at.asc'), { headers });
      const d = await r.json();
      return res.status(200).json({ rows: d });
    }

    // POST body: { action, type, rows?, id?, field?, value? }
    if (req.method === 'POST') {
      const { action, type, rows, id, field, value } = req.body;
      const table = TABLES[type];
      if (!table) return res.status(400).json({ error: 'Invalid type' });

      // INSERT multiple rows
      if (action === 'insert') {
        const now = new Date().toISOString();
        const payload = rows.map(r => ({ ...toDb(type, r), created_at: now }));
        const r = await fetch(sb(table), {
          method: 'POST', headers,
          body: JSON.stringify(payload)
        });
        const d = await r.json();
        return res.status(200).json({ success: true, inserted: d.length || rows.length, rows: d });
      }

      // UPDATE a single field on a row
      if (action === 'update') {
        const r = await fetch(sb(table, `id=eq.${id}`), {
          method: 'PATCH', headers,
          body: JSON.stringify({ [field]: value })
        });
        const d = await r.json();
        return res.status(200).json({ success: true, row: d[0] });
      }

      // DELETE a single row
      if (action === 'delete') {
        await fetch(sb(table, `id=eq.${id}`), { method: 'DELETE', headers });
        return res.status(200).json({ success: true });
      }

      // CLEAR entire table
      if (action === 'clear') {
        await fetch(sb(table, 'id=gt.0'), { method: 'DELETE', headers });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Map JS camelCase keys → Postgres snake_case columns
function toDb(type, r) {
  if (type === 'mainSignInstalls') return {
    number: r.number||'', project: r.project||'', city: r.city||'', pm: r.pm||'',
    possession_date: r.possessionDate||'', lao_name: r.laoName||'', lao_phone: r.laoPhone||'',
    date_completed: r.dateCompleted||'', notes: r.notes||'', cancelled: !!r.cancelled,
    added_date: r.addedDate || new Date().toLocaleDateString('en-US')
  };
  if (type === 'safetySignInstalls') return {
    number: r.number||'', project: r.project||'', city: r.city||'', pm: r.pm||'',
    construction_start_date: r.constructionStartDate||'', date_completed: r.dateCompleted||'',
    added_date: r.addedDate || new Date().toLocaleDateString('en-US')
  };
  if (type === 'onMarketRiders') return {
    number: r.number||'', project: r.project||'', pm: r.pm||'',
    listing_date: r.listingDate||'', date_completed: r.dateCompleted||'', notes: r.notes||'',
    added_date: r.addedDate || new Date().toLocaleDateString('en-US')
  };
  if (type === 'mainSignRemovals') return {
    number: r.number||'', project: r.project||'', pm: r.pm||'',
    remove_by_date: r.removeByDate||'', date_removed: r.dateRemoved||'',
    added_date: r.addedDate || new Date().toLocaleDateString('en-US')
  };
  return r;
}
