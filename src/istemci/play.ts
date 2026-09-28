/**
 * Google Play HTTP istemcisi.
 *
 * İki ayrı API'yi kapsar: Android Publisher (yayın, IAP, yorumlar) ve
 * Play Developer Reporting (çökme, ANR, Android vitals). Farklı taban
 * adresleri var, token'ları ortak.
 */
import { gecerliToken } from "../kimlik/google.js";

const TABANLAR = {
  publisher: "https://androidpublisher.googleapis.com",
  reporting: "https://playdeveloperreporting.googleapis.com",
} as const;

export type PlayApi = keyof typeof TABANLAR;

export type Istek = {
  api?: PlayApi;
  yontem: string;
  yol: string;
  sorgu?: Record<string, unknown>;
  govde?: unknown;
};

export async function cagir({
  api = "publisher",
  yontem,
  yol,
  sorgu,
  govde,
}: Istek): Promise<unknown> {
  const adres = new URL(yol.startsWith("http") ? yol : TABANLAR[api] + yol);

  for (const [ad, deger] of Object.entries(sorgu || {})) {
    if (deger === undefined || deger === null) continue;
    adres.searchParams.set(ad, String(deger));
  }

  const yanit = await fetch(adres, {
    method: yontem,
    headers: {
      authorization: `Bearer ${await gecerliToken()}`,
      "content-type": "application/json",
    },
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });

  const metin = await yanit.text();
  if (!yanit.ok) throw new Error(hataMesaji(yanit.status, metin, yol));
  if (!metin) return { basarili: true, durum: yanit.status };

  try {
    return JSON.parse(metin);
  } catch {
    return metin;
  }
}

function hataMesaji(durum: number, govde: string, yol: string): string {
  let ayrinti = govde.slice(0, 500);
  try {
    const cozulmus = JSON.parse(govde);
    if (cozulmus.error) {
      ayrinti = cozulmus.error.message || ayrinti;
    }
  } catch {
    /* düz metin olarak bırak */
  }

  const ipucu = ipuclari(durum, ayrinti, yol);
  return `Google Play hatası (HTTP ${durum})\n${ayrinti}${ipucu ? `\n\n→ ${ipucu}` : ""}`;
}

function ipuclari(durum: number, ayrinti: string, yol: string): string {
  if (durum === 401) {
    return "Erişim token'ı reddedildi. Servis hesabı anahtarı silinmiş veya değişmiş olabilir.";
  }

  if (durum === 403) {
    // Play Console izniyle hiç ilgisi olmayan, ama aynı 403'le gelen durum:
    // servis hesabının bağlı olduğu Google Cloud projesinde API kapalı.
    // Mesajı okumadan "izin ver" diye Play Console'da dolaşmak boşa vakit.
    if (
      ayrinti.includes("has not been used in project") ||
      ayrinti.includes("is disabled") ||
      ayrinti.includes("SERVICE_DISABLED")
    ) {
      const api = yol.startsWith("/v1beta1")
        ? "Google Play Developer Reporting API"
        : "Google Play Android Developer API";
      return (
        `Bu bir izin sorunu değil: ${api} servis hesabının Google Cloud ` +
        "projesinde açık değil. Yukarıdaki mesajdaki bağlantıyı aç, API'yi " +
        "etkinleştir, birkaç dakika bekleyip tekrar dene."
      );
    }

    // Sahada en çok vakit kaybettiren tuzak.
    if (yol.includes("inappproducts")) {
      return (
        "Bu uygulama yeni ürün modeline geçmiş olabilir. Tek seferlik ürünler için " +
        "artık eski 'inappproducts' değil, 'oneTimeProducts' uç noktası kullanılıyor — " +
        "geçiş yapmış uygulamalarda eski uç nokta 403 döner.\n" +
        "   magaza__endpoint_ara ile 'oneTimeProducts' ara ve onu kullan."
      );
    }
    if (ayrinti.includes("does not have permission") || ayrinti.includes("caller")) {
      return (
        "Servis hesabının bu uygulamada yetkisi yok. Play Console → Kullanıcılar ve " +
        "izinler bölümünden servis hesabını uygulamaya ekle ve ilgili izinleri ver. " +
        "İzin değişiklikleri birkaç dakikada yayılır."
      );
    }
    return (
      "Yetki reddedildi. Servis hesabı Play Console'a davet edilmiş mi ve bu " +
      "uygulamaya erişimi var mı, kontrol et."
    );
  }

  if (durum === 404) {
    if (yol.includes("edits")) {
      return (
        "Düzenleme oturumu (edit) bulunamadı. Oturumlar kısa ömürlüdür ve " +
        "commit veya iptal sonrası geçersiz olur — yenisini aç."
      );
    }
    return "Kaynak bulunamadı. Paket adı (packageName) doğru yazıldı mı?";
  }

  if (durum === 400 && ayrinti.includes("package")) {
    return "Paket adı geçersiz görünüyor. 'com.sirket.uygulama' biçiminde olmalı.";
  }

  if (durum === 409) {
    return "Çakışma — büyük ihtimalle aynı anda açık başka bir düzenleme oturumu var.";
  }

  if (durum === 429) {
    return "Google hız sınırına takıldın. Bir süre bekleyip tekrar dene.";
  }

  if (durum >= 500) {
    return "Google tarafında geçici bir sorun. Birazdan tekrar dene.";
  }

  return "";
}
