'use strict';
/**
 * Penanda tipe BSON dalam format Extended JSON (canonical) untuk data seed.
 * Di-parse di mongosh dengan EJSON.parse(..., { relaxed: false }) supaya
 * tipe int / double / decimal tersimpan persis.
 */
const D = (iso) => ({ $date: { $numberLong: String(new Date(iso).getTime()) } });
const OID = (hex) => ({ $oid: hex });
const INT = (n) => ({ $numberInt: String(n) });
const DBL = (n) => ({ $numberDouble: String(n) });
const DEC = (s) => ({ $numberDecimal: String(s) });

/** Ubah nilai JS (termasuk Date) jadi EJSON canonical, untuk mengirim pipeline ke mongosh */
function keEJSON(v) {
  if (v instanceof Date) return D(v.toISOString());
  if (Array.isArray(v)) return v.map(keEJSON);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = keEJSON(v[k]);
    return o;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? INT(v) : DBL(v);
  return v;
}

module.exports = { D, OID, INT, DBL, DEC, keEJSON };
