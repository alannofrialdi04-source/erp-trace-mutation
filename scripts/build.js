#!/usr/bin/env node
/**
 * Build: gabungkan CONFIG + MAPPING + lib + tool jadi SATU file per tool di dist/,
 * supaya bisa dijalankan dengan `mongosh --file` atau di-paste ke shell tanpa require/load.
 *
 *   node scripts/build.js          -> tulis dist/
 *   node scripts/build.js --check  -> gagal bila dist/ tidak sama dengan hasil build
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIR_TOOL = path.join(ROOT, 'src', 'tools');
const DIR_DIST = path.join(ROOT, 'dist');
const URUTAN_LIB = ['tanggal', 'teks', 'tabel', 'bson', 'mapping', 'sumber', 'runner'];

const REGION_NODE = /[ \t]*\/\/ #region node-only\n[\s\S]*?\/\/ #endregion[ \t]*\n?/g;
const REGION_CONFIG = /\/\/ #region config\n([\s\S]*?)\/\/ #endregion[ \t]*\n?/;

function baca(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

function sumberMapping() {
  const file = path.join(ROOT, 'config', 'mapping.js');
  const src = baca(file);
  const jumlah = (src.match(/module\.exports\s*=/g) || []).length;
  if (jumlah !== 1) throw new Error('config/mapping.js harus punya tepat satu "module.exports =" (ditemukan ' + jumlah + ')');
  if (/\brequire\s*\(/.test(src)) throw new Error('config/mapping.js tidak boleh memakai require()');
  return src.replace(/module\.exports\s*=/, 'var MAPPING =').trim();
}

function sumberLib() {
  return URUTAN_LIB.map((nama) => {
    const src = baca(path.join(ROOT, 'src', 'lib', nama + '.js')).replace(REGION_NODE, '').trim();
    return '// ---- src/lib/' + nama + '.js ----\n' + src;
  }).join('\n\n');
}

function metaTool(src, file) {
  const doc = /^\/\*\*([\s\S]*?)\*\//.exec(src);
  if (!doc) throw new Error(file + ': wajib diawali blok komentar /** @nama ... @judul ... */');
  const ambil = (tag) => {
    const m = new RegExp('@' + tag + '[ \\t]+(.+)').exec(doc[1]);
    return m ? m[1].trim() : null;
  };
  const nama = ambil('nama');
  const judul = ambil('judul');
  if (!nama || !judul) throw new Error(file + ': tag @nama dan @judul wajib ada');
  if (nama + '.js' !== file) throw new Error(file + ': @nama (' + nama + ') harus sama dengan nama file');
  const tagMapping = ambil('mapping');
  if (tagMapping !== null && tagMapping !== 'tidak') throw new Error(file + ': @mapping hanya boleh bernilai "tidak"');
  return { nama, judul, pakaiMapping: tagMapping !== 'tidak', sisa: src.slice(doc[0].length) };
}

function cekNamaGanda(kode, file) {
  const lihat = (re, jenis) => {
    const sudah = new Set();
    let m;
    while ((m = re.exec(kode)) !== null) {
      if (sudah.has(m[1])) throw new Error(file + ': ' + jenis + ' "' + m[1] + '" didefinisikan lebih dari sekali di level atas');
      sudah.add(m[1]);
    }
  };
  lihat(/^function\s+([A-Za-z_$][\w$]*)/gm, 'function');
  lihat(/^var\s+([A-Za-z_$][\w$]*)/gm, 'var');
}

function kepala(meta, versi) {
  return [
    '/*',
    ' * ============================================================================',
    ' *  ERP Trace Mutation | ' + meta.nama + ' | v' + versi,
    ' *  ' + meta.judul,
    ' * ----------------------------------------------------------------------------',
    ' *  FILE HASIL BUILD. Yang boleh diedit hanya blok KONFIGURASI di bawah.',
    ' *  Kode sumber: src/tools/' + meta.nama + '.js | mapping: config/mapping.js',
    ' *  Setelah mengubah sumber/mapping jalankan `npm run build`.',
    ' *',
    ' *  Cara pakai:',
    ' *    mongosh "<connection-string>/<database>" --file dist/' + meta.nama + '.js',
    ' *    atau di dalam mongosh : load("dist/' + meta.nama + '.js")',
    ' *    atau paste seluruh isi file ini ke shell.',
    ' *  Hasil lengkap tersimpan di variabel TRACE_HASIL.',
    ' *',
    ' *  READ-ONLY: script ini hanya membaca data (find / aggregate).',
    ' * ============================================================================',
    ' */',
  ].join('\n');
}

function bangunTool(file, versi, lib, mapping) {
  const src = baca(path.join(DIR_TOOL, file));
  const meta = metaTool(src, file);
  const cfg = REGION_CONFIG.exec(meta.sisa);
  if (!cfg) throw new Error(file + ': blok "// #region config" ... "// #endregion" tidak ditemukan');
  const badan = meta.sisa.replace(REGION_CONFIG, '').replace(REGION_NODE, '').trim();
  if (!/^function\s+jalankan\s*\(/m.test(badan)) throw new Error(file + ': function jalankan(config, mapping, ctx) wajib ada');
  if (!/^function\s+render\s*\(/m.test(badan)) throw new Error(file + ': function render(hasil, ctx, config) wajib ada');

  const isi = [
    '// ======================= KONFIGURASI (silakan edit) =========================',
    cfg[1].trim(),
    '',
    '// =================== MAPPING (dari config/mapping.js) ========================',
    mapping,
    '',
    '// =============================== LIB =========================================',
    lib,
    '',
    '// ======================= TOOL (src/tools/' + file + ') ==========================',
    badan,
  ].join('\n');
  cekNamaGanda(isi, file);

  const info = { nama: meta.nama, judul: meta.judul, versi: versi, pakaiMapping: meta.pakaiMapping };
  return [
    kepala(meta, versi),
    'var TRACE_HASIL = (function () {',
    "'use strict';",
    '',
    isi,
    '',
    'return jalankanTool(' + JSON.stringify(info) + ', CONFIG, MAPPING, jalankan, render);',
    '})();',
    '',
  ].join('\n');
}

/** Hasil: { 'nama-tool.js': isiFile } */
function bangunSemua() {
  const versi = JSON.parse(baca(path.join(ROOT, 'package.json'))).version;
  const lib = sumberLib();
  const mapping = sumberMapping();
  const hasil = {};
  const files = fs.readdirSync(DIR_TOOL).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) hasil[f] = bangunTool(f, versi, lib, mapping);
  return hasil;
}

function main() {
  const cekSaja = process.argv.includes('--check');
  const hasil = bangunSemua();
  const ada = fs.existsSync(DIR_DIST) ? fs.readdirSync(DIR_DIST).filter((f) => f.endsWith('.js')) : [];

  if (cekSaja) {
    const masalah = [];
    for (const [f, isi] of Object.entries(hasil)) {
      const p = path.join(DIR_DIST, f);
      if (!fs.existsSync(p)) masalah.push('dist/' + f + ' belum ada');
      else if (baca(p) !== isi) masalah.push('dist/' + f + ' tidak sesuai sumber');
    }
    for (const f of ada) if (!hasil[f]) masalah.push('dist/' + f + ' tidak punya sumber di src/tools');
    if (masalah.length) {
      console.error('dist/ belum diperbarui:\n  - ' + masalah.join('\n  - ') + '\nJalankan: npm run build');
      process.exit(1);
    }
    console.log('dist/ sudah sesuai sumber (' + Object.keys(hasil).length + ' file).');
    return;
  }

  fs.mkdirSync(DIR_DIST, { recursive: true });
  for (const f of ada) if (!hasil[f]) fs.unlinkSync(path.join(DIR_DIST, f));
  for (const [f, isi] of Object.entries(hasil)) fs.writeFileSync(path.join(DIR_DIST, f), isi);
  console.log('Build selesai: ' + Object.keys(hasil).map((f) => 'dist/' + f).join(', '));
}

module.exports = { bangunSemua };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('Build gagal: ' + e.message);
    process.exit(1);
  }
}
