#!/usr/bin/env node
/**
 * Katalog üretici.
 *
 * Apple'ın OpenAPI spesifikasyonunu ve Google'ın discovery dökümanlarını okur,
 * ikisini tek bir ortak operasyon kataloğuna dönüştürür.
 *
 * Katalog arama ve çağırma için gereken en az bilgiyi tutar; şişkin gövde
 * şemaları spec dosyalarında kalır ve sadece gerektiğinde okunur.
 *
 *   node scripts/uret-katalog.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kok = join(dirname(fileURLToPath(import.meta.url)), "..");
const specDizini = join(kok, "spec");
const cikisDizini = join(kok, "src", "katalog");

const oku = (ad) => JSON.parse(readFileSync(join(specDizini, ad), "utf8"));

/** Arama için metni sadeleştirir: küçük harf, noktalama yok. */
function sadelestir(metin) {
  return (metin || "")
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü]+/gi, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Apple — OpenAPI 3                                                    */
/* ------------------------------------------------------------------ */

function uretAppStore() {
  const spec = oku("appstore-openapi.json");
  const operasyonlar = [];
  let atlananEskimis = 0;

  for (const [yol, yolNesnesi] of Object.entries(spec.paths)) {
    const yolParametreleri = yolNesnesi.parameters || [];

    for (const yontem of ["get", "post", "patch", "delete", "put"]) {
      const op = yolNesnesi[yontem];
      if (!op) continue;
      if (op.deprecated) {
        atlananEskimis++;
        continue;
      }

      const parametreler = [...yolParametreleri, ...(op.parameters || [])].map(
        (p) => ({
          ad: p.name,
          konum: p.in,
          gerekli: !!p.required,
          tip: p.schema?.type || "string",
          aciklama: p.description || undefined,
        }),
      );

      // Gövde şemasının sadece adresini tutuyoruz; tamamı spec'te kalsın.
      const govdeRef =
        op.requestBody?.content?.["application/json"]?.schema?.$ref;

      operasyonlar.push({
        ad: op.operationId || `${yontem}${yol.replace(/[^a-zA-Z0-9]/g, "_")}`,
        yontem: yontem.toUpperCase(),
        yol,
        ozet: op.summary || op.description?.split("\n")[0] || "",
        parametreler,
        govdeRef: govdeRef || undefined,
        arama: sadelestir(
          [yol, op.operationId, op.summary, (op.tags || []).join(" ")].join(" "),
        ),
      });
    }
  }

  return {
    magaza: "appstore",
    surum: spec.info.version,
    taban: "https://api.appstoreconnect.apple.com",
    operasyonlar,
    atlananEskimis,
  };
}

/* ------------------------------------------------------------------ */
/* Google — discovery dökümanı                                          */
/* ------------------------------------------------------------------ */

function uretPlay(dosya, api, taban) {
  const spec = oku(dosya);
  const operasyonlar = [];

  const gez = (kaynak, onEk) => {
    for (const [ad, m] of Object.entries(kaynak.methods || {})) {
      const parametreler = Object.entries(m.parameters || {}).map(
        ([pAd, p]) => ({
          ad: pAd,
          konum: p.location === "path" ? "path" : "query",
          gerekli: !!p.required,
          tip: p.type || "string",
          aciklama: p.description || undefined,
        }),
      );

      const tamAd = onEk ? `${onEk}.${ad}` : ad;

      operasyonlar.push({
        ad: tamAd,
        api,
        yontem: (m.httpMethod || "GET").toUpperCase(),
        // discovery'de yol taban adrese göre görelidir ve servicePath boştur;
        // başına tek bir eğik çizgi yeter.
        yol: "/" + [spec.servicePath, m.path]
          .map((p) => (p || "").replace(/^\/+|\/+$/g, ""))
          .filter(Boolean)
          .join("/"),
        ozet: (m.description || "").split("\n")[0],
        parametreler,
        govdeRef: m.request?.$ref || undefined,
        kapsamlar: m.scopes || [],
        arama: sadelestir([tamAd, m.id, m.description].join(" ")),
      });
    }

    for (const [ad, alt] of Object.entries(kaynak.resources || {})) {
      gez(alt, onEk ? `${onEk}.${ad}` : ad);
    }
  };

  gez(spec, "");

  return {
    surum: spec.version,
    revizyon: spec.revision,
    taban,
    operasyonlar,
  };
}

/* ------------------------------------------------------------------ */

const appstore = uretAppStore();

const publisher = uretPlay(
  "play.json",
  "publisher",
  "https://androidpublisher.googleapis.com",
);
const reporting = uretPlay(
  "play-reporting.json",
  "reporting",
  "https://playdeveloperreporting.googleapis.com",
);

const play = {
  magaza: "play",
  surum: `androidpublisher ${publisher.surum} (rev ${publisher.revizyon}) + reporting ${reporting.surum}`,
  tabanlar: {
    publisher: publisher.taban,
    reporting: reporting.taban,
  },
  operasyonlar: [...publisher.operasyonlar, ...reporting.operasyonlar],
};

writeFileSync(
  join(cikisDizini, "appstore.json"),
  JSON.stringify(appstore, null, 0),
);
writeFileSync(join(cikisDizini, "play.json"), JSON.stringify(play, null, 0));

console.log(`App Store Connect  ${appstore.surum}`);
console.log(`  operasyon        ${appstore.operasyonlar.length}`);
console.log(`  eskimiş (atlandı) ${appstore.atlananEskimis}`);
console.log(`Google Play`);
console.log(`  publisher        ${publisher.operasyonlar.length}`);
console.log(`  reporting        ${reporting.operasyonlar.length}`);
console.log(
  `Toplam             ${appstore.operasyonlar.length + play.operasyonlar.length} operasyon`,
);
