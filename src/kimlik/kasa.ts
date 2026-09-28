/**
 * Kasa — kimlik bilgilerinin saklandığı yer.
 *
 * macOS'ta Anahtar Zinciri (Keychain) kullanılır; özel anahtar hiçbir zaman
 * düz metin config dosyasına yazılmaz. Diğer işletim sistemlerinde, dosya
 * izinleri 0600'e kilitlenmiş bir dosyaya düşülür.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const SERVIS = "magaza-mcp";
const macOS = platform() === "darwin";

/**
 * Saklanan değerlerin başına konan işaret.
 *
 * `security find-generic-password -w`, içinde satır sonu veya ASCII dışı bayt
 * olan bir parolayı düz metin yerine onaltılık (hex) döküm olarak basar.
 * Çok satırlı bir .p8 anahtarı ve JSON servis hesabı tam olarak bu tuzağa
 * düşer; geri okurken içerik bozulur. Bu yüzden değeri base64'e çevirip
 * başına bir işaret koyuyoruz: base64 alfabesi tamamen yazdırılabilir ASCII
 * olduğundan Anahtar Zinciri onu olduğu gibi geri verir.
 */
const ISARET = "b64:";

/** macOS'un hex dökümüne düşmüş, işaretten önce yazılmış kayıtları tanır. */
function hexMi(metin: string): boolean {
  return metin.length >= 2 && metin.length % 2 === 0 && /^[0-9a-f]+$/i.test(metin);
}

/** Kasadan çıkan ham metni asıl değere çevirir. */
function coz(ham: string): string {
  const temiz = ham.replace(/\n$/, "");

  if (temiz.startsWith(ISARET)) {
    return Buffer.from(temiz.slice(ISARET.length), "base64").toString("utf8");
  }

  if (hexMi(temiz)) {
    const cozulmus = Buffer.from(temiz, "hex").toString("utf8");
    // Hex'e benzeyen gerçek bir düz metni bozmayalım: çözülen şey geçerli
    // UTF-8 değilse ham metne geri dönüyoruz.
    if (!cozulmus.includes("�")) return cozulmus;
  }

  return temiz;
}

const yedekDosya = join(homedir(), ".config", "magaza-mcp", "kimlik.json");

function yedekOku(): Record<string, string> {
  if (!existsSync(yedekDosya)) return {};
  try {
    return JSON.parse(readFileSync(yedekDosya, "utf8"));
  } catch {
    return {};
  }
}

function yedekYaz(veri: Record<string, string>): void {
  mkdirSync(dirname(yedekDosya), { recursive: true, mode: 0o700 });
  writeFileSync(yedekDosya, JSON.stringify(veri, null, 2), { mode: 0o600 });
  chmodSync(yedekDosya, 0o600);
}

/** Bir değeri kasaya yazar. Aynı anahtar varsa üzerine yazılır. */
export function yaz(anahtar: string, deger: string): void {
  const saklanacak = ISARET + Buffer.from(deger, "utf8").toString("base64");

  if (macOS) {
    try {
      // Değer `-w` argümanı olarak veriliyor. Bunun bilinen bir bedeli var:
      // argümanlar çağrı süresince `ps` ile aynı makinedeki başka işlemlerce
      // okunabilir. Alternatifi denendi ve İŞE YARAMIYOR: `-w`'yi değersiz
      // bırakıp değeri stdin'den vermek, `security`'nin etkileşimli parola
      // okuyucusunu devreye sokuyor ve o okuyucu girdiyi 128 karakterde
      // sessizce kesiyor (ölçüldü: 300 karakter gönderildi, 128 saklandı).
      // Bir .p8 anahtarının base64'ü bunun iki katından uzun; o yolla
      // saklanan her anahtar bozuk kaydedilirdi.
      execFileSync(
        "security",
        ["add-generic-password", "-U", "-s", SERVIS, "-a", anahtar, "-w", saklanacak],
        { stdio: "pipe" },
      );
      return;
    } catch {
      // Anahtar Zinciri erişilemedi — dosyaya düş.
    }
  }

  const veri = yedekOku();
  veri[anahtar] = saklanacak;
  yedekYaz(veri);
}

/** Kasadan bir değer okur. Yoksa null döner. */
export function oku(anahtar: string): string | null {
  if (macOS) {
    try {
      const cikti = execFileSync(
        "security",
        ["find-generic-password", "-s", SERVIS, "-a", anahtar, "-w"],
        { stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" },
      );
      return coz(cikti);
    } catch {
      // Anahtar Zinciri'nde yok — dosyaya bak.
    }
  }

  const deger = yedekOku()[anahtar];
  return deger === undefined ? null : coz(deger);
}

/** Kasadan bir değeri siler. */
export function sil(anahtar: string): void {
  if (macOS) {
    try {
      execFileSync(
        "security",
        ["delete-generic-password", "-s", SERVIS, "-a", anahtar],
        { stdio: "pipe" },
      );
    } catch {
      /* yoktu, sorun değil */
    }
  }

  const veri = yedekOku();
  if (anahtar in veri) {
    delete veri[anahtar];
    if (Object.keys(veri).length) yedekYaz(veri);
    else rmSync(yedekDosya, { force: true });
  }
}

/** Kasanın nerede tutulduğunu insan diliyle söyler (kurulum özeti için). */
export function kasaNerede(): string {
  return macOS ? "macOS Anahtar Zinciri" : `${yedekDosya} (izinler 0600)`;
}
