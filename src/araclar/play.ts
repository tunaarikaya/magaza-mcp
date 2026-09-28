/**
 * Google Play için seçilmiş araçlar.
 *
 * Play'in iki tuhaflığı var, ikisi de burada saklanıyor:
 *  1. Android Publisher API'de "uygulamalarımı listele" diye bir uç yok;
 *     listeyi Play Developer Reporting API'sinin apps:search'ünden alıyoruz.
 *  2. Sürüm/kanal bilgisi ancak bir "düzenleme oturumu" (edit) içinden
 *     okunabilir. Okuma araçları oturumu açıp kapatıyor, kullanıcı görmüyor.
 */
import { cagir } from "../istemci/play.js";
import type { Arac } from "./tip.js";

const metin = (aciklama: string) => ({ type: "string", description: aciklama });
const sayi = (aciklama: string) => ({ type: "number", description: aciklama });

const paketAlani = metin("Uygulamanın paket adı, örn. com.sirket.uygulama.");

/** Geçici bir düzenleme oturumu açar, işi yapar, oturumu bırakır. */
async function oturumda<T>(
  packageName: string,
  is: (editId: string) => Promise<T>,
): Promise<T> {
  const oturum: any = await cagir({
    yontem: "POST",
    yol: `/androidpublisher/v3/applications/${packageName}/edits`,
  });

  try {
    return await is(oturum.id);
  } finally {
    // Oturumu commit etmiyoruz; sadece okuduk. Bırakmak değişiklik yaratmaz.
    try {
      await cagir({
        yontem: "DELETE",
        yol: `/androidpublisher/v3/applications/${packageName}/edits/${oturum.id}`,
      });
    } catch {
      /* oturum zaten düşmüş olabilir */
    }
  }
}

export function playAraclari(): Arac[] {
  return [
    {
      ad: "play__uygulamalar",
      aciklama:
        "Servis hesabının eriştiği Google Play uygulamalarını listeler. " +
        "Diğer play__ araçlarının istediği paket adını (packageName) buradan al. " +
        "Not: bu liste Play Developer Reporting API'sinden gelir, çünkü " +
        "Android Publisher API'sinde uygulama listeleme uç noktası yoktur.",
      girdiSemasi: {
        type: "object",
        properties: {
          limit: sayi("Kaç uygulama dönsün (varsayılan 50)."),
        },
      },
      async calistir(girdi) {
        const yanit: any = await cagir({
          api: "reporting",
          yontem: "GET",
          yol: "/v1beta1/apps:search",
          sorgu: { pageSize: girdi.limit ?? 50 },
        });

        return {
          adet: (yanit.apps || []).length,
          uygulamalar: (yanit.apps || []).map((u: any) => ({
            paket_adi: u.packageName,
            isim: u.displayName,
          })),
        };
      },
    },

    {
      ad: "play__kanallar",
      aciklama:
        "Uygulamanın yayın kanallarını (internal, alpha, beta, production) ve " +
        "her kanaldaki sürümleri gösterir. Hangi sürümün hangi kanalda, " +
        "yüzde kaç kullanıcıya açık olduğunu söyler.",
      girdiSemasi: {
        type: "object",
        properties: { paket_adi: paketAlani },
        required: ["paket_adi"],
      },
      async calistir(girdi) {
        return oturumda(girdi.paket_adi, async (editId) => {
          const yanit: any = await cagir({
            yontem: "GET",
            yol: `/androidpublisher/v3/applications/${girdi.paket_adi}/edits/${editId}/tracks`,
          });

          return {
            kanallar: (yanit.tracks || []).map((k: any) => ({
              kanal: k.track,
              surumler: (k.releases || []).map((s: any) => ({
                ad: s.name,
                surum_kodlari: s.versionCodes,
                durum: s.status,
                kullanici_orani: s.userFraction
                  ? `%${(s.userFraction * 100).toFixed(1)}`
                  : s.status === "completed"
                    ? "%100"
                    : undefined,
                notlar: (s.releaseNotes || []).map((n: any) => ({
                  dil: n.language,
                  metin: n.text,
                })),
              })),
            })),
          };
        });
      },
    },

    {
      ad: "play__yorumlar",
      aciklama:
        "Google Play kullanıcı yorumlarını getirir. Play yalnızca son ~1 " +
        "haftanın yorumlarını API'den verir; daha eskisi için Play Console " +
        "dışa aktarımı gerekir.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          dil: metin("Çeviri dili, örn. tr. Boşsa orijinal dilde gelir."),
          limit: sayi("Kaç yorum dönsün (varsayılan 50)."),
        },
        required: ["paket_adi"],
      },
      async calistir(girdi) {
        const sorgu: Record<string, unknown> = { maxResults: girdi.limit ?? 50 };
        if (girdi.dil) sorgu.translationLanguage = girdi.dil;

        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/androidpublisher/v3/applications/${girdi.paket_adi}/reviews`,
          sorgu,
        });

        return {
          adet: (yanit.reviews || []).length,
          yorumlar: (yanit.reviews || []).map((y: any) => {
            const son = y.comments?.[0]?.userComment;
            return {
              id: y.reviewId,
              yazan: y.authorName,
              puan: son?.starRating,
              metin: son?.text,
              cihaz: son?.deviceMetadata?.productName,
              android: son?.androidOsVersion,
              uygulama_surumu: son?.appVersionName,
              tarih: son?.lastModified?.seconds
                ? new Date(Number(son.lastModified.seconds) * 1000).toISOString()
                : undefined,
              gelistirici_yaniti: y.comments?.[1]?.developerComment?.text,
            };
          }),
        };
      },
    },

    {
      ad: "play__yorum_yanitla",
      aciklama: "Bir Google Play yorumuna geliştirici yanıtı yazar.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          yorum_id: metin("play__yorumlar'dan gelen yorum id'si."),
          yanit: metin("Yanıt metni (en fazla 350 karakter)."),
        },
        required: ["paket_adi", "yorum_id", "yanit"],
      },
      yazma: true,
      async calistir(girdi) {
        return cagir({
          yontem: "POST",
          yol: `/androidpublisher/v3/applications/${girdi.paket_adi}/reviews/${girdi.yorum_id}:reply`,
          govde: { replyText: girdi.yanit },
        });
      },
    },

    {
      ad: "play__abonelikler",
      aciklama:
        "Uygulamanın aboneliklerini ve temel planlarını (base plan) listeler. " +
        "Her planın süresi, durumu ve fiyatlandırıldığı ülkeler döner.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          limit: sayi("Kaç abonelik dönsün (varsayılan 50)."),
        },
        required: ["paket_adi"],
      },
      async calistir(girdi) {
        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/androidpublisher/v3/applications/${girdi.paket_adi}/subscriptions`,
          sorgu: { pageSize: girdi.limit ?? 50 },
        });

        return {
          abonelikler: (yanit.subscriptions || []).map((a: any) => ({
            urun_id: a.productId,
            isim: a.listings?.[0]?.title,
            arsivlenmis: a.archived,
            planlar: (a.basePlans || []).map((p: any) => ({
              plan_id: p.basePlanId,
              durum: p.state,
              sure: p.autoRenewingBasePlanType?.billingPeriodDuration
                ?? p.prepaidBasePlanType?.billingPeriodDuration,
              yenilenen: !!p.autoRenewingBasePlanType,
              ulke_sayisi: (p.regionalConfigs || []).length,
            })),
          })),
        };
      },
    },

    {
      ad: "play__abonelik_fiyatlari",
      aciklama:
        "Bir Play aboneliğinin temel planındaki ülke ülke fiyatlarını getirir.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          urun_id: metin("play__abonelikler'den gelen urun_id."),
          plan_id: metin("Temel plan kimliği. Boşsa ilk plan kullanılır."),
          ulke: metin("Sadece bu ülke, örn. TR. Boşsa hepsi."),
        },
        required: ["paket_adi", "urun_id"],
      },
      async calistir(girdi) {
        const abonelik: any = await cagir({
          yontem: "GET",
          yol: `/androidpublisher/v3/applications/${girdi.paket_adi}/subscriptions/${girdi.urun_id}`,
        });

        const planlar = abonelik.basePlans || [];
        const plan = girdi.plan_id
          ? planlar.find((p: any) => p.basePlanId === girdi.plan_id)
          : planlar[0];

        if (!plan) {
          throw new Error(
            `Temel plan bulunamadı. Mevcut planlar: ${planlar.map((p: any) => p.basePlanId).join(", ") || "yok"}`,
          );
        }

        let fiyatlar = (plan.regionalConfigs || []).map((b: any) => ({
          ulke: b.regionCode,
          fiyat: b.price
            ? `${(Number(b.price.units || 0) + Number(b.price.nanos || 0) / 1e9).toFixed(2)} ${b.price.currencyCode}`
            : undefined,
          yeni_abonelere_acik: b.newSubscriberAvailability,
        }));

        if (girdi.ulke) {
          const aranan = String(girdi.ulke).toUpperCase();
          fiyatlar = fiyatlar.filter((f: any) => f.ulke === aranan);
        }

        return { plan_id: plan.basePlanId, adet: fiyatlar.length, fiyatlar };
      },
    },

    {
      ad: "play__urunler",
      aciklama:
        "Tek seferlik uygulama içi ürünleri listeler. Yeni ürün modeline geçmiş " +
        "uygulamalarda oneTimeProducts, geçmemişlerde eski inappproducts uç " +
        "noktası kullanılır — bu araç ikisini de dener, hangisinin çalıştığını söyler.",
      girdiSemasi: {
        type: "object",
        properties: { paket_adi: paketAlani },
        required: ["paket_adi"],
      },
      async calistir(girdi) {
        const taban = `/androidpublisher/v3/applications/${girdi.paket_adi}`;

        try {
          const yeni: any = await cagir({
            yontem: "GET",
            yol: `${taban}/oneTimeProducts`,
            sorgu: { pageSize: 100 },
          });

          return {
            model: "oneTimeProducts (yeni)",
            urunler: (yeni.oneTimeProducts || []).map((u: any) => ({
              urun_id: u.productId,
              isim: u.listings?.[0]?.title,
              secenekler: (u.purchaseOptions || []).map((s: any) => s.purchaseOptionId),
            })),
          };
        } catch (hata) {
          // Eski modeldeki uygulamalar yeni uçta 403/404 döner.
          const eski: any = await cagir({
            yontem: "GET",
            yol: `${taban}/inappproducts`,
            sorgu: { maxResults: 100 },
          });

          return {
            model: "inappproducts (eski)",
            urunler: (eski.inappproduct || []).map((u: any) => ({
              urun_id: u.sku,
              isim: u.listings?.["en-US"]?.title,
              durum: u.status,
              varsayilan_fiyat: u.defaultPrice
                ? `${(Number(u.defaultPrice.priceMicros || 0) / 1e6).toFixed(2)} ${u.defaultPrice.currency}`
                : undefined,
            })),
          };
        }
      },
    },

    {
      ad: "play__satin_alma_dogrula",
      aciklama:
        "Bir satın alma token'ını doğrular ve durumunu döndürür. " +
        "'Bu kullanıcının aboneliği gerçekten aktif mi' sorusunun cevabı. " +
        "Abonelik veya tek seferlik ürün, ikisi de desteklenir.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          token: metin("Uygulamadan gelen satın alma token'ı."),
          tur: {
            type: "string",
            enum: ["abonelik", "urun"],
            description: "Varsayılan: abonelik.",
          },
        },
        required: ["paket_adi", "token"],
      },
      async calistir(girdi) {
        const taban = `/androidpublisher/v3/applications/${girdi.paket_adi}/purchases`;

        if (girdi.tur === "urun") {
          const u: any = await cagir({
            yontem: "GET",
            yol: `${taban}/productsv2/tokens/${encodeURIComponent(girdi.token)}`,
          });
          return { tur: "tek seferlik ürün", ...u };
        }

        const a: any = await cagir({
          yontem: "GET",
          yol: `${taban}/subscriptionsv2/tokens/${encodeURIComponent(girdi.token)}`,
        });

        return {
          tur: "abonelik",
          durum: a.subscriptionState,
          onaylandi: a.acknowledgementState,
          baslangic: a.startTime,
          bitis: a.lineItems?.[0]?.expiryTime,
          otomatik_yenileme: a.lineItems?.[0]?.autoRenewingPlan?.autoRenewEnabled,
          urun_id: a.lineItems?.[0]?.productId,
          plan_id: a.lineItems?.[0]?.offerDetails?.basePlanId,
          bolge: a.regionCode,
          test_mi: a.testPurchase !== undefined,
          ham: a,
        };
      },
    },

    {
      ad: "play__iade_edilenler",
      aciklama:
        "İptal edilmiş, iade edilmiş veya geri alınmış satın almaları listeler. " +
        "Kullanıcının erişimini kesmen gerekip gerekmediğini anlamak için.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          limit: sayi("Kaç kayıt (varsayılan 100)."),
        },
        required: ["paket_adi"],
      },
      async calistir(girdi) {
        const yanit: any = await cagir({
          yontem: "GET",
          yol: `/androidpublisher/v3/applications/${girdi.paket_adi}/purchases/voidedpurchases`,
          sorgu: { maxResults: girdi.limit ?? 100 },
        });

        return {
          adet: (yanit.voidedPurchases || []).length,
          kayitlar: (yanit.voidedPurchases || []).map((k: any) => ({
            siparis_no: k.orderId,
            token: k.purchaseToken,
            iptal_zamani: k.voidedTimeMillis
              ? new Date(Number(k.voidedTimeMillis)).toISOString()
              : undefined,
            sebep: k.voidedReason,
            kaynak: k.voidedSource,
          })),
        };
      },
    },

    {
      ad: "play__cokme_orani",
      aciklama:
        "Android vitals çökme oranını getirir (Play Developer Reporting). " +
        "'Uygulamam neden çöküyor, ne zamandan beri arttı' sorularının başlangıcı.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          gun: sayi("Kaç günlük veri (varsayılan 14)."),
        },
        required: ["paket_adi"],
      },
      async calistir(girdi) {
        const gun = girdi.gun ?? 14;
        const bitis = new Date();
        const baslangic = new Date(Date.now() - gun * 86400000);

        const tarih = (d: Date) => ({
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
        });

        const yanit: any = await cagir({
          api: "reporting",
          yontem: "POST",
          yol: `/v1beta1/apps/${girdi.paket_adi}/crashRateMetricSet:query`,
          govde: {
            timelineSpec: {
              aggregationPeriod: "DAILY",
              startTime: tarih(baslangic),
              endTime: tarih(bitis),
            },
            metrics: ["crashRate", "distinctUsers"],
          },
        });

        return {
          gun_sayisi: (yanit.rows || []).length,
          gunler: (yanit.rows || []).map((s: any) => {
            const t = s.startTime;
            const olcumler: Record<string, unknown> = {};
            for (const m of s.metrics || []) {
              olcumler[m.metric] =
                m.decimalValue?.value ?? m.value?.decimalValue?.value;
            }
            return {
              tarih: t ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : undefined,
              ...olcumler,
            };
          }),
        };
      },
    },
  ];
}
