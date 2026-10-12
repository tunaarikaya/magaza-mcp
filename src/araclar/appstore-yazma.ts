/**
 * App Store Connect'te çok adımlı yazma işlerini tek araca toplayanlar.
 *
 * Abonelik fiyatı, ülke erişimi ve yaş derecelendirmesi dispatch yoluyla da
 * yapılabiliyordu, ama model her ülke için ayrı POST atmaya itiliyordu:
 * 175 ülke × (önizleme + onay) ≈ 350 araç çağrısı. Buradaki araçlar döngüyü
 * sunucuda koşturur; model yalnızca bir önizleme ve bir onay görür.
 *
 * Yollar ve gövdeler Apple OpenAPI 4.5'e karşı doğrulandı; standart
 * aboneliğin planType'ı canlı hesapta UPFRONT okundu.
 */
import { cagir, tumunuGetir } from "../istemci/apple.js";
import { kimlik, metin, onayIste, onaySemasi, parca, ulkeKodu } from "./appstore.js";
import type { Arac } from "./tip.js";

/** Fiyat noktası uçları tek sayfada 8000 kayda izin verir (ABD'de ~800 nokta). */
const FIYAT_SAYFASI = 8000;

/** Önizlemede gösterilecek örnek ülkeler; hepsini basmak 175 satır eder. */
const ORNEK_ULKELER = ["USA", "TUR", "DEU", "GBR", "FRA", "JPN", "BRA", "IND", "CAN", "AUS"];

/** Standart (peşin ödenen) abonelik planı. MONTHLY, yıllık taahhüdün aylık ödemesi. */
const PLAN_TURU = "UPFRONT";

/** "9,99" ve 9.99 aynı fiyat; karşılaştırma sayı olarak yapılır. */
function fiyatSayisi(ham: unknown, alan = "fiyat"): number {
  const n = Number(String(ham ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${alan} geçerli bir sayı olmalı (örn. 9.99).`);
  return n;
}

function tarih(ham: unknown): string | null {
  if (ham === undefined || ham === null || ham === "") return null;
  const s = String(ham);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("baslangic YYYY-AA-GG biçiminde olmalı.");
  return s;
}

/** Bir fiyat noktası listesinden istenen fiyatı bulur; yoksa en yakınlarını söyler. */
function noktaSec(noktalar: any[], fiyat: number, ulke: string): any {
  const bulunan = noktalar.find((n) => Number(n.attributes?.customerPrice) === fiyat);
  if (bulunan) return bulunan;
  const yakin = noktalar
    .map((n) => Number(n.attributes?.customerPrice))
    .sort((a, b) => Math.abs(a - fiyat) - Math.abs(b - fiyat))
    .slice(0, 6)
    .sort((a, b) => a - b);
  throw new Error(
    `${ulke} için ${fiyat} fiyat noktası yok. Apple yalnızca sabit basamaklara izin verir; ` +
      `en yakınlar: ${yakin.join(", ")}`,
  );
}

type Satir = { ulke: string; nokta: string; fiyat: string; gelir: string; para?: string };

/**
 * Bir ülkedeki fiyattan bütün ülkelerin eşdeğer fiyatlarını çıkarır.
 *
 * Apple'ın kendi eşitleme ucu (`equalizations`) kur ve vergi farkını hesaba
 * katıp her ülke için doğru basamağı verir; fiyatı kurla çevirmek ise
 * basamakların hiçbirine denk gelmez. İki GET'le 175 ülke hazır.
 */
async function abonelikMatrisi(aboneId: string, fiyat: number, ulke: string): Promise<Satir[]> {
  const { data: noktalar } = await tumunuGetir(
    `/v1/subscriptions/${parca(aboneId, "abonelik_id")}/pricePoints`,
    { "filter[territory]": ulke, "fields[subscriptionPricePoints]": "customerPrice,proceeds" },
    FIYAT_SAYFASI,
    FIYAT_SAYFASI,
  );
  const cipa = noktaSec(noktalar, fiyat, ulke);

  const { data: esler, included } = await tumunuGetir(
    `/v1/subscriptionPricePoints/${parca(cipa.id, "fiyat noktası")}/equalizations`,
    {
      include: "territory",
      "fields[subscriptionPricePoints]": "customerPrice,proceeds,territory",
      "fields[territories]": "currency",
    },
    FIYAT_SAYFASI,
    FIYAT_SAYFASI,
  );
  const paralar = new Map<string, string>();
  for (const t of included) if (t?.type === "territories") paralar.set(t.id, t.attributes?.currency);

  const satir = (n: any, u: string): Satir => ({
    ulke: u,
    nokta: n.id,
    fiyat: n.attributes?.customerPrice,
    gelir: n.attributes?.proceeds,
    para: paralar.get(u),
  });

  return [
    satir(cipa, ulke),
    ...esler
      .map((n: any) => satir(n, n.relationships?.territory?.data?.id))
      .filter((s: Satir) => s.ulke && s.ulke !== ulke),
  ];
}

function ornekler(matris: Satir[]) {
  return matris
    .filter((s) => ORNEK_ULKELER.includes(s.ulke))
    .map((s) => `${s.ulke}: ${s.fiyat}${s.para ? ` ${s.para}` : ""}`);
}

/**
 * Matrisi aboneliğe yazar.
 *
 * Önce tek PATCH: ilişki olarak bütün fiyatlar `included` içinde satır içi
 * oluşturulur. Apple ilk fiyatı yalnızca bu yolla kabul ediyor. PATCH
 * reddedilirse (ör. abonelik incelemedeyken 409) ülke başına POST'a düşülür;
 * döngü sunucuda, dörder dörder koşar ve 429'lar istemcide tekrar denenir.
 */
async function abonelikFiyatYaz(
  aboneId: string,
  matris: Satir[],
  koru: boolean,
  baslangic: string | null,
): Promise<Record<string, unknown>> {
  const id = kimlik(aboneId, "abonelik_id");
  const nitelik = { startDate: baslangic, preserveCurrentPrice: koru };
  const iliski = (s: Satir) => ({
    subscription: { data: { type: "subscriptions", id } },
    territory: { data: { type: "territories", id: s.ulke } },
    subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: s.nokta } },
  });

  let patchHatasi: string;
  try {
    await cagir({
      yontem: "PATCH",
      yol: `/v1/subscriptions/${parca(id, "abonelik_id")}`,
      govde: {
        data: {
          type: "subscriptions",
          id,
          relationships: {
            prices: { data: matris.map((s) => ({ type: "subscriptionPrices", id: `\${f-${s.ulke}}` })) },
          },
        },
        included: matris.map((s) => ({
          type: "subscriptionPrices",
          id: `\${f-${s.ulke}}`,
          attributes: nitelik,
          relationships: iliski(s),
        })),
      },
    });
    return { basarili: true, yontem: "tek PATCH", ulke_sayisi: matris.length };
  } catch (hata) {
    patchHatasi = (hata as Error).message;
    // Yetki ve kimlik sorunlarında POST da aynı yere çarpar.
    if (/HTTP 40[13]\)/.test(patchHatasi)) throw hata;
  }

  const hatalar: { ulke: string; hata: string }[] = [];
  let yazilan = 0;
  for (let i = 0; i < matris.length; i += 4) {
    const dilim = matris.slice(i, i + 4);
    const sonuc = await Promise.allSettled(
      dilim.map((s) =>
        cagir({
          yontem: "POST",
          yol: "/v1/subscriptionPrices",
          govde: { data: { type: "subscriptionPrices", attributes: nitelik, relationships: iliski(s) } },
        }),
      ),
    );
    sonuc.forEach((r, j) => {
      if (r.status === "fulfilled") yazilan++;
      else hatalar.push({ ulke: dilim[j].ulke, hata: (r.reason as Error).message });
    });
    // İlk dilimin hepsi düştüyse kalan 170 ülke de aynı sebeple düşecek.
    if (i === 0 && yazilan === 0) {
      throw new Error(`Toplu PATCH reddedildi:\n${patchHatasi}\n\nÜlke başına POST da reddedildi:\n${hatalar[0]?.hata}`);
    }
  }

  return {
    basarili: hatalar.length === 0,
    yontem: "ülke başına POST (toplu PATCH reddedildi)",
    patch_hatasi: patchHatasi,
    yazilan,
    hatali: hatalar.length ? hatalar : undefined,
  };
}

/** Aboneliği verilen ülkelerde (ve istenirse yeni ülkelerde) satışa açar. */
async function abonelikUlkeleriYaz(
  aboneId: string,
  ulkeler: string[],
  yeniUlkeler: boolean,
): Promise<unknown> {
  const id = kimlik(aboneId, "abonelik_id");
  const mevcut = await mevcutPlan(id);
  const bolgeler = { data: ulkeler.map((u) => ({ type: "territories", id: u })) };

  if (mevcut) {
    return cagir({
      yontem: "PATCH",
      yol: `/v1/subscriptionPlanAvailabilities/${parca(mevcut.id, "plan id")}`,
      govde: {
        data: {
          type: "subscriptionPlanAvailabilities",
          id: mevcut.id,
          attributes: { availableInNewTerritories: yeniUlkeler },
          relationships: { availableTerritories: bolgeler },
        },
      },
    });
  }
  return cagir({
    yontem: "POST",
    yol: "/v1/subscriptionPlanAvailabilities",
    govde: {
      data: {
        type: "subscriptionPlanAvailabilities",
        attributes: { planType: PLAN_TURU, availableInNewTerritories: yeniUlkeler },
        relationships: {
          subscription: { data: { type: "subscriptions", id } },
          availableTerritories: bolgeler,
        },
      },
    },
  });
}

async function mevcutPlan(aboneId: string): Promise<any | undefined> {
  // fields vermezsek Apple her planın 175 ülkesini de gövdeye basıyor (~60 KB).
  const yanit: any = await cagir({
    yontem: "GET",
    yol: `/v1/subscriptions/${parca(aboneId, "abonelik_id")}/planAvailabilities`,
    sorgu: { "fields[subscriptionPlanAvailabilities]": "planType,availableInNewTerritories" },
  });
  const planlar: any[] = yanit?.data ?? [];
  return planlar.find((p) => p.attributes?.planType === PLAN_TURU) ?? planlar[0];
}

async function tumUlkeler(): Promise<string[]> {
  const { data } = await tumunuGetir("/v1/territories", { "fields[territories]": "currency" }, 400);
  return data.map((t: any) => t.id);
}

function ulkeListesi(ham: unknown): string[] {
  if (ham === undefined || ham === null) return [];
  const dizi = Array.isArray(ham) ? ham : String(ham).split(",");
  return dizi.map(ulkeKodu).filter((u): u is string => !!u);
}

/* ------------------------------------------------------------------ */
/* Yaş derecelendirmesi                                                */
/* ------------------------------------------------------------------ */

const SIKLIK = ["NONE", "INFREQUENT_OR_MILD", "FREQUENT_OR_INTENSE"];

/** Apple'ın 2025 anketi; eski `gamblingAndContests`, `seventeenPlus` spec'ten kalktı. */
const SIKLIK_ALANLARI = [
  "alcoholTobaccoOrDrugUseOrReferences",
  "contests",
  "gamblingSimulated",
  "gunsOrOtherWeapons",
  "horrorOrFearThemes",
  "matureOrSuggestiveThemes",
  "medicalOrTreatmentInformation",
  "profanityOrCrudeHumor",
  "sexualContentGraphicAndNudity",
  "sexualContentOrNudity",
  "violenceCartoonOrFantasy",
  "violenceRealistic",
  "violenceRealisticProlongedGraphicOrSadistic",
];

const EVET_HAYIR_ALANLARI = [
  "advertising",
  "ageAssurance",
  "gambling",
  "healthOrWellnessTopics",
  "lootBox",
  "messagingAndChat",
  "parentalControls",
  "socialMedia",
  "socialMediaAgeRestricted",
  "unrestrictedWebAccess",
  "userGeneratedContent",
];

const DIGER_ALANLAR: Record<string, unknown> = {
  kidsAgeBand: { type: "string", enum: ["FIVE_AND_UNDER", "SIX_TO_EIGHT", "NINE_TO_ELEVEN"] },
  ageRatingOverrideV2: {
    type: "string",
    enum: ["NONE", "NINE_PLUS", "THIRTEEN_PLUS", "SIXTEEN_PLUS", "EIGHTEEN_PLUS", "UNRATED"],
  },
  koreaAgeRatingOverride: {
    type: "string",
    enum: ["NONE", "ALL", "TWELVE_PLUS", "FIFTEEN_PLUS", "NINETEEN_PLUS"],
  },
  gracRatingClassificationNumber: { type: "string" },
  developerAgeRatingInfoUrl: { type: "string" },
};

const CEVAP_SEMASI: Record<string, unknown> = {
  ...Object.fromEntries(SIKLIK_ALANLARI.map((a) => [a, { type: "string", enum: SIKLIK }])),
  ...Object.fromEntries(EVET_HAYIR_ALANLARI.map((a) => [a, { type: "boolean" }])),
  ...DIGER_ALANLAR,
};

function cevaplariDogrula(ham: unknown): Record<string, unknown> {
  if (!ham || typeof ham !== "object" || Array.isArray(ham)) {
    throw new Error("cevaplar bir nesne olmalı, örn. {\"violenceCartoonOrFantasy\": \"NONE\"}.");
  }
  const cevaplar = ham as Record<string, unknown>;
  for (const [alan, deger] of Object.entries(cevaplar)) {
    if (!(alan in CEVAP_SEMASI)) {
      throw new Error(`Bilinmeyen soru: ${alan}. Geçerli sorular: ${Object.keys(CEVAP_SEMASI).join(", ")}`);
    }
    if (SIKLIK_ALANLARI.includes(alan) && !SIKLIK.includes(deger as string)) {
      throw new Error(`${alan} için değer ${SIKLIK.join(" / ")} olmalı.`);
    }
    if (EVET_HAYIR_ALANLARI.includes(alan) && typeof deger !== "boolean") {
      throw new Error(`${alan} true/false olmalı.`);
    }
  }
  if (Object.keys(cevaplar).length === 0) throw new Error("En az bir cevap vermelisin.");
  return cevaplar;
}

/** Bu durumdaki appInfo yayında ya da incelemede; Apple düzenlemeyi 409 ile reddeder. */
const KILITLI_DURUMLAR = new Set([
  "ACCEPTED",
  "IN_REVIEW",
  "PENDING_RELEASE",
  "READY_FOR_DISTRIBUTION",
  "REPLACED_WITH_NEW_INFO",
  "WAITING_FOR_REVIEW",
]);

/**
 * Yaş derecelendirmesinin bağlı olduğu appInfo'yu seçer.
 *
 * Yayında sürümü olan uygulamanın iki appInfo'su var: yayındaki (kilitli) ve
 * hazırlanan. Model ilkini seçince Apple 409 dönüyordu.
 */
async function appInfoSec(uygulamaId: unknown, verilen: unknown, yazmak: boolean) {
  const { data } = await tumunuGetir(
    `/v1/apps/${parca(uygulamaId, "uygulama_id")}/appInfos`,
    { "fields[appInfos]": "state" },
    50,
  );
  const liste = data.map((i: any) => ({ id: i.id as string, durum: i.attributes?.state as string }));

  if (verilen) {
    const secilen = liste.find((i) => i.id === verilen);
    if (!secilen) throw new Error(`app_info_id ${verilen} bu uygulamaya ait değil. Adaylar: ${JSON.stringify(liste)}`);
    return { secilen, liste };
  }

  const duzenlenebilir = liste.filter((i) => !KILITLI_DURUMLAR.has(i.durum));
  if (duzenlenebilir.length === 1) return { secilen: duzenlenebilir[0], liste };
  if (duzenlenebilir.length > 1) {
    throw new Error(`Birden çok düzenlenebilir appInfo var; app_info_id ile seç: ${JSON.stringify(liste)}`);
  }
  if (yazmak) {
    throw new Error(
      "Düzenlenebilir appInfo yok — yaş derecelendirmesi yalnızca hazırlanan bir sürümde değişir. " +
        `Önce yeni bir sürüm oluştur. Mevcutlar: ${JSON.stringify(liste)}`,
    );
  }
  // Okumak için yayındaki yeterli.
  if (!liste[0]) throw new Error("Uygulamanın appInfo kaydı bulunamadı.");
  return { secilen: liste[0], liste };
}

async function beyanOku(appInfoId: string): Promise<any> {
  const yanit: any = await cagir({
    yontem: "GET",
    yol: `/v1/appInfos/${parca(appInfoId, "app_info_id")}/ageRatingDeclaration`,
  });
  return yanit?.data;
}

/* ------------------------------------------------------------------ */
/* Araçlar                                                             */
/* ------------------------------------------------------------------ */

// Tip birleşimi (string|number) bazı istemcilerin şema denetiminden geçmiyor;
// sayı gelse de fiyatSayisi kabul ediyor.
const fiyatSemasi = {
  type: "string",
  description: "Müşterinin ödeyeceği fiyat, o ülkenin para biriminde (örn. \"9.99\").",
};
const ulkeSemasi = metin("Fiyatın verildiği ülke (3 harf). Varsayılan USA; diğer ülkeler buna eşitlenir.");
const baslangicSemasi = metin("Yeni fiyatın başlayacağı gün (YYYY-AA-GG). Boşsa hemen.");

export function appstoreYazmaAraclari(): Arac[] {
  return [
    {
      ad: "appstore__abonelik_fiyat_ayarla",
      aciklama:
        "Bir aboneliğin fiyatını TÜM ülkelerde tek seferde ayarlar. Tek bir ülkedeki " +
        "fiyatı verirsin (varsayılan USA), Apple'ın eşitleme tablosu ~175 ülkenin " +
        "karşılığını çıkarır ve hepsi tek istekte yazılır. Ülke ülke magaza__cagir ile " +
        "subscriptionPrices yazma; bu araç onun yerine geçer. Önizlemede ülke sayısı ve " +
        "örnek fiyatlar döner.",
      girdiSemasi: {
        type: "object",
        properties: {
          abonelik_id: metin("appstore__abonelikler'den gelen abonelik id'si."),
          fiyat: fiyatSemasi,
          ulke: ulkeSemasi,
          mevcut_aboneleri_koru: {
            type: "boolean",
            description:
              "Fiyat değişikliğinde mevcut aboneler eski fiyattan devam etsin mi " +
              "(varsayılan true). İlk fiyat ayarlanırken etkisi yok.",
          },
          baslangic: baslangicSemasi,
          onayla: onaySemasi,
        },
        required: ["abonelik_id", "fiyat"],
      },
      yazma: true,
      async calistir(girdi) {
        const fiyat = fiyatSayisi(girdi.fiyat);
        const ulke = ulkeKodu(girdi.ulke) ?? "USA";
        const koru = girdi.mevcut_aboneleri_koru !== false;
        const baslangic = tarih(girdi.baslangic);
        const matris = await abonelikMatrisi(girdi.abonelik_id, fiyat, ulke);

        if (girdi.onayla !== true) {
          return onayIste(
            `PATCH /v1/subscriptions/${girdi.abonelik_id} (${matris.length} ülke)`,
            `Aboneliğin fiyatını ${ulke} ${fiyat} baz alınarak ${matris.length} ülkede ayarlar.`,
            {
              ulke_sayisi: matris.length,
              ornek_fiyatlar: ornekler(matris),
              mevcut_aboneleri_koru: koru,
              baslangic: baslangic ?? "hemen",
            },
          );
        }
        return abonelikFiyatYaz(girdi.abonelik_id, matris, koru, baslangic);
      },
    },

    {
      ad: "appstore__iap_fiyat_ayarla",
      aciklama:
        "Tek seferlik uygulama içi satın almanın fiyatını ayarlar. Bir ülkedeki fiyatı " +
        "verirsin, Apple diğer bütün ülkeleri kendisi doldurur (tek istek). Mevcut fiyat " +
        "takviminin yerine geçer.",
      girdiSemasi: {
        type: "object",
        properties: {
          iap_id: metin("appstore__iap_urunler'den gelen ürün id'si."),
          fiyat: fiyatSemasi,
          ulke: ulkeSemasi,
          baslangic: baslangicSemasi,
          onayla: onaySemasi,
        },
        required: ["iap_id", "fiyat"],
      },
      yazma: true,
      async calistir(girdi) {
        const fiyat = fiyatSayisi(girdi.fiyat);
        const ulke = ulkeKodu(girdi.ulke) ?? "USA";
        const baslangic = tarih(girdi.baslangic);
        const id = kimlik(girdi.iap_id, "iap_id");

        const { data: noktalar } = await tumunuGetir(
          `/v2/inAppPurchases/${parca(id, "iap_id")}/pricePoints`,
          { "filter[territory]": ulke, "fields[inAppPurchasePricePoints]": "customerPrice,proceeds" },
          FIYAT_SAYFASI,
          FIYAT_SAYFASI,
        );
        const nokta = noktaSec(noktalar, fiyat, ulke);

        if (girdi.onayla !== true) {
          return onayIste(
            "POST /v1/inAppPurchasePriceSchedules",
            `Ürünün fiyat takvimini ${ulke} ${fiyat} baz alacak şekilde yeniden kurar; ` +
              "diğer ülkeleri Apple eşitler.",
            { iap_id: id, taban_ulke: ulke, fiyat, gelir: nokta.attributes?.proceeds, baslangic: baslangic ?? "hemen" },
          );
        }

        return cagir({
          yontem: "POST",
          yol: "/v1/inAppPurchasePriceSchedules",
          govde: {
            data: {
              type: "inAppPurchasePriceSchedules",
              relationships: {
                inAppPurchase: { data: { type: "inAppPurchases", id } },
                baseTerritory: { data: { type: "territories", id: ulke } },
                manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${taban}" }] },
              },
            },
            included: [
              {
                type: "inAppPurchasePrices",
                id: "${taban}",
                attributes: { startDate: baslangic },
                relationships: {
                  inAppPurchaseV2: { data: { type: "inAppPurchases", id } },
                  inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: nokta.id } },
                },
              },
            ],
          },
        });
      },
    },

    {
      ad: "appstore__abonelik_ulkeleri",
      aciklama:
        "Bir aboneliği hangi ülkelerde satılacağını tek istekte ayarlar. Ülke " +
        "vermezsen bütün App Store ülkelerinde satışa açar.",
      girdiSemasi: {
        type: "object",
        properties: {
          abonelik_id: metin("appstore__abonelikler'den gelen abonelik id'si."),
          ulkeler: {
            type: "array",
            items: { type: "string" },
            description: "Üç harfli ülke kodları (TUR, USA...). Boşsa bütün ülkeler.",
          },
          yeni_ulkelerde_ac: {
            type: "boolean",
            description: "Apple ileride yeni ülke eklerse orada da satılsın mı (varsayılan true).",
          },
          onayla: onaySemasi,
        },
        required: ["abonelik_id"],
      },
      yazma: true,
      async calistir(girdi) {
        const verilen = ulkeListesi(girdi.ulkeler);
        const ulkeler = verilen.length ? verilen : await tumUlkeler();
        const yeni = girdi.yeni_ulkelerde_ac !== false;

        if (girdi.onayla !== true) {
          return onayIste(
            "subscriptionPlanAvailabilities",
            `Aboneliği ${ulkeler.length} ülkede satışa açar; listede olmayan ülkelerden kaldırır.`,
            { ulke_sayisi: ulkeler.length, ulkeler: verilen.length ? verilen : "hepsi", yeni_ulkelerde_ac: yeni },
          );
        }
        await abonelikUlkeleriYaz(girdi.abonelik_id, ulkeler, yeni);
        return { basarili: true, ulke_sayisi: ulkeler.length, yeni_ulkelerde_ac: yeni };
      },
    },

    {
      ad: "appstore__abonelik_kur",
      aciklama:
        "Sıfırdan abonelik kurar, tek onayla: (gerekirse) grup → abonelik → dil " +
        "metinleri → bütün ülkelerde satış → bütün ülkelerde fiyat. Var olan bir " +
        "gruba eklemek için grup_id ver, yoksa grup_adi ile yeni grup açılır. Bir adım " +
        "düşerse o ana kadar oluşturulanlar ve hata döner.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
          grup_id: metin("Var olan abonelik grubu (appstore__abonelikler)."),
          grup_adi: metin("Yeni grup açılacaksa referans adı; müşteriye de bu ad gösterilir."),
          urun_id: metin("Ürün kimliği, örn. com.ornek.pro.aylik. Sonradan değişmez."),
          isim: metin("App Store Connect'teki referans adı."),
          sure: {
            type: "string",
            enum: ["ONE_WEEK", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"],
          },
          yerellestirmeler: {
            type: "array",
            description: "Müşterinin göreceği ad ve açıklama, dil başına. En az bir dil.",
            items: {
              type: "object",
              properties: {
                dil: metin("Örn. en-US, tr."),
                ad: metin("Görünen ad (en fazla 35 karakter)."),
                aciklama: metin("Açıklama (en fazla 55 karakter)."),
              },
              required: ["dil", "ad"],
            },
          },
          fiyat: { ...fiyatSemasi, description: `${fiyatSemasi.description} Boşsa fiyat kurulmaz.` },
          ulke: ulkeSemasi,
          aile_paylasimi: { type: "boolean", description: "Aile Paylaşımı açık mı (varsayılan kapalı)." },
          grup_seviyesi: { type: "number", description: "Gruptaki seviye; 1 en yüksek hizmet." },
          inceleme_notu: metin("Apple incelemesine not."),
          onayla: onaySemasi,
        },
        required: ["uygulama_id", "urun_id", "isim", "sure", "yerellestirmeler"],
      },
      yazma: true,
      async calistir(girdi) {
        if (!girdi.grup_id && !girdi.grup_adi) throw new Error("grup_id ya da grup_adi vermelisin.");
        const yerel: { dil: string; ad: string; aciklama?: string }[] = Array.isArray(girdi.yerellestirmeler)
          ? girdi.yerellestirmeler
          : [];
        if (!yerel.length || yerel.some((y) => !y?.dil || !y?.ad)) {
          throw new Error("yerellestirmeler en az bir {dil, ad} içermeli.");
        }
        const fiyat = girdi.fiyat === undefined || girdi.fiyat === "" ? undefined : fiyatSayisi(girdi.fiyat);
        const ulke = ulkeKodu(girdi.ulke) ?? "USA";

        if (girdi.onayla !== true) {
          return onayIste("abonelik kurulumu", "Yeni abonelik oluşturur ve satışa hazırlar.", {
            adimlar: [
              girdi.grup_id ? `var olan grup ${girdi.grup_id}` : `yeni grup: ${girdi.grup_adi}`,
              `abonelik: ${girdi.urun_id} (${girdi.sure})`,
              `dil metinleri: ${yerel.map((y) => y.dil).join(", ")}`,
              "bütün ülkelerde satış",
              fiyat !== undefined ? `fiyat: ${ulke} ${fiyat}, diğer ülkeler eşitlenir` : "fiyat kurulmayacak",
            ],
          });
        }

        const yapilan: Record<string, unknown> = {};
        const adim = async <T>(ad: string, is: () => Promise<T>): Promise<T> => {
          try {
            return await is();
          } catch (hata) {
            throw new Error(
              `Kurulum '${ad}' adımında durdu. Oluşturulanlar: ${JSON.stringify(yapilan)}\n` +
                "Kalan adımlar için appstore__abonelik_ulkeleri / appstore__abonelik_fiyat_ayarla " +
                `kullanılabilir.\n\n${(hata as Error).message}`,
            );
          }
        };

        let grupId = girdi.grup_id ? kimlik(girdi.grup_id, "grup_id") : "";
        if (!grupId) {
          const grup: any = await adim("grup", () =>
            cagir({
              yontem: "POST",
              yol: "/v1/subscriptionGroups",
              govde: {
                data: {
                  type: "subscriptionGroups",
                  attributes: { referenceName: girdi.grup_adi },
                  relationships: { app: { data: { type: "apps", id: kimlik(girdi.uygulama_id, "uygulama_id") } } },
                },
              },
            }),
          );
          grupId = grup.data.id;
          yapilan.grup_id = grupId;
          for (const y of yerel) {
            await adim(`grup metni (${y.dil})`, () =>
              cagir({
                yontem: "POST",
                yol: "/v1/subscriptionGroupLocalizations",
                govde: {
                  data: {
                    type: "subscriptionGroupLocalizations",
                    attributes: { name: girdi.grup_adi, locale: y.dil },
                    relationships: { subscriptionGroup: { data: { type: "subscriptionGroups", id: grupId } } },
                  },
                },
              }),
            );
          }
        }

        const abone: any = await adim("abonelik", () =>
          cagir({
            yontem: "POST",
            yol: "/v1/subscriptions",
            govde: {
              data: {
                type: "subscriptions",
                attributes: {
                  productId: girdi.urun_id,
                  name: girdi.isim,
                  subscriptionPeriod: girdi.sure,
                  familySharable: girdi.aile_paylasimi,
                  groupLevel: girdi.grup_seviyesi,
                  reviewNote: girdi.inceleme_notu,
                },
                relationships: { group: { data: { type: "subscriptionGroups", id: grupId } } },
              },
            },
          }),
        );
        const aboneId: string = abone.data.id;
        yapilan.abonelik_id = aboneId;

        for (const y of yerel) {
          await adim(`abonelik metni (${y.dil})`, () =>
            cagir({
              yontem: "POST",
              yol: "/v1/subscriptionLocalizations",
              govde: {
                data: {
                  type: "subscriptionLocalizations",
                  attributes: { name: y.ad, locale: y.dil, description: y.aciklama },
                  relationships: { subscription: { data: { type: "subscriptions", id: aboneId } } },
                },
              },
            }),
          );
        }
        yapilan.diller = yerel.map((y) => y.dil);

        const ulkeler = await adim("ülkeler", async () => {
          const liste = await tumUlkeler();
          await abonelikUlkeleriYaz(aboneId, liste, true);
          return liste.length;
        });
        yapilan.satistaki_ulke = ulkeler;

        if (fiyat !== undefined) {
          yapilan.fiyat = await adim("fiyat", async () => {
            const matris = await abonelikMatrisi(aboneId, fiyat, ulke);
            const sonuc = await abonelikFiyatYaz(aboneId, matris, true, null);
            return { ...sonuc, ornek_fiyatlar: ornekler(matris) };
          });
        }

        return { basarili: true, ...yapilan };
      },
    },

    {
      ad: "appstore__yas_derecelendirme",
      aciklama:
        "Uygulamanın yaş derecelendirme anketini okur veya doldurur. cevaplar " +
        "vermezsen mevcut cevapları döndürür. Verirsen yalnızca verdiğin sorular " +
        "değişir. Hazırlanan sürümün appInfo'sunu kendisi bulur. Sıklık soruları " +
        "NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE, diğerleri true/false.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
          cevaplar: {
            type: "object",
            description: "Soru adı → cevap. Boşsa sadece okunur.",
            properties: CEVAP_SEMASI,
            additionalProperties: false,
          },
          app_info_id: metin("Birden çok düzenlenebilir appInfo varsa hangisi."),
          onayla: onaySemasi,
        },
        required: ["uygulama_id"],
      },
      yazma: true,
      async calistir(girdi) {
        const yazmak = girdi.cevaplar !== undefined;
        const cevaplar = yazmak ? cevaplariDogrula(girdi.cevaplar) : {};
        const { secilen } = await appInfoSec(girdi.uygulama_id, girdi.app_info_id, yazmak);
        const beyan = await beyanOku(secilen.id);
        if (!beyan?.id) throw new Error("Bu appInfo'nun yaş derecelendirme kaydı bulunamadı.");

        if (!yazmak) {
          return { app_info_id: secilen.id, app_info_durumu: secilen.durum, cevaplar: beyan.attributes };
        }

        if (girdi.onayla !== true) {
          const degisen = Object.fromEntries(
            Object.entries(cevaplar).map(([k, v]) => [k, { simdi: beyan.attributes?.[k] ?? null, yeni: v }]),
          );
          return onayIste(
            `PATCH /v1/ageRatingDeclarations/${beyan.id}`,
            `Yaş derecelendirme anketinde ${Object.keys(cevaplar).length} cevabı değiştirir.`,
            { app_info_id: secilen.id, app_info_durumu: secilen.durum, degisen },
          );
        }

        return cagir({
          yontem: "PATCH",
          yol: `/v1/ageRatingDeclarations/${parca(beyan.id, "beyan id")}`,
          govde: { data: { type: "ageRatingDeclarations", id: beyan.id, attributes: cevaplar } },
        });
      },
    },
  ];
}
