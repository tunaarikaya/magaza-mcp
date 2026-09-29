/**
 * Kimlik doğrulayıcılar.
 *
 * Bir anahtarı kasaya yazmadan önce gerçekten çalışıyor mu diye Apple ve
 * Google'a tek bir okuma isteği atarız. Hem kurulum sihirbazı hem de
 * etkileşimsiz `anahtar` komutu aynı kontrolden geçer; böylece "kaydettim"
 * dediğimiz her anahtar gerçekten bağlanıyor demektir.
 */
import { tokenUret, type AppleKimlik } from "./kimlik/apple.js";

export type DogrulamaSonucu = {
  tamam: boolean;
  adet?: number;
  mesaj?: string;
  /** Anahtar geçerli ama tam kapasite çalışmıyor — kaydı engellemeyen not. */
  uyari?: string;
};

export async function appleDogrula(kimlik: AppleKimlik): Promise<DogrulamaSonucu> {
  let token: string;
  try {
    token = tokenUret(kimlik);
  } catch {
    return {
      tamam: false,
      mesaj:
        ".p8 dosyası imzalama için kullanılamadı. Dosya bozuk olabilir veya " +
        "App Store Connect anahtarı değil (örn. bir StoreKit anahtarı olabilir).",
    };
  }

  const yanit = await fetch("https://api.appstoreconnect.apple.com/v1/apps?limit=200", {
    headers: { authorization: `Bearer ${token}` },
  });

  if (yanit.status === 401) {
    return {
      tamam: false,
      mesaj:
        "Apple anahtarı kabul etmedi. Key ID, Issuer ID ve .p8 dosyası " +
        "birbirine ait mi? Bilgisayarın saati doğru mu?",
    };
  }
  if (!yanit.ok) {
    return {
      tamam: false,
      mesaj: `Apple ${yanit.status} döndü: ${(await yanit.text()).slice(0, 200)}`,
    };
  }

  const veri: any = await yanit.json();
  return { tamam: true, adet: (veri.data || []).length };
}

/**
 * Play tarafı kasadaki servis hesabını kullanır; bu yüzden çağırmadan önce
 * anahtarın yazılmış olması gerekir. Modül önbelleğini atlamak için taze
 * içe aktarım yapıyoruz.
 */
export async function playDogrula(): Promise<DogrulamaSonucu> {
  const { gecerliToken, onbellegiTemizle } = await import("./kimlik/google.js");
  onbellegiTemizle();

  let token: string;
  try {
    token = await gecerliToken();
  } catch (h) {
    const ham = h instanceof Error ? h.message : String(h);
    // OpenSSL'in "DECODER routines::unsupported" hatası hiçbir şey anlatmıyor;
    // pratikte hep private_key alanının bozulmuş olması demek.
    const anlasilir = /DECODER|unsupported/i.test(ham)
      ? "Servis hesabındaki private_key okunamadı. JSON eksik kopyalanmış veya " +
        "satır sonları bozulmuş olabilir; dosyayı Cloud Console'dan yeniden indir."
      : ham;
    return { tamam: false, mesaj: anlasilir };
  }

  const yanit = await fetch(
    "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search?pageSize=200",
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (yanit.status === 403) {
    const govde = await yanit.text();

    // Anahtarın kendisi zaten token alabildi; buradaki 403 çoğu zaman
    // "Reporting API bu Cloud projesinde açık değil" demektir. Bu, anahtarı
    // reddetmek için sebep değil: Android Publisher araçlarının hepsi çalışır.
    if (
      govde.includes("SERVICE_DISABLED") ||
      govde.includes("has not been used in project") ||
      govde.includes("is disabled")
    ) {
      return {
        tamam: true,
        uyari:
          "Play Developer Reporting API bu Cloud projesinde kapalı. Anahtar geçerli " +
          "ve Android Publisher araçları çalışır; play__uygulamalar ile " +
          "play__cokme_orani için API'yi Cloud Console'dan açman gerekir.",
      };
    }

    return {
      tamam: false,
      mesaj:
        "Google yetki vermedi. Servis hesabı Play Console'a davet edildi mi ve " +
        "izinleri verildi mi? Ayrıca Cloud projesinde Android Publisher API ve " +
        "Play Developer Reporting API açık olmalı.",
    };
  }
  if (!yanit.ok) {
    return {
      tamam: false,
      mesaj: `Google ${yanit.status} döndü: ${(await yanit.text()).slice(0, 200)}`,
    };
  }

  const veri: any = await yanit.json();
  return { tamam: true, adet: (veri.apps || []).length };
}
