import { isDeepStrictEqual } from 'node:util';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
let db;
async function localDb() {
  if (db) return db;
  const { DatabaseSync } = await import('node:sqlite');
  if (db) return db;
  const dir = process.env.ANOVA_DATA_DIR || 'datos-privados';
  mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(join(dir, 'prospectos.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS prospectos (
    id TEXT PRIMARY KEY, fecha TEXT NOT NULL, respuestas TEXT NOT NULL, evaluaciones TEXT NOT NULL,
    minimo INTEGER NOT NULL, estado TEXT NOT NULL, causas TEXT NOT NULL, negocio TEXT, correo TEXT
  )`);
  
  if (!db.prepare('PRAGMA table_info(prospectos)').all().some(col => col.name === 'telefono')) {
    db.exec('ALTER TABLE prospectos ADD COLUMN telefono TEXT');
  }
  return db;
}

async function remote(method, query, body, prefer) {
  const response = await fetch(new URL('/rest/v1/prospectos?' + query, url), {
    method,
    headers: { apikey: key, 'Content-Type': 'application/json', Prefer: prefer },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Storage request failed');
  return response.status === 204 ? null : response.text();
}

const ideal = 'Ideal', revisar = 'Revisión manual', excluir = 'No califica';
const reglas = {
  ticket: { bajo100: excluir, '100a299': revisar, '300a1000': ideal, '1000a5000': revisar, sobre5000: excluir },
  capacidad: { suficiente: ideal, invertir: ideal, depende: revisar, sin_capacidad: excluir },
  cambios: { implementar: ideal, razonables: ideal, minimos: revisar, solo_publicidad: excluir }
};
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
function monto(value) {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) invalid('Revisa los montos en MXN.');
  return Number(value);
}
export function clasificar(data) {
  const ventas = monto(data.ventas), presupuesto = monto(data.presupuesto);
  const minimo = ventas > 170000 ? 10000 : 6000;
  const respuestas = { ventas, presupuesto };
  const evaluaciones = { ventas: ventas >= 100000 && ventas <= 250000 ? ideal : revisar, presupuesto: presupuesto >= minimo ? ideal : excluir };
  const causas = [];
  if (evaluaciones.ventas === revisar) causas.push(ventas < 50000 ? 'Facturación no prioritaria (< $50,000)' : 'Facturación fuera del intervalo ideal');
  if (evaluaciones.presupuesto === excluir) causas.push('Presupuesto inferior al mínimo de $' + minimo);
  for (const [key, opciones] of Object.entries(reglas)) {
    const value = data[key];
    if (typeof value !== 'string' || !Object.hasOwn(opciones, value)) invalid('Selecciona una opción válida en cada pregunta.');
    respuestas[key] = value;
    evaluaciones[key] = opciones[value];
    if (opciones[value] !== ideal) causas.push(key + ': ' + value + ' (' + opciones[value] + ')');
  }
  const estados = Object.values(evaluaciones);
  return { respuestas, evaluaciones, minimo, causas, estado: estados.includes(excluir) ? excluir : estados.includes(revisar) ? revisar : ideal };
}
export async function prospectos(req, res) {
  const send = (code, data) => res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }).end(JSON.stringify(data));
  try {
    if (req.method !== 'POST') return send(405, { error:'Método no permitido.' });
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error:'Se requiere JSON.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) return send(413, { error:'Solicitud demasiado extensa.' });
    }
    let data;
    try { data = JSON.parse(body); } catch { invalid('Solicitud inválida.'); }
    if (!data || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)) invalid('Identificador inválido.');
    const cloud = Boolean(url && key);
    if (!cloud && (url || key || process.env.VERCEL)) throw new Error('Supabase configuration required');
    const storage = cloud ? null : await localDb();
    if (req.url === '/api/contacto') {
      const telefono = typeof data.telefono === 'string' ? data.telefono.trim() : '';
      if (telefono.length > 32 || !/^\+?[\d\s().-]+$/.test(telefono) || !/^\d{7,15}$/.test(telefono.replace(/\D/g,'')) || typeof data.negocio !== 'string' || data.negocio.length > 140) invalid('Revisa el teléfono y el nombre del negocio.');
      const updated = cloud
        ? JSON.parse(await remote('PATCH', new URLSearchParams({ id: 'eq.' + data.id, estado: 'neq.' + excluir, select: 'id' }), { negocio: data.negocio.trim(), telefono }, 'return=representation')).length
        : storage.prepare('UPDATE prospectos SET negocio=?, telefono=? WHERE id=? AND estado!=?').run(data.negocio.trim(), telefono, data.id, excluir).changes;
      return updated ? send(200, { ok:true }) : send(404, { error:'Evaluación no disponible.' });
    }
    const r = clasificar(data);
    const answers = JSON.stringify(r.respuestas);
    let recorded;
    if (cloud) {
      await remote('POST', 'on_conflict=id', { id: data.id, ...r }, 'resolution=ignore-duplicates,return=minimal');
      const rows = JSON.parse(await remote('GET', new URLSearchParams({ id: 'eq.' + data.id, select: 'respuestas' }), undefined, 'return=representation'));
      recorded = rows[0]?.respuestas;
    } else {
      storage.prepare('INSERT OR IGNORE INTO prospectos(id,fecha,respuestas,evaluaciones,minimo,estado,causas) VALUES(?,?,?,?,?,?,?)').run(data.id,new Date().toISOString(),answers,JSON.stringify(r.evaluaciones),r.minimo,r.estado,JSON.stringify(r.causas));
      recorded = JSON.parse(storage.prepare('SELECT respuestas FROM prospectos WHERE id=?').get(data.id).respuestas);
    }
    if (!isDeepStrictEqual(recorded, r.respuestas)) return send(409,{error:'La evaluación ya fue registrada.'});
    let agenda = null;
    if (r.estado === ideal && process.env.ANOVA_AGENDA_URL?.startsWith('https://')) agenda = process.env.ANOVA_AGENDA_URL;
    send(200,{ estado:r.estado, agenda });
  } catch (err) { send(err.status || 500,{ error: err.status ? err.message : 'No se pudo guardar. Inténtalo nuevamente.' }); }
}