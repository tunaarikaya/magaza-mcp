/**
 * App Store Connect için seçilmiş araçlar.
 *
 * Günlük işin büyük kısmı bunlarla döner. Buradaki yolların hepsi Apple'ın
 * OpenAPI spesifikasyonuna karşı doğrulandı; geri kalan ~1100 operasyona
 * magaza__endpoint_ara ve magaza__cagir üzerinden erişilir.
 */
import { cagir, raporIndir } from "../istemci/apple.js";
import type { Arac } from "./tip.js";

const metin = (aciklama: string) => ({ type: "string", description: aciklama });
const sayi = (aciklama: string) => ({ type: "number", description: aciklama });

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
        const yanit: any = await cagir({
          yontem: "GET",
          yol: "/v1/apps",
          sorgu: { limit: girdi.limit ?? 100 },
        });

        let uygulamalar = (yanit.data || []).map((u: any) => ({
          id: u.id,
          isim: u.attributes?.name,
          bundle_id: u.attributes?.bundleId,
          sku: u.attributes?.sku,
          birincil_dil: u.attributes?.primaryLocale,
        }));

        if (girdi.isim_filtresi) {
          const aranan = String(girdi.isim_filtresi).toLowerCase();
          uygulamalar = uygulamalar.filter((u: any) =>
            (u.isim || "").toLowerCase().includes(aranan),
          );
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
        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/v1/apps/${girdi.uygulama_id}/appStoreVersions`,
          sorgu: { limit: girdi.limit ?? 10 },
        });

        return {
          surumler: (yanit.data || []).map((s: any) => ({
            id: s.id,
            surum: s.attributes?.versionString,
            durum: s.attributes?.appStoreState ?? s.attributes?.appVersionState,
            platform: s.attributes?.platform,
            yayin_turu: s.attributes?.releaseType,
            olusturulma: s.attributes?.createdDate,
          })),
        };
      },
    },

    {
      ad: "appstore__buildler",
      aciklama:
        "TestFlight build'lerini listeler; işlenme durumunu ve son kullanma " +
        "tarihini gösterir. 'Yüklediğim build hazır mı' sorusunun cevabı.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("Belirtilirse sadece o uygulamanın build'leri."),
          limit: sayi("Kaç build dönsün (varsayılan 20)."),
        },
      },
      async calistir(girdi) {
        const sorgu: Record<string, unknown> = { limit: girdi.limit ?? 20 };
        if (girdi.uygulama_id) sorgu["filter[app]"] = girdi.uygulama_id;

        const yanit: any = await cagir({
          yontem: "GET",
          yol: "/v1/builds",
          sorgu,
        });

        return {
          buildler: (yanit.data || []).map((b: any) => ({
            id: b.id,
            surum: b.attributes?.version,
            islenme_durumu: b.attributes?.processingState,
            yuklenme: b.attributes?.uploadedDate,
            son_kullanma: b.attributes?.expirationDate,
            suresi_doldu: b.attributes?.expired,
            min_os: b.attributes?.minOsVersion,
          })),
        };
      },
    },

    {
      ad: "appstore__yorumlar",
      aciklama:
        "Bir uygulamanın App Store müşteri yorumlarını getirir. Puana veya " +
        "ülkeye göre süzülebilir. Yorumları özetlemek, şikâyetleri bulmak " +
        "veya cevap taslağı hazırlamak için kullan.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama_id: metin("appstore__uygulamalar'dan gelen id."),
          puan: sayi("Sadece bu yıldız sayısındaki yorumlar (1-5)."),
          ulke: metin("Ülke kodu, örn. TUR, USA."),
          limit: sayi("Kaç yorum dönsün (varsayılan 50)."),
        },
        required: ["uygulama_id"],
      },
      async calistir(girdi) {
        const sorgu: Record<string, unknown> = {
          limit: girdi.limit ?? 50,
          sort: "-createdDate",
        };
        if (girdi.puan) sorgu["filter[rating]"] = girdi.puan;
        if (girdi.ulke) sorgu["filter[territory]"] = girdi.ulke;

        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/v1/apps/${girdi.uygulama_id}/customerReviews`,
          sorgu,
        });

        return {
          adet: (yanit.data || []).length,
          yorumlar: (yanit.data || []).map((y: any) => ({
            id: y.id,
            puan: y.attributes?.rating,
            baslik: y.attributes?.title,
            metin: y.attributes?.body,
            yazan: y.attributes?.reviewerNickname,
            ulke: y.attributes?.territory,
            tarih: y.attributes?.createdDate,
          })),
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
        },
        required: ["yorum_id", "yanit"],
      },
      yazma: true,
      async calistir(girdi) {
        return cagir({
          yontem: "POST",
          yol: "/v1/customerReviewResponses",
          govde: {
            data: {
              type: "customerReviewResponses",
              attributes: { responseBody: girdi.yanit },
              relationships: {
                review: {
                  data: { type: "customerReviews", id: girdi.yorum_id },
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
        const gruplar: any = await cagir({
          yontem: "GET",
          yol: `/v1/apps/${girdi.uygulama_id}/subscriptionGroups`,
          sorgu: { limit: 50 },
        });

        const sonuc = [];
        for (const grup of gruplar.data || []) {
          const abonelikler: any = await cagir({
            yontem: "GET",
            yol: `/v1/subscriptionGroups/${grup.id}/subscriptions`,
            sorgu: { limit: 50 },
          });

          sonuc.push({
            grup_id: grup.id,
            grup_adi: grup.attributes?.referenceName,
            abonelikler: (abonelikler.data || []).map((a: any) => ({
              id: a.id,
              urun_id: a.attributes?.productId,
              isim: a.attributes?.name,
              sure: a.attributes?.subscriptionPeriod,
              durum: a.attributes?.state,
              ailece_paylasim: a.attributes?.familySharable,
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
        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/v1/subscriptions/${girdi.abonelik_id}/prices`,
          sorgu: {
            limit: girdi.limit ?? 200,
            include: "subscriptionPricePoint,territory",
          },
        });

        const noktalar = new Map<string, any>();
        for (const dahil of yanit.included || []) {
          noktalar.set(dahil.id, dahil);
        }

        let fiyatlar = (yanit.data || []).map((f: any) => {
          const noktaId = f.relationships?.subscriptionPricePoint?.data?.id;
          const nokta = noktalar.get(noktaId);
          const ulkeId = f.relationships?.territory?.data?.id;
          return {
            ulke: ulkeId,
            fiyat: nokta?.attributes?.customerPrice,
            gelir: nokta?.attributes?.proceeds,
            baslangic: f.attributes?.startDate,
          };
        });

        if (girdi.ulke) {
          const aranan = String(girdi.ulke).toUpperCase();
          fiyatlar = fiyatlar.filter((f: any) => f.ulke === aranan);
        }

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
        },
        required: ["uygulama_id"],
      },
      async calistir(girdi) {
        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/v1/apps/${girdi.uygulama_id}/inAppPurchasesV2`,
          sorgu: { limit: 200 },
        });

        return {
          urunler: (yanit.data || []).map((u: any) => ({
            id: u.id,
            urun_id: u.attributes?.productId,
            isim: u.attributes?.name,
            tur: u.attributes?.inAppPurchaseType,
            durum: u.attributes?.state,
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
        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/v1/apps/${girdi.uygulama_id}/betaGroups`,
          sorgu: { limit: 50 },
        });

        return {
          gruplar: (yanit.data || []).map((g: any) => ({
            id: g.id,
            isim: g.attributes?.name,
            ic_grup: g.attributes?.isInternalGroup,
            genel_link: g.attributes?.publicLinkEnabled,
            link: g.attributes?.publicLink,
            kota: g.attributes?.publicLinkLimit,
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
          tanitim_metni: metin("Promosyon metni (170 karakter)."),
        },
        required: ["yerellestirme_id"],
      },
      yazma: true,
      async calistir(girdi) {
        const nitelikler: Record<string, string> = {};
        if (girdi.surum_notlari) nitelikler.whatsNew = girdi.surum_notlari;
        if (girdi.aciklama) nitelikler.description = girdi.aciklama;
        if (girdi.anahtar_kelimeler) nitelikler.keywords = girdi.anahtar_kelimeler;
        if (girdi.tanitim_metni) nitelikler.promotionalText = girdi.tanitim_metni;

        if (Object.keys(nitelikler).length === 0) {
          throw new Error("Güncellenecek en az bir alan vermelisin.");
        }

        return cagir({
          yontem: "PATCH",
          yol: `/v1/appStoreVersionLocalizations/${girdi.yerellestirme_id}`,
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
        "aylık veya yıllık olabilir. Apple raporları 1-2 gün gecikmeli yayınlar.",
      girdiSemasi: {
        type: "object",
        properties: {
          saticı_no: metin("Vendor number (App Store Connect → Ödemeler)."),
          tarih: metin("Rapor tarihi. Günlük için YYYY-AA-GG, aylık için YYYY-AA."),
          sıklık: {
            type: "string",
            enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
            description: "Rapor sıklığı (varsayılan DAILY).",
          },
          tur: {
            type: "string",
            enum: ["SALES", "SUBSCRIPTION", "SUBSCRIPTION_EVENT", "SUBSCRIBER"],
            description: "Rapor türü (varsayılan SALES).",
          },
        },
        required: ["saticı_no", "tarih"],
      },
      async calistir(girdi) {
        const tsv = await raporIndir({
          vendorNumber: girdi.saticı_no,
          reportDate: girdi.tarih,
          frequency: girdi.sıklık ?? "DAILY",
          reportType: girdi.tur ?? "SALES",
          reportSubType: "SUMMARY",
        });

        const satirlar = tsv.trim().split("\n");
        return {
          satir_sayisi: Math.max(0, satirlar.length - 1),
          basliklar: satirlar[0]?.split("\t"),
          // Bağlamı boğmamak için ilk 200 satır.
          veri: satirlar.slice(1, 201),
          not:
            satirlar.length > 201
              ? `Toplam ${satirlar.length - 1} satırın ilk 200'ü gösteriliyor.`
              : undefined,
        };
      },
    },
  ];
}
