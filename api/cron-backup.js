// Friday auto-backup: emails CSVs of all order types.
// Requires env vars: RESEND_API_KEY (resend.com, free) + BACKUP_EMAIL_TO (comma-separated)
const TYPES = {
  mainSignInstalls: 'main-sign-installs',
  safetySignInstalls: 'safety-sign-installs',
  onMarketRiders: 'on-market-riders',
  mainSignRemovals: 'main-sign-removals',
  urgentRequests: 'urgent-requests',
  barricades: 'barricades'
};

function redisCfg() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
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
  return (await r.json()).result;
}

function toCSV(rows) {
  if (!rows.length) return 'no data';
  const keys = Object.keys(rows[0]).filter(k => k !== 'team_notes');
  const escape = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return [keys.join(','), ...rows.map(r => keys.map(k => escape(r[k])).join(','))].join('\n');
}

export default async function handler(req, res) {
  // Verify Vercel cron auth if CRON_SECRET is configured
  if (process.env.CRON_SECRET && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const to = (process.env.BACKUP_EMAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!resendKey || !to.length) {
    return res.status(200).json({ skipped: true, reason: 'Set RESEND_API_KEY and BACKUP_EMAIL_TO env vars to enable weekly backup emails.' });
  }

  const date = new Date().toLocaleDateString('en-US');
  const attachments = [];
  let total = 0;
  for (const [type, fname] of Object.entries(TYPES)) {
    const raw = await redis(['GET', 'mnos:' + type]);
    let rows = [];
    try { rows = JSON.parse(raw) || []; } catch {}
    total += rows.length;
    attachments.push({
      filename: `${fname}-${date.replace(/\//g, '-')}.csv`,
      content: Buffer.from(toCSV(rows)).toString('base64')
    });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MN Order Sync <onboarding@resend.dev>',
      to,
      subject: `MN Orders Weekly Backup — ${date} (${total} orders)`,
      text: `Automatic weekly backup from MN Order Sync.\n\n${total} total orders across all categories. CSVs attached.\n\nApp: https://mn-order-sync.vercel.app`,
      attachments
    })
  });

  if (!r.ok) return res.status(500).json({ error: 'Email failed: ' + await r.text() });
  res.status(200).json({ success: true, emailed: to, orders: total });
}
