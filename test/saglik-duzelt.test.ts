/** hesap_duzelt girdi doğrulaması — hepsi ağa çıkmadan reddedilmeli. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bulguIdCoz, hesapDuzelt, kapsam, girdiDogrula } from "../src/araclar/saglik/duzelt.js";

describe("bulguIdCoz", () => {
  it("kural:uygulama:ek ayrışır", () => {
    assert.deepEqual(bulguIdCoz("anahtar-marka:123:en-US"), { kural: "anahtar-marka", uygulamaId: "123", ek: "en-US" });
  });
  it("hesap düzeyi id'de uygulama yok", () => {
    assert.deepEqual(bulguIdCoz("fazla-admin:hesap"), { kural: "fazla-admin", uygulamaId: undefined, ek: undefined });
  });
  it("eksik parça, bilinmeyen kural ve yol kaçırma reddedilir", () => {
    assert.throws(() => bulguIdCoz("anahtar-marka"), /Geçersiz bulgu id/);
    assert.throws(() => bulguIdCoz("uydurma-kural:1"), /Bilinmeyen kural/);
    assert.throws(() => bulguIdCoz("toString:1"), /Bilinmeyen kural/);
    assert.throws(() => bulguIdCoz("anahtar-marka:../v1"), /geçersiz/);
  });
});

describe("kapsam", () => {
  it("uygulama bulguları yalnızca o uygulamaları toplar", () => {
    const { cozulen } = girdiDogrula({ bulgular: ["anahtar-marka:1:en-US", "icerik-hakki-yok:2"] });
    assert.deepEqual(kapsam(cozulen), { bolumler: ["metadata", "inceleme_hesap"], uygulamaIdleri: ["1", "2"] });
  });
  it("klon ve hesap bulguları tüm hesabı ister", () => {
    for (const id of ["yabanci-copyright:1", "fazla-admin:hesap"]) {
      assert.equal(kapsam(girdiDogrula({ bulgular: [id] }).cozulen).uygulamaIdleri, undefined);
    }
  });
});

describe("hesapDuzelt girdi kapısı", () => {
  it("boş / eksik bulgular ağdan önce reddedilir", async () => {
    await assert.rejects(hesapDuzelt({}), /boş olamaz/);
    await assert.rejects(hesapDuzelt({ bulgular: [] }), /boş olamaz/);
  });
  it("50'den fazla id reddedilir", async () => {
    const cok = Array.from({ length: 51 }, (_, i) => `anahtar-marka:${i}`);
    await assert.rejects(hesapDuzelt({ bulgular: cok }), /en çok 50/);
  });
  it("geçersiz id ve bozuk degerler reddedilir", async () => {
    await assert.rejects(hesapDuzelt({ bulgular: ["yok:1"] }), /Bilinmeyen kural/);
    await assert.rejects(hesapDuzelt({ bulgular: [5] }), /metin id/);
    await assert.rejects(hesapDuzelt({ bulgular: ["anahtar-marka:1"], degerler: { x: 1 } }), /degerler/);
  });
});
