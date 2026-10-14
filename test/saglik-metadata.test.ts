import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { metadataKurallari } from "../src/araclar/saglik/kurallar/metadata.js";
import type { AppInfo, Bulgu, Uygulama } from "../src/araclar/saglik/tip.js";
import { ornekUygulama, ornekVeri } from "./saglik-ornek.js";

const calistir = (u: Uygulama) => metadataKurallari(ornekVeri({ uygulamalar: [u] }));
const bul = (l: Bulgu[], kural: string) => l.find((b) => b.kural === kural);
const govde = (b: Bulgu | undefined, deger?: string) =>
  b!.duzeltme!.istekler(deger).map((i) => (i.govde as any).data.attributes);

function info(ad: string, ust: Partial<AppInfo> = {}, altBaslik = "Plan your day"): AppInfo {
  return {
    id: "ai-x",
    durum: "PREPARE_FOR_SUBMISSION",
    duzenlenebilir: true,
    kategori: "PRODUCTIVITY",
    yerel: [{ id: "ail-x", dil: "en-US", ad, altBaslik, gizlilikUrl: "https://ornek.com/gizlilik" }],
    ...ust,
  };
}

function anahtar(keywords: string, ust: Partial<Uygulama> = {}): Uygulama {
  const u = ornekUygulama("1", ust);
  return { ...u, surumYerel: [{ ...u.surumYerel[0], anahtarKelimeler: keywords }] };
}

describe("metadataKurallari", () => {
  it("temiz uygulamada bulgu yok", () => {
    assert.deepEqual(metadataKurallari(ornekVeri()), []);
  });

  it("anahtar-marka: markaları çıkarır, tekrar temizliğiyle aynı değeri yazar", () => {
    const l = calistir(anahtar("photo,instagram,edit, tiktok captions", { hedefSurumDuzenlenebilir: true }));
    const b = bul(l, "anahtar-marka")!;
    assert.equal(b.ciddiyet, "yuksek");
    assert.equal(b.duzeltme!.engel, undefined);
    const istek = b.duzeltme!.istekler()[0];
    assert.equal(istek.yontem, "PATCH");
    assert.equal(istek.yol, "/v1/appStoreVersionLocalizations/vl-1");
    assert.deepEqual(govde(b), [{ keywords: "photo,edit,captions" }]);
    assert.deepEqual(govde(bul(l, "anahtar-tekrar")), [{ keywords: "photo,edit,captions" }]);
  });

  it("anahtar-marka: düzenlenebilir sürüm yoksa engel", () => {
    const b = bul(calistir(anahtar("photo,instagram")), "anahtar-marka")!;
    assert.match(b.duzeltme!.engel!, /Düzenlenebilir sürüm yok/);
  });

  it("isim-marka: Apple markası kritik, değer doğrulanır", () => {
    const u = ornekUygulama("1", { bilgiler: [info("Notes for iPhone")] });
    const b = bul(calistir(u), "isim-marka")!;
    assert.equal(b.ciddiyet, "kritik");
    assert.equal(b.id, "isim-marka:1:en-US");
    assert.deepEqual(govde(b, "Notes Pro"), [{ name: "Notes Pro" }]);
    assert.throws(() => govde(b, "Notes iPhone"), /hâlâ sorunlu/);
  });

  it("isim-marka: başka marka yüksek; kilitli appInfo engel", () => {
    const u = ornekUygulama("1", { bilgiler: [info("Saver", { duzenlenebilir: false }, "Pics for Instagram")] });
    const b = bul(calistir(u), "isim-marka")!;
    assert.equal(b.ciddiyet, "yuksek");
    assert.match(b.duzeltme!.engel!, /appInfo yok/);
    assert.equal(b.duzeltme!.degisim[0].alan, "subtitle (en-US)");
  });

  it("isim-yasak-ifade: ifadeyi ve artan ayraçları temizler", () => {
    const u = ornekUygulama("1", { bilgiler: [info("Planner - Best Free", {}, "#1 to-do list")] });
    const b = bul(calistir(u), "isim-yasak-ifade")!;
    assert.deepEqual(govde(b), [{ name: "Planner", subtitle: "to-do list" }]);
  });

  it("isim-yasak-ifade: boş kalacaksa otomatik düzeltme yok", () => {
    const u = ornekUygulama("1", { bilgiler: [info("Planner", {}, "Free")] });
    const b = bul(calistir(u), "isim-yasak-ifade")!;
    assert.equal(b.duzeltme, undefined);
  });

  it("isim-yasak-ifade: 'smoke free' gibi bileşikler sayılmaz, düzeltme onları silmez", () => {
    for (const alt of ["Become smoke free", "Sugar-free recipes", "Ad free & calm"]) {
      const u = ornekUygulama("1", { bilgiler: [info("Quity: Quit Smoking Tracker", {}, alt)] });
      assert.equal(bul(calistir(u), "isim-yasak-ifade"), undefined, alt);
    }
    const u = ornekUygulama("1", { bilgiler: [info("Quity Free", {}, "Smoke free life")] });
    const b = bul(calistir(u), "isim-yasak-ifade")!;
    assert.deepEqual(govde(b), [{ name: "Quity" }]);
  });

  it("anahtar-tekrar: isimdeki kelime, app, tekrar ve boşluk", () => {
    const u = anahtar("photo,app,filters, filters", { bilgiler: [info("Photo Editor")], hedefSurumDuzenlenebilir: true });
    const b = bul(calistir(u), "anahtar-tekrar")!;
    assert.equal(b.ciddiyet, "dusuk");
    assert.deepEqual(govde(b), [{ keywords: "filters" }]);
  });

  it("kelime-doldurma", () => {
    const u = ornekUygulama("1", { bilgiler: [info("Photo, Video, Collage | Editor")] });
    const b = bul(calistir(u), "kelime-doldurma")!;
    assert.equal(b.duzeltme!.gerekenDeger?.startsWith("yeni kısa isim"), true);
    assert.throws(() => govde(b, "x".repeat(31)), /30 karakter/);
    assert.ok(bul(calistir(ornekUygulama("1", { bilgiler: [info("Photo - Video - Collage, Editor")] })), "kelime-doldurma"));
  });

  it("kelime-doldurma: 'Marka: açıklama' biçimli normal isimler tetiklemez", () => {
    for (const ad of [
      "Focusrot: Trình Chặn Ứng Dụng",
      "Home Decor: AI Room Designer",
      "Pozify: Foto IA & Face Swap",
      "Super Ball Sort - Color Puzzle",
      "AI Music & Beat Maker - Nora",
    ]) {
      assert.equal(bul(calistir(ornekUygulama("1", { bilgiler: [info(ad)] })), "kelime-doldurma"), undefined, ad);
    }
  });

  it("aciklama-platform: dil ekli id, açıklamayı yazar", () => {
    const u0 = ornekUygulama("1", { hedefSurumDuzenlenebilir: true });
    const u = { ...u0, surumYerel: [{ ...u0.surumYerel[0], aciklama: "Also on Android and Google Play." }] };
    const b = bul(calistir(u), "aciklama-platform")!;
    assert.equal(b.id, "aciklama-platform:1:en-US");
    assert.deepEqual(govde(b, "A calm planner."), [{ description: "A calm planner." }]);
    assert.throws(() => govde(b, "Get it on Android too"), /hâlâ sorunlu/);
  });

  it("gizlilik-url-yok: https şart", () => {
    const i = info("Planner");
    const u = ornekUygulama("1", { bilgiler: [{ ...i, yerel: [{ ...i.yerel[0], gizlilikUrl: undefined }] }] });
    const b = bul(calistir(u), "gizlilik-url-yok")!;
    assert.equal(b.ciddiyet, "yuksek");
    assert.throws(() => govde(b, "http://ornek.com/p"), /https/);
    assert.deepEqual(govde(b, "https://ornek.com/p"), [{ privacyPolicyUrl: "https://ornek.com/p" }]);
  });

  it("destek-url-yok", () => {
    const u0 = ornekUygulama("1", { hedefSurumDuzenlenebilir: true });
    const u = { ...u0, surumYerel: [{ ...u0.surumYerel[0], destekUrl: undefined }] };
    const b = bul(calistir(u), "destek-url-yok")!;
    assert.throws(() => govde(b, "destek"), /Geçerli bir adres değil/);
    assert.deepEqual(govde(b, "https://ornek.com/d"), [{ supportUrl: "https://ornek.com/d" }]);
  });

  it("medya-indirici kritik, rehber", () => {
    const b = bul(calistir(ornekUygulama("1", { bilgiler: [info("Video Downloader")] })), "medya-indirici")!;
    assert.equal(b.ciddiyet, "kritik");
    assert.equal(b.duzeltme, undefined);
  });

  it("sahte-islev", () => {
    const b = bul(calistir(anahtar("ram cleaner,booster")), "sahte-islev")!;
    assert.equal(b.ciddiyet, "yuksek");
  });

  it("regule-alan: büyük harf/Türkçe karakter güvenli", () => {
    const l = calistir(ornekUygulama("1", { bilgiler: [info("Hızlı VPN", {}, "KREDİ hesapla")] }));
    assert.deepEqual((bul(l, "regule-alan")!.kanit as any).terimler.sort(), ["kredi", "vpn"]);
  });

  it("konsept-degisimi: isim ve kategori kökten değişmiş", () => {
    const eski = info("Calm Planner", { id: "ai-eski", durum: "READY_FOR_DISTRIBUTION", duzenlenebilir: false });
    const yeni = info("Lucky Slots", { id: "ai-yeni", kategori: "GAMES" });
    const b = bul(calistir(ornekUygulama("1", { bilgiler: [eski, yeni] })), "konsept-degisimi")!;
    assert.equal(b.ciddiyet, "yuksek");
    assert.deepEqual((b.kanit as any).kategori, { eski: "PRODUCTIVITY", yeni: "GAMES" });
    // Sessiz düzeltme: Apple'a kendiliğinden açıklama yönlendirmesi yok, 'yapma' listesi var.
    assert.ok(![b.neden, ...b.adimlar].some((s) => /apple'a açıkla/i.test(s)));
    assert.ok(b.yapma?.length);
  });

  it("her metadata bulgusunun 'yapma' listesi var", () => {
    const l = calistir(
      ornekUygulama("1", {
        bilgiler: [info("Best Instagram Saver, Free | Pro", {}, "video downloader vpn")],
        surumYerel: [{ id: "vl-1", dil: "en-US", aciklama: "Also on Android.", anahtarKelimeler: "tiktok,app, saver" }],
      }),
    );
    assert.ok(l.length >= 5);
    for (const b of l) assert.ok(b.yapma?.length, `${b.kural} yapma listesi boş`);
  });
});
