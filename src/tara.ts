/**
 * Anahtar arama.
 *
 * Kullanıcı çoğu zaman anahtarını indirdiğini bilir ama nerede olduğunu
 * bilmez. Bu komut alışılmış klasörleri tarayıp App Store `.p8` anahtarlarını
 * ve Google servis hesabı JSON'larını bulur.
 *
 * Çıktıda anahtarın İÇERİĞİ asla yer almaz — yalnızca dosyanın yolu ve
 * kimliğini gösteren zararsız alanlar (Key ID, servis hesabının e-postası,
 * proje adı) basılır. Böylece bir yapay zekâ ajanı bu komutu çalıştırıp
 * kullanıcıya "şunu mu kullanayım?" diye sorabilir; özel anahtar ajanın
 * bağlamına hiç girmez.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const kisalt = (yol: string) => yol.replace(homedir(), "~");

/** Alışılmış konumlar. Sıra önemli: ilk sıradakiler daha olası. */
export function kokler(): string[] {
  const ev = homedir();
  return [
    join(ev, "Downloads"),
    join(ev, "İndirilenler"),
    join(ev, "Desktop"),
    join(ev, "Masaüstü"),
    join(ev, ".appstoreconnect", "private_keys"),
    join(ev, "private_keys"),
    join(ev, "Keys"),
    join(ev, "keys"),
    join(ev, ".config"),
    join(ev, ".ssh"),
    join(ev, "Documents"),
    join(ev, "Belgeler"),
    process.cwd(),
  ];
}

/** Girilmeyecek klasörler: içinde anahtar aranmaz, hepsi gürültü. */
const ATLA = new Set([
  "node_modules",
  ".git",
  "Library",
  "Applications",
  ".Trash",
  "Pods",
  "build",
  "dist",
  ".next",
  ".cache",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
]);

const DERINLIK = 3;
/** Güvenlik supabı: çok kalabalık bir klasörde sonsuza kadar dönmeyelim. */
const EN_FAZLA_DOSYA = 40_000;

export type Bulgu = {
  tur: "appstore" | "play";
  yol: string;
  degistirilme: string;
  /**
   * Bu dosya aradığımız anahtar mı?
   *
   * "yuksek": adı ve içeriği tam oturuyor.
   * "dusuk" : doğru türde görünüyor ama muhtemelen başka iş için üretilmiş —
   *           kullanıcıya sormadan kullanma. Sebebi `uyari` alanında.
   */
  guven: "yuksek" | "dusuk";
  uyari?: string;
  /** Apple: dosya adından okunan Key ID (okunabildiyse). */
  key_id?: string;
  /** Play: servis hesabının e-postası ve Cloud projesi. */
  servis_hesabi?: string;
  proje?: string;
};

/**
 * Verilen klasörleri tarar, bulunan anahtar dosyalarını döndürür.
 *
 * Kökleri dışarıdan alıyor olması testler için: gerçek ev dizinini taramadan
 * sınıflandırma mantığı sınanabiliyor.
 */
export function taraKokler(baslangic: string[]): Bulgu[] {
  const bulgular: Bulgu[] = [];
  const gorulen = new Set<string>();
  let sayac = 0;

  const gez = (dizin: string, derinlik: number): void => {
    if (derinlik > DERINLIK || sayac > EN_FAZLA_DOSYA) return;

    let girdiler;
    try {
      girdiler = readdirSync(dizin, { withFileTypes: true });
    } catch {
      return; // izin yok veya yok — sessizce geç
    }

    for (const girdi of girdiler) {
      if (sayac++ > EN_FAZLA_DOSYA) return;
      const yol = join(dizin, girdi.name);

      if (girdi.isDirectory()) {
        if (ATLA.has(girdi.name)) continue;
        // Nokta ile başlayan klasörlerin içine yalnızca kök olarak verdiysek gireriz.
        if (girdi.name.startsWith(".") && derinlik > 0) continue;
        gez(yol, derinlik + 1);
        continue;
      }

      if (!girdi.isFile()) continue;
      if (gorulen.has(yol)) continue;

      const bulgu = incele(yol, girdi.name);
      if (bulgu) {
        gorulen.add(yol);
        bulgular.push(bulgu);
      }
    }
  };

  for (const kok of baslangic) gez(kok, 0);

  // Önce doğru türdekiler, sonra en yeni: aradığımız çoğu zaman en üsttedir.
  bulgular.sort((a, b) => {
    if (a.guven !== b.guven) return a.guven === "yuksek" ? -1 : 1;
    return b.degistirilme.localeCompare(a.degistirilme);
  });
  return bulgular;
}

/** Alışılmış klasörleri tarar. */
export function tara(): Bulgu[] {
  return taraKokler(kokler());
}

/** Tek bir dosyaya bakar. Anahtar değilse null döner. */
function incele(yol: string, ad: string): Bulgu | null {
  const p8 = ad.toLowerCase().endsWith(".p8");
  const json = ad.toLowerCase().endsWith(".json");
  if (!p8 && !json) return null;

  let bilgi;
  try {
    bilgi = statSync(yol);
  } catch {
    return null;
  }

  // Servis hesabı anahtarları birkaç kilobayttır; büyük JSON'ları hiç açmayalım.
  if (bilgi.size > 64 * 1024) return null;

  let icerik: string;
  try {
    icerik = readFileSync(yol, "utf8");
  } catch {
    return null;
  }

  const degistirilme = bilgi.mtime.toISOString().slice(0, 10);

  if (p8) {
    if (!icerik.includes("BEGIN PRIVATE KEY")) return null;

    // App Store Connect API anahtarı AuthKey_ABC123DEFG.p8 diye iner.
    // SubscriptionKey_ ile başlayanlar StoreKit/uygulama içi satın alma
    // anahtarlarıdır; aynı uzantıyı taşırlar ama API'ye giriş yapmazlar.
    const eslesme = ad.match(/AuthKey_([A-Z0-9]{8,12})\.p8$/i);
    const storeKit = /^SubscriptionKey_/i.test(ad);

    return {
      tur: "appstore",
      yol,
      degistirilme,
      guven: eslesme ? "yuksek" : "dusuk",
      ...(storeKit
        ? {
            uyari:
              "Adı SubscriptionKey_ ile başlıyor: bu bir StoreKit abonelik " +
              "anahtarı olabilir, App Store Connect API anahtarı değil.",
          }
        : eslesme
          ? {}
          : { uyari: "Key ID dosya adından okunamadı; --key-id ile verilmeli." }),
      ...(eslesme ? { key_id: eslesme[1].toUpperCase() } : {}),
    };
  }

  // JSON: yalnızca servis hesabı anahtarları ilgilendiriyor.
  if (!icerik.includes("service_account") && !icerik.includes("private_key")) return null;

  let hesap: any;
  try {
    hesap = JSON.parse(icerik);
  } catch {
    return null;
  }

  if (!hesap || hesap.type !== "service_account") return null;
  if (!hesap.client_email || !hesap.private_key) return null;

  // Firebase'in admin SDK hesapları da servis hesabıdır ama genelde Play
  // Console'a davet edilmemiştir; kullanıcıya sormadan seçilmemeli.
  const firebase = /firebase-adminsdk/i.test(hesap.client_email);

  return {
    tur: "play",
    yol,
    degistirilme,
    guven: firebase ? "dusuk" : "yuksek",
    ...(firebase
      ? {
          uyari:
            "Firebase admin SDK hesabı — Play Console'a davet edilmemiş olabilir.",
        }
      : {}),
    servis_hesabi: hesap.client_email,
    ...(hesap.project_id ? { proje: hesap.project_id } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* komut                                                               */
/* ------------------------------------------------------------------ */

export function taraKomutu(): void {
  const jsonCikti = process.argv.includes("--json");
  const bulgular = tara();

  if (jsonCikti) {
    console.log(JSON.stringify({ bulgular }, null, 2));
    return;
  }

  const apple = bulgular.filter((b) => b.tur === "appstore");
  const play = bulgular.filter((b) => b.tur === "play");

  console.log();
  if (!bulgular.length) {
    console.log("  Alışılmış klasörlerde anahtar bulunamadı.");
    console.log("  Dosyanın yolunu biliyorsan doğrudan verebilirsin:");
    console.log();
    console.log("    npx magaza-mcp anahtar --apple-p8 <yol> --key-id <ID> --issuer-id <ID>");
    console.log("    npx magaza-mcp anahtar --play-json <yol>");
    console.log();
    return;
  }

  if (apple.length) {
    console.log(`  App Store Connect anahtarı (${apple.length}):`);
    for (const b of apple) {
      console.log(`    ${b.guven === "yuksek" ? "•" : "?"} ${kisalt(b.yol)}`);
      console.log(
        `        ${b.key_id ? `Key ID ${b.key_id}` : "Key ID okunamadı"}  ·  ${b.degistirilme}`,
      );
      if (b.uyari) console.log(`        ⚠ ${b.uyari}`);
    }
    console.log();
  }

  if (play.length) {
    console.log(`  Google Play servis hesabı (${play.length}):`);
    for (const b of play) {
      console.log(`    ${b.guven === "yuksek" ? "•" : "?"} ${kisalt(b.yol)}`);
      console.log(
        `        ${b.servis_hesabi}${b.proje ? `  ·  ${b.proje}` : ""}  ·  ${b.degistirilme}`,
      );
      if (b.uyari) console.log(`        ⚠ ${b.uyari}`);
    }
    console.log();
  }
}
