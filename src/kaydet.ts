/**
 * Etkileşimsiz kayıt ve durum komutları.
 *
 * Bunlar bir yapay zekâ ajanının güvenle çalıştırabileceği komutlar: sunucuyu
 * istemcilerin ayar dosyalarına yazarlar ve neyin bağlı olduğunu raporlarlar,
 * ama hiçbir kimlik bilgisi istemezler ve hiçbir anahtarı ekrana basmazlar.
 *
 * Anahtarın kendisi ayrı bir komutla girilir (`magaza-mcp anahtar`); orada da
 * yalnızca dosyanın yolu dolaşır, içeriği ajanın bağlamına hiç düşmez.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { kimlikOku } from "./kimlik/apple.js";
import { kasaNerede } from "./kimlik/kasa.js";
import { servisHesabiOku } from "./kimlik/google.js";
import { ISTEMCILER, kur, kuruluMu, sunucuGirdisi } from "./istemciler.js";

const kisalt = (yol: string) => yol.replace(homedir(), "~");

/** `--ad deger` biçimindeki bayrakları okur. */
function bayrak(ad: string): string | undefined {
  const i = process.argv.indexOf(`--${ad}`);
  if (i === -1) return undefined;
  const deger = process.argv[i + 1];
  return deger && !deger.startsWith("--") ? deger : undefined;
}

function listeyeCevir(deger: string | undefined): string[] {
  return (deger || "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* kaydet                                                              */
/* ------------------------------------------------------------------ */

export function kaydetKomutu(): void {
  const istenenMagazalar = listeyeCevir(bayrak("magazalar")) || [];
  const istenenIstemciler = listeyeCevir(bayrak("istemci"));
  const saltOkunur = process.argv.includes("--salt-okunur");

  const magazalar = istenenMagazalar.length
    ? istenenMagazalar.filter((m) => m === "appstore" || m === "play")
    : ["appstore", "play"];

  if (magazalar.length === 0) {
    console.error(
      "Geçersiz mağaza. Kullanılabilir değerler: appstore, play\n" +
        "Örnek: npx magaza-mcp kaydet --magazalar appstore,play",
    );
    process.exit(1);
  }

  // İstemci verilmediyse makinede kurulu görünenlere yaz.
  const secilenler = istenenIstemciler.length
    ? ISTEMCILER.filter((i) => istenenIstemciler.includes(i.anahtar))
    : ISTEMCILER.filter(kuruluMu);

  if (secilenler.length === 0) {
    console.error(
      istenenIstemciler.length
        ? `Bilinmeyen istemci. Kullanılabilir: ${ISTEMCILER.map((i) => i.anahtar).join(", ")}`
        : "Bu makinede kurulu bir MCP istemcisi bulunamadı.\n" +
            `--istemci ile açıkça belirtebilirsin: ${ISTEMCILER.map((i) => i.anahtar).join(", ")}`,
    );
    process.exit(1);
  }

  const sonuclar = kur(secilenler, sunucuGirdisi(magazalar, saltOkunur));

  console.log();
  for (const s of sonuclar) {
    console.log(
      s.basarili
        ? `  ✓ ${s.istemci.isim} — ${kisalt(s.istemci.yol)}`
        : `  ✗ ${s.istemci.isim} — ${s.hata}`,
    );
  }

  const basarisiz = sonuclar.filter((s) => !s.basarili).length;
  console.log();
  console.log(
    `  ${sonuclar.length - basarisiz} istemciye kaydedildi` +
      (basarisiz ? `, ${basarisiz} tanesi başarısız` : "") +
      ".",
  );

  // Kayıt ayrı, kimlik ayrı: eksikse net söyle.
  const eksikler: string[] = [];
  if (magazalar.includes("appstore") && !kimlikOku()) eksikler.push("App Store Connect");
  if (magazalar.includes("play") && !servisHesabiOku()) eksikler.push("Google Play");

  if (eksikler.length) {
    console.log();
    console.log(`  Eksik kimlik bilgisi: ${eksikler.join(", ")}`);
    console.log("  Anahtarı makinede ara:  npx magaza-mcp tara");
    console.log("  Bulduğunu kaydet     :  npx magaza-mcp anahtar --apple-p8 <yol> --issuer-id <ID>");
    console.log("                          npx magaza-mcp anahtar --play-json <yol>");
  }

  console.log();
  if (basarisiz) process.exit(1);
}

/* ------------------------------------------------------------------ */
/* durum                                                               */
/* ------------------------------------------------------------------ */

export async function durumKomutu(): Promise<void> {
  const jsonCikti = process.argv.includes("--json");

  const apple = kimlikOku();
  const play = servisHesabiOku();

  const kimlik = {
    appstore: {
      anahtar_var: !!apple,
      // Anahtarın kendisi asla basılmaz; yalnızca varlığı ve son 4 hanesi.
      key_id_sonu: apple ? `…${apple.keyId.slice(-4)}` : null,
      baglanti: apple ? await appleDene() : "anahtar yok",
    },
    play: {
      anahtar_var: !!play,
      baglanti: play ? await playDene() : "anahtar yok",
    },
    kasa: kasaNerede(),
    kayitli_istemciler: ISTEMCILER.filter((i) => kayitliMi(i)).map((i) => i.anahtar),
  };

  if (jsonCikti) {
    console.log(JSON.stringify(kimlik, null, 2));
    return;
  }

  const im = (d: string) =>
    d === "tamam" ? "✓" : d === "anahtar yok" ? "–" : d.startsWith("anahtar geçerli") ? "!" : "✗";

  console.log();
  console.log("  magaza-mcp durumu");
  console.log();
  console.log(
    `  ${im(kimlik.appstore.baglanti)} App Store Connect  ${kimlik.appstore.baglanti}` +
      (kimlik.appstore.key_id_sonu ? `  (anahtar ${kimlik.appstore.key_id_sonu})` : ""),
  );
  console.log(`  ${im(kimlik.play.baglanti)} Google Play        ${kimlik.play.baglanti}`);
  console.log();
  console.log(`  Kasa      : ${kimlik.kasa}`);
  console.log(
    `  Kayıtlı   : ${kimlik.kayitli_istemciler.length ? kimlik.kayitli_istemciler.join(", ") : "hiçbir istemciye kayıtlı değil"}`,
  );
  console.log();
}

/** Bir istemcinin ayar dosyasında bizim girdimiz var mı? */
function kayitliMi(istemci: (typeof ISTEMCILER)[number]): boolean {
  try {
    if (!existsSync(istemci.yol)) return false;
    return readFileSync(istemci.yol, "utf8").includes("magaza-mcp");
  } catch {
    return false;
  }
}

async function appleDene(): Promise<string> {
  try {
    const { gecerliToken } = await import("./kimlik/apple.js");
    const yanit = await fetch("https://api.appstoreconnect.apple.com/v1/apps?limit=1", {
      headers: { authorization: `Bearer ${gecerliToken()}` },
    });
    if (yanit.ok) return "tamam";
    if (yanit.status === 401) return "anahtar reddedildi (iptal edilmiş veya hatalı olabilir)";
    return `Apple ${yanit.status} döndü`;
  } catch (h) {
    return h instanceof Error ? h.message.split("\n")[0] : "bağlanılamadı";
  }
}

async function playDene(): Promise<string> {
  try {
    const { gecerliToken } = await import("./kimlik/google.js");
    const token = await gecerliToken();

    // Token alınabildiyse servis hesabı anahtarı zaten geçerli demektir.
    // Geriye API'lerin açık olup olmadığı kalıyor; onu Reporting ile yokluyoruz
    // çünkü Publisher'ın hesap düzeyinde yoklanacak bir ucu yok.
    const yanit = await fetch(
      "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search?pageSize=1",
      { headers: { authorization: `Bearer ${token}` } },
    );

    if (yanit.ok) return "tamam";

    if (yanit.status === 403) {
      const govde = await yanit.text();
      if (
        govde.includes("SERVICE_DISABLED") ||
        govde.includes("has not been used in project") ||
        govde.includes("is disabled")
      ) {
        return (
          "anahtar geçerli, ancak Play Developer Reporting API Cloud projesinde kapalı " +
          "(Android Publisher araçları yine de çalışır)"
        );
      }
      return "yetki yok (servis hesabı Play Console'a davet edildi mi?)";
    }

    return `Google ${yanit.status} döndü`;
  } catch (h) {
    return h instanceof Error ? h.message.split("\n")[0] : "bağlanılamadı";
  }
}
