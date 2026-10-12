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

  return gonder(adres, yontem, yol, "application/json", govde === undefined ? undefined : JSON.stringify(govde));
}

/**
 * Dosya yükler (AAB, APK, ekran görüntüsü).
 *
 * Google'da yükleme uçları ayrı bir kökte: `/upload/androidpublisher/...`
 * ve `uploadType=media`. Gövde dosyanın ham baytları; JSON'a sarılırsa Google
 * dosyayı bozuk sayıyor. Genel `cagir` bunu yapamadığı için katalogdaki
 * yükleme operasyonları hep düşüyordu.
 */
export async function yukle(yol: string, veri: Uint8Array<ArrayBuffer>, icerikTuru: string): Promise<unknown> {
  const adres = new URL(`${TABANLAR.publisher}/upload${yol}`);
  adres.searchParams.set("uploadType", "media");
  return gonder(adres, "POST", yol, icerikTuru, veri);
}

async function gonder(
  adres: URL,
  yontem: string,
  yol: string,
  icerikTuru: string,
  govde: string | Uint8Array<ArrayBuffer> | undefined,
): Promise<unknown> {
  // 429'da Google isteği işlememiştir; yazmayı bile tekrarlamak güvenli.
  let yanit: Response;
  for (let deneme = 0; ; deneme++) {
    yanit = await fetch(adres, {
      method: yontem,
      headers: { authorization: `Bearer ${await gecerliToken()}`, "content-type": icerikTuru },
      body: govde,
    });
    if (yanit.status !== 429 || deneme >= 3) break;
    const bekle = Number(yanit.headers.get("retry-after")) || 2 ** deneme * 2;
    await new Promise((r) => setTimeout(r, Math.min(bekle, 60) * 1000));
  }

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

  // Yayın commit'inde en sık düşülen üç tuzak; Google'ın mesajı ne yapılacağını söylemiyor.
  if (ayrinti.includes("changesNotSentForReview")) {
    return (
      "Bu uygulamada değişiklikler otomatik incelemeye gönderilemiyor (Play Console'da " +
      "'yönetilen yayın' açık olabilir). incelemeye_gonder=false ile tekrar dene; " +
      "sonra Play Console'dan incelemeye gönder."
    );
  }
  if (/only releases with status draft/i.test(ayrinti)) {
    return (
      "Uygulama henüz hiç yayınlanmamış (taslak uygulama). Bu durumda Play yalnızca " +
      "taslak sürüm kabul eder: taslak=true ile tekrar dene, ilk yayını Play Console'dan yap."
    );
  }
  if (/version code .* (has )?already been used/i.test(ayrinti)) {
    return "Bu versionCode daha önce yüklenmiş. Uygulamanın versionCode'unu artırıp yeniden derle.";
  }

  if (durum === 400 && /package ?name/i.test(ayrinti) && /invalid|not found|unknown/i.test(ayrinti)) {
    return "Paket adı geçersiz görünüyor. 'com.sirket.uygulama' biçiminde olmalı.";
  }

  if (durum === 409) {
    return yol.includes("/edits")
      ? "Çakışma — aynı anda açık başka bir düzenleme oturumu commit edilmiş olabilir (CI, Play Console). Tekrar dene."
      : "Çakışma — kaynak zaten var ya da şu anki durumu bu işleme izin vermiyor.";
  }

  if (durum === 429) {
    return "Google hız sınırına takıldın. Bir süre bekleyip tekrar dene.";
  }

  if (durum >= 500) {
    return "Google tarafında geçici bir sorun. Birazdan tekrar dene.";
  }

  return "";
}
