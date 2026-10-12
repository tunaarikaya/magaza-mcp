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

  it("fiyat sayı olmalı", async () => {
    await assert.rejects(arac("appstore__abonelik_fiyat_ayarla").calistir({ abonelik_id: "1", fiyat: "bedava" }), /sayı/);
  });
});
