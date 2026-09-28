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
/* Arama takma adları                                                   */
/* ------------------------------------------------------------------ */

/**
 * Apple ve Google, kullanıcıların bildiği adları kullanmıyor.
 *
 * Ölçtük: "testflight tester" ve "xcode cloud" aramaları sıfır sonuç
 * dönüyordu — çünkü TestFlight uçlarının hiçbirinde "testflight" kelimesi
 * geçmiyor (hepsi `betaTesters`, `betaGroups`, `preReleaseVersions`), Xcode
 * Cloud uçları da `ciProducts`, `ciWorkflows` diye adlandırılmış. Arama
 * dizinine bu köprü kelimeleri eklemezsek modelin bulma şansı yok.
 *
 * Her satır: [operasyonun kimlik metnine uygulanan kalıp, eklenecek kelimeler].
 */
const APPLE_TAKMA_ADLARI = [
  [/^Ci[A-Z]/, "xcode cloud continuous integration build pipeline"],
  [/Beta|PreRelease/, "testflight"],
  [/^Builds$|^BuildBundles$|^BuildBeta/, "testflight"],
  [/InAppPurchase|Subscription/, "iap in app purchase monetization"],
  [/CustomerReview/, "rating reply respond feedback"],
  [/SalesReport|FinanceReport/, "revenue earnings payout income sales"],
  [/AnalyticsReport/, "analytics metrics statistics"],
  [/Territor|Availabilit/, "country region market"],
  [/PricePoint|PriceSchedule|Prices$/, "pricing price tier"],
  [/Screenshot|Preview|AppMediaAsset/, "media asset image upload"],
  [/^Users$|^UserInvitations$|^ActorS/, "team member access permission"],
  [/Certificate|Profile|Device|BundleId/, "signing provisioning code sign"],
  [/Webhook/, "notification event callback"],
  [/AppStoreVersion|ReviewSubmission|AppStoreReview/, "release submit publish"],
  [/GameCenter/, "leaderboard achievement multiplayer"],
  [/AppClip/, "app clip instant"],
  [/Nomination|Marketplace|AlternativeDistribution/, "distribution"],
];

const PLAY_TAKMA_ADLARI = [
  [/^vitals\./, "crash anr stability android vitals quality"],
  [/^reviews\./, "rating reply respond feedback"],
  [/^purchases\.|^orders\./, "receipt entitlement refund voided token verify"],
  [/^edits\./, "release publish track rollout apk aab bundle"],
  [/^monetization\./, "price subscription iap in app purchase offer"],
  [/^inappproducts\./, "iap in app purchase product price"],
  [/^systemapks\.|^generatedapks\./, "apk download artifact"],
  [/^applications\.deviceTierConfigs|^grants\.|^users\./, "access permission team"],
];

function takmaAdlar(tablo, kimlik) {
  const kelimeler = [];
  for (const [kalip, ek] of tablo) if (kalip.test(kimlik)) kelimeler.push(ek);
  return kelimeler.join(" ");
}

/* ------------------------------------------------------------------ */
/* Apple — OpenAPI 3                                                    */
/* ------------------------------------------------------------------ */

/**
 * App Store Connect spec'inde operasyonların `summary`/`description` alanı YOK
 * (4.5 sürümünde 1270 operasyonun 1270'i boş). Özeti operationId'nin son
 * parçasından üretiyoruz; yoksa arama sonuçları modele adres dışında hiçbir
 * şey söylemiyor.
 */
const APPLE_EYLEMLERI = {
  getCollection: "List",
  getInstance: "Get",
  createInstance: "Create",
  updateInstance: "Update",
  deleteInstance: "Delete",
  getMetrics: "Metrics for",
  getToManyRelated: "List related",
  getToOneRelated: "Get related",
  getToManyRelationship: "List related IDs of",
  getToOneRelationship: "Get related ID of",
  createToManyRelationship: "Add to",
  replaceToManyRelationship: "Replace",
  deleteToManyRelationship: "Remove from",
  updateToOneRelationship: "Set",
};

function appleOzet(op, yol, yontem) {
  if (op.summary) return op.summary;
  const aciklama = op.description?.split("\n")[0]?.trim();
  if (aciklama) return aciklama;

  const eylem =
    APPLE_EYLEMLERI[op.operationId?.split("_").pop()] || yontem.toUpperCase();

  // /v1/apps/{id}/relationships/builds -> ["apps", "builds"]
  const segmentler = yol
    .split("/")
    .filter(
      (s) => s && !s.startsWith("{") && s !== "relationships" && !/^v\d+$/.test(s),
    );
  const kaynak = segmentler[segmentler.length - 1] || (op.tags || [])[0] || "";
  const kapsam = segmentler.length > 1 ? ` (${segmentler[0]})` : "";

  return `${eylem} ${kaynak}${kapsam}`.trim();
}

function uretAppStore() {
  const spec = oku("appstore-openapi.json");
  const operasyonlar = [];
  let eskimisSayisi = 0;

  for (const [yol, yolNesnesi] of Object.entries(spec.paths)) {
    const yolParametreleri = yolNesnesi.parameters || [];

    for (const yontem of ["get", "post", "patch", "delete", "put"]) {
      const op = yolNesnesi[yontem];
      if (!op) continue;
      if (op.deprecated) eskimisSayisi++;

      // OpenAPI'ye göre operasyon seviyesindeki parametre, yol seviyesindeki
      // aynı (ad, konum) çiftini EZER. İkisini üst üste eklersek parametre
      // listesinde aynı ad iki kez görünür ve model hangisine bakacağını
      // bilemez; bu yüzden (konum, ad) anahtarıyla teke indiriyoruz.
      const birlesik = new Map();
      for (const p of [...yolParametreleri, ...(op.parameters || [])]) {
        if (!p?.name) continue;
        birlesik.set(`${p.in}:${p.name}`, p);
      }

      const parametreler = [...birlesik.values()].map((p) => ({
        ad: p.name,
        konum: p.in,
        gerekli: !!p.required,
        tip: p.schema?.type || "string",
        aciklama: p.description || undefined,
      }));

      // Gövde şemasının sadece adresini tutuyoruz; tamamı spec'te kalsın.
      const govdeRef =
        op.requestBody?.content?.["application/json"]?.schema?.$ref;

      const etiket = (op.tags || [])[0] || "";
      const ozet = appleOzet(op, yol, yontem);

      operasyonlar.push({
        ad: op.operationId || `${yontem}${yol.replace(/[^a-zA-Z0-9]/g, "_")}`,
        yontem: yontem.toUpperCase(),
        yol,
        ozet: op.deprecated ? `[ESKİMİŞ] ${ozet}` : ozet,
        parametreler,
        govdeRef: govdeRef || undefined,
        // Eskimiş uçlar katalogdan atılmıyor: 159'unun 108'inin sürüm
        // değiştirilmiş bire bir karşılığı yok ve bazıları (örn.
        // `POST /v1/appEncryptionDeclarations/{id}/relationships/builds`)
        // o yeteneğe giden TEK yol. Atarsak kapsam iddiası delinir.
        // İşaretli bırakıp aramada geriye itiyoruz.
        eskimis: op.deprecated ? true : undefined,
        arama: sadelestir(
          [
            yol,
            op.operationId,
            ozet,
            (op.tags || []).join(" "),
            takmaAdlar(APPLE_TAKMA_ADLARI, `${etiket} ${yol}`),
          ].join(" "),
        ),
      });
    }
  }

  return {
    magaza: "appstore",
    surum: spec.info.version,
    taban: "https://api.appstoreconnect.apple.com",
    operasyonlar,
    eskimisSayisi,
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
          // Tekrarlanabilir parametreler (?id=a&id=b) dizi olarak verilmeli;
          // dispatch bunu bilmezse virgülle birleştirip yanlış istek atar.
          cok: p.repeated ? true : undefined,
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
        arama: sadelestir(
          [
            tamAd,
            m.id,
            m.description,
            takmaAdlar(PLAY_TAKMA_ADLARI, tamAd),
          ].join(" "),
        ),
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

/** Aynı adla iki operasyon olursa `operasyonBul` yanlışını döndürür. */
function cakismaDenetle(etiket, operasyonlar) {
  const gorulen = new Map();
  const cakisan = [];
  for (const o of operasyonlar) {
    if (gorulen.has(o.ad)) {
      cakisan.push(`${o.ad}: ${gorulen.get(o.ad)} ⇄ ${o.yontem} ${o.yol}`);
    }
    gorulen.set(o.ad, `${o.yontem} ${o.yol}`);
  }
  if (cakisan.length) {
    throw new Error(
      `${etiket} katalogunda yinelenen operasyon adı var — ` +
        `arama yanlış operasyonu döndürür:\n  ${cakisan.join("\n  ")}`,
    );
  }
}

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

cakismaDenetle("App Store Connect", appstore.operasyonlar);
cakismaDenetle("Google Play", play.operasyonlar);

writeFileSync(
  join(cikisDizini, "appstore.json"),
  JSON.stringify(appstore, null, 0),
);
writeFileSync(join(cikisDizini, "play.json"), JSON.stringify(play, null, 0));

console.log(`App Store Connect  ${appstore.surum}`);
console.log(`  operasyon        ${appstore.operasyonlar.length}`);
console.log(`  eskimiş (işaretli, katalogda) ${appstore.eskimisSayisi}`);
console.log(`Google Play`);
console.log(`  publisher        ${publisher.operasyonlar.length}`);
console.log(`  reporting        ${reporting.operasyonlar.length}`);
console.log(
  `Toplam             ${appstore.operasyonlar.length + play.operasyonlar.length} operasyon`,
);
