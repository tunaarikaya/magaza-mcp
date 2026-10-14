import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { incelemeHesapKurallari } from "../src/araclar/saglik/kurallar/inceleme-hesap.js";
import type { Bulgu, Uygulama } from "../src/araclar/saglik/tip.js";
import { ornekUygulama, ornekVeri } from "./saglik-ornek.js";

const kos = (u: Partial<Uygulama>, ust = {}) =>
  incelemeHesapKurallari(ornekVeri({ uygulamalar: [ornekUygulama("1", u)], ...ust }));
const bul = (b: Bulgu[], id: string) => b.find((x) => x.id === id);

describe("inceleme-hesap kuralları", () => {
  it("temiz uygulamada bulgu yok", () => {
    assert.deepEqual(kos({}), []);
  });

  it("red-gecmisi: uygulama ve hesap düzeyi", () => {
    const surumler = ["REJECTED", "METADATA_REJECTED", "INVALID_BINARY", "REJECTED", "REJECTED"].map((durum, i) => ({
      id: `r${i}`, surum: `0.${i}`, durum, olusturma: "2026-05-01T00:00:00Z",
    }));
    // 2 red normal sayılır
    assert.equal(bul(kos({ surumler: surumler.slice(0, 2) }), "red-gecmisi:1"), undefined);
    assert.equal(bul(kos({ surumler: surumler.slice(0, 3) }), "red-gecmisi:1")?.ciddiyet, "orta");
    assert.equal(bul(kos({ surumler }), "red-gecmisi:1")?.ciddiyet, "yuksek");
    // 12 aydan eski reddi sayma
    assert.equal(bul(kos({ surumler: surumler.slice(0, 3).map((s) => ({ ...s, olusturma: "2024-01-01T00:00:00Z" })) }), "red-gecmisi:1"), undefined);

    const uygulamalar = ["1", "2"].map((id) => ornekUygulama(id, { surumler }));
    const h = incelemeHesapKurallari(ornekVeri({ uygulamalar }));
    assert.equal(bul(h, "red-gecmisi:hesap")?.ciddiyet, "yuksek");
  });

  it("uzun-bekleyen-inceleme", () => {
    const b = kos({ gonderimler: [{ id: "g1", durum: "WAITING_FOR_REVIEW", tarih: "2026-10-05T00:00:00Z" }] });
    assert.equal(bul(b, "uzun-bekleyen-inceleme:1:g1")?.ciddiyet, "yuksek");
    const o = kos({ gonderimler: [{ id: "g1", durum: "IN_REVIEW", tarih: "2026-10-10T00:00:00Z" }] });
    assert.equal(bul(o, "uzun-bekleyen-inceleme:1:g1")?.ciddiyet, "orta");
  });

  it("apple-kaldirdi yalnızca Apple'ın kaldırması", () => {
    const s = (magazaDurumu: string) => [{ id: "v", surum: "1", durum: "READY_FOR_DISTRIBUTION", magazaDurumu, olusturma: "2026-08-01T00:00:00Z" }];
    assert.equal(bul(kos({ surumler: s("REMOVED_FROM_SALE") }), "apple-kaldirdi:1")?.ciddiyet, "kritik");
    assert.equal(bul(kos({ surumler: s("DEVELOPER_REMOVED_FROM_SALE") }), "apple-kaldirdi:1"), undefined);
  });

  it("eski-uygulama", () => {
    const s = (olusturma: string) => [{ id: "v", surum: "1", durum: "READY_FOR_DISTRIBUTION", olusturma }];
    assert.equal(bul(kos({ surumler: s("2022-01-01T00:00:00Z") }), "eski-uygulama:1")?.ciddiyet, "orta");
    assert.equal(bul(kos({ surumler: s("2024-06-01T00:00:00Z") }), "eski-uygulama:1")?.ciddiyet, "dusuk");
  });

  it("isim-isgali", () => {
    const b = kos({
      surumler: [{ id: "v", surum: "1.0", durum: "PREPARE_FOR_SUBMISSION", olusturma: "2026-01-01T00:00:00Z" }],
      buildler: [],
    });
    assert.equal(bul(b, "isim-isgali:1")?.ciddiyet, "orta");
  });

  it("trader-durumu ve bolge-engeli", () => {
    const b = kos({
      bolgeDurumlari: {
        AVAILABLE: ["USA"],
        TRADER_STATUS_NOT_PROVIDED: ["DEU", "FRA"],
        MISSING_RATING: ["KOR"],
      },
    });
    assert.equal(bul(b, "trader-durumu:1")?.ciddiyet, "yuksek");
    const engel = bul(b, "bolge-engeli:1")!;
    assert.equal(engel.ciddiyet, "orta");
    assert.deepEqual(Object.keys(engel.kanit as object), ["MISSING_RATING"]);
  });

  it("bolge-engeli: yayında olmayan uygulama, genel CANNOT_SELL ve yalnız Çin", () => {
    const hepsi = ["USA", "FRA", "DEU"];
    const taslak = [{ id: "v", surum: "1.0", durum: "PREPARE_FOR_SUBMISSION", olusturma: "2026-09-01T00:00:00Z" }];
    assert.equal(bul(kos({ surumler: taslak, bolgeDurumlari: { MISSING_RATING: hepsi } }), "bolge-engeli:1"), undefined);
    assert.equal(bul(kos({ bolgeDurumlari: { CANNOT_SELL: hepsi } }), "bolge-engeli:1"), undefined);
    const cin = bul(kos({ bolgeDurumlari: { MISSING_GRN: ["CHN"], CANNOT_SELL: ["CHN", "KOR"] } }), "bolge-engeli:1")!;
    assert.equal(cin.ciddiyet, "dusuk");
    assert.deepEqual(Object.keys(cin.kanit as object), ["MISSING_GRN"]);
  });

  it("icerik-hakki-yok düzeltmesi", () => {
    const d = bul(kos({ icerikHaklari: null }), "icerik-hakki-yok:1")!.duzeltme!;
    assert.deepEqual(d.istekler("hayır")[0], {
      yontem: "PATCH",
      yol: "/v1/apps/1",
      govde: { data: { type: "apps", id: "1", attributes: { contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT" } } },
    });
    assert.equal((d.istekler("evet")[0].govde as any).data.attributes.contentRightsDeclaration, "USES_THIRD_PARTY_CONTENT");
    assert.throws(() => d.istekler("belki"));
  });

  it("sifreleme-beyani-yok: yalnız en son VALID build", () => {
    const build = (id: string, yuklenme: string, sifreleme: boolean | null) => ({ id, surum: id, yuklenme, sifreleme, durum: "VALID" });
    const d = bul(
      kos({ buildler: [build("a", "2026-07-01T00:00:00Z", null), build("b", "2026-08-01T00:00:00Z", null)] }),
      "sifreleme-beyani-yok:1",
    )!.duzeltme!;
    const istekler = d.istekler("hayır");
    assert.deepEqual(istekler.map((i) => i.yol), ["/v1/builds/b"]);
    assert.equal((istekler[0].govde as any).data.attributes.usesNonExemptEncryption, false);
    // eski build'deki boşluk önemsiz
    const eski = kos({ buildler: [build("a", "2026-07-01T00:00:00Z", null), build("b", "2026-08-01T00:00:00Z", false)] });
    assert.equal(bul(eski, "sifreleme-beyani-yok:1"), undefined);
  });

  it("demo-hesap-eksik: engel, maskeleme, PATCH/POST", () => {
    const detay = { id: "rd", demoGerekli: true, demoAd: "", demoSifre: "gizli123" };
    const kilitli = bul(kos({ incelemeDetayi: detay }), "demo-hesap-eksik:1")!;
    assert.equal(kilitli.ciddiyet, "orta");
    assert.ok(kilitli.duzeltme!.engel);
    assert.ok(!JSON.stringify(kilitli.duzeltme!.degisim).includes("gizli123"));

    const acik = bul(kos({ incelemeDetayi: detay, hedefSurumDuzenlenebilir: true, surumYerel: [{ id: "vl", dil: "en-US", aciklama: "x".repeat(10) }] }), "demo-hesap-eksik:1")!;
    assert.equal(acik.duzeltme!.engel, undefined);
    const [patch] = acik.duzeltme!.istekler("demo@ornek.com:Sifre:1");
    assert.equal(patch.yontem, "PATCH");
    assert.deepEqual((patch.govde as any).data.attributes, {
      demoAccountRequired: true, demoAccountName: "demo@ornek.com", demoAccountPassword: "Sifre:1",
    });
    assert.throws(() => acik.duzeltme!.istekler("sifresiz"));

    const giris = bul(
      kos({ incelemeDetayi: null, hedefSurumDuzenlenebilir: true, surumYerel: [{ id: "vl", dil: "en-US", aciklama: "Sign in to sync your notes." }] }),
      "demo-hesap-eksik:1",
    )!;
    assert.equal(giris.ciddiyet, "dusuk");
    const [post] = giris.duzeltme!.istekler("a:b");
    assert.equal(post.yontem, "POST");
    assert.equal((post.govde as any).data.relationships.appStoreVersion.data.id, "v-1");

    // abonelik metnindeki "account" giriş sayılmaz; Türkçe ekli kalıp sayılır
    const yerel = (aciklama: string) => [{ id: "vl", dil: "en-US", aciklama }];
    const abonelik = kos({ surumYerel: yerel("Payment will be charged to your Apple ID account at confirmation.") });
    assert.equal(bul(abonelik, "demo-hesap-eksik:1"), undefined);
    assert.ok(bul(kos({ surumYerel: yerel("Notlarını eşitlemek için giriş yapın.") }), "demo-hesap-eksik:1"));
  });

  it("inceleme-notu-bos: yalnızca düzenlenebilir sürümde, red varsa orta", () => {
    const detay = { id: "rd", notlar: "Bug fixes" };
    assert.equal(bul(kos({ incelemeDetayi: detay }), "inceleme-notu-bos:1"), undefined);
    const b = bul(kos({ incelemeDetayi: detay, hedefSurumDuzenlenebilir: true }), "inceleme-notu-bos:1")!;
    assert.equal(b.ciddiyet, "dusuk");
    assert.deepEqual((b.duzeltme!.istekler("Open the app and tap + to add a task.")[0].govde as any).data.attributes, {
      notes: "Open the app and tap + to add a task.",
    });
    assert.throws(() => b.duzeltme!.istekler("kısa"));
    const red = kos({
      incelemeDetayi: detay,
      hedefSurumDuzenlenebilir: true,
      gonderimler: [{ id: "g", durum: "UNRESOLVED_ISSUES", tarih: "2026-09-01T00:00:00Z" }],
    });
    assert.equal(bul(red, "inceleme-notu-bos:1")?.ciddiyet, "orta");
  });

  it("yanlis-beyan: içerik, şifreleme, kumar", () => {
    const yerel = (aciklama: string) => [{ id: "vl", dil: "en-US", aciklama }];
    assert.equal(bul(kos({ surumYerel: yerel("Draw your favourite Naruto characters.") }), "yanlis-beyan:1:icerik")?.ciddiyet, "orta");
    assert.equal(bul(kos({ surumYerel: yerel("Fast VPN with military-grade encryption.") }), "yanlis-beyan:1:sifreleme")?.ciddiyet, "yuksek");
    const kumar = kos({
      surumYerel: yerel("Spin the casino wheel and win!"),
      yasBeyani: { id: "y", ozellikler: { gambling: false, gamblingSimulated: "NONE" } },
    });
    assert.equal(bul(kumar, "yanlis-beyan:1:kumar")?.ciddiyet, "yuksek");
    // "better" içindeki "bet" tetiklememeli
    const temiz = kos({
      surumYerel: yerel("A better planner."),
      yasBeyani: { id: "y", ozellikler: { gambling: false, gamblingSimulated: "NONE" } },
    });
    assert.equal(bul(temiz, "yanlis-beyan:1:kumar"), undefined);
    // "poker face" parti oyunu kumar sayılmaz
    const parti = kos({
      surumYerel: yerel("Keep your poker face and find the spy. Place your bet on who is lying!"),
      yasBeyani: { id: "y", ozellikler: { gambling: false, gamblingSimulated: "NONE" } },
    });
    assert.equal(bul(parti, "yanlis-beyan:1:kumar"), undefined);
  });

  it("yas-anketi-eksik", () => {
    const b = bul(kos({ yasBeyani: { id: "y", ozellikler: { gambling: false, ageAssurance: null, advertising: false } } }), "yas-anketi-eksik:1")!;
    assert.equal(b.ciddiyet, "orta");
    assert.ok((b.kanit as any).bos_alanlar.includes("ageAssurance"));
    assert.ok(!(b.kanit as any).bos_alanlar.includes("advertising"));
  });

  it("fazla-admin: kullanıcı ve davet", () => {
    const kullanicilar = ["a", "b", "c", "d"].map((id) => ({ id, roller: ["ADMIN"], tumUygulamalar: true }));
    const b = incelemeHesapKurallari(
      ornekVeri({ kullanicilar, davetler: [{ id: "d1", roller: ["ADMIN"], bitis: "2026-12-01T00:00:00Z" }] }),
    );
    assert.equal(bul(b, "fazla-admin:hesap:kullanici")?.ciddiyet, "orta");
    assert.equal(bul(b, "fazla-admin:hesap:davet")?.ciddiyet, "dusuk");
    assert.ok(b.every((x) => !x.duzeltme || x.kural !== "fazla-admin"));
  });
});
