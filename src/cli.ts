#!/usr/bin/env node
/**
 * Giriş noktası.
 *
 * Argümansız çalıştırıldığında MCP sunucusu olarak stdio üzerinden konuşur —
 * istemciler onu böyle başlatır. "kur" ile kurulum sihirbazı açılır.
 */
import { araclariTopla, SURUM, sunucuyuBaslat } from "./index.js";
import { durumKomutu, kaydetKomutu } from "./kaydet.js";
import { kurulumSihirbazi } from "./kur.js";

const YARDIM = `
  magaza-mcp — App Store Connect + Google Play için MCP sunucusu

  Kullanım:
    npx magaza-mcp kur          Kurulum sihirbazı (buradan başla)
    npx magaza-mcp durum        Neyin bağlı olduğunu göster
    npx magaza-mcp araclar      Yüklü araçları listele
    npx magaza-mcp surum        Sürümü yazdır
    npx magaza-mcp              MCP sunucusunu başlat (istemciler çağırır)

  Yapay zekâ ajanları için (kimlik bilgisi istemez, sormaz):
    npx magaza-mcp kaydet       Sunucuyu istemcilerin ayarlarına yaz
      --magazalar appstore,play   Hangi mağazalar açık olsun
      --istemci claude-code,...   Hangi istemcilere yazılsın
                                  (verilmezse kurulu görünenlere yazar)
    npx magaza-mcp durum --json Durumu makine okunur biçimde ver

    Anahtar girme işi ajana ait değildir: onu kullanıcı "kur" ile yapar,
    anahtar makineden çıkmaz. Ayrıntı için repodaki AGENTS.md.

  Seçenekler:
    --salt-okunur               Veri değiştiren araçları tamamen kapat

  Ortam değişkenleri:
    MAGAZALAR=appstore,play     Hangi mağazaların açık olduğu
    SALT_OKUNUR=1               --salt-okunur ile aynı

  İstemci anahtarları: claude-code, claude-desktop, antigravity,
                       cursor, windsurf, codex
`;

async function main(): Promise<void> {
  const komut = process.argv[2];

  switch (komut) {
    case "kur":
    case "setup":
      await kurulumSihirbazi();
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
