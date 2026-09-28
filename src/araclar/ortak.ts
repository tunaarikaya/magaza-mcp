/**
 * Çapraz mağaza araçları.
 *
 * Projenin var oluş sebebi burası: bu araçlar iki mağazayı aynı anda
 * sorgular ve sonucu yan yana koyar. Tek mağazalı bir sunucuda bunları
 * yapmak mümkün değil.
 */
import { cagir as appleCagir } from "../istemci/apple.js";
import { cagir as playCagir } from "../istemci/play.js";
import { yolParcasi } from "./play.js";
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

  const tam =
    hepsi.find((u: any) => u.attributes?.bundleId?.toLowerCase() === kucuk) ||
    hepsi.find((u: any) => u.attributes?.name?.toLowerCase() === kucuk);
  if (tam) return tam;

  // Gevşek eşleşme: "defter" yazınca "Nota Defteri" ve "Nota Defteri Pro"nun
  // ikisi de uyuyorsa birini seçip diğerini yutmak, kullanıcıya YANLIŞ
  // uygulamanın verisini doğruymuş gibi göstermek demek. Belirsizlikte
  // durup adayları söylüyoruz.
  const gevsek = hepsi.filter((u: any) =>
    u.attributes?.name?.toLowerCase().includes(kucuk),
  );
  if (gevsek.length > 1) {
    throw new Error(
      `App Store'da '${aranan}' birden fazla uygulamayla eşleşiyor: ` +
        gevsek.map((u: any) => `${u.attributes?.name} (${u.attributes?.bundleId})`).join(", ") +
        ". Tam adı veya bundle id'yi ver.",
    );
  }
  return gevsek[0] || null;
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

  const tam =
    hepsi.find((u: any) => u.packageName?.toLowerCase() === kucuk) ||
    hepsi.find((u: any) => u.displayName?.toLowerCase() === kucuk);
  if (tam) return tam;

  // Bkz. appleUygulamaBul: gevşek eşleşme tekse kabul, çoksa hata.
  const gevsek = hepsi.filter((u: any) =>
    u.displayName?.toLowerCase().includes(kucuk),
  );
  if (gevsek.length > 1) {
    throw new Error(
      `Google Play'de '${aranan}' birden fazla uygulamayla eşleşiyor: ` +
        gevsek.map((u: any) => `${u.displayName} (${u.packageName})`).join(", ") +
        ". Tam adı veya paket adını ver.",
    );
  }
  return gevsek[0] || null;
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

        // Aynı ürünü iki mağazada eşleştir: önce bundle/paket adı, sonra
        // görünen ad. Eşleşen Play uygulaması havuzdan DÜŞÜRÜLÜR — yoksa aynı
        // Play uygulaması birden çok Apple uygulamasına eşleşip listede iki
        // kez görünür ve "iki mağazada da var" yanlış çıkar.
        const eslesenler: any[] = [];
        const kalanPlay = new Map(playListe.map((p: any) => [p.paket_adi, p]));
        // Apple tarafını bundle_id yerine id ile takip ediyoruz: bundle_id
        // tanımsız gelen bir uygulama varsa, bundle_id'li bir küme
        // tanımsızları toptan "eşleşmiş" sayıp sadece_ios'tan düşürürdü.
        const eslesenIos = new Set<string>();

        const bul = (a: any, olcut: (p: any) => boolean) => {
          for (const p of kalanPlay.values()) if (olcut(p)) return p;
          return undefined;
        };

        // İki tur: önce kesin olan paket adı eşleşmeleri, sonra isim
        // benzerliği. Tek turda yapılırsa zayıf bir isim eşleşmesi, başka bir
        // uygulamanın kesin paket eşleşmesini çalabilir.
        for (const tur of ["paket", "isim"] as const) {
          for (const a of appleListe) {
            if (eslesenIos.has(a.id)) continue;

            const es =
              tur === "paket"
                ? bul(a, (p) =>
                    Boolean(
                      a.bundle_id &&
                        p.paket_adi?.toLowerCase() === a.bundle_id.toLowerCase(),
                    ),
                  )
                : bul(a, (p) =>
                    Boolean(
                      p.isim && a.isim && p.isim.toLowerCase() === a.isim.toLowerCase(),
                    ),
                  );

            if (!es) continue;

            eslesenler.push({
              isim: a.isim || es.isim,
              ios: { id: a.id, bundle_id: a.bundle_id },
              android: { paket_adi: es.paket_adi },
              eslesme: tur === "paket" ? "paket adı" : "uygulama adı",
            });
            eslesenIos.add(a.id);
            kalanPlay.delete(es.paket_adi);
          }
        }

        return {
          iki_magazada_da: eslesenler,
          sadece_ios: appleListe.filter((a: any) => !eslesenIos.has(a.id)),
          sadece_android: [...kalanPlay.values()],
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
        // App Store 3 harfli ISO-3166-1 alpha-3, Play 2 harfli alpha-2 ister.
        // Tanınmayan kodda hata verir; sessizce Türkiye'ye düşmez.
        const { appstore: appleUlke, play: playUlke } = ulkeCozumle(girdi.ulke);

        const [appleTaraf, playTaraf] = await Promise.all([
          dene(async () => {
            const uygulama = await appleUygulamaBul(girdi.uygulama);
            if (!uygulama) return { bulunamadi: true };

            const gruplar: any = await appleCagir({
              yontem: "GET",
              yol: `/v1/apps/${yolParcasi(uygulama.id, "app id")}/subscriptionGroups`,
              sorgu: { limit: 20 },
            });

            const abonelikler: any[] = [];
            for (const grup of gruplar.data || []) {
              const liste: any = await appleCagir({
                yontem: "GET",
                yol: `/v1/subscriptionGroups/${yolParcasi(grup.id, "grup id")}/subscriptions`,
                sorgu: { limit: 50 },
              });

              for (const a of liste.data || []) {
                const fiyatlar: any = await appleCagir({
                  yontem: "GET",
                  yol: `/v1/subscriptions/${yolParcasi(a.id, "abonelik id")}/prices`,
                  sorgu: {
                    limit: 200,
                    include: "subscriptionPricePoint,territory",
                    "filter[territory]": appleUlke,
                  },
                });

                /*
                 * `included`ın ilk fiyat noktasını almak yanlış: uç nokta
                 * o ülkenin GEÇMİŞ ve PLANLANMIŞ bütün fiyat kayıtlarını
                 * döndürür, sıra da garanti değil. Fiyatı değişmiş bir
                 * abonelikte bu, sessizce eski fiyatı gösterir.
                 * Doğrusu: her kaydı kendi fiyat noktasıyla eşleştir,
                 * sonra bugün yürürlükte olanı seç.
                 */
                const dahililer = new Map<string, any>();
                for (const d of fiyatlar.included || []) {
                  dahililer.set(`${d?.type}:${d?.id}`, d);
                }

                const bugun = new Date().toISOString().slice(0, 10);
                // startDate boş olan kayıt "hep geçerli" taban fiyattır;
                // ileri tarihli kayıtlar henüz yürürlükte değil.
                const yururlukte = (fiyatlar.data || [])
                  .filter((f: any) => (f.attributes?.startDate ?? "") <= bugun)
                  .sort((x: any, y: any) =>
                    String(x.attributes?.startDate ?? "").localeCompare(
                      String(y.attributes?.startDate ?? ""),
                    ),
                  )
                  .pop();

                const noktaId =
                  yururlukte?.relationships?.subscriptionPricePoint?.data?.id;
                const nokta = dahililer.get(`subscriptionPricePoints:${noktaId}`);

                abonelikler.push({
                  urun_id: a.attributes?.productId,
                  isim: a.attributes?.name,
                  sure: a.attributes?.subscriptionPeriod,
                  durum: a.attributes?.state,
                  fiyat: nokta?.attributes?.customerPrice,
                  fiyat_baslangici: yururlukte?.attributes?.startDate,
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
              yol:
                `/androidpublisher/v3/applications/${yolParcasi(uygulama.packageName, "paket_adi")}` +
                "/subscriptions",
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
        const { appstore: appleUlke, play: playUlke } = ulkeCozumle(girdi.ulke);

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
            yol: `/v1/apps/${yolParcasi(uygulama.id, "app id")}/subscriptionGroups`,
            sorgu: { limit: 20 },
          });

          const durumlar: any[] = [];
          for (const grup of gruplar.data || []) {
            const liste: any = await appleCagir({
              yontem: "GET",
              yol: `/v1/subscriptionGroups/${yolParcasi(grup.id, "grup id")}/subscriptions`,
              sorgu: { limit: 50 },
            });

            for (const a of liste.data || []) {
              const durum = a.attributes?.state;
              const urunId = a.attributes?.productId;

              // Spec'teki enum: MISSING_METADATA, READY_TO_SUBMIT,
              // WAITING_FOR_REVIEW, IN_REVIEW, DEVELOPER_ACTION_NEEDED,
              // PENDING_BINARY_APPROVAL, APPROVED,
              // DEVELOPER_REMOVED_FROM_SALE, REMOVED_FROM_SALE, REJECTED.
              // Satın alınabilir tek durum APPROVED, ama sebep her zaman
              // "onaylanmadı" değil — satıştan kaldırılmış da olabilir.
              if (durum !== "APPROVED") {
                const kaldirilmis =
                  durum === "DEVELOPER_REMOVED_FROM_SALE" ||
                  durum === "REMOVED_FROM_SALE";
                bulgular.push(
                  `App Store: '${urunId}' aboneliğinin durumu ${durum}. ` +
                    (kaldirilmis
                      ? "Ürün satıştan kaldırılmış; mevcut aboneler devam eder, yenileri satın alamaz."
                      : "Yalnızca APPROVED durumundaki ürünler canlıda satın alınabilir."),
                );
              }

              const fiyatlar: any = await appleCagir({
                yontem: "GET",
                yol: `/v1/subscriptions/${yolParcasi(a.id, "abonelik id")}/prices`,
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
            yol:
                `/androidpublisher/v3/applications/${yolParcasi(uygulama.packageName, "paket_adi")}` +
                "/subscriptions",
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
              // Ülke regionalConfigs'te yoksa fiyat YOK demek değil:
              // otherRegionsConfig tanımlıysa listelenmemiş bütün ülkeler
              // USD/EUR fiyatıyla satılmaya devam eder. Bunu atlayan eski
              // sürüm, çalışan kurulumları "fiyat yok" diye suçluyordu.
              const yedek = p.otherRegionsConfig;
              if (!bolge && !yedek) {
                bulgular.push(
                  `Play: '${a.productId}/${p.basePlanId}' için ${playUlke} bölgesinde ` +
                    "fiyat tanımlı değil — o ülkedeki kullanıcılar ürünü göremez.",
                );
              } else if (!bolge && yedek?.newSubscriberAvailability === false) {
                bulgular.push(
                  `Play: '${a.productId}/${p.basePlanId}' ${playUlke} bölgesinde ` +
                    "ülkeye özel fiyat yok ve 'diğer bölgeler' yedeği yeni " +
                    "abonelere kapalı — yeni kullanıcılar satın alamaz.",
                );
              } else if (bolge?.newSubscriberAvailability === false) {
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
                diger_bolgeler_yedegi_var: !!yedek,
              });
            }
          }

          let tokenSonucu;
          if (girdi.play_token) {
            tokenSonucu = await dene(async () => {
              const s: any = await playCagir({
                yontem: "GET",
                yol:
                  `/androidpublisher/v3/applications/${yolParcasi(uygulama.packageName, "paket_adi")}` +
                  `/purchases/subscriptionsv2/tokens/${yolParcasi(girdi.play_token, "play_token")}`,
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

/* ------------------------------------------------------------------ *
 * Ülke kodları
 *
 * App Store Connect üç harfli (alpha-3), Google Play iki harfli (alpha-2)
 * ISO 3166-1 kodu ister. Eskiden burada 36 ülkelik kısa bir tablo vardı ve
 * listede olmayan bir kod SESSİZCE Türkiye'ye düşüyordu: kullanıcı "DK
 * fiyatları" isteyip Türkiye fiyatlarını alıyor, farkı anlamıyordu. Daha
 * kötüsü, iki tarafın varsayılanları birbirinden bağımsızdı; bir mağaza
 * istenen ülkeyi, diğeri Türkiye'yi gösterebiliyordu.
 *
 * Tablo artık App Store Connect'in TerritoryCode enum'undaki 233 bölgenin
 * tamamını kapsıyor (spec/appstore-openapi.json ile karşılaştırılarak
 * üretildi) ve bilinmeyen kodda sessizce varsayılana düşmek yerine hata
 * veriyor.
 * ------------------------------------------------------------------ */
const ULKE_2_3: Record<string, string> = {
  AD: "AND", AE: "ARE", AF: "AFG", AG: "ATG", AI: "AIA", AL: "ALB",
  AM: "ARM", AN: "ANT", AO: "AGO", AR: "ARG", AS: "ASM", AT: "AUT",
  AU: "AUS", AW: "ABW", AZ: "AZE", BA: "BIH", BB: "BRB", BD: "BGD",
  BE: "BEL", BF: "BFA", BG: "BGR", BH: "BHR", BI: "BDI", BJ: "BEN",
  BM: "BMU", BN: "BRN", BO: "BOL", BQ: "BES", BR: "BRA", BS: "BHS",
  BT: "BTN", BW: "BWA", BY: "BLR", BZ: "BLZ", CA: "CAN", CD: "COD",
  CF: "CAF", CG: "COG", CH: "CHE", CI: "CIV", CK: "COK", CL: "CHL",
  CM: "CMR", CN: "CHN", CO: "COL", CR: "CRI", CU: "CUB", CV: "CPV",
  CW: "CUW", CX: "CXR", CY: "CYP", CZ: "CZE", DE: "DEU", DJ: "DJI",
  DK: "DNK", DM: "DMA", DO: "DOM", DZ: "DZA", EC: "ECU", EE: "EST",
  EG: "EGY", ER: "ERI", ES: "ESP", ET: "ETH", FI: "FIN", FJ: "FJI",
  FK: "FLK", FM: "FSM", FO: "FRO", FR: "FRA", GA: "GAB", GB: "GBR",
  GD: "GRD", GE: "GEO", GF: "GUF", GG: "GGY", GH: "GHA", GI: "GIB",
  GL: "GRL", GM: "GMB", GN: "GIN", GP: "GLP", GQ: "GNQ", GR: "GRC",
  GT: "GTM", GU: "GUM", GW: "GNB", GY: "GUY", HK: "HKG", HN: "HND",
  HR: "HRV", HT: "HTI", HU: "HUN", ID: "IDN", IE: "IRL", IL: "ISR",
  IM: "IMN", IN: "IND", IQ: "IRQ", IS: "ISL", IT: "ITA", JE: "JEY",
  JM: "JAM", JO: "JOR", JP: "JPN", KE: "KEN", KG: "KGZ", KH: "KHM",
  KI: "KIR", KM: "COM", KN: "KNA", KR: "KOR", KW: "KWT", KY: "CYM",
  KZ: "KAZ", LA: "LAO", LB: "LBN", LC: "LCA", LI: "LIE", LK: "LKA",
  LR: "LBR", LS: "LSO", LT: "LTU", LU: "LUX", LV: "LVA", LY: "LBY",
  MA: "MAR", MC: "MCO", MD: "MDA", ME: "MNE", MG: "MDG", MH: "MHL",
  MK: "MKD", ML: "MLI", MM: "MMR", MN: "MNG", MO: "MAC", MP: "MNP",
  MQ: "MTQ", MR: "MRT", MS: "MSR", MT: "MLT", MU: "MUS", MV: "MDV",
  MW: "MWI", MX: "MEX", MY: "MYS", MZ: "MOZ", NA: "NAM", NC: "NCL",
  NE: "NER", NF: "NFK", NG: "NGA", NI: "NIC", NL: "NLD", NO: "NOR",
  NP: "NPL", NR: "NRU", NU: "NIU", NZ: "NZL", OM: "OMN", PA: "PAN",
  PE: "PER", PF: "PYF", PG: "PNG", PH: "PHL", PK: "PAK", PL: "POL",
  PM: "SPM", PR: "PRI", PS: "PSE", PT: "PRT", PW: "PLW", PY: "PRY",
  QA: "QAT", RE: "REU", RO: "ROU", RS: "SRB", RU: "RUS", RW: "RWA",
  SA: "SAU", SB: "SLB", SC: "SYC", SE: "SWE", SG: "SGP", SH: "SHN",
  SI: "SVN", SK: "SVK", SL: "SLE", SM: "SMR", SN: "SEN", SO: "SOM",
  SR: "SUR", SS: "SSD", ST: "STP", SV: "SLV", SX: "SXM", SZ: "SWZ",
  TC: "TCA", TD: "TCD", TG: "TGO", TH: "THA", TJ: "TJK", TL: "TLS",
  TM: "TKM", TN: "TUN", TO: "TON", TR: "TUR", TT: "TTO", TV: "TUV",
  TW: "TWN", TZ: "TZA", UA: "UKR", UG: "UGA", UM: "UMI", US: "USA",
  UY: "URY", UZ: "UZB", VA: "VAT", VC: "VCT", VE: "VEN", VG: "VGB",
  VI: "VIR", VN: "VNM", VU: "VUT", WF: "WLF", WS: "WSM", XK: "XKS",
  YE: "YEM", YT: "MYT", ZA: "ZAF", ZM: "ZMB", ZW: "ZWE",
};

const ULKE_3_2: Record<string, string> = Object.fromEntries(
  Object.entries(ULKE_2_3).map(([iki, uc]) => [uc, iki]),
);

export type UlkeCifti = { appstore: string; play: string };

/**
 * Kullanıcının verdiği ülke kodunu iki mağazanın da anladığı biçime çevirir.
 * Tanımadığı kodda hata verir — yanlış ülkenin verisini doğruymuş gibi
 * döndürmektense duralım.
 */
function ulkeCozumle(ham: unknown): UlkeCifti {
  const kod = String(ham ?? "TR").trim().toUpperCase();

  if (kod.length === 2) {
    const uc = ULKE_2_3[kod];
    if (!uc) {
      throw new Error(
        `'${kod}' tanınmayan bir ülke kodu. İki harfli ISO 3166-1 alpha-2 ` +
          "(TR, US, DE) veya üç harfli alpha-3 (TUR, USA, DEU) bekleniyor. " +
          "Kod doğruysa o bölge App Store Connect'in desteklediği " +
          "bölgeler arasında değil demektir.",
      );
    }
    return { appstore: uc, play: kod };
  }

  if (kod.length === 3) {
    const iki = ULKE_3_2[kod];
    if (!iki) {
      throw new Error(
        `'${kod}' tanınmayan bir ülke kodu. Üç harfli ISO 3166-1 alpha-3 ` +
          "(TUR, USA, DEU) veya iki harfli alpha-2 (TR, US, DE) bekleniyor.",
      );
    }
    return { appstore: kod, play: iki };
  }

  throw new Error(
    `'${kod}' ülke kodu değil. İki harfli (TR) veya üç harfli (TUR) ` +
      "ISO 3166-1 kodu ver.",
  );
}
