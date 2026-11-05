'use strict';
/**
 * dist/00-peta-data.js dijalankan di mongosh terhadap data dummy berbentuk mirip erpgarment.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');
const { data, ids } = require('../fixtures/data-peta');

const DB = 'erp_trace_uji_peta';

const CONFIG_UJI = {
  FORMAT: 'json',
  COMPANY_CODE: 'WAG',
  DISTRIBUSI: [
    { koleksi: 'tbl_stok', grup: ['asal', 'jenis'], jumlah: 'qty', tanggal: 'tanggal' },
    { koleksi: 'tbl_stok', grup: [{ label: 'punya _class', expr: { $ne: [{ $type: '$_class' }, 'missing'] } }] },
    { koleksi: 'tbl_stok', grup: ['infoProses'] },
    {
      koleksi: 'tbl_barangmasukdetail',
      grup: [
        { label: 'qty = qtyWh', expr: { $eq: ['$qty', '$qtyWh'] } },
        { label: 'satuan = satuanWh', expr: { $eq: ['$satuan', '$satuanWh'] } },
      ],
    },
    { koleksi: 'tbl_materialkeluardetail', grup: ['approveStatus', 'isDeleted'], jumlah: 'qtyKeluarOk', tanggal: 'tglKeluar' },
    { koleksi: 'tbl_IncomingDetail', grup: ['idDokumen'] },
  ],
  RELASI: [
    { koleksi: 'tbl_incomingdetail', field: 'idAsal' },
    { koleksi: 'tbl_materialkeluardetail', field: 'idAsal' },
    { koleksi: 'tbl_materialkeluardetail', field: 'idPenyesuaian' },
    { koleksi: 'tbl_stok', field: 'idAsal', perNilai: 'asal' },
    { koleksi: 'tbl_tidakada', field: 'idAsal' },
  ],
  TARGET_TERTANAM: [{ koleksi: 'tbl_incomingheader', path: 'listDetail._id' }],
};

function peta(config) {
  const r = h.jalankanTool('00-peta-data', DB, { CONFIG: Object.assign({}, CONFIG_UJI, config) });
  return h.ambilJSON(r.stdout).hasil;
}

const distribusi = (hasil, koleksi, label) =>
  hasil.distribusi.find((d) => d.koleksi === koleksi && (!label || d.grup.join('|') === label));
const relasi = (hasil, koleksi, field, nilaiPer) =>
  hasil.relasi.find((r) => r.koleksi === koleksi && r.field === field && (nilaiPer === undefined || (r.perNilai && r.perNilai.nilai === nilaiPer)));
const target = (r) => Object.fromEntries(r.ditemukan.map((t) => [t.target, t.jumlah]));

before(() => {
  h.pastikanMongo();
  h.seed(DB, data);
});

test('distribusi: kombinasi nilai, total qty, rentang tanggal, filter companyCode', () => {
  const hasil = peta();
  assert.equal(hasil.companyCode, 'WAG');

  const stok = distribusi(hasil, 'tbl_stok', 'asal|jenis');
  assert.equal(stok.totalDok, 4, 'dokumen NGI tidak ikut');
  const per = Object.fromEntries(stok.kombinasi.map((k) => [k.nilai.join('/'), k]));
  assert.equal(per['MATERIALOUT/OUT'].dok, 2);
  assert.equal(per['MATERIALOUT/OUT'].total, 50);
  assert.equal(per['INCOMING/IN'].total, 220);
  assert.equal(per['INCOMING/IN'].tglMin, '2025-11-01T03:00:00.000Z');

  const kelas = distribusi(hasil, 'tbl_stok', 'punya _class');
  assert.deepEqual(Object.fromEntries(kelas.kombinasi.map((k) => [String(k.nilai[0]), k.dok])), { true: 1, false: 3 });

  const kosong = distribusi(hasil, 'tbl_stok', 'infoProses');
  assert.deepEqual(kosong.kombinasi.map((k) => [k.nilai[0], k.dok]), [[null, 4]], 'field yang tidak ada = satu grup (kosong)');

  const banding = distribusi(hasil, 'tbl_barangmasukdetail');
  assert.deepEqual(
    banding.kombinasi.map((k) => k.nilai.join('/')).sort(),
    ['false/false', 'true/true'],
    'ekspresi pembanding qty & satuan'
  );

  const mk = distribusi(hasil, 'tbl_materialkeluardetail');
  const perMk = Object.fromEntries(mk.kombinasi.map((k) => [k.nilai.join('/'), k]));
  assert.equal(perMk['Received/false'].total, 50);
  assert.equal(perMk['Pending/true'].dok, 1);

  const salah = distribusi(hasil, 'tbl_IncomingDetail');
  assert.equal(salah.ada, false);
  assert.ok(salah.kandidat.includes('tbl_incomingdetail'));
});

test('relasi: id ditelusuri ke koleksi tujuan (top-level & listDetail tertanam)', () => {
  const hasil = peta();

  const inc = relasi(hasil, 'tbl_incomingdetail', 'idAsal');
  assert.equal(inc.sampel, 2, 'hanya WAG');
  assert.deepEqual(target(inc), { tbl_barangmasukdetail: 2 });
  assert.equal(inc.tidakDitemukan, 0);

  const mk = relasi(hasil, 'tbl_materialkeluardetail', 'idAsal');
  assert.equal(mk.sampel, 3);
  assert.deepEqual(target(mk), { tbl_incomingdetail: 2, 'tbl_incomingheader.listDetail': 1 });
  assert.equal(mk.tidakDitemukan, 1, 'idAsal yang menunjuk dokumen hilang');

  const mo = relasi(hasil, 'tbl_stok', 'idAsal', 'MATERIALOUT');
  assert.deepEqual(target(mo), { tbl_materialkeluardetail: 2 });

  const masuk = relasi(hasil, 'tbl_stok', 'idAsal', 'INCOMING');
  assert.equal(masuk.sampel, 2);
  assert.equal(masuk.hex24, 2, 'idAsal bertipe ObjectId maupun string hex dikenali');
  assert.deepEqual(target(masuk), { tbl_incomingdetail: 2, 'tbl_incomingheader.listDetail': 1 });

  assert.equal(relasi(hasil, 'tbl_materialkeluardetail', 'idPenyesuaian').sampel, 0);
  assert.equal(relasi(hasil, 'tbl_tidakada', 'idAsal').ada, false);
});

test('tanpa filter companyCode: id bukan ObjectId dilaporkan tidak ditemukan', () => {
  const masuk = relasi(peta({ COMPANY_CODE: null }), 'tbl_stok', 'idAsal', 'INCOMING');
  assert.equal(masuk.sampel, 3);
  assert.equal(masuk.hex24, 2);
  assert.equal(masuk.tidakDitemukan, 1);
});

test('TARGET_RELASI dibatasi & target yang tidak ada dicatat', () => {
  const hasil = peta({ TARGET_RELASI: ['tbl_incomingdetail', 'tbl_salah'], TARGET_TERTANAM: [] });
  const mk = relasi(hasil, 'tbl_materialkeluardetail', 'idAsal');
  assert.deepEqual(target(mk), { tbl_incomingdetail: 2 });
  assert.equal(hasil.jumlahTargetRelasi, 1);
  assert.ok(hasil.catatan.some((c) => c.includes('tbl_salah')));
});

test('CONFIG bawaan (preset erpgarment) jalan walau banyak koleksi tidak ada, format teks', () => {
  const r = h.jalankanTool('00-peta-data', DB, {});
  assert.match(r.stdout, /--- tbl_stok: asal x jenis x namaProses x infoProses/);
  assert.match(r.stdout, /tbl_materialkeluardetail\.idAsal \| sampel 3 nilai/);
  assert.match(r.stdout, /tidak ditemukan di mana pun/);
  assert.match(r.stdout, /TIDAK DITEMUKAN/);
});

test('CONFIG salah -> gagal dengan pesan jelas', () => {
  const r = h.jalankanTool('00-peta-data', DB, { CONFIG: { SAMPEL_RELASI: 5000 } }, { bolehGagal: true });
  assert.notEqual(r.kode, 0);
  assert.match(r.stdout + r.stderr, /CONFIG\.SAMPEL_RELASI harus bilangan bulat 1-1000/);
  const r2 = h.jalankanTool('00-peta-data', DB, { CONFIG: { DISTRIBUSI: [{ koleksi: 'x', grup: [] }] } }, { bolehGagal: true });
  assert.match(r2.stdout + r2.stderr, /DISTRIBUSI\[0\] wajib punya koleksi/);
});

test('tool tanpa mapping: header tidak menampilkan status mapping', () => {
  const r = h.jalankanTool('00-peta-data', DB, { CONFIG: { RELASI: [], DISTRIBUSI: [{ koleksi: 'tbl_stok', grup: ['asal'] }] } });
  assert.doesNotMatch(r.stdout, /Mapping :/);
  const j = h.jalankanTool('00-peta-data', DB, { CONFIG: { FORMAT: 'json', RELASI: [], DISTRIBUSI: [{ koleksi: 'tbl_stok', grup: ['asal'] }] } });
  assert.equal(h.ambilJSON(j.stdout).meta.statusMapping, null);
});

test('fixture konsisten dengan id yang dipakai test', () => {
  assert.equal(ids.INC1.length, 24);
  assert.equal(ids.HILANG.length, 24);
});
