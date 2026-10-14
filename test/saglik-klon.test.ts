import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { klonKurallari } from "../src/araclar/saglik/kurallar/klon.js";
import type { Uygulama } from "../src/araclar/saglik/tip.js";
import { ornekUygulama, ornekVeri } from "./saglik-ornek.js";

const ACIKLAMALAR = [
  "Start a focused work session, block distractions and review where your hours went each week.",
  "Save recipes from anywhere, scale ingredients for any crowd and cook step by step hands free.",
  "Split shared bills with friends, see monthly spending trends and export everything to a spreadsheet.",
  "Fall asleep to rain, ocean waves or brown noise with a gentle fade out timer.",
  "Grow a tiny garden that blooms every time you keep a habit going for another day.",
];

/** Birbirinden gerçekten farklı, temiz bir uygulama. */
function temiz(id: string, ad: string, ust: Partial<Uygulama> = {}): Uygulama {
  const u = ornekUygulama(id, { ad, bundleId: `com.ornek.${ad.toLowerCase().replace(/\s+/g, "")}`, ...ust });
  u.surumYerel = [{ ...u.surumYerel[0], aciklama: ACIKLAMALAR[(Number(id) - 1) % ACIKLAMALAR.length] }];
  return u;
}

const calistir = (uygulamalar: Uygulama[]) => klonKurallari(ornekVeri({ uygulamalar }));
const kural = (uygulamalar: Uygulama[], k: string) => calistir(uygulamalar).filter((b) => b.kural === k);

describe("klon kuralları", () => {
  it("üç farklı temiz uygulama → bulgu yok", () => {
    assert.deepEqual(calistir([temiz("1", "Focus Timer"), temiz("2", "Recipe Box"), temiz("3", "Budget Tracker")]), []);
  });

  it("eksik veriye dayanıklı", () => {
    assert.deepEqual(klonKurallari(ornekVeri({ uygulamalar: [] })), []);
    const yarim = { id: "9", ad: "X", bundleId: "", anaDil: "en-US", icerikHaklari: null } as unknown as Uygulama;
    assert.doesNotThrow(() => calistir([yarim, temiz("1", "Focus Timer")]));
  });

  it("klon-ekran-goruntusu: 2 uygulama yüksek, 3 uygulama kritik", () => {
    const ekran = [{ dil: "en-US", checksum: "ayni", tur: "APP_IPHONE_67" }];
    const iki = kural([temiz("1", "Focus Timer", { ekranGoruntuleri: ekran }), temiz("2", "Recipe Box", { ekranGoruntuleri: ekran })], "klon-ekran-goruntusu");
    assert.equal(iki.length, 1);
    assert.equal(iki[0].ciddiyet, "yuksek");
    assert.equal(iki[0].id, "klon-ekran-goruntusu:hesap:1+2");
    const uc = kural(
      ["Focus Timer", "Recipe Box", "Budget Tracker"].map((ad, i) => temiz(String(i + 1), ad, { ekranGoruntuleri: ekran })),
      "klon-ekran-goruntusu",
    );
    assert.equal(uc[0].ciddiyet, "kritik");
  });

  it("klon-isim: Pro / Lite varyantları", () => {
    const b = kural([temiz("1", "Photo Editor Pro"), temiz("2", "Photo Editor Lite"), temiz("3", "Budget Tracker")], "klon-isim");
    assert.equal(b.length, 1);
    assert.equal(b[0].ciddiyet, "yuksek");
    assert.deepEqual((b[0].kanit as any).uygulamalar, ["Photo Editor Pro", "Photo Editor Lite"]);
  });

  it("klon-aciklama: aynı açıklama ve şablon izi", () => {
    const metin = "The best way to track your daily water intake and stay hydrated all day long with reminders.";
    const a = temiz("1", "Focus Timer");
    const b = temiz("2", "Recipe Box");
    a.surumYerel[0].aciklama = metin;
    b.surumYerel[0].aciklama = metin;
    const c = temiz("3", "Budget Tracker");
    c.surumYerel[0].aciklama = "Welcome to [App Name]! Lorem ipsum dolor sit amet.";
    const bulgular = kural([a, b, c], "klon-aciklama");
    assert.equal(bulgular.find((x) => x.id === "klon-aciklama:hesap:1+2")?.ciddiyet, "yuksek");
    assert.equal(bulgular.find((x) => x.id === "klon-aciklama:3:sablon")?.ciddiyet, "orta");
  });

  it("sirali-bundle: 3 orta, 5 yüksek", () => {
    const uret = (n: number) =>
      ["Focus Timer", "Recipe Box", "Budget Tracker", "Sleep Sounds", "Habit Garden"].slice(0, n).map((ad, i) =>
        temiz(String(i + 1), ad, { bundleId: `com.fabrika.app${i + 1}` }),
      );
    assert.equal(kural(uret(3), "sirali-bundle")[0].ciddiyet, "orta");
    assert.equal(kural(uret(5), "sirali-bundle")[0].ciddiyet, "yuksek");
    assert.equal(kural(uret(2), "sirali-bundle").length, 0);
  });

  it("doymus-kategori: aynı temada iki uygulama orta, tek uygulama ya da farklı temalar sessiz", () => {
    assert.equal(kural([temiz("1", "Bright Flashlight"), temiz("2", "Recipe Box")], "doymus-kategori").length, 0);
    assert.equal(kural([temiz("1", "Bright Flashlight"), temiz("2", "Günlük Burç Yorumu")], "doymus-kategori").length, 0);
    const ikiFener = kural([temiz("1", "Bright Flashlight"), temiz("2", "Torch Light")], "doymus-kategori");
    assert.equal(ikiFener.length, 1);
    assert.equal(ikiFener[0].ciddiyet, "orta");
    assert.equal(ikiFener[0].id, "doymus-kategori:hesap:fener");
  });

  it("doymus-kategori: anahtar kelimeler ve 'junk food' tema sayılmaz", () => {
    const a = temiz("1", "Pozify: AI Profile Photo");
    const b = temiz("2", "Recipe Box");
    for (const u of [a, b]) u.surumYerel[0].anahtarKelimeler = "dating,barcode,cleaner";
    assert.equal(kural([a, b], "doymus-kategori").length, 0);
    const yemek = kural([temiz("1", "Junk Food Scanner"), temiz("2", "Junk Food Diary")], "doymus-kategori");
    assert.equal(yemek.length, 0);
    const temizleyici = kural([temiz("1", "Junk Files Remover"), temiz("2", "Phone Cleaner")], "doymus-kategori");
    assert.equal(temizleyici[0]?.id, "doymus-kategori:hesap:temizleyici");
  });

  it("yabanci-copyright: farklı sahip, engel ve düzeltme isteği", () => {
    const yabanci = temiz("3", "Budget Tracker");
    yabanci.surumler = [{ ...yabanci.surumler[0], copyright: "© 2024 Other Studio LLC. All rights reserved." }];
    const uygulamalar = [temiz("1", "Focus Timer"), temiz("2", "Recipe Box"), yabanci];

    const [b] = kural(uygulamalar, "yabanci-copyright");
    assert.equal(b.id, "yabanci-copyright:3:sahip");
    assert.equal(b.ciddiyet, "orta");
    assert.ok(b.duzeltme?.engel);
    assert.deepEqual(b.duzeltme!.istekler("© 2026 Ornek Ltd"), []);

    yabanci.hedefSurumDuzenlenebilir = true;
    const [d] = kural(uygulamalar, "yabanci-copyright");
    assert.equal(d.duzeltme?.engel, undefined);
    assert.deepEqual(d.duzeltme!.istekler("© 2026 Ornek Ltd"), [
      {
        yontem: "PATCH",
        yol: "/v1/appStoreVersions/v-3",
        govde: { data: { type: "appStoreVersions", id: "v-3", attributes: { copyright: "© 2026 Ornek Ltd" } } },
      },
    ]);
    assert.throws(() => d.duzeltme!.istekler("  "));

    const ucuncu = temiz("4", "Sleep Sounds");
    ucuncu.surumler = [{ ...ucuncu.surumler[0], copyright: "2025 Baska Yazilim Ltd. Şti." }];
    const uc = kural([...uygulamalar, ucuncu], "yabanci-copyright");
    assert.equal(uc.length, 2);
    assert.ok(uc.every((x) => x.ciddiyet === "orta"));
  });

  it("yabanci-copyright: uygulamanın kendi markası ve aynı sahibin uzun adı yabancı sayılmaz", () => {
    const marka = (id: string, ad: string, copyright: string) => {
      const u = temiz(id, ad);
      u.surumler = [{ ...u.surumler[0], copyright }];
      return u;
    };
    const uygulamalar = [
      marka("1", "Focus Timer", "© 2026 Smartify"),
      marka("2", "Recipe Box", "© 2026 Smartify"),
      marka("3", "Calorie Friend: AI Counter", "2026 Calorie Friend"),
      marka("4", "Watch Car Race: Carify", "2026 Carify"),
      marka("5", "Pozify: AI Profile Photo", "©Smartify Apps 2026"),
    ];
    assert.deepEqual(kural(uygulamalar, "yabanci-copyright"), []);
    const kisi = marka("6", "Spy: Find the Liar", "2025 Emirhan Akyıldırım");
    const ekip = marka("7", "Home Decor: AI Room Designer", "Emirhan Akyıldırım & Mehmet Tuna Arıkaya");
    const b = kural([...uygulamalar, kisi, ekip], "yabanci-copyright");
    assert.deepEqual(b.map((x) => x.id).sort(), ["yabanci-copyright:6:sahip", "yabanci-copyright:7:sahip"]);
    assert.match(b[0].baslik, /farklı bir sahip/);
  });

  it("yabanci-copyright: sürümler arası sahip değişimi", () => {
    const u = temiz("1", "Focus Timer");
    u.surumler = [
      { ...u.surumler[0], id: "v2", surum: "2.0", copyright: "© 2026 Ornek Ltd" },
      { ...u.surumler[0], id: "v1", surum: "1.0", copyright: "© 2022 Eski Sahip Inc." },
    ];
    const b = kural([u], "yabanci-copyright");
    assert.equal(b.length, 1);
    assert.equal(b[0].id, "yabanci-copyright:1:degisim");

    u.surumler[1].copyright = "2025 Focus Timer";
    assert.equal(kural([u], "yabanci-copyright").length, 0);
  });

  it("toplu-yayin: 30 günde 5 uygulama orta", () => {
    const adlar = ["Focus Timer", "Recipe Box", "Budget Tracker", "Sleep Sounds", "Habit Garden"];
    const uygulamalar = adlar.map((ad, i) => {
      const u = temiz(String(i + 1), ad);
      u.surumler = [{ ...u.surumler[0], olusturma: `2026-09-0${i + 1}T00:00:00Z` }];
      return u;
    });
    const [b] = kural(uygulamalar, "toplu-yayin");
    assert.equal(b.ciddiyet, "orta");
    assert.equal(b.id, "toplu-yayin:hesap:2026-09-01");
    uygulamalar[4].surumler[0].olusturma = "2025-01-01T00:00:00Z";
    assert.equal(kural(uygulamalar, "toplu-yayin").length, 0);
  });
});
