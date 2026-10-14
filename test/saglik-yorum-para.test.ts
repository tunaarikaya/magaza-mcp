import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { yorumParaKurallari } from "../src/araclar/saglik/kurallar/yorum-para.js";
import type { Urun, Veri, Yorum } from "../src/araclar/saglik/tip.js";
import { ornekUygulama, ornekVeri } from "./saglik-ornek.js";

const yorum = (id: number, ust: Partial<Yorum> = {}): Yorum => ({
  id: `r${id}`,
  puan: 4,
  metin: `Good app ${id}`,
  takmaAd: `kisi${id}`,
  tarih: `2026-09-${String((id % 28) + 1).padStart(2, "0")}T10:00:00Z`,
  ...ust,
});

const kurallar = (ust: Parameters<typeof ornekUygulama>[1], veriUst: Partial<Veri> = {}) =>
  yorumParaKurallari(ornekVeri({ uygulamalar: [ornekUygulama("1", ust)], ...veriUst }));
const bul = (b: ReturnType<typeof kurallar>, kural: string) => b.find((x) => x.kural === kural);

describe("yorum & para kuralları", () => {
  it("temiz uygulama → bulgu yok", () => {
    assert.deepEqual(yorumParaKurallari(ornekVeri()), []);
  });

  it("sikayet-yorum: 5 şikâyet / 20 yorum → yüksek, 2 şikâyet → yok", () => {
    const sikayetler = ["It's a SCAM", "İADE istiyorum", "can't cancel, charged after trial", "Fraud app", "dolandırıcı"];
    const yorumlar = [...sikayetler.map((m, i) => yorum(i, { metin: m, puan: 1 })), ...Array.from({ length: 15 }, (_, i) => yorum(100 + i))];
    const b = bul(kurallar({ yorumlar }), "sikayet-yorum");
    assert.equal(b?.ciddiyet, "yuksek");
    assert.equal((b?.kanit as any).sayi, 5);
    assert.equal(bul(kurallar({ yorumlar: [...yorumlar.slice(0, 2), ...yorumlar.slice(5)] }), "sikayet-yorum"), undefined);
  });

  it("sikayet-yorum: 3 şikâyet → orta", () => {
    const yorumlar = ["scam", "refund please", "betrug"].map((m, i) => yorum(i, { metin: m }));
    assert.equal(bul(kurallar({ yorumlar }), "sikayet-yorum")?.ciddiyet, "orta");
  });

  it("yildiz-patlamasi: tek günde 12 adet 5★ → yüksek; 9 adet → yok", () => {
    const taban = Array.from({ length: 20 }, (_, i) => yorum(i));
    const patlama = (n: number) =>
      Array.from({ length: n }, (_, i) => yorum(200 + i, { puan: 5, metin: `harika ${i} uygulama gerçekten çok iyi ${i}`, tarih: "2026-09-15T08:00:00Z" }));
    assert.equal(bul(kurallar({ yorumlar: [...taban, ...patlama(12)] }), "yildiz-patlamasi")?.ciddiyet, "yuksek");
    assert.equal(bul(kurallar({ yorumlar: [...taban, ...patlama(9)] }), "yildiz-patlamasi"), undefined);
  });

  it("kopya-yorum: 3 farklı kişiden aynı metin → kritik, 2 → yüksek", () => {
    const metin = "Best planner app ever, totally changed my life!";
    const kopya = (n: number) => Array.from({ length: n }, (_, i) => yorum(300 + i, { metin: i % 2 ? metin.toUpperCase() : metin }));
    assert.equal(bul(kurallar({ yorumlar: [...kopya(3), yorum(1)] }), "kopya-yorum")?.ciddiyet, "kritik");
    assert.equal(bul(kurallar({ yorumlar: [...kopya(2), yorum(1)] }), "kopya-yorum")?.ciddiyet, "yuksek");
    // Aynı kişinin iki yorumu kopya grubu değildir.
    assert.equal(bul(kurallar({ yorumlar: kopya(2).map((y) => ({ ...y, takmaAd: "ayni" })) }), "kopya-yorum"), undefined);
  });

  it("yaniltici-yanit: teşvikli geliştirici yanıtı → yüksek", () => {
    const yorumlar = [yorum(1, { yanit: "Sorry! Please change your rating and get free premium." }), yorum(2, { yanit: "Thanks, fixed in 1.3" })];
    assert.equal(bul(kurallar({ yorumlar }), "yaniltici-yanit")?.ciddiyet, "yuksek");
    assert.equal(bul(kurallar({ yorumlar: [yorum(2, { yanit: "Thanks, fixed in 1.3" })] }), "yaniltici-yanit"), undefined);
    const deneme = "Yapay zeka ile foto üretmenin ciddi maliyetleri var. Buna rağmen ücretsiz deneme hakkı ve 3 günlük ücretsiz premium var.";
    assert.equal(bul(kurallar({ yorumlar: [yorum(3, { yanit: deneme })] }), "yaniltici-yanit"), undefined);
    const odul = "Yorumunu 5 yıldıza çevirirsen ücretsiz premium hediye ediyoruz!";
    assert.equal(bul(kurallar({ yorumlar: [yorum(4, { yanit: odul })] }), "yaniltici-yanit")?.ciddiyet, "yuksek");
  });

  it("iade-orani: eşikler ve satış verisi yokken sessiz", () => {
    const satis = (birim: number, iade: number) => ({ satis: { donem: "2026-09", uygulamalar: { "1": { birim, iade } } } });
    assert.equal(bul(kurallar({}, satis(100, 6)), "iade-orani")?.ciddiyet, "yuksek");
    assert.equal(bul(kurallar({}, satis(100, 3)), "iade-orani")?.ciddiyet, "orta");
    assert.equal(bul(kurallar({}, satis(100, 1)), "iade-orani"), undefined);
    assert.equal(bul(kurallar({}, satis(40, 20)), "iade-orani"), undefined);
    assert.equal(bul(kurallar({}), "iade-orani"), undefined);
  });

  it("indirme-yok: yayındaki uygulama 12 ayda ≤10 indirme → orta", () => {
    assert.equal(bul(kurallar({}, { yillikIndirme: { "1": 4 } }), "indirme-yok")?.ciddiyet, "orta");
    assert.equal(bul(kurallar({}, { yillikIndirme: {} }), "indirme-yok")?.ciddiyet, "orta");
    assert.equal(bul(kurallar({}, { yillikIndirme: { "1": 500 } }), "indirme-yok"), undefined);
    assert.equal(bul(kurallar({}), "indirme-yok"), undefined);
  });

  it("fiyat-anomalisi: pahalı haftalık → orta, haftalık ≥ aylık → yüksek", () => {
    const abone = (ad: string, periyot: string, abdFiyat: number): Urun => ({ id: ad, ad, tur: "abonelik", durum: "APPROVED", periyot, abdFiyat });
    assert.equal(bul(kurallar({ urunler: [abone("h", "ONE_WEEK", 12.99), abone("a", "ONE_MONTH", 29.99)] }), "fiyat-anomalisi")?.ciddiyet, "orta");
    assert.equal(bul(kurallar({ urunler: [abone("h", "ONE_WEEK", 9.99), abone("a", "ONE_MONTH", 7.99)] }), "fiyat-anomalisi")?.ciddiyet, "yuksek");
    assert.equal(bul(kurallar({ urunler: [abone("a", "ONE_MONTH", 149.99)] }), "fiyat-anomalisi")?.ciddiyet, "yuksek");
    assert.equal(bul(kurallar({ urunler: [abone("h", "ONE_WEEK", 4.99), abone("a", "ONE_MONTH", 9.99)] }), "fiyat-anomalisi"), undefined);
  });

  it("iap-sorunlu: REJECTED → orta, yalnız MISSING_METADATA → düşük", () => {
    const urun = (durum: string): Urun => ({ id: durum, ad: durum, tur: "iap", durum });
    assert.equal(bul(kurallar({ urunler: [urun("REJECTED"), urun("MISSING_METADATA")] }), "iap-sorunlu")?.ciddiyet, "orta");
    assert.equal(bul(kurallar({ urunler: [urun("MISSING_METADATA")] }), "iap-sorunlu")?.ciddiyet, "dusuk");
    assert.equal(bul(kurallar({ urunler: [urun("APPROVED")] }), "iap-sorunlu"), undefined);
  });
});
