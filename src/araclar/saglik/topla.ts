import { cagir, raporIndir, tumunuGetir } from "../../istemci/apple.js";
import { parca } from "../appstore.js";
import { KILITLI_DURUMLAR } from "../appstore-yazma.js";
import type { AppInfo, Bolum, Surum, Urun, Uygulama, Veri, Yorum } from "./tip.js";

export type ToplaSecenek = {
  /** Apple id, bundle id ya da ad. */
  uygulama?: string;
  /** hesap_duzelt'in kullandığı kesin id listesi. */
  uygulamaIdleri?: string[];
  bolumler: Bolum[];
  derin?: boolean;
  /** Satış raporu için vendor number; yoksa satis/yillikIndirme toplanmaz. */
  saticiNo?: string;
};

/** Metadata'sı düzenlenebilen sürüm durumları (appVersionState). */
const DUZENLENEBILIR_SURUM = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

/** Güncelleme satırları indirme sayılmaz. */
const GUNCELLEME_TURLERI = new Set(["7", "7F", "7T", "F7"]);

type Hatalar = Record<string, string>;

/** Bir parçayı çalıştırır; patlarsa hatayı kaydedip varsayılanı döndürür. */
async function guvenli<T>(hatalar: Hatalar, anahtar: string, varsayilan: T, is: () => Promise<T>): Promise<T> {
  try {
    return await is();
  } catch (h) {
    hatalar[anahtar] = h instanceof Error ? h.message : String(h);
    return varsayilan;
  }
}

/**
 * Satış özeti TSV'sini uygulama bazında toplar.
 * Negatif Units = iade. IAP satırları Parent Identifier (uygulama SKU'su) üzerinden uygulamaya sayılır.
 * `indirme`: uygulama satırlarının pozitif birimleri, güncellemeler hariç.
 */
export function satisAyristir(
  tsv: string,
  skuHaritasi: Record<string, string>,
): Record<string, { birim: number; iade: number; indirme: number }> {
  const satirlar = tsv.replace(/\r\n/g, "\n").trim().split("\n");
  const baslik = (satirlar[0] ?? "").split("\t");
  const sutun = (ad: string) => baslik.indexOf(ad);
  const [iId, iBirim, iUst, iTur] = [sutun("Apple Identifier"), sutun("Units"), sutun("Parent Identifier"), sutun("Product Type Identifier")];
  const sonuc: Record<string, { birim: number; iade: number; indirme: number }> = {};
  if (iId < 0 || iBirim < 0) return sonuc;

  for (const satir of satirlar.slice(1)) {
    const h = satir.split("\t");
    const birim = Number(h[iBirim]);
    if (!Number.isFinite(birim)) continue;
    const ust = iUst >= 0 ? h[iUst]?.trim() : "";
    const id = ust ? skuHaritasi[ust] : h[iId]?.trim();
    if (!id) continue;

    const t = (sonuc[id] ??= { birim: 0, iade: 0, indirme: 0 });
    if (birim < 0) {
      t.iade += -birim;
      continue;
    }
    t.birim += birim;
    if (!ust && !GUNCELLEME_TURLERI.has(h[iTur]?.trim() ?? "")) t.indirme += birim;
  }
  return sonuc;
}

function uygulamaSec(hepsi: any[], s: ToplaSecenek): any[] {
  if (s.uygulamaIdleri?.length) {
    const istenen = new Set(s.uygulamaIdleri);
    const bulunan = hepsi.filter((u) => istenen.has(u.id));
    const eksik = s.uygulamaIdleri.filter((id) => !bulunan.some((u) => u.id === id));
    if (eksik.length) throw new Error(`Bu hesapta bulunamayan uygulama id'leri: ${eksik.join(", ")}.`);
    return bulunan;
  }
  if (!s.uygulama) return hepsi;

  const aranan = s.uygulama.trim().toLowerCase();
  const tam =
    hepsi.find((u) => u.id === s.uygulama!.trim()) ||
    hepsi.find((u) => u.attributes?.bundleId?.toLowerCase() === aranan) ||
    hepsi.find((u) => u.attributes?.name?.toLowerCase() === aranan);
  if (tam) return [tam];

  const gevsek = hepsi.filter((u) => u.attributes?.name?.toLowerCase().includes(aranan));
  if (gevsek.length > 1) {
    throw new Error(
      `'${s.uygulama}' birden fazla uygulamayla eşleşiyor: ` +
        gevsek.map((u) => `${u.attributes?.name} (${u.attributes?.bundleId})`).join(", ") +
        ". Tam adı, bundle id'yi ya da Apple id'yi ver.",
    );
  }
  if (!gevsek.length) throw new Error(`App Store hesabında '${s.uygulama}' adlı ya da id'li bir uygulama bulunamadı.`);
  return gevsek;
}

async function bilgileriGetir(appId: string) {
  const { data, included } = await tumunuGetir(
    `/v1/apps/${parca(appId, "uygulama_id")}/appInfos`,
    {
      include: "appInfoLocalizations,primaryCategory,ageRatingDeclaration",
      "fields[appInfoLocalizations]": "locale,name,subtitle,privacyPolicyUrl",
      "limit[appInfoLocalizations]": 50,
    },
    50,
  );
  const ek = new Map(included.map((i: any) => [`${i.type}:${i.id}`, i]));

  const bilgiler: AppInfo[] = data.map((i: any) => ({
    id: i.id,
    durum: i.attributes?.state ?? i.attributes?.appStoreState,
    duzenlenebilir: !KILITLI_DURUMLAR.has(i.attributes?.state),
    kategori: i.relationships?.primaryCategory?.data?.id,
    yerel: (i.relationships?.appInfoLocalizations?.data ?? [])
      .map((r: any) => ek.get(`appInfoLocalizations:${r.id}`))
      .filter(Boolean)
      .map((l: any) => ({
        id: l.id,
        dil: l.attributes?.locale,
        ad: l.attributes?.name ?? "",
        altBaslik: l.attributes?.subtitle ?? undefined,
        gizlilikUrl: l.attributes?.privacyPolicyUrl ?? undefined,
      })),
  }));

  const beyanSahibi = data.find((i: any) => !KILITLI_DURUMLAR.has(i.attributes?.state)) ?? data[0];
  const beyanId = beyanSahibi?.relationships?.ageRatingDeclaration?.data?.id;
  const beyan: any = beyanId ? ek.get(`ageRatingDeclarations:${beyanId}`) : undefined;
  const yasBeyani = beyan ? { id: beyan.id as string, ozellikler: beyan.attributes ?? {} } : null;

  return { bilgiler, yasBeyani };
}

async function surumleriGetir(appId: string): Promise<Surum[]> {
  const { data } = await tumunuGetir(
    `/v1/apps/${parca(appId, "uygulama_id")}/appStoreVersions`,
    { "fields[appStoreVersions]": "platform,versionString,appStoreState,appVersionState,copyright,createdDate" },
    200,
  );
  return data
    .map((v: any) => ({
      id: v.id,
      surum: v.attributes?.versionString ?? "",
      durum: v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? "",
      magazaDurumu: v.attributes?.appStoreState ?? undefined,
      olusturma: v.attributes?.createdDate ?? "",
      copyright: v.attributes?.copyright ?? undefined,
      platform: v.attributes?.platform ?? undefined,
    }))
    .sort(
      (a: Surum, b: Surum) =>
        Number(a.platform !== "IOS") - Number(b.platform !== "IOS") || b.olusturma.localeCompare(a.olusturma),
    )
    .slice(0, 20);
}

function hedefSec(surumler: Surum[]): { surum?: Surum; duzenlenebilir: boolean } {
  const duz = surumler.find((v) => DUZENLENEBILIR_SURUM.has(v.durum));
  if (duz) return { surum: duz, duzenlenebilir: true };
  const yayinda = surumler.find((v) => v.durum === "READY_FOR_DISTRIBUTION" || v.magazaDurumu === "READY_FOR_SALE");
  return { surum: yayinda ?? surumler[0], duzenlenebilir: false };
}

async function surumYerelGetir(surumId: string) {
  const { data } = await tumunuGetir(
    `/v1/appStoreVersions/${parca(surumId, "surum_id")}/appStoreVersionLocalizations`,
    { "fields[appStoreVersionLocalizations]": "locale,description,keywords,promotionalText,whatsNew,supportUrl,marketingUrl" },
    200,
  );
  return data.map((l: any) => ({
    id: l.id,
    dil: l.attributes?.locale,
    aciklama: l.attributes?.description ?? undefined,
    anahtarKelimeler: l.attributes?.keywords ?? undefined,
    tanitimMetni: l.attributes?.promotionalText ?? undefined,
    yenilikler: l.attributes?.whatsNew ?? undefined,
    destekUrl: l.attributes?.supportUrl ?? undefined,
    pazarlamaUrl: l.attributes?.marketingUrl ?? undefined,
  }));
}

async function ekranGoruntuleri(yerelId: string, dil: string) {
  const { data, included } = await tumunuGetir(
    `/v1/appStoreVersionLocalizations/${parca(yerelId, "yerellestirme_id")}/appScreenshotSets`,
    {
      include: "appScreenshots",
      "fields[appScreenshotSets]": "screenshotDisplayType,appScreenshots",
      "fields[appScreenshots]": "sourceFileChecksum",
      "limit[appScreenshots]": 50,
    },
    200,
  );
  const checksum = new Map(
    included.filter((i: any) => i.type === "appScreenshots").map((i: any) => [i.id, i.attributes?.sourceFileChecksum]),
  );
  return data.flatMap((set: any) =>
    (set.relationships?.appScreenshots?.data ?? [])
      .map((r: any) => checksum.get(r.id))
      .filter(Boolean)
      .map((cs: any) => ({ dil, checksum: String(cs), tur: set.attributes?.screenshotDisplayType ?? "" })),
  );
}

async function yorumlariGetir(appId: string, adet: number): Promise<Yorum[]> {
  const { data, included } = await tumunuGetir(
    `/v1/apps/${parca(appId, "uygulama_id")}/customerReviews`,
    { sort: "-createdDate", include: "response" },
    adet,
  );
  const yanit = new Map(
    included.filter((i: any) => i.type === "customerReviewResponses").map((i: any) => [i.id, i.attributes?.responseBody]),
  );
  return data.map((r: any) => ({
    id: r.id,
    puan: Number(r.attributes?.rating ?? 0),
    baslik: r.attributes?.title ?? undefined,
    metin: r.attributes?.body ?? undefined,
    takmaAd: r.attributes?.reviewerNickname ?? undefined,
    tarih: r.attributes?.createdDate ?? "",
    ulke: r.attributes?.territory ?? undefined,
    yanit: yanit.get(r.relationships?.response?.data?.id) ?? undefined,
  }));
}

/** Aboneliğin bugün geçerli ABD fiyatı (standart plan). */
async function abdFiyati(abonelikId: string, bugun: string): Promise<number | undefined> {
  const yanit: any = await cagir({
    yontem: "GET",
    yol: `/v1/subscriptions/${parca(abonelikId, "abonelik_id")}/prices`,
    sorgu: {
      "filter[territory]": "USA",
      include: "subscriptionPricePoint",
      "fields[subscriptionPricePoints]": "customerPrice",
      limit: 50,
    },
  });
  const noktalar = new Map(
    (yanit?.included ?? []).map((i: any) => [i.id, Number(i.attributes?.customerPrice)]),
  );
  const gecerli = (yanit?.data ?? [])
    .filter((p: any) => !p.attributes?.planType || p.attributes.planType === "UPFRONT")
    .filter((p: any) => !p.attributes?.startDate || p.attributes.startDate <= bugun)
    .sort((a: any, b: any) => String(b.attributes?.startDate ?? "").localeCompare(String(a.attributes?.startDate ?? "")));
  const fiyat = noktalar.get(gecerli[0]?.relationships?.subscriptionPricePoint?.data?.id);
  return Number.isFinite(fiyat) ? (fiyat as number) : undefined;
}

async function urunleriGetir(appId: string, hatalar: Hatalar, bugun: string): Promise<Urun[]> {
  const [iaplar, gruplar] = await Promise.all([
    guvenli(hatalar, `${appId}:iap`, [] as Urun[], async () => {
      const { data } = await tumunuGetir(
        `/v1/apps/${parca(appId, "uygulama_id")}/inAppPurchasesV2`,
        { "fields[inAppPurchases]": "name,productId,inAppPurchaseType,state" },
        500,
      );
      return data.map((i: any) => ({ id: i.id, ad: i.attributes?.name ?? i.attributes?.productId ?? "", tur: "iap" as const, durum: i.attributes?.state ?? "" }));
    }),
    guvenli(hatalar, `${appId}:abonelik`, [] as Urun[], async () => {
      const { included } = await tumunuGetir(
        `/v1/apps/${parca(appId, "uygulama_id")}/subscriptionGroups`,
        {
          include: "subscriptions",
          "fields[subscriptions]": "name,productId,state,subscriptionPeriod",
          "limit[subscriptions]": 50,
        },
        200,
      );
      return included
        .filter((i: any) => i.type === "subscriptions")
        .map((i: any) => ({
          id: i.id,
          ad: i.attributes?.name ?? i.attributes?.productId ?? "",
          tur: "abonelik" as const,
          durum: i.attributes?.state ?? "",
          periyot: i.attributes?.subscriptionPeriod ?? undefined,
        }));
    }),
  ]);

  await Promise.all(
    gruplar.map(async (u) => {
      u.abdFiyat = await guvenli(hatalar, `${appId}:fiyat:${u.id}`, undefined, () => abdFiyati(u.id, bugun));
    }),
  );
  return [...iaplar, ...gruplar];
}

async function bolgeDurumlari(appId: string): Promise<Record<string, string[]>> {
  const musaitlik: any = await cagir({
    yontem: "GET",
    yol: `/v1/apps/${parca(appId, "uygulama_id")}/appAvailabilityV2`,
    sorgu: { "fields[appAvailabilities]": "availableInNewTerritories" },
  });
  const id = musaitlik?.data?.id;
  if (!id) return {};
  let data: any[];
  try {
    ({ data } = await tumunuGetir(
      `/v2/appAvailabilities/${parca(id, "musaitlik_id")}/territoryAvailabilities`,
      { "fields[territoryAvailabilities]": "contentStatuses,territory", include: "territory", "fields[territories]": "currency" },
      500,
    ));
  } catch (h) {
    // Satış ülkeleri hiç ayarlanmamış uygulamada Apple 404 döner — engel değil, veri yok.
    if (String((h as Error).message).includes("HTTP 404")) return {};
    throw h;
  }
  const sonuc: Record<string, string[]> = {};
  for (const t of data) {
    const ulke = t.relationships?.territory?.data?.id ?? t.id;
    for (const d of t.attributes?.contentStatuses ?? []) (sonuc[d] ??= []).push(ulke);
  }
  return sonuc;
}

async function incelemeDetayi(surumId: string) {
  try {
    const yanit: any = await cagir({ yontem: "GET", yol: `/v1/appStoreVersions/${parca(surumId, "surum_id")}/appStoreReviewDetail` });
    const d = yanit?.data;
    if (!d) return null;
    return {
      id: d.id as string,
      notlar: d.attributes?.notes ?? undefined,
      demoGerekli: d.attributes?.demoAccountRequired ?? undefined,
      demoAd: d.attributes?.demoAccountName ?? undefined,
      demoSifre: d.attributes?.demoAccountPassword ?? undefined,
      eposta: d.attributes?.contactEmail ?? undefined,
    };
  } catch (h) {
    // Hiç doldurulmamış inceleme detayı 404 döner; bu bir hata değil, "yok" demek.
    if (h instanceof Error && h.message.includes("HTTP 404")) return null;
    throw h;
  }
}

async function uygulamaTopla(ham: any, s: ToplaSecenek, hatalar: Hatalar, bugun: string): Promise<Uygulama> {
  const id: string = ham.id;
  const a = ham.attributes ?? {};
  const b = new Set(s.bolumler);
  const yorumAdedi = s.derin ? 1000 : 200;

  const [bilgi, surumler] = await Promise.all([
    guvenli<Awaited<ReturnType<typeof bilgileriGetir>>>(hatalar, `${id}:bilgiler`, { bilgiler: [], yasBeyani: null }, () => bilgileriGetir(id)),
    guvenli(hatalar, `${id}:surumler`, [] as Surum[], () => surumleriGetir(id)),
  ]);
  const hedef = hedefSec(surumler);
  const surumYerel = hedef.surum
    ? await guvenli(hatalar, `${id}:surum_yerel`, [] as Uygulama["surumYerel"], () => surumYerelGetir(hedef.surum!.id))
    : [];

  const ekranGorevi = async () => {
    const diller = s.derin
      ? surumYerel
      : surumYerel.filter((l) => l.dil === a.primaryLocale || l.dil === "en-US");
    const secilen = diller.length ? diller : surumYerel.slice(0, 1);
    const parcalar = await Promise.all(
      secilen.map((l) => guvenli(hatalar, `${id}:ekran:${l.dil}`, [] as Uygulama["ekranGoruntuleri"], () => ekranGoruntuleri(l.id, l.dil))),
    );
    return parcalar.flat();
  };

  const [ekran, yorumlar, urunler, gonderimler, detay, buildler, bolgeler] = await Promise.all([
    b.has("klon") ? ekranGorevi() : [],
    b.has("yorum_para") ? guvenli(hatalar, `${id}:yorumlar`, [] as Yorum[], () => yorumlariGetir(id, yorumAdedi)) : [],
    b.has("yorum_para") ? urunleriGetir(id, hatalar, bugun) : [],
    b.has("inceleme_hesap")
      ? guvenli(hatalar, `${id}:gonderimler`, [] as Uygulama["gonderimler"], async () => {
          const { data } = await tumunuGetir(
            "/v1/reviewSubmissions",
            { "filter[app]": id, "fields[reviewSubmissions]": "state,submittedDate,platform" },
            200,
          );
          return data.map((g: any) => ({ id: g.id, durum: g.attributes?.state ?? "", tarih: g.attributes?.submittedDate ?? undefined }));
        })
      : [],
    b.has("inceleme_hesap") && hedef.surum
      ? guvenli(hatalar, `${id}:inceleme_detayi`, undefined as Uygulama["incelemeDetayi"], () => incelemeDetayi(hedef.surum!.id))
      : undefined,
    b.has("inceleme_hesap")
      ? guvenli(hatalar, `${id}:buildler`, [] as Uygulama["buildler"], async () => {
          const yanit: any = await cagir({
            yontem: "GET",
            yol: "/v1/builds",
            sorgu: {
              "filter[app]": id,
              sort: "-uploadedDate",
              limit: 10,
              "fields[builds]": "version,uploadedDate,usesNonExemptEncryption,processingState",
            },
          });
          return (yanit?.data ?? []).map((x: any) => ({
            id: x.id,
            surum: x.attributes?.version ?? "",
            yuklenme: x.attributes?.uploadedDate ?? "",
            sifreleme: x.attributes?.usesNonExemptEncryption ?? null,
            durum: x.attributes?.processingState ?? "",
          }));
        })
      : [],
    b.has("inceleme_hesap") ? guvenli(hatalar, `${id}:bolgeler`, {}, () => bolgeDurumlari(id)) : {},
  ]);

  return {
    id,
    ad: a.name ?? "",
    bundleId: a.bundleId ?? "",
    anaDil: a.primaryLocale ?? "",
    icerikHaklari: a.contentRightsDeclaration ?? null,
    cocuklaraYonelik: a.isOrEverWasMadeForKids ?? undefined,
    bilgiler: bilgi.bilgiler,
    surumler,
    hedefSurumId: hedef.surum?.id,
    hedefSurumDuzenlenebilir: hedef.duzenlenebilir,
    surumYerel,
    ekranGoruntuleri: ekran,
    incelemeDetayi: detay,
    gonderimler,
    yorumlar,
    urunler,
    buildler,
    bolgeDurumlari: bolgeler,
    yasBeyani: bilgi.yasBeyani,
  };
}

async function satisTopla(veri: Veri, saticiNo: string, skuHaritasi: Record<string, string>, simdi: Date) {
  const rapor = (frequency: string, reportDate: string) =>
    raporIndir({ vendorNumber: saticiNo, reportDate, frequency, reportType: "SALES", reportSubType: "SUMMARY" });

  const ay = (geri: number) => {
    const d = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth() - geri, 1));
    return d.toISOString().slice(0, 7);
  };

  await Promise.all([
    guvenli(veri.hatalar, "satis:aylik", undefined, async () => {
      // Geçen ayın raporu ayın ilk günlerinde henüz yayınlanmamış olabilir; bir önceki aya düş.
      let donem = ay(1);
      let tsv: string;
      try {
        tsv = await rapor("MONTHLY", donem);
      } catch {
        donem = ay(2);
        tsv = await rapor("MONTHLY", donem);
      }
      const t = satisAyristir(tsv, skuHaritasi);
      veri.satis = {
        donem,
        uygulamalar: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { birim: v.birim, iade: v.iade }])),
      };
    }),
    guvenli(veri.hatalar, "satis:yillik", undefined, async () => {
      // sınır: takvim yılı raporu "son 12 ay"a yakınsar; tam pencere için 12 aylık rapor toplanmalı
      const t = satisAyristir(await rapor("YEARLY", String(simdi.getUTCFullYear() - 1)), skuHaritasi);
      veri.yillikIndirme = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.indirme]));
    }),
  ]);
}

export async function hesapVerisiTopla(s: ToplaSecenek): Promise<Veri> {
  const simdi = new Date();
  const bugun = simdi.toISOString().slice(0, 10);
  const veri: Veri = {
    simdi: simdi.toISOString(),
    derin: !!s.derin,
    uygulamalar: [],
    kullanicilar: [],
    davetler: [],
    hatalar: {},
  };

  const { data: hepsi } = await tumunuGetir(
    "/v1/apps",
    { sort: "name", "fields[apps]": "name,bundleId,sku,primaryLocale,contentRightsDeclaration,isOrEverWasMadeForKids" },
    10000,
  );
  const secilen = uygulamaSec(hepsi, s);

  const hesapGorevi = s.bolumler.includes("inceleme_hesap")
    ? Promise.all([
        guvenli(veri.hatalar, "kullanicilar", [] as Veri["kullanicilar"], async () => {
          const { data } = await tumunuGetir("/v1/users", { "fields[users]": "roles,allAppsVisible" }, 1000);
          return data.map((u: any) => ({ id: u.id, roller: u.attributes?.roles ?? [], tumUygulamalar: !!u.attributes?.allAppsVisible }));
        }),
        guvenli(veri.hatalar, "davetler", [] as Veri["davetler"], async () => {
          const { data } = await tumunuGetir("/v1/userInvitations", { "fields[userInvitations]": "roles,expirationDate" }, 1000);
          return data.map((d: any) => ({ id: d.id, roller: d.attributes?.roles ?? [], bitis: d.attributes?.expirationDate ?? undefined }));
        }),
      ]).then(([k, d]) => {
        veri.kullanicilar = k;
        veri.davetler = d;
      })
    : Promise.resolve();

  const satisGorevi =
    s.saticiNo && s.bolumler.includes("yorum_para")
      ? satisTopla(
          veri,
          s.saticiNo,
          Object.fromEntries(secilen.filter((u) => u.attributes?.sku).map((u) => [u.attributes.sku, u.id])),
          simdi,
        )
      : Promise.resolve();

  // sınır: sabit 5'li grup; Apple saatlik limitine yaklaşan dev hesaplarda gruplar küçültülmeli
  const uygulamaGorevi = (async () => {
    for (let i = 0; i < secilen.length; i += 5) {
      const grup = await Promise.all(secilen.slice(i, i + 5).map((u) => uygulamaTopla(u, s, veri.hatalar, bugun)));
      veri.uygulamalar.push(...grup);
    }
  })();

  await Promise.all([hesapGorevi, satisGorevi, uygulamaGorevi]);
  return veri;
}
