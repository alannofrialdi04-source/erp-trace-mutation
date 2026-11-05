'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bangunPipelineSumber, filterDiHeader } = require('../../src/lib/sumber');
const { rentangPeriode } = require('../../src/lib/tanggal');
const mapping = require('../fixtures/mapping-uji');

const tahap = (pipeline, nama) => pipeline.filter((s) => Object.keys(s)[0] === nama);

test('sumber detail: filter logis diterjemahkan ke nama field fisik', () => {
  const r = rentangPeriode('2025-11');
  const p = bangunPipelineSumber('keluar', mapping.sumber.keluar, {
    filter: { companyCode: 'PT1', kodeBarang: ['BB-001', 'BB-002'], tanggal: { gte: r.gte, lt: r.lt } },
  });
  assert.deepEqual(p[0], {
    $match: {
      companyCode: 'PT1',
      kodeMaterial: { $in: ['BB-001', 'BB-002'] },
      tglKeluar: { $gte: r.gte, $lt: r.lt },
    },
  });
  assert.equal(tahap(p, '$lookup').length, 0);
  const proj = tahap(p, '$project')[0].$project;
  assert.equal(proj.kodeBarangAsli.$ifNull[0], '$kodeMaterial');
  assert.equal(proj.qtyAsli.$ifNull[0], '$jumlah');
  assert.deepEqual(proj.idAsal, { $ifNull: ['$idIncoming', null] });
  assert.deepEqual(proj.gudang, { $literal: null });
  assert.deepEqual(proj.arah, { $literal: 'OUT' });
});

test('filter tetap sumber digabung dengan $and', () => {
  const sumber = Object.assign({}, mapping.sumber.masuk, { filter: { status: 'POSTED' } });
  const p = bangunPipelineSumber('masuk', sumber, { filter: { companyCode: 'PT1' } });
  assert.deepEqual(p[0], { $match: { $and: [{ status: 'POSTED' }, { companyCode: 'PT1' }] } });
});

test('sampel: sort _id menurun + limit sebelum lookup header', () => {
  const p = bangunPipelineSumber('penyesuaian', mapping.sumber.penyesuaian, { sampel: 50 });
  const urutan = p.map((s) => Object.keys(s)[0]);
  assert.deepEqual(urutan, ['$sort', '$limit', '$addFields', '$lookup', '$addFields', '$addFields', '$project']);
  assert.deepEqual(p[0], { $sort: { _id: -1 } });
  assert.deepEqual(p[1], { $limit: 50 });
});

test('header: konversi link, lookup, filter header diterapkan setelah lookup', () => {
  const r = rentangPeriode('2025-11');
  const s = mapping.sumber.penyesuaian;
  const p = bangunPipelineSumber('penyesuaian', s, { filter: { companyCode: 'PT1', tanggal: { gte: r.gte, lt: r.lt } } });
  assert.deepEqual(p[0].$addFields.__link.$convert, { input: '$idHeader', to: 'objectId', onError: null, onNull: null });
  assert.deepEqual(p[1], { $lookup: { from: 'uji_penyesuaianheader', localField: '__link', foreignField: '_id', as: '__h' } });
  assert.deepEqual(p[3], { $match: { '__h.companyCode': 'PT1', '__h.tanggal': { $gte: r.gte, $lt: r.lt } } });
  const proj = tahap(p, '$project')[0].$project;
  assert.deepEqual(proj.tanggal, { $ifNull: ['$__h.tanggal', null] });
  assert.deepEqual(proj.noTransaksi, { $ifNull: ['$__h.noDokumen', null] });
  assert.equal(proj.headerJumlah, '$__hJumlah');
  assert.deepEqual(filterDiHeader(s, { companyCode: 'PT1', kodeBarang: 'X' }), ['companyCode']);
});

test('arah dari field: dinormalisasi trim + huruf besar, default TIDAK_DIKENAL', () => {
  const s = Object.assign({}, mapping.sumber.penyesuaian, {
    arah: { field: 'jenis', nilai: { ' tambah ': 'IN', Kurang: 'OUT' } },
  });
  const proj = tahap(bangunPipelineSumber('penyesuaian', s), '$project')[0].$project;
  const cabang = proj.arah.$switch.branches;
  assert.deepEqual(cabang.map((c) => [c.case.$eq[1], c.then]), [['TAMBAH', 'IN'], ['KURANG', 'OUT']]);
  assert.equal(proj.arah.$switch.default, 'TIDAK_DIKENAL');
});

test('TANDA_QTY: qty diambil nilai absolut, arah dari tanda', () => {
  const proj = tahap(bangunPipelineSumber('koreksi', mapping.sumber.koreksi), '$project')[0].$project;
  assert.deepEqual(proj.qty, { $abs: '$__qty' });
  assert.ok(JSON.stringify(proj.arah).includes('"$lt":["$__qty",0]'));
});

test('filter field yang tidak dipetakan -> error jelas', () => {
  const s = { koleksi: 'x', arah: 'IN', field: { tanggal: 't', companyCode: 'c', kodeBarang: 'k', qty: 'q' } };
  assert.doesNotThrow(() => bangunPipelineSumber('x', s, { filter: { kodeBarang: 'A' } }));
  const tanpaKode = { koleksi: 'x', arah: 'IN', field: { tanggal: 't', companyCode: 'c', qty: 'q' } };
  assert.throws(() => bangunPipelineSumber('x', tanpaKode, { filter: { kodeBarang: 'A' } }), /belum dipetakan/);
});
