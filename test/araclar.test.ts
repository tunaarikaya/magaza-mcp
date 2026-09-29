/**
 * Araç listesi testleri.
 *
 * Buradaki sayılar README'de ve AGENTS.md'de yazılı: "iki mağazada 27, tek
 * mağazada 14/13, salt-okunurda 24". Bir araç eklenip dokümanı güncellenmezse
 * bu testler uyarır.
 *
 * Asıl önemlisi kapsam: seçilmeyen mağazanın araçlarının hiç yüklenmemesi ve
 * salt-okunur modda yazma araçlarının listede görünmemesi güvenlik vaadinin
 * kendisi — model göremediği aracı çağıramaz.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { araclariTopla } from "../src/index.js";

const oncekiMagazalar = process.env.MAGAZALAR;
const oncekiSaltOkunur = process.env.SALT_OKUNUR;

/** Ortamı değiştirip araçları topla; test bitince ortam geri alınır. */
function ortamda(magazalar: string | undefined, saltOkunur = false) {
  if (magazalar === undefined) delete process.env.MAGAZALAR;
  else process.env.MAGAZALAR = magazalar;

  if (saltOkunur) process.env.SALT_OKUNUR = "1";
  else delete process.env.SALT_OKUNUR;

  return araclariTopla();
}

afterEach(() => {
  if (oncekiMagazalar === undefined) delete process.env.MAGAZALAR;
  else process.env.MAGAZALAR = oncekiMagazalar;

  if (oncekiSaltOkunur === undefined) delete process.env.SALT_OKUNUR;
  else process.env.SALT_OKUNUR = oncekiSaltOkunur;
});

const adlar = (araclar: { ad: string }[]) => araclar.map((a) => a.ad);

describe("araclariTopla", () => {
  it("iki mağaza açıkken 27 araç yükler", () => {
    assert.equal(ortamda("appstore,play").length, 27);
  });

  it("MAGAZALAR verilmezse iki mağaza da açıktır", () => {
    assert.equal(ortamda(undefined).length, 27);
  });

  it("yalnızca App Store'da 14 araç yükler, hiç play__ aracı olmaz", () => {
    const araclar = ortamda("appstore");
    assert.equal(araclar.length, 14);
    assert.equal(adlar(araclar).filter((a) => a.startsWith("play__")).length, 0);
  });

  it("yalnızca Play'de 13 araç yükler, hiç appstore__ aracı olmaz", () => {
    const araclar = ortamda("play");
    assert.equal(araclar.length, 13);
    assert.equal(adlar(araclar).filter((a) => a.startsWith("appstore__")).length, 0);
  });

  it("çapraz araçlar yalnızca iki mağaza da açıkken oluşur", () => {
    const capraz = ["magaza__genel_bakis", "magaza__abonelik_karsilastir", "magaza__iap_teshis"];

    for (const ad of capraz) {
      assert.ok(adlar(ortamda("appstore,play")).includes(ad), `${ad} iki mağazada olmalı`);
      assert.ok(!adlar(ortamda("appstore")).includes(ad), `${ad} tek mağazada olmamalı`);
      assert.ok(!adlar(ortamda("play")).includes(ad), `${ad} tek mağazada olmamalı`);
    }
  });

  it("salt-okunur modda yazma araçları listeye hiç girmez", () => {
    const araclar = ortamda("appstore,play", true);
    assert.equal(araclar.length, 24);

    for (const ad of ["appstore__yorum_yanitla", "appstore__metin_guncelle", "play__yorum_yanitla"]) {
      assert.ok(!adlar(araclar).includes(ad), `${ad} salt-okunur modda yüklenmemeli`);
    }
    // Katalogdaki okuma uçlarının tek kapısı olduğu için o listede kalır.
    assert.ok(adlar(araclar).includes("magaza__cagir"));
  });

  it("araç adları benzersizdir", () => {
    const liste = adlar(ortamda("appstore,play"));
    assert.equal(new Set(liste).size, liste.length);
  });

  it("her araç önekli ve şemalı gelir", () => {
    for (const arac of ortamda("appstore,play")) {
      assert.match(arac.ad, /^(appstore|play|magaza)__/, `${arac.ad} öneksiz`);
      assert.ok(arac.aciklama.length > 0, `${arac.ad} açıklamasız`);
      assert.equal(arac.girdiSemasi.type, "object", `${arac.ad} şemasız`);
      assert.equal(typeof arac.calistir, "function");
    }
  });

  it("dispatch araçlarının mağaza enum'u yalnızca açık mağazaları kabul eder", () => {
    const enumu = (magazalar: string) => {
      const cagir = ortamda(magazalar).find((a) => a.ad === "magaza__cagir");
      assert.ok(cagir, "magaza__cagir yüklenmemiş");
      return (cagir.girdiSemasi.properties.magaza as { enum?: string[] }).enum;
    };

    assert.deepEqual(enumu("appstore,play"), ["appstore", "play"]);
    assert.deepEqual(enumu("play"), ["play"]);
    assert.deepEqual(enumu("appstore"), ["appstore"]);
  });
});
