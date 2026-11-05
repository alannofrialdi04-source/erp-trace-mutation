'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../../src/lib/tanggal');

const iso = (d) => d.toISOString();

test('periode bulan WIB: batas bawah 17:00Z hari sebelumnya, batas atas eksklusif', () => {
  const r = t.rentangPeriode('2026-11', '+07:00');
  assert.equal(iso(r.gte), '2026-10-31T17:00:00.000Z');
  assert.equal(iso(r.lt), '2026-11-30T17:00:00.000Z');
  assert.equal(r.dari, '2026-11-01');
  assert.equal(r.sampai, '2026-11-30');
  assert.equal(r.label, '2026-11-01 s/d 2026-11-30 (WIB)');
});

test('periode Desember menyeberang tahun', () => {
  const r = t.rentangPeriode('2026-12');
  assert.equal(iso(r.gte), '2026-11-30T17:00:00.000Z');
  assert.equal(iso(r.lt), '2026-12-31T17:00:00.000Z');
  assert.equal(r.sampai, '2026-12-31');
});

test('periode tahun, hari, dan rentang inklusif', () => {
  const tahun = t.rentangPeriode('2026');
  assert.equal(iso(tahun.gte), '2025-12-31T17:00:00.000Z');
  assert.equal(iso(tahun.lt), '2026-12-31T17:00:00.000Z');

  const hari = t.rentangPeriode('2026-11-05');
  assert.equal(iso(hari.gte), '2026-11-04T17:00:00.000Z');
  assert.equal(iso(hari.lt), '2026-11-05T17:00:00.000Z');

  const rentang = t.rentangPeriode({ dari: '2026-11-01', sampai: '2026-11-15' });
  assert.equal(iso(rentang.gte), '2026-10-31T17:00:00.000Z');
  assert.equal(iso(rentang.lt), '2026-11-15T17:00:00.000Z');
  assert.equal(rentang.sampai, '2026-11-15');
});

test('tahun kabisat', () => {
  assert.equal(t.rentangPeriode('2028-02').sampai, '2028-02-29');
  assert.equal(t.rentangPeriode('2026-02').sampai, '2026-02-28');
});

test('timezone lain', () => {
  const r = t.rentangPeriode('2026-11', '+00:00');
  assert.equal(iso(r.gte), '2026-11-01T00:00:00.000Z');
  assert.equal(t.labelZona('+08:00'), 'WITA');
  assert.equal(t.offsetMenit('-03:30'), -210);
});

test('input tidak valid ditolak dengan pesan jelas', () => {
  assert.throws(() => t.rentangPeriode('2026-13'), /Bulan tidak valid/);
  assert.throws(() => t.rentangPeriode('2026-02-30'), /Tanggal tidak valid/);
  assert.throws(() => t.rentangPeriode('Nov 2026'), /Format periode tidak dikenal/);
  assert.throws(() => t.rentangPeriode({ dari: '2026-11-10', sampai: '2026-11-01' }), /lebih awal/);
  assert.throws(() => t.rentangPeriode({ dari: '2026-11-10' }), /wajib punya/);
  assert.throws(() => t.rentangPeriode('2026-11', '+7'), /timezone tidak valid/);
  assert.throws(() => t.offsetMenit('+15:00'), /di luar jangkauan/);
});

test('format tanggal & jam lokal', () => {
  const d = new Date('2026-10-31T17:00:00Z');
  assert.equal(t.formatLokal(d, '+07:00'), '2026-11-01 00:00:00');
  assert.equal(t.formatLokal(d, '+07:00', false), '2026-11-01');
  assert.equal(t.jamLokal(new Date('2026-11-30T16:59:59Z'), '+07:00'), '23:59');
  assert.equal(t.jamLokal(new Date('invalid'), '+07:00'), null);
});

test('dugaanSalahTahun & geserTahun', () => {
  assert.equal(t.dugaanSalahTahun(-374, 60), 1, '2024-11-29 vs registrasi 2025-12-08');
  assert.equal(t.dugaanSalahTahun(-72, 60), 0, 'backdate biasa');
  assert.equal(t.dugaanSalahTahun(370, 60), -1, 'kelebihan satu tahun');
  assert.equal(t.dugaanSalahTahun(-735, 60), 2);
  assert.equal(t.dugaanSalahTahun(-200, 60), 0);
  assert.equal(t.geserTahun('2024-11-29', 1), '2025-11-29');
  assert.equal(t.geserTahun('2024-02-29', 1), null, '29 Feb 2025 tidak ada');
  assert.equal(t.geserTahun('bukan', 1), null);
});
