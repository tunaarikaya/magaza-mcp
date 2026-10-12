/**
 * Arama ve yazma kolaylıkları — ağa çıkmadan doğrulanabilenler.
 *
 * "abonelik fiyat" ve "yaş derecelendirme" aramaları sıfır dönüyordu; model
 * ya vazgeçiyor ya da ülke başına POST'a sürükleniyordu. Bu testler o
 * gerilemenin geri gelmesini yakalar.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appstoreYazmaAraclari } from "../src/araclar/appstore-yazma.js";
import { dispatchAraclari } from "../src/araclar/dispatch.js";
import { guzelFiyat, yeniKanallar } from "../src/araclar/play-yazma.js";
import { ara } from "../src/katalog/yukle.js";

const ilkler = (sorgu: string, n = 5) => ara(sorgu, { magaza: "appstore", limit: n }).map((s) => s.ad);

describe("ara", () => {
  it("Türkçe kelimeleri API terimine çevirir", () => {
    assert.ok(ara("abonelik fiyat", { magaza: "appstore" }).length > 0);
    assert.ok(ilkler("yaş derecelendirme", 8).includes("ageRatingDeclarations_updateInstance"));
  });

  it("tekil kelime çoğul operasyonu bulur", () => {
    assert.ok(
      ilkler("subscription plan availability", 10).some((a) => a.startsWith("subscriptionPlanAvailabilities")),
    );
  });
});

describe("magaza__cagir gövde tamamlama", () => {
  it("PATCH'te eksik type ve id'yi şemadan/yoldan doldurur", async () => {
    const cagir = dispatchAraclari().find((a) => a.ad === "magaza__cagir")!;
    const sonuc: any = await cagir.calistir({
      magaza: "appstore",
      operasyon: "ageRatingDeclarations_updateInstance",
      parametreler: { id: "abc" },
      govde: { data: { attributes: { lootBox: false } } },
    });
    assert.equal(sonuc.onay_gerekli, true);
    assert.equal(sonuc.gonderilecek_govde.data.type, "ageRatingDeclarations");
    assert.equal(sonuc.gonderilecek_govde.data.id, "abc");
  });
});

describe("yazma araçları ağa çıkmadan girdiyi reddeder", () => {
  const arac = (ad: string) => appstoreYazmaAraclari().find((a) => a.ad === ad)!;

  it("yaş derecelendirmesinde bilinmeyen soru ve geçersiz değer", async () => {
    const yas = arac("appstore__yas_derecelendirme");
    await assert.rejects(yas.calistir({ uygulama_id: "1", cevaplar: { seventeenPlus: true } }), /Bilinmeyen soru/);
    await assert.rejects(yas.calistir({ uygulama_id: "1", cevaplar: { contests: "SOMETIMES" } }), /NONE/);
    await assert.rejects(yas.calistir({ uygulama_id: "1", cevaplar: { lootBox: "evet" } }), /true\/false/);
  });

  it("abonelik kurulumunda grup zorunlu", async () => {
    await assert.rejects(
      arac("appstore__abonelik_kur").calistir({
        uygulama_id: "1",
        urun_id: "x",
        isim: "x",
        sure: "ONE_MONTH",
        yerellestirmeler: [{ dil: "tr", ad: "x" }],
      }),
      /grup_id ya da grup_adi/,
    );
  });

  it("abonelik fiyatında fiyat ya da ozel_fiyatlar zorunlu, ozel_fiyatlar nesne olmalı", async () => {
    const fiyat = arac("appstore__abonelik_fiyat_ayarla");
    await assert.rejects(fiyat.calistir({ abonelik_id: "1" }), /fiyat ya da ozel_fiyatlar/);
    await assert.rejects(fiyat.calistir({ abonelik_id: "1", ozel_fiyatlar: ["TUR"] }), /nesne olmalı/);
    await assert.rejects(fiyat.calistir({ abonelik_id: "1", ozel_fiyatlar: { TUR: "bedava" } }), /TUR fiyatı/);
  });

  it("fiyat sayı olmalı", async () => {
    await assert.rejects(arac("appstore__abonelik_fiyat_ayarla").calistir({ abonelik_id: "1", fiyat: "bedava" }), /sayı/);
  });
});

describe("Play yayın hesabı", () => {
  const tamam = { status: "completed", versionCodes: ["30"] };
  const kademeli = { status: "inProgress", versionCodes: ["31"], userFraction: 0.1 };

  it("yüzde artırınca kademeli sürüm değişir, tamamlanmış sürüm korunur", () => {
    const { kaynak } = yeniKanallar({ kanal: "production", islem: "yuzde", yuzde: 50 }, [tamam, kademeli], []);
    assert.deepEqual(kaynak, [tamam, { ...kademeli, userFraction: 0.5 }]);
  });

  it("tamamla ve %100 kanalda tek tamamlanmış sürüm bırakır", () => {
    for (const girdi of [{ islem: "tamamla" }, { islem: "yuzde", yuzde: 100 }]) {
      const { kaynak } = yeniKanallar({ kanal: "production", ...girdi }, [tamam, kademeli], []);
      assert.deepEqual(kaynak, [{ status: "completed", versionCodes: ["31"] }]);
    }
  });

  it("durdurulmuş sürümün yüzdesi değişince durdurulmuş kalır", () => {
    const { kaynak } = yeniKanallar({ kanal: "production", islem: "yuzde", yuzde: 20 }, [{ ...kademeli, status: "halted" }], []);
    assert.equal(kaynak![0].status, "halted");
  });

  it("taşıma hedefteki tamamlanmış sürümü korur", () => {
    const { hedef } = yeniKanallar({ kanal: "internal", islem: "tasi", hedef_kanal: "production", yuzde: 10 }, [{ status: "completed", versionCodes: ["32"] }], [tamam]);
    assert.deepEqual(hedef, [tamam, { name: undefined, versionCodes: ["32"], releaseNotes: undefined, status: "inProgress", userFraction: 0.1 }]);
  });

  it("kademeli yayın yokken yüzde değiştirmek hata verir", () => {
    assert.throws(() => yeniKanallar({ kanal: "production", islem: "yuzde", yuzde: 50 }, [tamam], []), /kademeli yayın yok/);
  });

  it("fiyatı mağazada doğal görünen biçime yuvarlar", () => {
    assert.equal(guzelFiyat(359.43, "TRY"), 359.99);
    assert.equal(guzelFiyat(1287, "JPY"), 1300);
    assert.equal(guzelFiyat(7812.4, "NGN"), 7800);
    assert.equal(guzelFiyat(8.43, "EUR"), 8.39);
  });
});
