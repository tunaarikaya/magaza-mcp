/**
 * App Store Connect HTTP istemcisi.
 *
 * Apple'ın hata gövdeleri İngilizce ve çoğu zaman sebebi söylemez; burada
 * sık karşılaşılanlar Türkçeye ve "ne yapmalıyım"a çevrilir.
 */
import { gecerliToken } from "../kimlik/apple.js";

const TABAN = "https://api.appstoreconnect.apple.com";
const TABAN_KOKU = new URL(TABAN).origin;

/**
 * Bir yolu istek adresine çevirir.
 *
 * Mutlak URL kabul ediyoruz (sayfalamada Apple `links.next` içinde tam adres
 * verir), ama kökü doğrulamadan değil: Bearer token'ı yanıt gövdesinin
 * gösterdiği rastgele bir hosta göndermek, tek korumanın "Apple'ın gövdesine
 * güveniyoruz" olması demek olurdu.
 */
function adresCoz(yol: string): URL {
  if (!/^https?:\/\//i.test(yol)) return new URL(TABAN + yol);

  const adres = new URL(yol);
  if (adres.origin !== TABAN_KOKU) {
    throw new Error(
      `Apple isteği ${adres.origin} adresine yönlendirilmek istendi; ` +
        `yalnızca ${TABAN_KOKU} kabul ediliyor. İstek gönderilmedi.`,
    );
  }
  return adres;
}

export type Istek = {
  yontem: string;
  yol: string;
  sorgu?: Record<string, unknown>;
  govde?: unknown;
};

export async function cagir({ yontem, yol, sorgu, govde }: Istek): Promise<unknown> {
  const adres = adresCoz(yol);

  for (const [ad, deger] of Object.entries(sorgu || {})) {
    if (deger === undefined || deger === null) continue;
    adres.searchParams.set(ad, Array.isArray(deger) ? deger.join(",") : String(deger));
  }

  const basliklar: Record<string, string> = {
    authorization: `Bearer ${gecerliToken()}`,
    accept: "application/json",
  };
  // Gövdesiz isteklerde content-type göndermek gereksiz; bazı vekil sunucular
  // gövdesiz POST/DELETE'te bundan rahatsız oluyor.
  if (govde !== undefined) basliklar["content-type"] = "application/json";

  const yanit = await fetch(adres, {
    method: yontem,
    headers: basliklar,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });

  // 204 ve gövdesiz yanıtlar
  const metin = await yanit.text();
  if (!yanit.ok) throw new Error(hataMesaji(yanit.status, metin, yol));
  if (!metin.trim()) return { basarili: true, durum: yanit.status };

  try {
    return JSON.parse(metin);
  } catch {
    return metin;
  }
}

/**
 * Bir koleksiyonu istenen adede ulaşana kadar sayfa sayfa toplar.
 *
 * Apple tek istekte en çok 200 kayıt verir ve gerisini `links.next` ile
 * işaret eder. Tek sayfayla yetinmek sessizce eksik veri döndürmek demektir;
 * "200'den fazla ülkede fiyat" veya "300 yorum" gibi isteklerde fark eder.
 */
export async function tumunuGetir(
  yol: string,
  sorgu: Record<string, unknown>,
  istenen: number,
): Promise<{ data: any[]; included: any[] }> {
  const data: any[] = [];
  const included: any[] = [];

  // Apple'ın tek sayfa üst sınırı 200.
  const sayfaBoyu = Math.min(200, Math.max(1, istenen));
  let yanit: any = await cagir({ yontem: "GET", yol, sorgu: { ...sorgu, limit: sayfaBoyu } });

  for (let sayfa = 0; sayfa < 50; sayfa++) {
    data.push(...(yanit?.data || []));
    included.push(...(yanit?.included || []));

    const sonraki = yanit?.links?.next;
    if (!sonraki || data.length >= istenen) break;

    // Sayfalama bağlantısı yanıt gövdesinden geliyor; kökü Apple değilse
    // takip etmiyoruz (adresCoz da reddederdi, burada sessizce duruyoruz).
    let sonrakiAdres: URL;
    try {
      sonrakiAdres = new URL(sonraki, TABAN);
    } catch {
      break;
    }
    if (sonrakiAdres.origin !== TABAN_KOKU) break;

    yanit = await cagir({ yontem: "GET", yol: sonrakiAdres.toString() });
  }

  return { data: data.slice(0, istenen), included };
}

/** Satış/finans raporları JSON değil, gzip'li TSV döner. */
export async function raporIndir(sorgu: Record<string, unknown>): Promise<string> {
  const adres = adresCoz("/v1/salesReports");
  for (const [ad, deger] of Object.entries(sorgu)) {
    if (deger === undefined || deger === null || deger === "") continue;
    adres.searchParams.set(`filter[${ad}]`, String(deger));
  }

  const yanit = await fetch(adres, {
    method: "GET",
    headers: {
      authorization: `Bearer ${gecerliToken()}`,
      accept: "application/a-gzip, application/json",
    },
  });

  const ham = Buffer.from(await yanit.arrayBuffer());

  if (!yanit.ok) {
    throw new Error(hataMesaji(yanit.status, ham.toString("utf8"), "/v1/salesReports"));
  }

  // gzip sihirli baytları: 1f 8b. Apple bazen sıkıştırmadan düz TSV döndürür.
  if (ham.length >= 2 && ham[0] === 0x1f && ham[1] === 0x8b) {
    const { gunzipSync } = await import("node:zlib");
    return gunzipSync(ham).toString("utf8");
  }
  return ham.toString("utf8");
}

function hataMesaji(durum: number, govde: string, yol: string): string {
  let ayrinti = govde.slice(0, 500);
  try {
    const cozulmus = JSON.parse(govde);
    if (Array.isArray(cozulmus.errors)) {
      ayrinti = cozulmus.errors
        .map(
          (h: {
            title?: string;
            detail?: string;
            code?: string;
            source?: { parameter?: string; pointer?: string };
          }) => {
            // Apple, hatalı parametrenin adını `source.parameter` içinde verir;
            // hangi filtrenin reddedildiğini anlamanın tek yolu çoğu zaman bu.
            const kaynak = h.source?.parameter || h.source?.pointer;
            return [h.title, h.detail, kaynak ? `(${kaynak})` : ""]
              .filter(Boolean)
              .join(" — ");
          },
        )
        .join("\n");
    }
  } catch {
    /* düz metin olarak bırak */
  }

  const ipucu = ipuclari(durum, ayrinti, yol);
  return `App Store Connect hatası (HTTP ${durum})\n${ayrinti}${ipucu ? `\n\n→ ${ipucu}` : ""}`;
}

function ipuclari(durum: number, ayrinti: string, yol: string): string {
  const rapor = yol.includes("Reports");

  if (durum === 400 && rapor) {
    return (
      "Rapor parametreleri kabul edilmedi. Sık sebepler: SUBSCRIBER raporu " +
      "yalnızca DETAILED alt türünü kabul eder; abonelik raporları çoğu zaman " +
      "bir sürüm ister (örn. 1_3); haftalık raporda tarih bir pazar gününe, " +
      "aylık raporda YYYY-AA, yıllık raporda YYYY biçimine denk gelmelidir."
    );
  }
  if (durum === 401) {
    return (
      "Anahtar kabul edilmedi. Key ID, Issuer ID ve .p8 dosyası birbirine ait mi? " +
      "Bilgisayarın saati doğru mu? (JWT'nin ömrü 20 dakika, kaymış saat token'ı geçersiz kılar.)"
    );
  }
  if (durum === 403) {
    if (yol.includes("/users") || yol.includes("/userInvitations")) {
      return "Kullanıcı yönetimi için anahtarın rolü Admin olmalı. App Manager yetmez.";
    }
    if (yol.includes("analytics")) {
      return (
        "Analitik raporları için anahtarın Admin olması gerekebilir; " +
        "yeni bir rapor türü ilk kez istendiğinde Apple Admin arar."
      );
    }
    if (rapor) {
      return (
        "Satış raporları için anahtarın rolü Finance, Admin veya Account Holder " +
        "olmalı. App Manager bu raporları göremez."
      );
    }
    return (
      "Anahtarın bu işlem için yetkisi yok. Günlük yayın işleri için App Manager " +
      "yeterlidir; sözleşme, vergi ve banka bilgileri ise yalnızca Hesap Sahibi'nde " +
      "olup hiçbir API anahtarıyla okunamaz."
    );
  }
  if (durum === 404) {
    if (rapor) {
      return (
        "O tarih için rapor yok. Apple raporları 1-2 gün gecikmeli yayınlar ve " +
        "hiç satış olmayan gün için dosya üretmez. Satıcı numarası (vendor number) " +
        "doğru mu?"
      );
    }
    return "Kaynak bulunamadı. Kimlik (id) doğru mu, silinmiş olabilir mi?";
  }
  if (durum === 409) {
    return (
      "Çakışma. Genelde kaynağın o anki durumu bu işleme izin vermiyor demektir — " +
      "örneğin incelemedeki bir sürümü düzenlemeye çalışmak."
    );
  }
  if (durum === 422) {
    return "Gövde biçimsel olarak doğru ama içerik kabul edilmedi (uzunluk sınırı, geçersiz değer).";
  }
  if (durum === 429) {
    return "Apple hız sınırına takıldın. Bir süre bekleyip tekrar dene.";
  }
  if (durum >= 500) {
    return "Apple tarafında geçici bir sorun. Birazdan tekrar dene.";
  }
  return "";
}
