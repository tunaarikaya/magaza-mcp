/** Satış özeti ayrıştırma — ağsız. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { satisAyristir } from "../src/araclar/saglik/topla.js";

const BASLIK = ["Provider", "SKU", "Product Type Identifier", "Units", "Apple Identifier", "Parent Identifier"].join("\t");
const satir = (sku: string, tur: string, birim: number, appleId: string, ust = "") =>
  [`APPLE`, sku, tur, String(birim), appleId, ust].join("\t");

describe("satisAyristir", () => {
  it("indirme, iade, IAP→ana uygulama ve bilinmeyen satırları doğru sayar", () => {
    const tsv = [
      BASLIK,
      satir("SKU-A", "1", 100, "111"),
      satir("SKU-A", "1", -4, "111"),
      satir("SKU-A", "7", 30, "111"), // güncelleme: birim sayılır, indirme sayılmaz
      satir("iap.pro", "IA1", 10, "999", "SKU-A"),
      satir("iap.pro", "IA1", -2, "999", "SKU-A"),
      satir("iap.x", "IA1", 5, "888", "SKU-BILINMEYEN"),
      "bozuk\tsatir",
    ].join("\r\n");

    const t = satisAyristir(tsv, { "SKU-A": "111" });
    assert.deepEqual(t["111"], { birim: 140, iade: 6, indirme: 100 });
    assert.equal(t["999"], undefined);
    assert.equal(t["888"], undefined);
    assert.deepEqual(Object.keys(t), ["111"]);
  });

  it("başlıkta gerekli sütun yoksa boş döner", () => {
    assert.deepEqual(satisAyristir("a\tb\n1\t2", {}), {});
  });
});
