// Tiny stand-in for Supabase (auth + a PostgREST subset) on top of real Postgres,
// so the real app, its security rules and triggers can be exercised end-to-end.
import http from 'node:http';
import pg from 'pg';
import busboy from 'busboy';
import crypto from 'node:crypto';
import ece from 'http_ece';

pg.types.setTypeParser(1082, (v) => v); // keep DATE as 'YYYY-MM-DD' like PostgREST
pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number like PostgREST
// timestamptz → ISO text with full precision, like PostgREST ("2026-10-06T10:00:00.123456+00:00")
pg.types.setTypeParser(1184, (v) => { let s = v.replace(' ', 'T'); if (/[+-]\d\d$/.test(s)) s += ':00'; return s; });

// ---------- storage stand-in: bytes in memory, permissions from storage.objects RLS ----------
const blobs = new Map();   // "bucket/name" -> { data: Buffer, type }
const tokens = new Map();  // token -> { bucket, name, until }
const storageErr = (res, status, message, error = 'Error') => send(res, 400, { statusCode: String(status), error, message });
function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
    let file = null;
    bb.on('file', (_name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => { file = { data: Buffer.concat(chunks), type: info.mimeType }; });
    });
    bb.on('close', () => resolve(file));
    bb.on('error', reject);
    req.pipe(bb);
  });
}
function signFor(bucket, name, expiresIn) {
  const token = crypto.randomBytes(12).toString('hex');
  tokens.set(token, { bucket, name, until: Date.now() + expiresIn * 1000 });
  return `/object/sign/${bucket}/${name}?token=${token}`;
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:54322/postgres' });
const PORT = Number(process.env.MOCK_PORT || 54321);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const makeJwt = (user) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp: now + 3600, iat: now })}.sig`;
};
const readJwt = (h) => {
  if (!h) return null;
  try {
    const p = JSON.parse(Buffer.from(h.replace(/^Bearer /, '').split('.')[1], 'base64url').toString());
    return p.sub ? p : null;
  } catch { return null; }
};
const userObj = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
  user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: 'email' },
  created_at: u.created_at, email_confirmed_at: u.created_at,
});
const session = (u) => ({
  access_token: makeJwt(u), token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt-' + u.id, user: userObj(u),
});

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range',
};
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : {})); });

const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error('bad identifier ' + s), { code: 'PGRST100' }); return `"${s}"`; };

function buildWhere(q, params) {
  const conds = [];
  for (const [k, v] of q.entries()) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const col = ident(k);
    let m = v.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.*)$/s);
    if (!m) throw Object.assign(new Error('unsupported filter ' + v), { code: 'PGRST100' });
    const [, not, op, val] = m;
    let c;
    if (op === 'is') c = `${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
    else if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      c = `${col} in (${items.map((x) => { params.push(x); return '$' + params.length; }).join(',')})`;
    } else {
      params.push(val);
      const sqlop = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }[op];
      c = `${col} ${sqlop} $${params.length}`;
    }
    conds.push(not ? `not (${c})` : c);
  }
  return conds.length ? ' where ' + conds.join(' and ') : '';
}
const buildSelect = (q) => {
  const s = q.get('select') || '*';
  return s === '*' ? '*' : s.split(',').map((c) => ident(c.trim())).join(',');
};
const buildOrder = (q) => {
  const o = q.get('order');
  if (!o) return '';
  return ' order by ' + o.split(',').map((part) => {
    const [c, ...mods] = part.split('.');
    return `${ident(c)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}`;
  }).join(', ');
};

async function asRole(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(claims ? 'set local role authenticated' : 'set local role anon');
    if (claims) await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, undefined, { 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*' });
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    // ---------------- auth ----------------
    if (path.startsWith('/auth/v1/')) {
      const ep = path.slice(9);
      if (ep === 'signup' && req.method === 'POST') {
        const b = await body(req);
        const exists = await pool.query('select 1 from auth.users where email=$1', [b.email]);
        if (exists.rowCount) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const { rows: [u] } = await pool.query('insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1,$2,$3) returning *', [b.email, b.password, b.data || {}]);
        return send(res, 200, session(u));
      }
      if (ep === 'token') {
        const b = await body(req);
        const gt = url.searchParams.get('grant_type');
        let u;
        if (gt === 'password') u = (await pool.query('select * from auth.users where email=$1 and encrypted_password=$2', [b.email, b.password])).rows[0];
        else if (gt === 'refresh_token') u = (await pool.query('select * from auth.users where id::text=$1', [String(b.refresh_token).replace(/^rt-/, '')])).rows[0];
        if (!u) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, session(u));
      }
      if (ep === 'user') {
        const claims = readJwt(req.headers.authorization);
        if (!claims) return send(res, 401, { code: 401, msg: 'invalid JWT' });
        if (req.method === 'PUT') {
          const b = await body(req);
          if (b.password) await pool.query('update auth.users set encrypted_password=$2 where id=$1', [claims.sub, b.password]);
        }
        const u = (await pool.query('select * from auth.users where id=$1', [claims.sub])).rows[0];
        return send(res, 200, userObj(u));
      }
      if (ep === 'logout') return send(res, 204);
      return send(res, 404, { msg: 'not mocked: ' + ep });
    }

    // ---------------- storage ----------------
    if (path.startsWith('/storage/v1/')) {
      const claims = readJwt(req.headers.authorization);
      const ep = decodeURIComponent(path.slice(12));
      // download through a signed link (no login needed, like Supabase)
      if (req.method === 'GET' && ep.startsWith('object/sign/')) {
        const t = tokens.get(url.searchParams.get('token'));
        if (!t || t.until < Date.now()) return storageErr(res, 400, 'Invalid signature', 'InvalidJWT');
        const blob = blobs.get(`${t.bucket}/${t.name}`);
        if (!blob) return storageErr(res, 404, 'Object not found', 'not_found');
        res.writeHead(200, { 'Content-Type': blob.type || 'application/octet-stream', ...cors });
        return res.end(blob.data);
      }
      if (req.method === 'POST' && ep.startsWith('object/sign/')) {
        const rest2 = ep.slice('object/sign/'.length);
        const b = await body(req);
        const [bucket, ...nameParts] = rest2.split('/');
        const names = nameParts.length ? [nameParts.join('/')] : b.paths;
        const visible = await asRole(claims, (c) => c.query('select name from storage.objects where bucket_id = $1 and name = any($2)', [bucket, names]));
        const ok = new Set(visible.rows.map((r) => r.name));
        if (nameParts.length) {
          if (!ok.has(names[0])) return storageErr(res, 404, 'Object not found', 'not_found');
          return send(res, 200, { signedURL: signFor(bucket, names[0], b.expiresIn) });
        }
        return send(res, 200, names.map((n) => ok.has(n)
          ? { path: n, signedURL: signFor(bucket, n, b.expiresIn), error: null }
          : { path: n, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }));
      }
      if (req.method === 'POST' && ep.startsWith('object/')) {
        const [bucket, ...nameParts] = ep.slice('object/'.length).split('/');
        const name = nameParts.join('/');
        const file = await readMultipart(req);
        if (!file) return storageErr(res, 400, 'No file');
        const lim = (await pool.query('select file_size_limit from storage.buckets where id = $1', [bucket])).rows[0];
        if (!lim) return storageErr(res, 404, 'Bucket not found', 'Bucket not found');
        if (lim.file_size_limit && file.data.length > Number(lim.file_size_limit)) return storageErr(res, 413, 'The object exceeded the maximum allowed size', 'Payload too large');
        try {
          const r = await asRole(claims, (c) => c.query(
            'insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4, $5) returning id',
            [bucket, name, claims?.sub ?? null, claims?.sub ?? null, JSON.stringify({ mimetype: file.type, size: file.data.length })]));
          blobs.set(`${bucket}/${name}`, file);
          return send(res, 200, { Id: r.rows[0].id, Key: `${bucket}/${name}` });
        } catch (e) {
          if (e.code === '23505') return storageErr(res, 409, 'The resource already exists', 'Duplicate');
          return storageErr(res, 403, e.message.includes('row-level security') ? 'new row violates row-level security policy' : e.message, 'Unauthorized');
        }
      }
      if (req.method === 'DELETE' && ep.startsWith('object/')) {
        const bucket = ep.slice('object/'.length);
        const b = await body(req);
        const r = await asRole(claims, (c) => c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name, id', [bucket, b.prefixes ?? []]));
        for (const row of r.rows) blobs.delete(`${bucket}/${row.name}`);
        return send(res, 200, r.rows.map((row) => ({ name: row.name, id: row.id, bucket_id: bucket })));
      }
      return send(res, 404, { message: 'storage not mocked: ' + ep });
    }

    // ---------------- test-only: fake phones for the phone-alert tests ----------------
    if (path === '/__test/push-device') return send(res, 200, newDevice());
    if (path === '/__test/push-inbox') return send(res, 200, inbox(url.searchParams.get('endpoint')));

    // ---------------- rest ----------------
    if (path.startsWith('/rest/v1/')) {
      const claims = readJwt(req.headers.authorization);
      const rest = path.slice(9);
      const single = (req.headers.accept || '').includes('vnd.pgrst.object');
      const prefer = req.headers.prefer || '';
      const wantRows = prefer.includes('return=representation');
      const wantCount = prefer.includes('count=exact');

      if (rest.startsWith('rpc/')) {
        const fn = ident(rest.slice(4));
        const b = req.method === 'POST' ? await body(req) : {};
        const keys = Object.keys(b);
        const call = `public.${fn}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(',')})`;
        const set = (await pool.query('select bool_or(proretset) as s from pg_proc where proname = $1', [fn.replace(/"/g, '')])).rows[0]?.s;
        const r = await asRole(claims, (c) => c.query(set ? `select coalesce(json_agg(t), '[]') as r from ${call} t` : `select to_json(${call}) as r`, keys.map((k) => b[k])));
        return send(res, 200, r.rows[0].r);
      }

      const table = `public.${ident(rest)}`;
      const params = [];
      let sql;
      if (req.method === 'GET') {
        sql = `select ${buildSelect(url.searchParams)} from ${table}${buildWhere(url.searchParams, params)}${buildOrder(url.searchParams)}`;
        if (url.searchParams.get('limit')) sql += ` limit ${Number(url.searchParams.get('limit'))}`;
        if (url.searchParams.get('offset')) sql += ` offset ${Number(url.searchParams.get('offset'))}`;
      } else if (req.method === 'POST') {
        const b = await body(req);
        const rows = Array.isArray(b) ? b : [b];
        const cols = Object.keys(rows[0]).map(ident);
        params.push(JSON.stringify(rows));
        sql = `insert into ${table} (${cols.join(',')}) select ${cols.join(',')} from json_populate_recordset(null::${table}, $1) returning ${buildSelect(url.searchParams)}`;
      } else if (req.method === 'PATCH') {
        const b = await body(req);
        const cols = Object.keys(b).map(ident);
        params.push(JSON.stringify(b));
        sql = `update ${table} set (${cols.join(',')}) = (select ${cols.join(',')} from json_populate_record(null::${table}, $1))${buildWhere(url.searchParams, params)} returning ${buildSelect(url.searchParams)}`;
        if (cols.length === 1) sql = sql.replace(`set (${cols[0]}) = (select`, `set ${cols[0]} = (select`);
      } else if (req.method === 'DELETE') {
        sql = `delete from ${table}${buildWhere(url.searchParams, params)} returning ${buildSelect(url.searchParams)}`;
      } else return send(res, 405, { message: 'method' });

      const r = await asRole(claims, (c) => c.query(sql, params));
      const headers = wantCount || req.method === 'GET' ? { 'Content-Range': `0-${Math.max(r.rowCount - 1, 0)}/${r.rowCount}` } : {};
      if (single) {
        if (r.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${r.rows.length} rows`, hint: null });
        return send(res, 200, r.rows[0], headers);
      }
      if (req.method !== 'GET' && !wantRows) return send(res, 204, undefined, headers);
      return send(res, req.method === 'POST' ? 201 : 200, r.rows, headers);
    }
    send(res, 404, { message: 'not found' });
  } catch (e) {
    const status = e.code === '42501' ? 403 : e.code === 'PGRST100' ? 400 : 400;
    send(res, status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
  }
});
server.listen(PORT, () => console.log('mock supabase on', PORT));

// ---------- pg_net + push services stand-in ----------
// The database "calls" the Edge Function through net.http_post (recorded in net.mock_requests). Here we run the
// REAL function code (supabase/functions/workspace-push/index.ts) on each request; its calls to Google/Apple are
// answered by fake phones that decrypt the alert with the reference decoder (http_ece), like a real phone would.
const devices = new Map();   // endpoint -> { ecdh, auth, got: [] }
function newDevice() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomBytes(6).toString('hex')}`;
  devices.set(endpoint, { ecdh, auth, got: [] });
  return { endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
}
const inbox = (endpoint) => devices.get(endpoint)?.got ?? [];

const fnPath = new URL('../../supabase/functions/workspace-push/index.ts', import.meta.url);
let pushFn = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const target = String(input?.url ?? input);
  const dev = devices.get(target);
  if (!target.startsWith('https://fcm.googleapis.com/')) return realFetch(input, init);
  if (!dev) return new Response('', { status: 410 });              // a phone that unsubscribed
  if (!/^vapid t=.+, k=/.test(init.headers?.Authorization ?? '')) return new Response('no vapid', { status: 403 });
  const plain = ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: dev.ecdh, authSecret: dev.auth });
  dev.got.push(JSON.parse(plain.toString('utf8')));
  return new Response('', { status: 201 });
};

async function deliverPushRequests() {
  try {
    const { rows } = await pool.query('update net.mock_requests set done = true where not done returning *');
    for (const r of rows) {
      let status = 404, content = '{"code":"NOT_FOUND","message":"Requested function was not found"}';
      if (r.url.endsWith('/functions/v1/workspace-push')) {
        pushFn ??= await import(fnPath.href);
        const out = await pushFn.handle(new Request(r.url, { method: 'POST', body: JSON.stringify(r.body) }));
        status = out.status;
        content = await out.text();
      }
      await pool.query('insert into net._http_response (id, status_code, content_type, content, timed_out) values ($1, $2, $3, $4, false) on conflict (id) do nothing',
        [r.id, status, 'application/json', content]);
    }
  } catch (e) {
    if (!/does not exist/.test(e.message)) console.error('push stand-in:', e.message);
  }
  setTimeout(deliverPushRequests, 250);
}
deliverPushRequests();
