#!/usr/bin/env node
/**
 * Giriş noktası.
 *
 * Argümansız çalıştırıldığında MCP sunucusu olarak stdio üzerinden konuşur —
 * istemciler onu böyle başlatır. "kur" ile kurulum sihirbazı açılır.
 */
import { anahtarKomutu } from "./anahtar.js";
import { araclariTopla, SURUM, sunucuyuBaslat } from "./index.js";
import { durumKomutu, kaydetKomutu } from "./kaydet.js";
import { kurulumSihirbazi } from "./kur.js";
import { taraKomutu } from "./tara.js";

const YARDIM = `
  magaza-mcp — App Store Connect + Google Play için MCP sunucusu

  Kurulumu yapay zekâ asistanına yaptır. Asistan bu dört komutu sırayla
  çalıştırır; senin hiçbir şey yazman gerekmez:

    magaza-mcp tara             Makinede .p8 ve servis hesabı anahtarı ara
    magaza-mcp anahtar ...      Bulunan anahtarı doğrula ve kasaya yaz
    magaza-mcp kaydet           Sunucuyu istemcilerin ayarlarına ekle
    magaza-mcp durum            Neyin bağlı olduğunu doğrula

  Anahtar kaydı:
    magaza-mcp anahtar --apple-p8 <yol|-> --issuer-id <ID> [--key-id <ID>]
    magaza-mcp anahtar --play-json <yol|->
    magaza-mcp anahtar --sil appstore|play

    Yol yerine "-" verilirse içerik stdin'den okunur:
      pbpaste | magaza-mcp anahtar --play-json -
    Anahtar doğrulanmadan kasaya yazılmaz; ekrana hiç basılmaz.

  Sunucuyu kaydetme:
    magaza-mcp kaydet
      --magazalar appstore,play   Hangi mağazalar açık olsun
      --istemci claude-code,...   Hangi istemcilere yazılsın
                                  (verilmezse kurulu görünenlere yazar)

  Diğer:
    magaza-mcp kur              Elle kurulum sihirbazı (asistan yoksa)
    magaza-mcp araclar          Yüklü araçları listele
    magaza-mcp surum            Sürümü yazdır
    magaza-mcp                  MCP sunucusunu başlat (istemciler çağırır)

  Seçenekler:
    --salt-okunur               Veri değiştiren araçları tamamen kapat
    --json                      tara, durum ve anahtar için makine okunur çıktı

  Ortam değişkenleri:
    MAGAZALAR=appstore,play     Hangi mağazaların açık olduğu
    SALT_OKUNUR=1               --salt-okunur ile aynı

  İstemci anahtarları: claude-code, claude-desktop, antigravity,
                       cursor, windsurf, codex

  Ajanlar için ayrıntılı talimat: repodaki AGENTS.md
`;

async function main(): Promise<void> {
  const komut = process.argv[2];

  switch (komut) {
    case "kur":
    case "setup":
      await kurulumSihirbazi();
      break;

    case "tara":
    case "scan":
      taraKomutu();
      break;

    case "anahtar":
    case "key":
      await anahtarKomutu();
      break;

    case "kaydet":
    case "register":
      kaydetKomutu();
      break;

    case "durum":
    case "status":
      await durumKomutu();
      break;

    case "araclar":
    case "tools": {
      const araclar = araclariTopla();
      console.log(`\n  ${araclar.length} araç yüklü:\n`);
      for (const a of araclar) {
        console.log(`  ${a.yazma ? "✎" : " "} ${a.ad}`);
      }
      console.log("\n  ✎ = veri değiştirebilir\n");
      break;
    }

    case "surum":
    case "--version":
    case "-v":
      console.log(SURUM);
      break;

    case "yardim":
    case "--help":
    case "-h":
      console.log(YARDIM);
      break;

    case undefined:
      await sunucuyuBaslat();
      break;

    default:
      // Bilinmeyen bayraklar sunucuyu başlatmayı engellemesin (--salt-okunur gibi).
      if (komut.startsWith("-")) {
        await sunucuyuBaslat();
      } else {
        console.error(`Bilinmeyen komut: ${komut}`);
        console.error(YARDIM);
        process.exit(1);
      }
  }
}

main().catch((hata) => {
  console.error(hata instanceof Error ? hata.message : String(hata));
  process.exit(1);
});
