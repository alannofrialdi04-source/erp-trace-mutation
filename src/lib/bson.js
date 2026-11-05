/**
 * Helper tipe data BSON di sisi klien (mongosh).
 *
 * Catatan: mongosh mengembalikan Int32 dan Double sama-sama sebagai number JS,
 * jadi di sisi klien keduanya dilaporkan 'int/double'. Tipe persis diambil dari
 * operator $type di server bila memungkinkan.
 */

var TIPE_ANGKA = ['double', 'int', 'long', 'decimal', 'int/double'];

function tipeNilai(v) {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return 'array';
  var t = typeof v;
  if (t === 'number') return 'int/double';
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'bool';
  if (t === 'object') {
    var bt = v._bsontype;
    if (bt === 'ObjectId' || bt === 'ObjectID') return 'objectId';
    if (bt === 'Decimal128') return 'decimal';
    if (bt === 'Long') return 'long';
    if (bt === 'Int32') return 'int';
    if (bt === 'Double') return 'double';
    if (bt === 'Timestamp') return 'timestamp';
    if (bt === 'Binary') return 'binData';
    if (bt === 'BSONRegExp' || v instanceof RegExp) return 'regex';
    if (bt) return String(bt).toLowerCase();
    return 'object';
  }
  return t;
}

function tipeAngka(tipe) {
  return TIPE_ANGKA.indexOf(tipe) >= 0;
}

/** Nilai angka BSON apa pun -> number JS (atau null bila bukan angka) */
function angkaDariNilai(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && v._bsontype) {
    if (v._bsontype === 'Long' && typeof v.toNumber === 'function') return v.toNumber();
    if (v._bsontype === 'Decimal128') return parseFloat(v.toString());
    if (v._bsontype === 'Int32' || v._bsontype === 'Double') return Number(v.valueOf());
  }
  return null;
}

/** Ubah nilai (termasuk tipe BSON) jadi bentuk yang aman untuk JSON.stringify */
function keJSONAman(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) {
    var arr = [];
    for (var i = 0; i < v.length; i++) arr.push(keJSONAman(v[i]));
    return arr;
  }
  if (typeof v === 'object') {
    var bt = v._bsontype;
    if (bt === 'ObjectId' || bt === 'ObjectID') return v.toHexString();
    if (bt === 'Decimal128' || bt === 'Long') return v.toString();
    if (bt === 'Int32' || bt === 'Double') return Number(v.valueOf());
    if (bt) return String(v);
    var o = {};
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = keJSONAman(v[k]);
    }
    return o;
  }
  if (typeof v === 'number' && !isFinite(v)) return String(v);
  return v;
}

// #region node-only
module.exports = {
  TIPE_ANGKA: TIPE_ANGKA,
  tipeNilai: tipeNilai,
  tipeAngka: tipeAngka,
  angkaDariNilai: angkaDariNilai,
  keJSONAman: keJSONAman,
};
// #endregion
