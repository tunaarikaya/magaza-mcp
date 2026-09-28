/**
 * App Store Connect için seçilmiş araçlar.
 *
 * Günlük işin büyük kısmı bunlarla döner. Buradaki yolların, sorgu
 * parametrelerinin ve okunan alan adlarının hepsi Apple'ın OpenAPI 4.5
 * spesifikasyonuna karşı doğrulandı; geri kalan ~1100 operasyona
 * magaza__endpoint_ara ve magaza__cagir üzerinden erişilir.
 */
import { cagir, raporIndir, tumunuGetir } from "../istemci/apple.js";
import type { Arac } from "./tip.js";

const metin = (aciklama: string) => ({ type: "string", description: aciklama });
const sayi = (aciklama: string) => ({ type: "number", description: aciklama });

/** Apple tek sayfada en çok 200 kayıt verir; daha fazlası 400 ile döner. */
const SAYFA_SINIRI = 200;

/** Kullanıcıdan gelen adedi makul bir aralığa çeker. */
function adet(ham: unknown, varsayilan: number, ust = 1000): number {
  const n = Number(ham);
  if (!Number.isFinite(n) || n <= 0) return varsayilan;
  return Math.min(Math.floor(n), ust);
}

/**
 * Bir kimliği URL yoluna güvenle gömer.
 *
 * Kodlamadan şablona konan bir değer yolu kaçırabilir: `../../v1/users`
 * verildiğinde istek bambaşka bir uca gider, `?` ve `#` ise yolu ortadan
 * keser. Kimlikler harf/rakam/tire dünyasından geldiği için kodlamanın
 * meşru bir kullanımı bozması söz konusu değil.
 */
function kimlik(deger: unknown, alan: string): string {
  const ham = String(deger ?? "").trim();
  if (!ham) throw new Error(`${alan} boş olamaz.`);
  if (ham === "." || ham === ".." || ham.includes("/") || ham.includes("\\")) {
    throw new Error(
      `${alan} geçersiz: kimlik yol ayracı ('/', '..') içeremez. ` +
        "Listeleme araçlarının döndürdüğü 'id' değerini olduğu gibi ver.",
    );
  }
  return ham;
}

function parca(deger: unknown, alan: string): string {
  return encodeURIComponent(kimlik(deger, alan));
}

/**
 * Yazma araçlarının onay kapısı.
 *
 * magaza__cagir'daki kapının aynısı (bkz. araclar/dispatch.ts). Buradaki
 * araçların girdisi çoğu zaman mağaza yorumu gibi güvenilmez metinden
 * türüyor; onay olmadan yazmak, yoruma gömülü bir talimatın mağaza metnini
 * değiştirmesine ya da senin adına halka açık yanıt yayımlamasına yeter.
 */
function onayIste(
  islem: string,
  ozet: string,
  yapilacak: Record<string, unknown>,
): Record<string, unknown> {
  return {
    onay_gerekli: true,
    islem,
    ozet,
    uyari:
      "Bu işlem veri değiştirir. Kullanıcıya ne yapılacağını anlat, " +
      "onayını al, sonra aynı çağrıyı onayla=true ile tekrarla.",
    yapilacak,
  };
}

const onaySemasi = {
  type: "boolean",
  description:
    "Veri değiştiren işlemler için true olmalı. Kullanıcı işlemi açıkça " +
    "istemeden true verme.",
};

/** Ülke kodları spesifikasyonda büyük harf (TUR, USA); küçük harf reddedilir. */
function ulkeKodu(ham: unknown): string | undefined {
  const s = String(ham ?? "").trim().toUpperCase();
  return s ? s : undefined;
}

export function appstoreAraclari(): Arac[] {
  return [
    {
      ad: "appstore__uygulamalar",
      aciklama:
        "App Store Connect hesabındaki uygulamaları listeler. Her uygulamanın " +
        "adını, bundle ID'sini, App Store ID'sini ve birincil dilini döndürür. " +
        "Diğer araçların çoğu buradaki 'id' değerini ister.",
      girdiSemasi: {
        type: "object",
        properties: {
          limit: sayi("Kaç uygulama dönsün (varsayılan 100)."),
          isim_filtresi: metin("Uygulama adında geçen kelimeye göre süz."),
        },
      },
      async calistir(girdi) {
        const istenen = adet(girdi.limit, 100);
        // Apple'ın filter[name] alanı tam eşleşme arar; "kelime geçiyor mu"
        // sorusunun karşılığı yok, o yüzden süzme burada yapılıyor.
        const { data } = await tumunuGetir(
          "/v1/apps",
          { sort: "name" },
          // Süzme istemci tarafında yapıldığı için önce geniş tarıyoruz;
          // sayfalama zaten kayıt bitince duruyor, küçük hesaplarda tek istek.
          girdi.isim_filtresi ? Math.max(istenen, 1000) : istenen,
        );

        let uygulamalar = data.map((u: any) => ({
          id: u.id,
          isim: u.attributes?.name,
          bundle_id: u.attributes?.bundleId,
          sku: u.attributes?.sku,
          birincil_dil: u.attributes?.primaryLocale,
        }));

        if (girdi.isim_filtresi) {
          const aranan = String(girdi.isim_filtresi).toLowerCase();
          uygulamalar = uygulamalar
            .filter((u: any) => (u.isim || "").toLowerCase().includes(aranan))
            .slice(0, istenen);
        }

        return { adet: uygulamalar.length, uygulamalar };
      },
    },

    {
      ad: "appstore__surumler",
      aciklama:
        "Bir uygulamanın App Store sürümlerini ve durumlarını listeler " +
        "(hazırlanıyor, incelemede, yayında, reddedildi...). " +
        "'Hangi sürüm incelemede takıldı' sorusunun cevabı burada.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
          limit: sayi("Kaç sürüm dönsün (varsayılan 10)."),
        },
        required: ["uygulama_id"],
      },
      async calistir(girdi) {
        const { data } = await tumunuGetir(
          `/v1/apps/${parca(girdi.uygulama_id, "uygulama_id")}/appStoreVersions`,
          {},
          adet(girdi.limit, 10),
        );

        return {
          surumler: data.map((s: any) => ({
            id: s.id,
            surum: s.attributes?.versionString,
            // Spesifikasyonda appStoreState "deprecated" işaretli; güncel alan
            // appVersionState. Eski hesaplarda hâlâ yalnız eskisi dolu gelebilir.
            durum: s.attributes?.appVersionState ?? s.attributes?.appStoreState,
            platform: s.attributes?.platform,
            yayin_turu: s.attributes?.releaseType,
            indirilebilir: s.attributes?.downloadable,
            en_erken_yayin: s.attributes?.earliestReleaseDate,
            olusturulma: s.attributes?.createdDate,
          })),
        };
      },
    },

    {
      ad: "appstore__buildler",
      aciklama:
        "TestFlight build'lerini listeler; işlenme durumunu ve son kullanma " +
        "tarihini gösterir. En yeni build en üstte gelir. " +
        "'Yüklediğim build hazır mı' sorusunun cevabı.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("Belirtilirse sadece o uygulamanın build'leri."),
          limit: sayi("Kaç build dönsün (varsayılan 20)."),
        },
      },
      async calistir(girdi) {
        // Sıralama verilmezse Apple'ın döndürdüğü sıra tanımsızdır; "en son
        // yüklediğim build" sorusu o yüzden yanlış cevaplanabiliyordu.
        const sorgu: Record<string, unknown> = { sort: "-uploadedDate" };
        if (girdi.uygulama_id) sorgu["filter[app]"] = girdi.uygulama_id;

        const { data } = await tumunuGetir("/v1/builds", sorgu, adet(girdi.limit, 20));

        return {
          buildler: data.map((b: any) => ({
            id: b.id,
            surum: b.attributes?.version,
            islenme_durumu: b.attributes?.processingState,
            yuklenme: b.attributes?.uploadedDate,
            son_kullanma: b.attributes?.expirationDate,
            suresi_doldu: b.attributes?.expired,
            min_os: b.attributes?.minOsVersion,
            kitle: b.attributes?.buildAudienceType,
          })),
        };
      },
    },

    {
      ad: "appstore__yorumlar",
      aciklama:
        "Bir uygulamanın App Store müşteri yorumlarını getirir. Puana veya " +
        "ülkeye göre süzülebilir, en yeniden eskiye sıralanır. Yorumları " +
        "özetlemek, şikâyetleri bulmak veya cevap taslağı hazırlamak için kullan. " +
        "Yoruma daha önce yanıt verilmişse onu da gösterir.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
          puan: sayi("Sadece bu yıldız sayısındaki yorumlar (1-5)."),
          ulke: metin("Üç harfli ülke kodu, örn. TUR, USA."),
          yanitsizlar: {
            type: "boolean",
            description: "Sadece henüz yanıtlanmamış yorumlar.",
          },
          limit: sayi("Kaç yorum dönsün (varsayılan 50)."),
        },
        required: ["uygulama_id"],
      },
      async calistir(girdi) {
        const sorgu: Record<string, unknown> = {
          sort: "-createdDate",
          include: "response",
        };

        if (girdi.puan !== undefined) {
          const puan = Number(girdi.puan);
          if (!Number.isInteger(puan) || puan < 1 || puan > 5) {
            throw new Error("Puan 1 ile 5 arasında bir tam sayı olmalı.");
          }
          sorgu["filter[rating]"] = puan;
        }

        const ulke = ulkeKodu(girdi.ulke);
        if (ulke) sorgu["filter[territory]"] = ulke;
        if (girdi.yanitsizlar) sorgu["exists[publishedResponse]"] = false;

        const { data, included } = await tumunuGetir(
          `/v1/apps/${parca(girdi.uygulama_id, "uygulama_id")}/customerReviews`,
          sorgu,
          adet(girdi.limit, 50),
        );

        const yanitlar = new Map<string, any>();
        for (const d of included) {
          if (d?.type === "customerReviewResponses") yanitlar.set(d.id, d);
        }

        return {
          adet: data.length,
          yorumlar: data.map((y: any) => {
            const yanitId = y.relationships?.response?.data?.id;
            const yanit = yanitId ? yanitlar.get(yanitId) : undefined;
            return {
              id: y.id,
              puan: y.attributes?.rating,
              baslik: y.attributes?.title,
              metin: y.attributes?.body,
              yazan: y.attributes?.reviewerNickname,
              ulke: y.attributes?.territory,
              tarih: y.attributes?.createdDate,
              yanit: yanit
                ? {
                    metin: yanit.attributes?.responseBody,
                    durum: yanit.attributes?.state,
                    tarih: yanit.attributes?.lastModifiedDate,
                  }
                : undefined,
            };
          }),
        };
      },
    },

    {
      ad: "appstore__yorum_yanitla",
      aciklama:
        "Bir App Store yorumuna geliştirici yanıtı yazar. " +
        "Yanıt Apple incelemesinden geçtikten sonra yayınlanır.",
      girdiSemasi: {
        type: "object",
        properties: {
          yorum_id: metin("appstore__yorumlar'dan gelen yorum id'si."),
          yanit: metin("Yanıt metni (en fazla 5970 karakter)."),
          onayla: onaySemasi,
        },
        required: ["yorum_id", "yanit"],
      },
      yazma: true,
      async calistir(girdi) {
        const yanit = String(girdi.yanit ?? "");
        if (!yanit.trim()) throw new Error("Yanıt metni boş olamaz.");
        if (yanit.length > 5970) {
          throw new Error(
            `Yanıt ${yanit.length} karakter; App Store sınırı 5970 karakter.`,
          );
        }
        const yorumId = parca(girdi.yorum_id, "yorum_id");

        if (girdi.onayla !== true) {
          return onayIste(
            "POST /v1/customerReviewResponses",
            "App Store yorumuna herkese açık geliştirici yanıtı yayımlar.",
            { yorum_id: girdi.yorum_id, yayimlanacak_yanit: yanit },
          );
        }

        return cagir({
          yontem: "POST",
          yol: "/v1/customerReviewResponses",
          govde: {
            data: {
              type: "customerReviewResponses",
              attributes: { responseBody: yanit },
              relationships: {
                review: {
                  data: { type: "customerReviews", id: yorumId },
                },
              },
            },
          },
        });
      },
    },

    {
      ad: "appstore__abonelikler",
      aciklama:
        "Bir uygulamanın abonelik gruplarını ve içlerindeki abonelikleri " +
        "listeler. Ürün kimliği (productId), süre ve durum bilgisi döner.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
        },
        required: ["uygulama_id"],
      },
      async calistir(girdi) {
        const { data: gruplar } = await tumunuGetir(
          `/v1/apps/${parca(girdi.uygulama_id, "uygulama_id")}/subscriptionGroups`,
          {},
          SAYFA_SINIRI,
        );

        const sonuc = [];
        for (const grup of gruplar) {
          const { data: abonelikler } = await tumunuGetir(
            `/v1/subscriptionGroups/${parca(grup.id, "grup id")}/subscriptions`,
            {},
            SAYFA_SINIRI,
          );

          sonuc.push({
            grup_id: grup.id,
            grup_adi: grup.attributes?.referenceName,
            abonelikler: abonelikler.map((a: any) => ({
              id: a.id,
              urun_id: a.attributes?.productId,
              isim: a.attributes?.name,
              sure: a.attributes?.subscriptionPeriod,
              durum: a.attributes?.state,
              ailece_paylasim: a.attributes?.familySharable,
              grup_seviyesi: a.attributes?.groupLevel,
            })),
          });
        }

        return { gruplar: sonuc };
      },
    },

    {
      ad: "appstore__abonelik_fiyatlari",
      aciklama:
        "Bir aboneliğin ülke ülke fiyatlarını getirir. " +
        "'Bu abonelik Türkiye'de kaça' türü sorular için.",
      girdiSemasi: {
        type: "object",
        properties: {
          abonelik_id: metin("appstore__abonelikler'den gelen abonelik id'si."),
          ulke: metin("Sadece bu ülke, örn. TUR. Boşsa hepsi."),
          limit: sayi("Kaç fiyat kaydı (varsayılan 200)."),
        },
        required: ["abonelik_id"],
      },
      async calistir(girdi) {
        const sorgu: Record<string, unknown> = {
          include: "subscriptionPricePoint,territory",
        };
        // Ülke süzgecini Apple'a bırakmak şart: 175'ten fazla ülke ve her
        // ülkede geçmiş fiyat kayıtları var; ilk sayfayı çekip sonradan süzmek
        // aranan ülkeyi sessizce ıskalayabiliyordu.
        const ulke = ulkeKodu(girdi.ulke);
        if (ulke) sorgu["filter[territory]"] = ulke;

        const { data, included } = await tumunuGetir(
          `/v1/subscriptions/${parca(girdi.abonelik_id, "abonelik_id")}/prices`,
          sorgu,
          adet(girdi.limit, 200),
        );

        // `included` içinde hem fiyat noktaları hem ülkeler var; kimlikler
        // ayrı uzaylardan geldiği için anahtarı tür ile birlikte kuruyoruz.
        const dahililer = new Map<string, any>();
        for (const d of included) dahililer.set(`${d?.type}:${d?.id}`, d);

        const fiyatlar = data.map((f: any) => {
          const noktaId = f.relationships?.subscriptionPricePoint?.data?.id;
          const nokta = dahililer.get(`subscriptionPricePoints:${noktaId}`);
          return {
            ulke: f.relationships?.territory?.data?.id,
            fiyat: nokta?.attributes?.customerPrice,
            gelir: nokta?.attributes?.proceeds,
            plan_turu: f.attributes?.planType,
            baslangic: f.attributes?.startDate,
            korunan: f.attributes?.preserved,
          };
        });

        return { adet: fiyatlar.length, fiyatlar };
      },
    },

    {
      ad: "appstore__iap_urunler",
      aciklama:
        "Uygulamanın tek seferlik uygulama içi satın alma ürünlerini listeler " +
        "(abonelik olmayanlar).",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
          limit: sayi("Kaç ürün dönsün (varsayılan 200)."),
        },
        required: ["uygulama_id"],
      },
      async calistir(girdi) {
        const { data } = await tumunuGetir(
          `/v1/apps/${parca(girdi.uygulama_id, "uygulama_id")}/inAppPurchasesV2`,
          { sort: "name" },
          adet(girdi.limit, 200),
        );

        return {
          urunler: data.map((u: any) => ({
            id: u.id,
            urun_id: u.attributes?.productId,
            isim: u.attributes?.name,
            tur: u.attributes?.inAppPurchaseType,
            durum: u.attributes?.state,
            ailece_paylasim: u.attributes?.familySharable,
          })),
        };
      },
    },

    {
      ad: "appstore__testflight_gruplari",
      aciklama:
        "Uygulamanın TestFlight beta gruplarını ve her gruptaki test kullanıcı " +
        "sayısını listeler.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
        },
        required: ["uygulama_id"],
      },
      async calistir(girdi) {
        // /v1/apps/{id}/betaGroups yalnızca `limit` kabul eder; test kullanıcı
        // sayısını verebilmek için include destekleyen koleksiyon ucunu
        // kullanıyoruz. Sayı, ilişkinin meta.paging.total alanından gelir.
        const { data } = await tumunuGetir(
          "/v1/betaGroups",
          {
            "filter[app]": kimlik(girdi.uygulama_id, "uygulama_id"),
            include: "betaTesters",
            "limit[betaTesters]": 1,
            sort: "name",
          },
          SAYFA_SINIRI,
        );

        return {
          gruplar: data.map((g: any) => ({
            id: g.id,
            isim: g.attributes?.name,
            ic_grup: g.attributes?.isInternalGroup,
            tester_sayisi: g.relationships?.betaTesters?.meta?.paging?.total,
            tum_buildlere_erisim: g.attributes?.hasAccessToAllBuilds,
            genel_link: g.attributes?.publicLinkEnabled,
            link: g.attributes?.publicLink,
            // Kota yalnızca publicLinkLimitEnabled açıkken anlamlı.
            kota: g.attributes?.publicLinkLimitEnabled
              ? g.attributes?.publicLinkLimit
              : undefined,
          })),
        };
      },
    },

    {
      ad: "appstore__metin_guncelle",
      aciklama:
        "Bir sürümün mağaza metinlerini günceller: sürüm notları, açıklama, " +
        "anahtar kelimeler, tanıtım metni. Yayındaki sürüm düzenlenemez, " +
        "sadece hazırlanmakta olan sürüm düzenlenebilir.",
      girdiSemasi: {
        type: "object",
        properties: {
          yerellestirme_id: metin(
            "appStoreVersionLocalization id'si. Bulmak için: " +
              "appstore__surumler ile sürüm id'sini al, sonra magaza__cagir ile " +
              "appStoreVersions_appStoreVersionLocalizations_getToManyRelated çağır.",
          ),
          surum_notlari: metin("'Bu sürümde neler yeni' metni."),
          aciklama: metin("Uygulama açıklaması."),
          anahtar_kelimeler: metin("Virgülle ayrılmış, en fazla 100 karakter."),
          tanitim_metni: metin("Promosyon metni (en fazla 170 karakter)."),
          onayla: onaySemasi,
        },
        required: ["yerellestirme_id"],
      },
      yazma: true,
      async calistir(girdi) {
        const nitelikler: Record<string, string> = {};
        // Boş dize geçerli bir değer: alanı temizlemek isteyen kullanıcıyı
        // sessizce görmezden gelmemek için undefined kontrolü yapıyoruz.
        if (girdi.surum_notlari !== undefined) nitelikler.whatsNew = girdi.surum_notlari;
        if (girdi.aciklama !== undefined) nitelikler.description = girdi.aciklama;
        if (girdi.anahtar_kelimeler !== undefined)
          nitelikler.keywords = girdi.anahtar_kelimeler;
        if (girdi.tanitim_metni !== undefined)
          nitelikler.promotionalText = girdi.tanitim_metni;

        if (Object.keys(nitelikler).length === 0) {
          throw new Error("Güncellenecek en az bir alan vermelisin.");
        }
        if (nitelikler.keywords && nitelikler.keywords.length > 100) {
          throw new Error(
            `Anahtar kelimeler ${nitelikler.keywords.length} karakter; App Store sınırı 100.`,
          );
        }
        if (nitelikler.promotionalText && nitelikler.promotionalText.length > 170) {
          throw new Error(
            `Tanıtım metni ${nitelikler.promotionalText.length} karakter; App Store sınırı 170.`,
          );
        }

        const hedef = parca(girdi.yerellestirme_id, "yerellestirme_id");

        if (girdi.onayla !== true) {
          return onayIste(
            `PATCH /v1/appStoreVersionLocalizations/${girdi.yerellestirme_id}`,
            "Yayına çıkacak mağaza metinlerini değiştirir.",
            { yerellestirme_id: girdi.yerellestirme_id, yazilacak_alanlar: nitelikler },
          );
        }

        return cagir({
          yontem: "PATCH",
          yol: `/v1/appStoreVersionLocalizations/${hedef}`,
          govde: {
            data: {
              type: "appStoreVersionLocalizations",
              id: girdi.yerellestirme_id,
              attributes: nitelikler,
            },
          },
        });
      },
    },

    {
      ad: "appstore__satis_raporu",
      aciklama:
        "Satış ve indirme raporunu indirir (TSV biçiminde). Günlük, haftalık, " +
        "aylık veya yıllık olabilir. Apple raporları 1-2 gün gecikmeli yayınlar " +
        "ve hiç satış olmayan gün için dosya üretmez. " +
        "Not: SUBSCRIBER raporu yalnızca DETAILED alt türüyle çalışır; abonelik " +
        "raporları çoğu zaman bir sürüm numarası ister (örn. 1_3).",
      girdiSemasi: {
        type: "object",
        properties: {
          satici_no: metin("Vendor number (App Store Connect → Ödemeler)."),
          tarih: metin(
            "Rapor tarihi. DAILY: YYYY-AA-GG, WEEKLY: o haftanın son günü " +
              "(pazar) YYYY-AA-GG, MONTHLY: YYYY-AA, YEARLY: YYYY.",
          ),
          siklik: {
            type: "string",
            enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
            description: "Rapor sıklığı (varsayılan DAILY).",
          },
          tur: {
            type: "string",
            enum: [
              "SALES",
              "PRE_ORDER",
              "SUBSCRIPTION",
              "SUBSCRIPTION_EVENT",
              "SUBSCRIBER",
              "SUBSCRIPTION_OFFER_CODE_REDEMPTION",
              "INSTALLS",
              "FIRST_ANNUAL",
              "WIN_BACK_ELIGIBILITY",
            ],
            description: "Rapor türü (varsayılan SALES).",
          },
          alt_tur: {
            type: "string",
            enum: [
              "SUMMARY",
              "DETAILED",
              "SUMMARY_INSTALL_TYPE",
              "SUMMARY_TERRITORY",
              "SUMMARY_CHANNEL",
            ],
            description:
              "Rapor alt türü. Boşsa SUMMARY; SUBSCRIBER için DETAILED seçilir.",
          },
          surum: metin(
            "Rapor sürümü, örn. 1_0 / 1_2 / 1_3. Apple bazı rapor türlerinde " +
              "zorunlu tutar; hata alırsan burayı doldur.",
          ),
          satir_limiti: sayi("Kaç veri satırı gösterilsin (varsayılan 200)."),
        },
        required: ["satici_no", "tarih"],
      },
      async calistir(girdi) {
        const tur = String(girdi.tur ?? "SALES");
        // SUBSCRIBER raporunun SUMMARY karşılığı yok; sabit SUMMARY göndermek
        // bu rapor türünü tamamen kullanılamaz kılıyordu.
        const altTur = girdi.alt_tur ?? (tur === "SUBSCRIBER" ? "DETAILED" : "SUMMARY");

        const tsv = await raporIndir({
          vendorNumber: girdi.satici_no ?? girdi["saticı_no"],
          reportDate: girdi.tarih,
          frequency: girdi.siklik ?? girdi["sıklık"] ?? "DAILY",
          reportType: tur,
          reportSubType: altTur,
          version: girdi.surum,
        });

        // Apple bazı raporları CRLF ile döndürür; \r satır sonlarını kırpıyoruz.
        const satirlar = tsv.replace(/\r\n/g, "\n").trim().split("\n");
        const goster = adet(girdi.satir_limiti, 200, 5000);
        const toplam = Math.max(0, satirlar.length - 1);

        return {
          satir_sayisi: toplam,
          basliklar: satirlar[0]?.split("\t"),
          veri: satirlar.slice(1, goster + 1),
          not:
            toplam > goster
              ? `Toplam ${toplam} satırın ilk ${goster}'ü gösteriliyor.`
              : undefined,
        };
      },
    },
  ];
}
