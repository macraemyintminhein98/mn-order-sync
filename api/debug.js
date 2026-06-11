export default async function handler(req, res) {
  const env = process.env;
  const names = Object.keys(env);

  const redisVars = names.filter(k =>
    k.includes('KV_') || k.includes('UPSTASH') || k.includes('REDIS')
  ).sort();

  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    for (const k of names) {
      if (!url && k.endsWith('REST_API_URL')) url = env[k];
      if (!token && k.endsWith('REST_API_TOKEN') && !k.includes('READ_ONLY')) token = env[k];
    }
  }

  let redisPing = 'not attempted';
  if (url && token) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['PING'])
      });
      const d = await r.json();
      redisPing = d.result === 'PONG' ? 'PONG ✓ — Redis is working' : JSON.stringify(d);
    } catch (e) {
      redisPing = 'FAILED: ' + e.message;
    }
  }

  res.status(200).json({
    openrouter_key_present: !!env.OPENROUTER_API_KEY,
    redis_url_found: !!url,
    redis_token_found: !!token,
    redis_ping: redisPing,
    redis_related_env_var_names: redisVars,
    hint: !env.OPENROUTER_API_KEY
      ? 'OPENROUTER_API_KEY is missing — add it in Vercel env vars then Redeploy'
      : (!url || !token)
        ? 'Redis env vars missing — connect Upstash DB to THIS project, then Redeploy'
        : 'All good — if app still shows red, hard-refresh (Ctrl+Shift+R)'
  });
}
