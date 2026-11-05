'use strict';
/**
 * dist/00-profil-skema.js dijalankan di mongosh terhadap data dummy.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');
const data = require('../fixtures/data-uji');
const mappingUji = require('../fixtures/mapping-uji');
const { INT, DBL } = require('../fixtures/ejson');

const DB = 'erp_trace_uji_profil';

const dataBersarang = {
  uji_bersarang: [
    {
      info: { gudang: 'G1', lokasi: { rak: 'A-01' } },
      detail: [{ kode: 'X', qty: INT(1) }, { kode: 'Y', qty: DBL(2.5) }],
      tags: ['a', 'b'],
    },
  ],
};

function profil(config) {
  const r = h.jalankanTool('00-profil-skema', DB, { CONFIG: Object.assign({ FORMAT: 'json' }, config) });
  return h.ambilJSON(r.stdout).hasil;
}

const perKoleksi = (hasil) => Object.fromEntries(hasil.koleksi.map((k) => [k.koleksi, k]));
const perField = (koleksi) => Object.fromEntries(koleksi.field.map((f) => [f.path, f]));

before(() => {
  h.pastikanMongo();
  h.seed(DB, Object.assign({}, data, dataBersarang));
});

test('tipe persis dari server, pola tersamar, enum hanya untuk variasi sedikit', () => {
  const hasil = profil({ KOLEKSI: ['uji_incomingdetail', 'uji_penyesuaiandetail', 'uji_IncomingDetail'], ENUM_MAKS: 3 });
  const k = perKoleksi(hasil);

  const inc = perField(k.uji_incomingdetail);
  assert.equal(k.uji_incomingdetail.sampel, 8);
  assert.deepEqual(inc.qty.tipe, { double: 2, int: 4, string: 2 });
  assert.equal(inc.qty.tipeSumber, 'server');
  assert.deepEqual(inc.tanggal.info.jam[0], { nilai: '00:00', jumlah: 6 });
  assert.equal(inc.tanggal.info.tanggalMin, '2025-11-01');
  assert.equal(inc.tanggal.info.tanggalMax, '2025-12-01');
  assert.equal(inc.kodeBarang.info.spasiTepi, 1);
  assert.deepEqual(inc.kodeBarang.info.pola, [{ nilai: 'AA-999', jumlah: 7 }, { nilai: 'AA-999 ', jumlah: 1 }]);
  assert.equal(inc.kodeBarang.info.nilai, undefined, '4 nilai unik > ENUM_MAKS 3 -> disamarkan');
  assert.deepEqual(inc.status.info.nilai, [{ nilai: 'POSTED', jumlah: 7 }, { nilai: 'DRAFT', jumlah: 1 }]);
  assert.deepEqual(inc.noAju.info.pola, [{ nilai: '999999', jumlah: 8 }]);
  assert.equal(inc.noAju.info.nilai, undefined, 'nilai unik semua -> bukan enum');
  assert.equal(inc.idAsal.ada, 1);
  assert.equal(inc.idAsal.adaPersen, 12.5);
  assert.deepEqual(inc.idAsal.tipe, { null: 1 });

  const adj = perField(k.uji_penyesuaiandetail);
  assert.deepEqual(adj.idHeader.info.pola, [{ nilai: '<hex24>', jumlah: 4 }]);
  assert.equal(adj.jenis.info.spasiTepi, 1);

  assert.equal(k.uji_IncomingDetail.ada, false);
  assert.deepEqual(k.uji_IncomingDetail.kandidat, ['uji_incomingdetail']);
});

test('TAMPILKAN_ENUM false -> semua string disamarkan', () => {
  const hasil = profil({ KOLEKSI: ['uji_incomingdetail'], TAMPILKAN_ENUM: false });
  const inc = perField(hasil.koleksi[0]);
  assert.equal(inc.status.info.nilai, undefined);
  assert.deepEqual(inc.status.info.pola, [{ nilai: 'AAAAAA', jumlah: 7 }, { nilai: 'AAAAA', jumlah: 1 }]);
  assert.equal(inc.companyCode.info.nilai, undefined);
});

test('field bersarang & array ditelusuri', () => {
  const f = perField(profil({ KOLEKSI: ['uji_bersarang'] }).koleksi[0]);
  assert.deepEqual(f['info.lokasi.rak'].info.pola, [{ nilai: 'A-99', jumlah: 1 }]);
  assert.equal(f['info.gudang'].tipeSumber, 'server');
  assert.deepEqual(f.detail.tipe, { array: 1 });
  assert.deepEqual(f.detail.info.panjangArray, { min: 2, max: 2 });
  assert.deepEqual(f['detail[].qty'].tipe, { 'int/double': 2 });
  assert.equal(f['detail[].qty'].tipeSumber, 'klien');
  assert.equal(f['detail[].qty'].info.pecahan, 1);
  assert.deepEqual(f['tags[]'].tipe, { string: 2 });
});

test('KOLEKSI kosong -> pakai semua koleksi dari MAPPING (termasuk header)', () => {
  const r = h.jalankanTool('00-profil-skema', DB, { MAPPING: mappingUji, CONFIG: { FORMAT: 'json' } });
  const hasil = h.ambilJSON(r.stdout).hasil;
  assert.deepEqual(hasil.koleksi.map((k) => [k.koleksi, k.ada]), [
    ['uji_incomingdetail', true],
    ['uji_materialkeluardetail', true],
    ['uji_koreksi', true],
    ['uji_penyesuaiandetail', true],
    ['uji_penyesuaianheader', true],
  ]);
});

test('MODE_SAMPEL acak & batas sampel', () => {
  const hasil = profil({ KOLEKSI: ['uji_incomingdetail'], MODE_SAMPEL: 'acak' });
  assert.equal(hasil.koleksi[0].sampel, 8);
  const r = h.jalankanTool('00-profil-skema', DB, { CONFIG: { SAMPEL: 99999 } }, { bolehGagal: true });
  assert.notEqual(r.kode, 0);
  assert.match(r.stdout + r.stderr, /CONFIG\.SAMPEL maksimal 5000/);
});

test('aman dijalankan dua kali di sesi yang sama (paste ulang) & format teks', () => {
  const sekali = 'var __TRACE_OVERRIDE__ = ' + JSON.stringify({ CONFIG: { KOLEKSI: ['uji_incomingdetail'] } }) + ';\n' + h.bacaDist('00-profil-skema');
  const r = h.jalankanMongosh(sekali + '\n' + sekali + "\nprint('jumlah koleksi: ' + TRACE_HASIL.hasil.koleksi.length);", DB);
  assert.equal((r.stdout.match(/ERP Trace Mutation \| 00-profil-skema/g) || []).length, 2);
  assert.match(r.stdout, /--- uji_incomingdetail/);
  assert.match(r.stdout, /FIELD\s+ADA\s+TIPE\s+INFO/);
  assert.match(r.stdout, /jumlah koleksi: 1/);
});
