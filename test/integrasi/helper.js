'use strict';
/**
 * Helper test integrasi: menjalankan script di mongosh sungguhan.
 *
 * Default: mongosh di dalam container docker-compose (erp-trace-mongo).
 * Alternatif (mongosh terpasang lokal):
 *   MONGOSH_BIN=mongosh MONGO_URI_DASAR=mongodb://localhost:27018 npm run test:integrasi
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTAINER = process.env.TRACE_MONGO_CONTAINER || 'erp-trace-mongo';
const MONGOSH_BIN = process.env.MONGOSH_BIN || null;
const URI_DASAR = process.env.MONGO_URI_DASAR || (MONGOSH_BIN ? 'mongodb://localhost:27018' : 'mongodb://localhost:27017');

function jalankanMongosh(script, db, opsi = {}) {
  const uri = URI_DASAR.replace(/\/+$/, '') + '/' + db;
  let r;
  if (MONGOSH_BIN) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trace-')), 'script.js');
    fs.writeFileSync(tmp, script);
    r = spawnSync(MONGOSH_BIN, ['--quiet', uri, '--file', tmp], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } else {
    r = spawnSync('docker', ['exec', '-i', CONTAINER, 'mongosh', '--quiet', uri, '--file', '/dev/stdin'], {
      input: script,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  if (r.error) throw r.error;
  const hasil = { kode: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  if (!opsi.bolehGagal && hasil.kode !== 0) {
    throw new Error('mongosh gagal (exit ' + hasil.kode + '):\n' + hasil.stdout + '\n' + hasil.stderr);
  }
  return hasil;
}

function pastikanMongo() {
  try {
    const r = jalankanMongosh("print(db.runCommand({ ping: 1 }).ok)", 'admin');
    if (r.stdout.trim() !== '1') throw new Error(r.stdout);
  } catch (e) {
    throw new Error(
      'MongoDB untuk test belum siap. Jalankan dulu: npm run db:up\n(detail: ' + e.message.split('\n')[0] + ')'
    );
  }
}

function seed(db, data) {
  const script = [
    'db.dropDatabase();',
    'var DATA = EJSON.parse(' + JSON.stringify(JSON.stringify(data)) + ', { relaxed: false });',
    'for (var k in DATA) { db.getCollection(k).insertMany(DATA[k]); }',
    "print('seed-ok');",
  ].join('\n');
  const r = jalankanMongosh(script, db);
  if (!r.stdout.includes('seed-ok')) throw new Error('Seed gagal:\n' + r.stdout + r.stderr);
}

function ambilJSON(stdout) {
  const awal = '__TRACE_JSON_BEGIN__';
  const akhir = '__TRACE_JSON_END__';
  const a = stdout.indexOf(awal);
  const b = stdout.indexOf(akhir, a);
  if (a < 0 || b < 0) throw new Error('Penanda JSON tidak ditemukan di output:\n' + stdout);
  return JSON.parse(stdout.slice(a + awal.length, b));
}

function bacaDist(tool) {
  return fs.readFileSync(path.join(ROOT, 'dist', tool + '.js'), 'utf8');
}

/** Jalankan file dist dengan override CONFIG/MAPPING (lewat variabel global __TRACE_OVERRIDE__) */
function jalankanTool(tool, db, override, opsi) {
  const script = 'var __TRACE_OVERRIDE__ = ' + JSON.stringify(override || {}) + ';\n' + bacaDist(tool);
  return jalankanMongosh(script, db, opsi);
}

module.exports = { ROOT, jalankanMongosh, pastikanMongo, seed, ambilJSON, bacaDist, jalankanTool };
