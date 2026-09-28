/**
 * Çapraz mağaza araçları.
 *
 * Projenin var oluş sebebi burası: bu araçlar iki mağazayı aynı anda
 * sorgular ve sonucu yan yana koyar. Tek mağazalı bir sunucuda bunları
 * yapmak mümkün değil.
 */
import { cagir as appleCagir } from "../istemci/apple.js";
import { cagir as playCagir } from "../istemci/play.js";
import { acikMagazalar, type Arac } from "./tip.js";

const metin = (aciklama: string) => ({ type: "string", description: aciklama });

/** Bir isteği çalıştırır; patlarsa hatayı sonuç olarak döndürür. */
async function dene<T>(is: () => Promise<T>): Promise<T | { hata: string }> {
  try {
    return await is();
  } catch (h) {
    return { hata: h instanceof Error ? h.message : String(h) };
  }
}

/** Apple tarafında uygulamayı ada veya bundle id'ye göre bulur. */
async function appleUygulamaBul(aranan: string): Promise<any | null> {
  const yanit: any = await appleCagir({
    yontem: "GET",
    yol: "/v1/apps",
    sorgu: { limit: 200 },
  });

  const kucuk = aranan.toLowerCase();
  const hepsi = yanit.data || [];

  return (
    hepsi.find((u: any) => u.attributes?.bundleId?.toLowerCase() === kucuk) ||
    hepsi.find((u: any) => u.attributes?.name?.toLowerCase() === kucuk) ||
    hepsi.find((u: any) => u.attributes?.name?.toLowerCase().includes(kucuk)) ||
    null
  );
}

/** Play tarafında uygulamayı paket adına veya görünen ada göre bulur. */
async function playUygulamaBul(aranan: string): Promise<any | null> {
  const yanit: any = await playCagir({
    api: "reporting",
    yontem: "GET",
    yol: "/v1beta1/apps:search",
    sorgu: { pageSize: 200 },
  });

  const kucuk = aranan.toLowerCase();
  const hepsi = yanit.apps || [];

  return (
    hepsi.find((u: any) => u.packageName?.toLowerCase() === kucuk) ||
    hepsi.find((u: any) => u.displayName?.toLowerCase() === kucuk) ||
    hepsi.find((u: any) => u.displayName?.toLowerCase().includes(kucuk)) ||
    null
  );
}

export function ortakAraclar(): Arac[] {
  const acik = acikMagazalar();

  // Çapraz araçların anlamı ancak iki mağaza da açıkken var.
  if (!acik.appstore || !acik.play) return [];

  return [
    {
      ad: "magaza__genel_bakis",
      aciklama:
        "İki mağazadaki uygulamaları tek listede gösterir ve aynı ürünün " +
        "iOS/Android eşlerini yan yana getirir. 'Nerede neyim var' " +
        "sorusunun tek çağrılık cevabı.",
      girdiSemasi: { type: "object", properties: {} },
      async calistir() {
        const [apple, play] = await Promise.all([
          dene(async () => {
            const y: any = await appleCagir({
              yontem: "GET",
              yol: "/v1/apps",
              sorgu: { limit: 200 },
            });
            return (y.data || []).map((u: any) => ({
              id: u.id,
              isim: u.attributes?.name,
              bundle_id: u.attributes?.bundleId,
            }));
          }),
          dene(async () => {
            const y: any = await playCagir({
              api: "reporting",
              yontem: "GET",
              yol: "/v1beta1/apps:search",
              sorgu: { pageSize: 200 },
            });
            return (y.apps || []).map((u: any) => ({
              paket_adi: u.packageName,
              isim: u.displayName,
            }));
          }),
        ]);

        const appleListe = Array.isArray(apple) ? apple : [];
        const playListe = Array.isArray(play) ? play : [];

        // Aynı ürünü iki mağazada eşleştirmeye çalış: önce bundle/paket adı,
        // sonra görünen ad.
        const eslesenler: any[] = [];
        const kalanPlay = new Set(playListe.map((p: any) => p.paket_adi));

        for (const a of appleListe) {
          const es = playListe.find(
            (p: any) =>
              p.paket_adi?.toLowerCase() === a.bundle_id?.toLowerCase() ||
              (p.isim &&
                a.isim &&
                p.isim.toLowerCase() === a.isim.toLowerCase()),
          );
          if (es) {
            eslesenler.push({
              isim: a.isim || es.isim,
              ios: { id: a.id, bundle_id: a.bundle_id },
              android: { paket_adi: es.paket_adi },
            });
            kalanPlay.delete(es.paket_adi);
          }
        }

        const eslesenIos = new Set(eslesenler.map((e) => e.ios.bundle_id));

        return {
          iki_magazada_da: eslesenler,
          sadece_ios: appleListe.filter((a: any) => !eslesenIos.has(a.bundle_id)),
          sadece_android: playListe.filter((p: any) => kalanPlay.has(p.paket_adi)),
          hatalar: {
            appstore: Array.isArray(apple) ? undefined : (apple as any).hata,
            play: Array.isArray(play) ? undefined : (play as any).hata,
          },
        };
      },
    },

    {
      ad: "magaza__abonelik_karsilastir",
      aciklama:
        "Aynı uygulamanın aboneliklerini App Store ve Google Play'de yan yana " +
        "karşılaştırır: ürün kimlikleri, süreler ve istenen ülkedeki fiyatlar. " +
        "İki mağaza arasındaki fiyat farklarını ve eksik ürünleri yakalar.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama: metin(
            "Uygulama adı, bundle id veya paket adı. İki mağazada da aranır.",
          ),
          ulke: metin(
            "Fiyatların karşılaştırılacağı ülke. App Store için 3 harfli " +
              "(TUR), Play için 2 harfli (TR) kod kullanılır; hangisini " +
              "verirsen ver, dönüştürülür. Varsayılan: Türkiye.",
          ),
        },
        required: ["uygulama"],
      },
      async calistir(girdi) {
        const ham = String(girdi.ulke || "TR").toUpperCase();
        // App Store 3 harfli ISO-3166-1 alpha-3, Play 2 harfli alpha-2 ister.
        const appleUlke = ham.length === 3 ? ham : ULKE_2_3[ham] || "TUR";
        const playUlke = ham.length === 2 ? ham : ULKE_3_2[ham] || "TR";

        const [appleTaraf, playTaraf] = await Promise.all([
          dene(async () => {
            const uygulama = await appleUygulamaBul(girdi.uygulama);
            if (!uygulama) return { bulunamadi: true };

            const gruplar: any = await appleCagir({
              yontem: "GET",
              yol: `/v1/apps/${uygulama.id}/subscriptionGroups`,
              sorgu: { limit: 20 },
            });

            const abonelikler: any[] = [];
            for (const grup of gruplar.data || []) {
              const liste: any = await appleCagir({
                yontem: "GET",
                yol: `/v1/subscriptionGroups/${grup.id}/subscriptions`,
                sorgu: { limit: 50 },
              });

              for (const a of liste.data || []) {
                const fiyatlar: any = await appleCagir({
                  yontem: "GET",
                  yol: `/v1/subscriptions/${a.id}/prices`,
                  sorgu: {
                    limit: 200,
                    include: "subscriptionPricePoint,territory",
                    "filter[territory]": appleUlke,
                  },
                });

                const nokta = (fiyatlar.included || []).find(
                  (d: any) => d.type === "subscriptionPricePoints",
                );

                abonelikler.push({
                  urun_id: a.attributes?.productId,
                  isim: a.attributes?.name,
                  sure: a.attributes?.subscriptionPeriod,
                  durum: a.attributes?.state,
                  fiyat: nokta?.attributes?.customerPrice,
                });
              }
            }

            return { uygulama: uygulama.attributes?.name, abonelikler };
          }),

          dene(async () => {
            const uygulama = await playUygulamaBul(girdi.uygulama);
            if (!uygulama) return { bulunamadi: true };

            const liste: any = await playCagir({
              yontem: "GET",
              yol: `/androidpublisher/v3/applications/${uygulama.packageName}/subscriptions`,
              sorgu: { pageSize: 50 },
            });

            const abonelikler = (liste.subscriptions || []).flatMap((a: any) =>
              (a.basePlans || []).map((p: any) => {
                const bolge = (p.regionalConfigs || []).find(
                  (b: any) => b.regionCode === playUlke,
                );
                return {
                  urun_id: a.productId,
                  plan_id: p.basePlanId,
                  isim: a.listings?.[0]?.title,
                  sure:
                    p.autoRenewingBasePlanType?.billingPeriodDuration ??
                    p.prepaidBasePlanType?.billingPeriodDuration,
                  durum: p.state,
                  fiyat: bolge?.price
                    ? `${(Number(bolge.price.units || 0) + Number(bolge.price.nanos || 0) / 1e9).toFixed(2)} ${bolge.price.currencyCode}`
                    : undefined,
                };
              }),
            );

            return { uygulama: uygulama.displayName, abonelikler };
          }),
        ]);

        return {
          ulke: { appstore: appleUlke, play: playUlke },
          appstore: appleTaraf,
          play: playTaraf,
          not:
            "Süre biçimleri iki mağazada farklıdır: Apple 'ONE_MONTH' der, " +
            "Play ISO-8601 ile 'P1M' der. Aynı şeyi anlatırlar.",
        };
      },
    },

    {
      ad: "magaza__iap_teshis",
      aciklama:
        "'Kullanıcı parayı ödedi ama premium göremiyor' tipi sorunları teşhis " +
        "eder. Uygulamanın iki mağazadaki satın alma kurulumunu tek tek " +
        "kontrol eder: ürünler yayında mı, istenen ülkede fiyatı var mı, " +
        "abonelik aktif mi. Play satın alma token'ı verirsen onu da doğrular.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama: metin("Uygulama adı, bundle id veya paket adı."),
          ulke: metin("Kontrol edilecek ülke (varsayılan Türkiye)."),
          play_token: metin(
            "İsteğe bağlı: şikâyet eden kullanıcının Play satın alma token'ı.",
          ),
        },
        required: ["uygulama"],
      },
      async calistir(girdi) {
        const ham = String(girdi.ulke || "TR").toUpperCase();
        const appleUlke = ham.length === 3 ? ham : ULKE_2_3[ham] || "TUR";
        const playUlke = ham.length === 2 ? ham : ULKE_3_2[ham] || "TR";

        const bulgular: string[] = [];

        /* --- App Store tarafı --- */
        const appstore = await dene(async () => {
          const uygulama = await appleUygulamaBul(girdi.uygulama);
          if (!uygulama) {
            bulgular.push("App Store'da bu isimde uygulama bulunamadı.");
            return { bulunamadi: true };
          }

          const gruplar: any = await appleCagir({
            yontem: "GET",
            yol: `/v1/apps/${uygulama.id}/subscriptionGroups`,
            sorgu: { limit: 20 },
          });

          const durumlar: any[] = [];
          for (const grup of gruplar.data || []) {
            const liste: any = await appleCagir({
              yontem: "GET",
              yol: `/v1/subscriptionGroups/${grup.id}/subscriptions`,
              sorgu: { limit: 50 },
            });

            for (const a of liste.data || []) {
              const durum = a.attributes?.state;
              const urunId = a.attributes?.productId;

              if (durum !== "APPROVED") {
                bulgular.push(
                  `App Store: '${urunId}' aboneliğinin durumu ${durum}. ` +
                    "Onaylanmamış ürünler canlıda satın alınamaz.",
                );
              }

              const fiyatlar: any = await appleCagir({
                yontem: "GET",
                yol: `/v1/subscriptions/${a.id}/prices`,
                sorgu: {
                  limit: 5,
                  include: "subscriptionPricePoint",
                  "filter[territory]": appleUlke,
                },
              });

              if (!(fiyatlar.data || []).length) {
                bulgular.push(
                  `App Store: '${urunId}' için ${appleUlke} ülkesinde fiyat tanımlı değil — ` +
                    "o ülkedeki kullanıcılar ürünü göremez.",
                );
              }

              durumlar.push({ urun_id: urunId, durum, ulkede_fiyat_var: !!(fiyatlar.data || []).length });
            }
          }

          return { uygulama: uygulama.attributes?.name, abonelikler: durumlar };
        });

        /* --- Play tarafı --- */
        const play = await dene(async () => {
          const uygulama = await playUygulamaBul(girdi.uygulama);
          if (!uygulama) {
            bulgular.push("Google Play'de bu isimde uygulama bulunamadı.");
            return { bulunamadi: true };
          }

          const liste: any = await playCagir({
            yontem: "GET",
            yol: `/androidpublisher/v3/applications/${uygulama.packageName}/subscriptions`,
            sorgu: { pageSize: 50 },
          });

          const durumlar: any[] = [];
          for (const a of liste.subscriptions || []) {
            for (const p of a.basePlans || []) {
              const aktif = p.state === "ACTIVE";
              const bolge = (p.regionalConfigs || []).find(
                (b: any) => b.regionCode === playUlke,
              );

              if (!aktif) {
                bulgular.push(
                  `Play: '${a.productId}/${p.basePlanId}' planı ${p.state} durumunda. ` +
                    "Etkin olmayan planlar satın alınamaz.",
                );
              }
              if (!bolge) {
                bulgular.push(
                  `Play: '${a.productId}/${p.basePlanId}' için ${playUlke} bölgesinde ` +
                    "fiyat tanımlı değil — o ülkedeki kullanıcılar ürünü göremez.",
                );
              } else if (bolge.newSubscriberAvailability === false) {
                bulgular.push(
                  `Play: '${a.productId}/${p.basePlanId}' ${playUlke} bölgesinde ` +
                    "yeni abonelere kapalı. Mevcut aboneler devam eder, yeniler satın alamaz.",
                );
              }

              durumlar.push({
                urun_id: a.productId,
                plan_id: p.basePlanId,
                durum: p.state,
                bolgede_fiyat_var: !!bolge,
              });
            }
          }

          let tokenSonucu;
          if (girdi.play_token) {
            tokenSonucu = await dene(async () => {
              const s: any = await playCagir({
                yontem: "GET",
                yol: `/androidpublisher/v3/applications/${uygulama.packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(girdi.play_token)}`,
              });

              if (s.subscriptionState !== "SUBSCRIPTION_STATE_ACTIVE") {
                bulgular.push(
                  `Play token: abonelik durumu ${s.subscriptionState}. ` +
                    "Aktif değilse uygulamanın premium vermemesi doğru davranıştır.",
                );
              }
              if (s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
                bulgular.push(
                  "Play token: satın alma onaylanmamış (acknowledge edilmemiş). " +
                    "Google 3 gün içinde onaylanmayan satın almaları otomatik iade eder — " +
                    "bu, 'ödedim ama premium yok' şikâyetlerinin en sık sebebidir.",
                );
              }

              return {
                durum: s.subscriptionState,
                onay_durumu: s.acknowledgementState,
                bitis: s.lineItems?.[0]?.expiryTime,
                urun_id: s.lineItems?.[0]?.productId,
                test_satin_alma: s.testPurchase !== undefined,
              };
            });
          }

          return {
            uygulama: uygulama.displayName,
            planlar: durumlar,
            token_kontrolu: tokenSonucu,
          };
        });

        return {
          ulke: { appstore: appleUlke, play: playUlke },
          bulgular: bulgular.length
            ? bulgular
            : ["Kurulumda gözle görülür bir sorun bulunamadı."],
          appstore,
          play,
        };
      },
    },
  ];
}

/* Sık kullanılan ülkelerin iki ve üç harfli kodları. Listede olmayan bir kod
   verilirse araç varsayılana döner ve bunu çıktıda belirtir. */
const ULKE_2_3: Record<string, string> = {
  TR: "TUR", US: "USA", GB: "GBR", DE: "DEU", FR: "FRA", IT: "ITA",
  ES: "ESP", NL: "NLD", RU: "RUS", IN: "IND", BR: "BRA", JP: "JPN",
  KR: "KOR", CN: "CHN", CA: "CAN", AU: "AUS", MX: "MEX", SA: "SAU",
  AE: "ARE", EG: "EGY", ID: "IDN", PL: "POL", SE: "SWE", NO: "NOR",
  DK: "DNK", FI: "FIN", CH: "CHE", AT: "AUT", BE: "BEL", PT: "PRT",
  GR: "GRC", CZ: "CZE", RO: "ROU", UA: "UKR", AZ: "AZE", KZ: "KAZ",
};

const ULKE_3_2: Record<string, string> = Object.fromEntries(
  Object.entries(ULKE_2_3).map(([iki, uc]) => [uc, iki]),
);
