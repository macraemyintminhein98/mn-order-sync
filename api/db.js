// Supabase REST proxy with proper error surfacing
const TABLES = {
  mainSignInstalls:   'main_sign_installs',
  safetySignInstalls: 'safety_sign_installs',
  onMarketRiders:     'on_market_riders',
  mainSignRemovals:   'main_sign_removals',
  urgentRequests:     'urgent_requests'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not set in Vercel environment variables.' });
  }

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const sb = (table, qs = '') => `${url.replace(/\/$/, '')}/rest/v1/${table}${qs ? '?' + qs : ''}`;

  // Helper: parse Supabase response, surface real errors
  async function parse(r) {
    const text = await r.text();
    let d;
    try { d = text ? JSON.parse(text) : null; } catch { d = null; }
    if (!r.ok) {
      const msg = d?.message || d?.hint || text || `HTTP ${r.status}`;
      const friendly = /relation .* does not exist/i.test(msg)
        ? 'Tables not created yet — run the SQL from Settings tab in Supabase SQL Editor.'
        : msg;
      throw new Error(friendly);
    }
    return d;
  }

  try {
    if (req.method === 'GET') {
      const table = TABLES[req.query.type];
      if (!table) return res.status(400).json({ error: 'Invalid type' });
      const r = await fetch(sb(table, 'select=*&order=created_at.asc'), { headers });
      const d = await parse(r);
      return res.status(200).json({ rows: Array.isArray(d) ? d : [] });
    }

    if (req.method === 'POST') {
      const { action, type, rows, id, field, value } = req.body;
      const table = TABLES[type];
      if (!table) return res.status(400).json({ error: 'Invalid type' });

      if (action === 'insert') {
        if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows to insert' });
        const now = new Date().toISOString();
        const payload = rows.map(r => ({ ...toDb(type, r), created_at: now }));
        const r = await fetch(sb(table), { method: 'POST', headers, body: JSON.stringify(payload) });
        const d = await parse(r);
        return res.status(200).json({ success: true, inserted: Array.isArray(d) ? d.length : rows.length, rows: d });
      }

      if (action === 'update') {
        if (!id || !field) return res.status(400).json({ error: 'Missing id or field' });
        // whitelist editable columns to prevent junk writes
        const r = await fetch(sb(table, `id=eq.${encodeURIComponent(id)}`), {
          method: 'PATCH', headers, body: JSON.stringify({ [field]: value })
        });
        const d = await parse(r);
        return res.status(200).json({ success: true, row: Array.isArray(d) ? d[0] : d });
      }

      if (action === 'delete') {
        if (!id) return res.status(400).json({ error: 'Missing id' });
        const r = await fetch(sb(table, `id=eq.${encodeURIComponent(id)}`), { method: 'DELETE', headers });
        await parse(r);
        return res.status(200).json({ success: true });
      }

      if (action === 'clear') {
        const r = await fetch(sb(table, 'id=gt.0'), { method: 'DELETE', headers });
        await parse(r);
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function toDb(type, r) {
  const added = r.addedDate || new Date().toLocaleDateString('en-US');
  if (type === 'mainSignInstalls') return {
    number: r.number||'', project: r.project||'', city: r.city||'', pm: r.pm||'',
    possession_date: r.possessionDate||'', lao_name: r.laoName||'', lao_phone: r.laoPhone||'',
    date_completed: r.dateCompleted||'', notes: r.notes||'', cancelled: !!r.cancelled, added_date: added
  };
  if (type === 'safetySignInstalls') return {
    number: r.number||'', project: r.project||'', city: r.city||'', pm: r.pm||'',
    construction_start_date: r.constructionStartDate||'', date_completed: r.dateCompleted||'', added_date: added
  };
  if (type === 'onMarketRiders') return {
    number: r.number||'', project: r.project||'', pm: r.pm||'',
    listing_date: r.listingDate||'', date_completed: r.dateCompleted||'', notes: r.notes||'', added_date: added
  };
  if (type === 'mainSignRemovals') return {
    number: r.number||'', project: r.project||'', pm: r.pm||'',
    remove_by_date: r.removeByDate||'', date_removed: r.dateRemoved||'', added_date: added
  };
  if (type === 'urgentRequests') return {
    number: r.number||'', street_address: r.streetAddress||'', pm: r.pm||'',
    request: r.request||'', date_submitted: r.dateSubmitted||'', date_completed: r.dateCompleted||'', added_date: added
  };
  return r;
}
