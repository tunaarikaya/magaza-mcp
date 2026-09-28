/**
 * MCP sunucusu.
 *
 * Hangi araçların sunulacağı kurulumda seçilen mağazalara göre belirlenir:
 * sadece App Store seçildiyse hiçbir play__ aracı yüklenmez, tersi de geçerli.
 * Böylece tek paket olmasına rağmen iki mağaza birbirine karışmaz.
 */
import { createRequire } from "node:module";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { appstoreAraclari } from "./araclar/appstore.js";
import { dispatchAraclari } from "./araclar/dispatch.js";
import { ortakAraclar } from "./araclar/ortak.js";
import { playAraclari } from "./araclar/play.js";
import { acikMagazalar, saltOkunur, type Arac } from "./araclar/tip.js";

/**
 * Sürüm tek kaynaktan okunur.
 *
 * Elle iki yere yazılırsa biri güncellenmeden kalır ve hem `magaza-mcp surum`
 * hem de MCP el sıkışması yanlış sürüm bildirir.
 */
export const SURUM: string = createRequire(import.meta.url)(
  "../../package.json",
).version;

/**
 * Araç istemciye "veri değiştirebilir" diye bildirilmeli mi?
 *
 * `yazma` bayrağı salt-okunur modda aracın listeden düşürülmesi için var.
 * `magaza__cagir` bilerek o bayrağı taşımıyor — salt-okunur modda da
 * katalogdaki okuma operasyonlarına erişim ondan geçiyor — ama katalogdaki
 * her yazma operasyonunu çalıştırabilen tek araç yine o. İstemciye
 * "zararsız okuma" diye tanıtmak, onun onay arayüzünü yanıltmak olurdu.
 */
function yazabilirMi(arac: Arac): boolean {
  return !!arac.yazma || arac.ad === "magaza__cagir";
}

export function araclariTopla(): Arac[] {
  const acik = acikMagazalar();
  const hepsi: Arac[] = [];

  if (acik.appstore) hepsi.push(...appstoreAraclari());
  if (acik.play) hepsi.push(...playAraclari());
  hepsi.push(...ortakAraclar());
  hepsi.push(...dispatchAraclari());

  return saltOkunur() ? hepsi.filter((a) => !a.yazma) : hepsi;
}

export async function sunucuyuBaslat(): Promise<void> {
  const araclar = araclariTopla();
  const kayit = new Map(araclar.map((a) => [a.ad, a]));

  const sunucu = new Server(
    { name: "magaza-mcp", version: SURUM },
    { capabilities: { tools: {} } },
  );

  sunucu.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: araclar.map((a) => ({
      name: a.ad,
      description: a.aciklama,
      inputSchema: a.girdiSemasi,
      // MCP istemcileri kendi onay arayüzlerini bu ipuçlarına göre kurar.
      // Bunları göndermezsek istemci hangi aracın veri değiştirdiğini bilemez
      // ve okuma ile yazmayı aynı kefeye koyar.
      annotations: {
        readOnlyHint: !yazabilirMi(a),
        destructiveHint: yazabilirMi(a),
        openWorldHint: true,
      },
    })),
  }));

  sunucu.setRequestHandler(CallToolRequestSchema, async (istek) => {
    const arac = kayit.get(istek.params.name);

    if (!arac) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Bilinmeyen araç: ${istek.params.name}` },
        ],
      };
    }

    try {
      const sonuc = await arac.calistir(
        (istek.params.arguments as Record<string, any>) || {},
      );
      return {
        content: [{ type: "text", text: JSON.stringify(sonuc, null, 2) }],
      };
    } catch (hata) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: hata instanceof Error ? hata.message : String(hata),
          },
        ],
      };
    }
  });

  await sunucu.connect(new StdioServerTransport());

  // stdout MCP protokolüne ait; günlükler stderr'e.
  const acik = acikMagazalar();
  const magazalar = [
    acik.appstore ? "App Store Connect" : null,
    acik.play ? "Google Play" : null,
  ]
    .filter(Boolean)
    .join(" + ");

  console.error(
    `magaza-mcp hazır — ${magazalar} · ${araclar.length} araç` +
      (saltOkunur() ? " · salt-okunur" : ""),
  );
}
