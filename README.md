# ERP Trace Mutation

Kumpulan script **mongosh read-only** untuk menelusuri mutasi stok ERP Kawasan Berikat / IT Inventory.

Semua sumber mutasi dibaca lewat **mapping**, lalu dinormalisasi jadi satu bentuk baris yang seragam. Untuk database `erpgarment`, mutasi dihitung dari ledger aplikasi `tbl_stok`. Setiap baris ledger bisa ditelusuri ke dokumen sumbernya lewat `idAsal`:

```text
tbl_stok (ledger: asal, jenis IN/OUT, qty, tanggal, idAsal)
   │  dihitung: saldo awal + masuk − keluar = saldo akhir
   │
   └─ idAsal per asal ──► INCOMING     tbl_incomingdetail      (GRN…)
                          MATERIALOUT  tbl_materialkeluardetail (OUTWH…)
                          DELIVERY     tbl_deliverydetail       (OUT…)
                          PRODUCTION   tbl_productiondetail     (PRD…, hasil)
                          TRANSFER     tbl_transferproduction   (TRF…)
                          DEADSTOK     tbl_deadstokdetail
                          SCRAP        exim_scrapdetail / exim_scrapexbc
```

Saldo dihitung dengan model `Saldo Akhir = Saldo Awal + Pemasukan − Pengeluaran`. Kode yang saldonya minus ditelusuri sampai ke transaksi pertama yang membuatnya minus, beserta kecocokan baris ledger dengan dokumen sumbernya.

---

## Status

Versi **0.3.0**: Fase 1 selesai.

| Fase | Isi | Status |
|---|---|---|
| 0 | Engine normalisasi berbasis mapping, helper periode WIB, build, test, tool `00-profil-skema` dan `00-cek-mapping` | Selesai |
| 1 | `00-peta-data` (distribusi nilai kunci + relasi `idAsal`), mapping `erpgarment` berbasis ledger `tbl_stok`, `01-mutasi` (rekap saldo per kode + kartu stok dengan saldo berjalan dan cek per baris ke dokumen sumber) | Selesai |
| 2 | `02-duplikat`, `03-orphan` (termasuk counter lot `qtyOut`/`qtyBalance` vs transaksi OUT), `04-anomali` | Belum |
| 3 | `05-cross-module` (termasuk ledger `tbl_stok` vs transaksi sumber, header `listDetail` vs koleksi detail), template koreksi data yang aman, CI | Belum |

> **Dasar mapping.** Nama koleksi & field diverifikasi dengan profil schema dan `00-peta-data` (2026-11-05). Jumlah dokumen dan total qty `tbl_stok` sama persis dengan transaksi sumber untuk MATERIALOUT, DELIVERY, PRODUCTION, TRANSFER, DEADSTOK, dan SCRAP; INCOMING selisih 10 dokumen. Satu hal yang masih asumsi: ledger INCOMING diasumsikan memakai `qtyWh`. Kalau salah, kolom CEK kartu stok akan menunjukkan `QTY_BEDA` pada baris INCOMING.

---

## Prinsip keamanan

- **Read-only.** Semua file di `dist/` hanya memakai `find` / `aggregate` / `count`. Ada test otomatis yang gagal bila muncul operasi tulis (`insert`, `update`, `delete`, `$out`, `$merge`, dan sejenisnya).
- **Beban dibatasi.** Sampel maksimal 5.000 dokumen per koleksi. Mode sampel bawaan memakai urutan `_id` (memanfaatkan index `_id`).
- **Disarankan dijalankan di secondary atau hasil restore dump** bila koleksinya besar.
- **Jangan commit kredensial atau output dari database asli.** `.env` dan folder `hasil/` sudah masuk `.gitignore`.

---

## Cara pakai

Setiap file di `dist/` berdiri sendiri: tidak perlu `require`, `load` tambahan, atau instalasi apa pun.

```bash
mongosh "mongodb://USER@HOST:27017/NAMA_DB?authSource=admin" --quiet --file dist/00-profil-skema.js
```

Cara lain:

- Di dalam sesi mongosh: `load("dist/00-profil-skema.js")`
- Paste seluruh isi file ke shell. Script aman di-paste ulang di sesi yang sama.

Hasil lengkap tersimpan di variabel `TRACE_HASIL`.

**Mengatur konfigurasi.** Ada dua cara:

1. Edit blok `KONFIGURASI` di bagian atas file `dist/`.
2. Override dari command line tanpa mengedit file:

   ```bash
   mongosh "mongodb://..." --quiet --eval 'var __TRACE_OVERRIDE__ = { CONFIG: { SUMBER: ["incoming"], PERIODE: "2026-10" } }' --file dist/00-cek-mapping.js
   ```

Menyimpan output ke file (folder `hasil/` tidak ikut ter-commit):

```bash
mkdir -p hasil
```
```bash
mongosh "mongodb://..." --quiet --file dist/00-profil-skema.js > hasil/profil-skema.txt
```

Lingkungan yang sudah dites: mongosh 2.14 dengan MongoDB 7.0 (test) dan MongoDB 8.0.1 (`erpgarment`, tool `00-*`). `01-mutasi` butuh **MongoDB 5.0+** (`$setWindowFields`, `$unionWith`); tool `00-*` memakai operator yang tersedia sejak 4.0. Shell GUI (Studio 3T, NoSQLBooster, Compass) **belum dites**.

### Alur verifikasi mapping

1. Jalankan `dist/00-profil-skema.js` di database ERP untuk melihat field, tipe data, dan pola nilai yang sebenarnya. Nilai asli disamarkan, jadi output aman dibagikan.
2. Sesuaikan `config/mapping.js`, lalu jalankan `npm run build`. Setelah semuanya cocok, ubah `meta.status` menjadi `'TERVERIFIKASI'`.
3. Jalankan `dist/00-cek-mapping.js`. Targetnya, semua sumber `OK`, atau `PERINGATAN` yang penyebabnya sudah dipahami.

---

## Tool

### `00-profil-skema`: profil struktur koleksi

Tool ini menampilkan, untuk setiap field:

- persentase keterisian;
- tipe data BSON persis (`int`, `double`, `long`, `decimal`, `string`, dan lainnya, diambil dari `$type` di server);
- pola nilai yang disamarkan: `A` = huruf besar, `a` = huruf kecil, `9` = angka, karakter lain tetap. Contoh: `PT-ABC/2024/001` menjadi `AA-AAA/9999/999`.

Tool ini juga menandai:

- spasi di awal/akhir nilai;
- angka negatif, nol, dan pecahan;
- sebaran jam untuk field tanggal, untuk mengetahui cara ERP menyimpan tanggal WIB.

Nilai asli hanya ditampilkan untuk field "enum", yaitu field dengan variasi nilai sedikit dan berulang (misalnya `status` atau jenis dokumen). Fitur ini bisa dimatikan dengan `TAMPILKAN_ENUM: false`.

| CONFIG | Default | Keterangan |
|---|---|---|
| `KOLEKSI` | `[]` | `[]` = semua koleksi di MAPPING (detail + header) |
| `SAMPEL` | `200` | Dokumen per koleksi (maks 5.000) |
| `MODE_SAMPEL` | `'terbaru'` | `'terbaru'` (urut `_id` menurun) atau `'acak'` (`$sample`) |
| `TAMPILKAN_ENUM` | `true` | Tampilkan nilai asli untuk field enum |
| `ENUM_MAKS` | `8` | Batas nilai unik supaya dianggap enum |
| `KEDALAMAN_MAKS` | `4` | Kedalaman field bersarang yang ditelusuri |
| `DB` | `null` | `null` = database di connection string |
| `FORMAT` | `'teks'` | `'teks'` atau `'json'` |

Contoh output (data dummy dari test):

```text
--- uji_incomingdetail -------------------------------------------------------
Estimasi dokumen: 8 | sampel: 8 (terbaru)
FIELD          ADA  TIPE                             INFO
-----------  -----  -------------------------------  --------------------------------------------------------------------------------------
_id           100%  objectId
tanggal       100%  date                             jam WIB: 00:00 (75%), 10:15 (12,5%), 23:59 (12,5%) | rentang 2025-11-01 s/d 2025-12-01
companyCode   100%  string                           nilai: "PT1" (7), "PT2" (1)
kodeBarang    100%  string                           pola: "AA-999" (7), "AA-999 " (1) | spasi di awal/akhir: 1
qty           100%  int 50%, double 25%, string 25%  pola: "9.999,9" (1), "99" (1) | angka: pecahan 1
noAju         100%  string                           pola: "999999" (8)
status        100%  string                           nilai: "POSTED" (7), "DRAFT" (1)
idAsal       12,5%  null

--- uji_IncomingDetail -------------------------------------------------------
TIDAK DITEMUKAN. Mungkin maksudnya: uji_incomingdetail
```

### `00-cek-mapping`: cek kecocokan mapping dengan data

Untuk setiap sumber di MAPPING, tool ini memeriksa hal-hal berikut:

1. struktur mapping (validasi statis);
2. keberadaan koleksi, disertai saran nama bila salah ketik;
3. keterisian field wajib dan opsional;
4. tipe field tanggal dan qty;
5. hasil penentuan arah IN/OUT;
6. relasi detail ke header (detail yatim, header ganda, tipe link yang tidak cocok).

| CONFIG | Default | Keterangan |
|---|---|---|
| `SUMBER` | `[]` | `[]` = semua sumber di MAPPING, mis. `['incoming', 'delivery']` |
| `SAMPEL` | `500` | Dokumen detail terbaru per sumber (maks 5.000) |
| `PERIODE` | `null` | `'2026-10'`, `'2026'`, `'2026-10-15'`, atau `{ dari: '2026-10-01', sampai: '2026-10-15' }` |
| `COMPANY_CODE` | `null` | Batasi ke satu companyCode |
| `DB` | `null` | `null` = database di connection string |
| `FORMAT` | `'teks'` | `'teks'` atau `'json'` |

Kode temuan:

| Kode | Level | Arti |
|---|---|---|
| `VALIDASI` | ERROR / PERINGATAN | Struktur mapping salah atau ada salah ketik |
| `KOLEKSI_TIDAK_ADA`, `HEADER_KOLEKSI_TIDAK_ADA` | ERROR | Koleksi tidak ditemukan (disertai kandidat nama) |
| `FIELD_WAJIB_KOSONG_SEMUA` | ERROR | Field wajib tidak pernah terisi; nama field kemungkinan salah |
| `HEADER_TIDAK_TERHUBUNG` | ERROR | Tidak ada detail yang menemukan header-nya (disertai saran `konversi`) |
| `TANGGAL_BUKAN_DATE` | ERROR / PERINGATAN | Tanggal tersimpan bukan sebagai Date, sehingga tidak tertangkap filter periode |
| `FIELD_WAJIB_KOSONG_SEBAGIAN` | PERINGATAN | Field wajib kosong di sebagian dokumen |
| `FIELD_OPSIONAL_KOSONG` | PERINGATAN | Field opsional selalu kosong; cek nama field |
| `QTY_STRING` | PERINGATAN | qty bertipe string (dipisahkan antara yang bisa dan tidak bisa dikonversi) |
| `QTY_BUKAN_ANGKA` | PERINGATAN | qty bertipe selain angka/teks |
| `QTY_NEGATIF` | PERINGATAN | qty negatif pada sumber berarah tetap |
| `KODE_SPASI` | PERINGATAN | kodeBarang punya spasi di awal/akhir; barang yang sama bisa terhitung terpisah |
| `KODE_BUKAN_STRING` | PERINGATAN | kodeBarang bukan string |
| `ARAH_TIDAK_DIKENAL` | PERINGATAN | Nilai field arah tidak ada di `arah.nilai` |
| `DETAIL_YATIM` | PERINGATAN | Detail tanpa header |
| `HEADER_GANDA` | PERINGATAN | Detail cocok ke lebih dari satu header |
| `TANGGAL_MASA_DEPAN` | PERINGATAN | Tanggal lebih dari 1 hari ke depan |
| `SAMPEL_KOSONG` | PERINGATAN | Tidak ada dokumen yang cocok dengan filter |

Contoh output (data dummy dari test):

```text
[PERINGATAN] masuk | Incoming (uji) | uji_incomingdetail | arah IN | kategori BB
              sampel 8 dokumen
              - INFO       Rentang tanggal sampel 2025-11-01 s/d 2025-12-01 | jam WIB: 00:00 75%, 10:15 12,5%, 23:59 12,5%
              - INFO       Tipe qty: int 50%, double 25%, string 25%
              - PERINGATAN qty bertipe string di 2 dokumen (1 bisa dikonversi ke angka, 1 tidak: pola "9.999,9" 1).
              - PERINGATAN kodeBarang punya spasi di awal/akhir di 1 dokumen (bisa bikin barang yang sama terhitung terpisah).
              - INFO       companyCode: "PT1" 7, "PT2" 1
              - INFO       Arah: IN 8

[PERINGATAN] penyesuaian | Penyesuaian (uji) | uji_penyesuaiandetail + uji_penyesuaianheader | arah dari field jenis (TAMBAH->IN, KURANG->OUT)
              sampel 4 dokumen
              - PERINGATAN 1 detail tidak punya header (header terhapus atau link salah).
              - INFO       Rentang tanggal sampel 2025-11-08 s/d 2025-11-09 | jam WIB: 00:00 100%
              - INFO       Tipe qty: double 100%
              - INFO       companyCode: "PT1" 3
              - INFO       Arah: IN 2, OUT 1, TIDAK_DIKENAL 1
              - PERINGATAN Arah tidak dikenali di 1 dokumen. Nilai asli: "KOREKSI" (1). Tambahkan ke arah.nilai bila memang valid.

Ringkasan: 1 OK | 2 PERINGATAN | 0 ERROR
```

### `00-peta-data`: distribusi nilai kunci & relasi id

Tool ini menjawab pertanyaan yang tidak bisa dijawab dari profil schema yang cuma memberi satu contoh nilai per field:

- **Distribusi:** jumlah dokumen per kombinasi nilai, dihitung dari **seluruh** koleksi (bukan sampel). Bisa disertai total qty dan rentang tanggal (WIB) per kombinasi. Contohnya: `asal × jenis × namaProses` di `tbl_stok`, `approveStatus × isDeleted` di material keluar, atau perbandingan `qty = qtyWh` dan `satuan = satuanWh`.
- **Relasi:** nilai field id (mis. `idAsal`) diambil sampelnya, lalu dicari ke `_id` **semua koleksi** (memakai index `_id`) dan ke array tertanam yang dipilih (`listDetail._id`). Hasilnya: field itu menunjuk ke koleksi mana dan berapa persen yang tidak ditemukan (calon data yatim). Kalau diberi `perNilai`, sampel dipecah per nilai field lain, mis. `tbl_stok.idAsal` per `asal`.

CONFIG bawaan sudah berisi preset untuk database `erpgarment` (modul gudang, produksi, delivery, penyesuaian, opname, scrap, deadstock, dan `tbl_stok`).

| CONFIG | Default | Keterangan |
|---|---|---|
| `COMPANY_CODE` | `'WAG'` | Filter companyCode; `null` = semua company |
| `DISTRIBUSI` | preset | `{ koleksi, grup: [field \| { label, expr }], jumlah?, tanggal? }` |
| `TOP` | `25` | Kombinasi yang ditampilkan per distribusi |
| `RELASI` | preset | `{ koleksi, field, perNilai? }` |
| `SAMPEL_RELASI` | `200` | Nilai id per relasi (maks 1.000) |
| `TARGET_RELASI` | `[]` | Koleksi tujuan pencarian `_id`; `[]` = semua koleksi |
| `TARGET_TERTANAM` | preset | `{ koleksi, path }` array id tertanam. Koleksi ini dipindai penuh, jadi daftarnya dibatasi |

Contoh output (data dummy dari test):

```text
--- tbl_stok: asal x jenis ---------------------------------------------------
4 dokumen, 2 kombinasi
asal         jenis  DOK  TOTAL qty  tanggal (min s/d max)
-----------  -----  ---  ---------  -------------------------
MATERIALOUT  OUT      2         50  2025-11-05 s/d 2025-11-06
INCOMING     IN       2        220  2025-11-01 s/d 2025-11-02

tbl_materialkeluardetail.idAsal | sampel 3 nilai (format hex ObjectId 100%)
    tbl_incomingdetail                  2  66,7%
    tbl_incomingheader.listDetail       1  33,3%
    tidak ditemukan di mana pun         1  33,3%
```

### `01-mutasi`: rekap mutasi & kartu stok

Menghitung mutasi dari sumber yang `hitungMutasi`-nya tidak `false` (untuk `erpgarment`: ledger `tbl_stok`).

- **Saldo awal** adalah akumulasi semua transaksi **sebelum** periode. Tidak ada tabel saldo awal terpisah. Cut-off 18 Agustus 2025 (stock opname mesin) sudah tercatat sebagai transaksi INCOMING `SALDO AWAL`.
- **Masuk/keluar** adalah transaksi **di dalam** periode, dengan batas WIB dan batas atas eksklusif.

**Mode `rekap`:** satu baris per kode barang berisi saldo awal, masuk, keluar, saldo akhir, satuan, dan tanda masalah. Disertai mutasi per asal (INCOMING, MATERIALOUT, DELIVERY, …) dan, untuk kode yang saldonya pernah minus, **transaksi pertama yang membuat saldo minus** (dihitung dengan saldo berjalan per kode).

**Mode `kartu`:** semua transaksi satu atau beberapa kode (maks 20) dengan saldo berjalan. Setiap baris ledger dicocokkan ke dokumen sumbernya lewat `idAsal` (`CEK_SUMBER`), dan ditampilkan nomor transaksinya (GRN…/OUTWH…/OUT…/PRD…/TRF…) serta jenis dokumen BC.

| CONFIG | Default | Keterangan |
|---|---|---|
| `MODE` | `'rekap'` | `'rekap'` atau `'kartu'` |
| `COMPANY_CODE` | `'WAG'` | Filter companyCode. Satu DB berisi beberapa company, jadi sebaiknya selalu diisi |
| `PERIODE` | `'2026-01'` | `'2026-01'`, `'2026'`, `'2026-01-15'`, atau `{ dari, sampai }` |
| `KODE_BARANG` | `null` | `'ABC'` atau `['ABC', 'DEF']`. Wajib untuk mode `kartu` |
| `KATEGORI` | `null` | Rekap per kategori master (`jenisBc`): `'MATERIAL'`, `'BARANG SETENGAH JADI'`, `'BARANG JADI'`, `'MESIN'`, `'SCRAP'` |
| `TANGGAL_CUTOFF` | `'2025-08-18'` | Transaksi sebelum tanggal ini diberi tanda `SEBELUM_CUTOFF` (tetap dihitung) |
| `HANYA_BERMASALAH` | `false` | Rekap: tampilkan hanya kode yang punya tanda |
| `TAMPIL_MAKS` | `200` | Rekap: baris maksimal di output teks (`FORMAT: 'json'` selalu lengkap) |
| `KARTU_MAKS_BARIS` | `2000` | Kartu: baris maksimal per kode |
| `CEK_SUMBER` | `true` | Kartu: cocokkan tiap baris ledger dengan dokumen sumbernya |

Tanda di rekap (urut dari yang paling berat):

| Tanda | Arti |
|---|---|
| `MINUS` | Saldo akhir minus |
| `AWAL_MINUS` | Saldo awal sudah minus |
| `PERNAH_MINUS` | Saldo akhir tidak minus, tetapi sempat minus di dalam periode |
| `TIDAK_DI_MASTER` | Kode tidak ada di master barang (`tbl_barang`) untuk companyCode tersebut |
| `SATUAN_CAMPUR` | Baris kode ini memakai lebih dari satu satuan. Qty dijumlah apa adanya **tanpa konversi** |
| `SEBELUM_CUTOFF` | Ada transaksi bertanggal sebelum `TANGGAL_CUTOFF` |
| `ARAH_TIDAK_DIKENAL`, `QTY_KOSONG`, `TANPA_TANGGAL` | Arah, qty, atau tanggal baris tidak terbaca (tidak ikut saldo) |

Kolom CEK di kartu stok:

| Kode | Arti |
|---|---|
| `OK` | Baris ledger cocok dengan dokumen sumbernya |
| `SUMBER_HILANG` | `idAsal` menunjuk dokumen yang tidak ada (hard delete atau id salah) |
| `SUMBER_DIHAPUS` | Dokumen sumber `isDeleted: true`, tetapi baris ledger masih dihitung |
| `QTY_BEDA` | qty ledger ≠ qty dokumen sumber (qty sumber ada di JSON `dokSumber.qty`) |
| `KODE_BEDA` / `ARAH_BEDA` | Kode barang / arah ledger ≠ dokumen sumber |
| `TANGGAL_BEDA` | Tanggal (WIB) ledger ≠ tanggal dokumen sumber |
| `SATUAN_BEDA` | Satuan ledger ≠ satuan dokumen sumber |
| `RUJUKAN_TIDAK_ADA`, `ID_ASAL_KOSONG`, `ID_ASAL_TIDAK_VALID` | Baris tidak bisa ditelusuri |

Contoh (data dummy dari test):

```bash
mongosh "mongodb://..." --quiet --eval 'var __TRACE_OVERRIDE__ = { CONFIG: { PERIODE: "2026-01", HANYA_BERMASALAH: true, KODE_BARANG: ["FG-001", "MAT-001"] } }' --file dist/01-mutasi.js
```

```text
KODE     NAMA    KATEGORI     SAT  SALDO AWAL  MASUK  KELUAR  SALDO AKHIR  TANDA
-------  ------  -----------  ---  ----------  -----  ------  -----------  ------------
FG-001   KAOS    BARANG JADI  PCE           0    500     510          -10  MINUS
MAT-001  KAIN A  MATERIAL     YRD         100     60     145           15  PERNAH_MINUS

Transaksi pertama yang membuat saldo minus di periode ini:
  FG-001 : 2026-01-20 12:00 | DELIVERY OUT 10 | saldo -10 | saldo terendah -10 (1 baris minus)
  MAT-001 : 2026-01-10 09:00 | MATERIALOUT OUT 50 | saldo -30 | saldo terendah -30 (1 baris minus)
Telusuri per transaksi dengan MODE: "kartu" dan KODE_BARANG berisi kode di atas.
```

```bash
mongosh "mongodb://..." --quiet --eval 'var __TRACE_OVERRIDE__ = { CONFIG: { MODE: "kartu", PERIODE: "2026-01", KODE_BARANG: "FG-001" } }' --file dist/01-mutasi.js
```

```text
TANGGAL (WIB)     ASAL        PROSES       NO. TRANSAKSI                 DOK    MASUK  KELUAR  SALDO  SAT  CEK
----------------  ----------  -----------  ----------------------------  -----  -----  ------  -----  ---  --------------
2026-01-08 12:00  PRODUCTION  FINISHGOODS  PRDFINISHGOODS20260108-00001  BC 40    500            500  PCE  OK
2026-01-12 12:00  DELIVERY                 OUT20260112-00001             BC 30            200    300  PCE  OK
2026-01-14 12:00  DELIVERY                 OUT20260114-00001             BC 30            150    150  PCE  SUMBER_DIHAPUS
2026-01-16 12:00  DELIVERY                 OUT20260116-00001             BC 30            120     30  PCE  QTY_BEDA
2026-01-18 12:00  DELIVERY                                                                 30      0  PCE  SUMBER_HILANG
2026-01-20 12:00  DELIVERY                 OUT20260125-00001             BC 30             10    -10  PCE  TANGGAL_BEDA
Saldo akhir: -10 (masuk 500, keluar 510, 6 transaksi)
Saldo pertama kali minus: 2026-01-20 12:00 | DELIVERY OUT 10 | saldo -10 | OUT20260125-00001
```

---

## Mapping (`config/mapping.js`)

Semua nama koleksi dan field ditulis di satu file ini. Tool tidak meng-hardcode nama field. Format lengkapnya dijelaskan di komentar bagian atas file. Ringkasnya (potongan mapping `erpgarment`):

```js
master: {
  koleksi: 'tbl_barang',
  field: { kodeBarang: 'kodeBarang', companyCode: 'companyCode', nama: 'namaBarang', kategori: 'jenisBc', satuan: 'satuan' },
},
sumber: {
  stok: {                                   // dihitung (hitungMutasi default true)
    koleksi: 'tbl_stok',
    arah: { field: 'jenis', nilai: { IN: 'IN', OUT: 'OUT' } },
    field: { tanggal: 'tanggal', companyCode: 'companyCode', kodeBarang: 'kodeBarang', qty: 'qty',
             satuan: 'satuan', idAsal: 'idAsal', asal: 'asal', proses: 'namaProses' },
    rujukan: { MATERIALOUT: 'materialKeluar', 'DEADSTOK:OUT': 'deadstokKeluar', /* ... */ },
  },
  materialKeluar: {                         // hanya untuk penelusuran
    koleksi: 'tbl_materialkeluardetail',
    arah: 'OUT',
    hitungMutasi: false,
    field: { tanggal: 'tglKeluar', companyCode: 'companyCode', kodeBarang: 'kodeMaterial', qty: 'qtyKeluarOk',
             satuan: 'satuanKeluarOk', noTransaksi: 'noReg', idAsal: 'idAsal', dihapus: 'isDeleted' },
  },
}
```

- **Field logis wajib:** `tanggal`, `companyCode`, `kodeBarang`, `qty`
- **Field logis opsional:** `noTransaksi`, `idAsal`, `idDokumen`, `noAju`, `noReg`, `noUrut`, `jenisDokumen`, `satuan`, `gudang`, `createdAt`, `asal`, `proses`, `dihapus`
- **`rujukan`:** baris dengan `asal` X dicari dokumen sumbernya di sumber `rujukan[X]` lewat `_id = idAsal`. Kunci `'ASAL:ARAH'` (mis. `'DEADSTOK:OUT'`) didahulukan dari `'ASAL'`.
- **Arah dari field** dibandingkan setelah trim + huruf besar. Sumber yang field-nya ada di koleksi header bisa memakai `header: { koleksi, localField, foreignField, konversi, field }`.

**Periode selalu dihitung dalam WIB** (`timezone: '+07:00'`) dengan batas atas eksklusif. Contoh November 2026:

```js
{ $gte: ISODate("2026-10-31T17:00:00Z"), $lt: ISODate("2026-11-30T17:00:00Z") }
```

---

## Development

Prasyarat: Node.js >= 22 dan Docker (untuk MongoDB test). Tidak ada dependency npm.

```bash
npm run db:up
```
```bash
npm test
```
```bash
npm run test:integrasi
```
```bash
npm run build
```
```bash
npm run db:down
```

| Script | Fungsi |
|---|---|
| `npm run db:up` / `db:down` | Menyalakan/mematikan MongoDB test (container `erp-trace-mongo`, port 27018). Versi image bisa diatur: `MONGO_VERSION=6.0 npm run db:up` |
| `npm test` | Test unit: helper, validasi mapping, pipeline, dan pemeriksaan `dist/` (up-to-date, sintaks, read-only) |
| `npm run test:integrasi` | Menjalankan file `dist/` di mongosh sungguhan terhadap data dummy berisi anomali yang sengaja ditanam |
| `npm run build` | Menyusun ulang `dist/` dari `src/` + `config/mapping.js` |
| `npm run cek:dist` | Gagal bila `dist/` belum dibuild ulang |

Untuk memakai mongosh lokal (bukan di dalam container), set environment variable sebelum test integrasi:

```bash
MONGOSH_BIN=mongosh MONGO_URI_DASAR=mongodb://localhost:27018 npm run test:integrasi
```

### Struktur

```text
config/mapping.js       mapping koleksi & field (satu-satunya yang disesuaikan per ERP)
src/lib/                tanggal (WIB), teks (pola/kandidat), tabel, bson, mapping (validasi),
                        sumber (pipeline normalisasi), mutasi (rekap, saldo berjalan, cek sumber),
                        runner (lapisan mongosh)
src/tools/              satu file per tool: blok CONFIG + jalankan() + render()
scripts/build.js        gabungkan CONFIG + MAPPING + lib + tool -> dist/<tool>.js
dist/                   hasil build, siap dijalankan (ikut di-commit)
test/unit/              test Node tanpa database
test/integrasi/         test terhadap MongoDB (docker compose)
test/fixtures/          mapping & data dummy berisi anomali tertanam
```

### Aturan kode

Script dijalankan di mongosh, jadi ada beberapa aturan:

- Tidak ada operasi tulis di `src/tools/`. Test `build.test.js` memeriksanya.
- Panggilan shell API (`db.x.find()`, `aggregate()`) tidak boleh diletakkan di dalam callback (`map`, `forEach`, `sort`). Pakai loop `for` biasa supaya aman dengan async rewriter mongosh.
- Kode yang khusus untuk Node (`require` / `module.exports`) diletakkan di dalam `// #region node-only` ... `// #endregion`. Bagian ini dibuang saat build.
- Hindari sintaks JavaScript yang sangat baru (`?.`, `??`) supaya tetap aman di engine JS shell yang lebih lama.
- Setiap perubahan di `src/` atau `config/` harus diikuti `npm run build`, lalu ikut commit `dist/`.

---

## Batasan yang diketahui

- Filter yang field-nya ada di koleksi header (misalnya tanggal penyesuaian) diterapkan **setelah** `$lookup`. Untuk koleksi besar, sertakan filter yang ada di detail, seperti `kodeBarang`.
- Filter `kodeBarang` mencocokkan nilai mentah secara persis. Kode yang mengandung spasi tidak ikut tertangkap. Kasus ini dilaporkan `00-cek-mapping` sebagai `KODE_SPASI`.
- qty berbentuk teks dengan format Indonesia (`"1.234,5"`) **sengaja tidak dikonversi otomatis** supaya tidak salah tebak. Kasus ini dilaporkan sebagai `QTY_STRING`.
- Tanggal yang tersimpan sebagai string tidak tertangkap filter periode. Kasus ini dilaporkan sebagai `TANGGAL_BUKAN_DATE`.
- Untuk field di dalam array, tipe `int` dan `double` hanya terbaca sebagai `int/double` (keterbatasan di sisi klien).
- Transaksi yang di-*hard delete* tidak bisa dilacak langsung. Jejaknya terlihat dari referensi yang yatim (`SUMBER_HILANG` di kartu stok).
- `01-mutasi` menjumlahkan qty apa adanya. Kode dengan `SATUAN_CAMPUR` **tidak dikonversi** (konversi satuan via `tbl_konversiunit` belum dipakai).
- Ledger `tbl_stok` tidak mencatat stok material di lantai produksi (receiving & konsumsi produksi dilacak lewat counter `qtyUse`). Saldo material di `01-mutasi` = saldo gudang.
- Urutan baris dengan tanggal persis sama: IN dulu, lalu OUT, lalu urutan `_id`.
