/**
 * MCP istemcilerinin ayar dosyalarını yazar.
 *
 * Her istemcinin ayrı bir dosyası ve ayrı bir biçimi var; kullanıcının bunları
 * tek tek elle düzenlemesi kurulumun en sıkıcı kısmı. Burası o işi üstlenir.
 *
 * Kural: mevcut ayarlara dokunulmaz, sadece kendi girdimiz eklenir/güncellenir
 * ve her yazmadan önce yedek alınır.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Istemci = {
  anahtar: string;
  isim: string;
  yol: string;
  bicim: "json" | "toml";
  /** JSON dosyasında sunucuların tutulduğu alan. */
  alan?: string;
  /**
   * Ayar dosyası henüz yokken "bu istemci kurulu" demeye yeten yollar.
   * Ayar dosyasının klasörü ev dizininin kendisi olduğunda gerekir.
   */
  ipucuYollari?: string[];
};

const ev = homedir();

export const ISTEMCILER: Istemci[] = [
  {
    anahtar: "claude-code",
    isim: "Claude Code",
    yol: join(ev, ".claude.json"),
    bicim: "json",
    alan: "mcpServers",
    // ~/.claude.json'un klasörü ev dizini; o her zaman var. Asıl işaret ~/.claude.
    ipucuYollari: [join(ev, ".claude")],
  },
  {
    anahtar: "claude-desktop",
    isim: "Claude Desktop",
    yol: join(ev, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    bicim: "json",
    alan: "mcpServers",
  },
  {
    anahtar: "antigravity",
    isim: "Antigravity (IDE + CLI)",
    yol: join(ev, ".gemini", "config", "mcp_config.json"),
    bicim: "json",
    alan: "mcpServers",
  },
  {
    anahtar: "cursor",
    isim: "Cursor",
    yol: join(ev, ".cursor", "mcp.json"),
    bicim: "json",
    alan: "mcpServers",
  },
  {
    anahtar: "windsurf",
    isim: "Windsurf",
    yol: join(ev, ".codeium", "windsurf", "mcp_config.json"),
    bicim: "json",
    alan: "mcpServers",
  },
  {
    anahtar: "codex",
    isim: "Codex",
    yol: join(ev, ".codex", "config.toml"),
    bicim: "toml",
  },
];

/** Bir istemcinin bu makinede kurulu görünüp görünmediği. */
export function kuruluMu(istemci: Istemci): boolean {
  // Ayar dosyası varsa kesin kurulu.
  if (existsSync(istemci.yol)) return true;
  if (istemci.ipucuYollari?.some((y) => existsSync(y))) return true;

  // Yoksa üst klasörüne bak. Ev dizininin kendisi her zaman var; onu
  // "kurulu" saymak bütün istemcileri kurulu göstermek olurdu.
  const klasor = dirname(istemci.yol);
  return klasor !== ev && existsSync(klasor);
}

export type SunucuGirdisi = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** Kurulacak sunucu girdisini üretir. Anahtarlar buraya girmez. */
export function sunucuGirdisi(magazalar: string[], saltOkunur = false): SunucuGirdisi {
  const args = ["-y", "magaza-mcp"];
  if (saltOkunur) args.push("--salt-okunur");

  return {
    command: "npx",
    args,
    // Sadece hangi mağazaların açık olduğu yazılır; kimlik bilgileri kasada.
    env: { MAGAZALAR: magazalar.join(",") },
  };
}

function yedekle(yol: string): void {
  if (existsSync(yol)) {
    copyFileSync(yol, `${yol}.magaza-mcp-yedek`);
  }
}

/**
 * Önce geçici dosyaya yazar, sonra yerine taşır.
 *
 * Doğrudan yazarken bir hata olursa (disk dolu, süreç öldü) kullanıcının
 * ayar dosyası yarım kalır. Taşıma işlemi ya tamamen olur ya hiç olmaz.
 */
function guvenliYaz(yol: string, icerik: string): void {
  const gecici = `${yol}.magaza-mcp-gecici`;
  // Dosya zaten varsa izinlerini koru; yenisini dar izinle oluştur.
  const izin = existsSync(yol) ? statSync(yol).mode & 0o777 : 0o600;
  try {
    writeFileSync(gecici, icerik, { mode: izin });
    renameSync(gecici, yol);
  } catch (h) {
    rmSync(gecici, { force: true });
    throw h;
  }
}

/** Bir metni TOML temel dizesine (tırnaklı) çevirir. */
function tomlDize(deger: string): string {
  const kacan = deger
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // Kalan kontrol karakterleri TOML'da çıplak duramaz.
    .replace(
      /[\u0000-\u001f\u007f]/g,
      (k) => `\\u${k.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return `"${kacan}"`;
}

/** TOML anahtarı; çıplak yazılamıyorsa tırnaklanır. */
function tomlAnahtar(ad: string): string {
  return /^[A-Za-z0-9_-]+$/.test(ad) ? ad : tomlDize(ad);
}

function jsonYaz(istemci: Istemci, girdi: SunucuGirdisi): void {
  mkdirSync(dirname(istemci.yol), { recursive: true });

  const bozukMesaj = (neden: string) =>
    new Error(
      `${istemci.isim} ayar dosyası okunamadı (${neden}): ${istemci.yol}\n` +
        "Elle düzeltip tekrar dene; dosyaya dokunmadım.",
    );

  let icerik: Record<string, any> = {};
  if (existsSync(istemci.yol)) {
    // Bazı düzenleyiciler dosyanın başına BOM koyar; JSON.parse onu sevmez.
    const ham = readFileSync(istemci.yol, "utf8").replace(/^\uFEFF/, "").trim();

    // Boş dosya bozuk değil, sadece henüz hiçbir ayar yok demek.
    if (ham) {
      let cozulen: unknown;
      try {
        cozulen = JSON.parse(ham);
      } catch {
        throw bozukMesaj("bozuk JSON");
      }
      if (typeof cozulen !== "object" || cozulen === null || Array.isArray(cozulen)) {
        throw bozukMesaj("kökü bir JSON nesnesi değil");
      }
      icerik = cozulen as Record<string, any>;
    }
  }

  const alan = istemci.alan || "mcpServers";
  const mevcut = icerik[alan];

  // Alan varsa nesne olmalı. Dizi/dize ise üzerine yazmak veri kaybı olur.
  if (mevcut != null && (typeof mevcut !== "object" || Array.isArray(mevcut))) {
    throw bozukMesaj(`"${alan}" alanı bir nesne değil`);
  }

  icerik[alan] = { ...(mevcut || {}), "magaza-mcp": girdi };

  yedekle(istemci.yol);
  guvenliYaz(istemci.yol, JSON.stringify(icerik, null, 2) + "\n");
}

function tomlYaz(istemci: Istemci, girdi: SunucuGirdisi): void {
  mkdirSync(dirname(istemci.yol), { recursive: true });

  const mevcut = existsSync(istemci.yol) ? readFileSync(istemci.yol, "utf8") : "";

  const blok =
    `[mcp_servers.magaza-mcp]\n` +
    `command = ${tomlDize(girdi.command)}\n` +
    `args = [${girdi.args.map(tomlDize).join(", ")}]\n` +
    `env = { ${Object.entries(girdi.env)
      .map(([k, v]) => `${tomlAnahtar(k)} = ${tomlDize(v)}`)
      .join(", ")} }\n`;

  /*
   * Eski girdimiz varsa onu değiştir, yoksa sona ekle.
   *
   * Başlık satır başında olmalı (yorum satırındaki "# [mcp_servers.magaza-mcp]"
   * eşleşmesin), blok da bir sonraki satır başı köşeli parantezine kadar sürer;
   * böylece komşu bloklar yenmez. Bitişteki $ çok satırlı değil, dizgenin
   * gerçek sonu — m bayrağıyla her satır sonuna takılmasın diye (?![\s\S]) var.
   */
  const desen = /^[ \t]*\[mcp_servers\.magaza-mcp\][\s\S]*?(?=\r?\n[ \t]*\[|$(?![\s\S]))/m;

  // Yerine koyarken işlev kullanılıyor: blokta geçen $& gibi diziler
  // replace tarafından özel kabul edilip metni bozmasın.
  const yeni = desen.test(mevcut)
    ? mevcut.replace(desen, () => blok.trimEnd() + "\n")
    : (mevcut.trimEnd() ? mevcut.trimEnd() + "\n\n" : "") + blok;

  yedekle(istemci.yol);
  guvenliYaz(istemci.yol, yeni);
}

/** Seçilen istemcilere sunucuyu kurar. Sonuçları tek tek döndürür. */
export function kur(
  secilenler: Istemci[],
  girdi: SunucuGirdisi,
): { istemci: Istemci; basarili: boolean; hata?: string }[] {
  return secilenler.map((istemci) => {
    try {
      if (istemci.bicim === "toml") tomlYaz(istemci, girdi);
      else jsonYaz(istemci, girdi);
      return { istemci, basarili: true };
    } catch (h) {
      return {
        istemci,
        basarili: false,
        hata: h instanceof Error ? h.message : String(h),
      };
    }
  });
}
