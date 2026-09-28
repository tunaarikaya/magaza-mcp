/**
 * Dispatch araçları — katalogdaki 1281 operasyonun tamamına açılan kapı.
 *
 * Seçilmiş araçlar günlük işin çoğunu görür; geri kalan uzun kuyruk için
 * model önce `magaza__endpoint_ara` ile arar, sonra `magaza__cagir` ile
 * çağırır. Böylece tam kapsam, birkaç bin token'lık araç tanımıyla sağlanır.
 */
import { cagir as appleCagir } from "../istemci/apple.js";
import { cagir as playCagir } from "../istemci/play.js";
import { ara, govdeSemasi, operasyonBul, katalog } from "../katalog/yukle.js";
import type { Operasyon } from "../katalog/yukle.js";
import { acikMagazalar, saltOkunur, type Arac } from "./tip.js";

/** Yoldaki {yer tutucu}ları doldurur, kullanılanları sorgudan düşer. */
function yoluDoldur(
  op: Operasyon,
  parametreler: Record<string, any>,
): { yol: string; sorgu: Record<string, any> } {
  const sorgu: Record<string, any> = { ...parametreler };

  const yol = op.yol.replace(/\{(\+?)([^}]+)\}/g, (_esles, arti, ad) => {
    if (!(ad in sorgu)) {
      throw new Error(
        `'${op.ad}' için zorunlu yol parametresi eksik: ${ad}\n` +
          `Beklenen parametreler: ${op.parametreler.map((p) => p.ad).join(", ")}`,
      );
    }
    const deger = String(sorgu[ad]);
    delete sorgu[ad];

    // {+name} biçimindeki "reserved expansion" parametreleri kaynak yolunun
    // tamamını taşır (örn. "apps/com.ornek.uygulama/anomalies"); eğik
    // çizgileri kodlarsak adres bozulur.
    return arti
      ? deger.split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(deger);
  });

  return { yol, sorgu };
}

const YAZMA_YONTEMLERI = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Google'ın POST ile çağrılan ama hiçbir şey değiştirmeyen uçları.
 *
 * Android vitals sorguları (`:query`) ve toplu okuma uçları (`:batchGet`)
 * gövdeyle parametre aldıkları için POST; yine de salt okuma. Bunları yazma
 * sayarsak crash oranı okumak bile onay ister, salt-okunur modda ise hiç
 * çalışmaz. `:batchMigratePrices` gibi gerçek toplu yazma uçları bu listeye
 * girmesin diye ek adı tam olarak eşleştiriliyor.
 */
const OKUYAN_POST_EKLERI = [":query", ":batchGet", ":search", ":lookup"];

function yazmaIslemiMi(op: Operasyon): boolean {
  if (!YAZMA_YONTEMLERI.has(op.yontem)) return false;
  if (op.yontem === "POST" && OKUYAN_POST_EKLERI.some((ek) => op.yol.endsWith(ek))) {
    return false;
  }
  return true;
}

export function dispatchAraclari(): Arac[] {
  const acik = acikMagazalar();
  const magazaListesi = [
    acik.appstore ? "appstore" : null,
    acik.play ? "play" : null,
  ].filter(Boolean) as string[];

  const kapsamNotu =
    magazaListesi.length === 2
      ? "App Store Connect ve Google Play"
      : magazaListesi[0] === "appstore"
        ? "App Store Connect"
        : "Google Play";

  const araclar: Arac[] = [];

  /* ---------------- endpoint_ara ---------------- */

  araclar.push({
    ad: "magaza__endpoint_ara",
    aciklama:
      `${kapsamNotu} API'lerinin tamamında uç nokta arar. ` +
      "Hazır araçlar arasında işini görecek bir şey yoksa önce bunu kullan: " +
      "aradığın işlemin gerçek operasyon adını, parametrelerini ve HTTP " +
      "yöntemini döndürür. Sonucu magaza__cagir ile çalıştırabilirsin. " +
      "Örnek sorgular: 'abonelik fiyat', 'testflight tester', 'crash rate'.",
    girdiSemasi: {
      type: "object",
      properties: {
        sorgu: {
          type: "string",
          description:
            "Aranacak kelimeler. Türkçe değil, API terimleriyle ara " +
            "(örn. 'subscription price', 'review', 'build').",
        },
        magaza: {
          type: "string",
          enum: magazaListesi,
          description: "Belirtilmezse iki mağazada birden aranır.",
        },
        limit: {
          type: "number",
          description: "Kaç sonuç dönsün (varsayılan 15).",
        },
      },
      required: ["sorgu"],
    },
    async calistir(girdi) {
      const sonuclar = ara(girdi.sorgu, {
        magaza: girdi.magaza,
        limit: girdi.limit,
      });

      if (sonuclar.length === 0) {
        const toplam = magazaListesi
          .map((m) => katalog(m as any).operasyonlar.length)
          .reduce((a, b) => a + b, 0);
        return {
          bulunan: 0,
          not:
            `'${girdi.sorgu}' için sonuç yok (${toplam} operasyon tarandı). ` +
            "Daha genel veya İngilizce terimlerle dene.",
        };
      }

      return {
        bulunan: sonuclar.length,
        sonuclar: sonuclar.map((s) => ({
          magaza: s.magaza,
          operasyon: s.ad,
          yontem: s.yontem,
          yol: s.yol,
          ozet: s.ozet,
          yazma_islemi: yazmaIslemiMi(s),
          parametreler: s.parametreler.map(
            (p) => `${p.ad}${p.gerekli ? "*" : ""} (${p.konum})`,
          ),
          govde_var: !!s.govdeRef,
        })),
        not: "* işaretli parametreler zorunlu. Çalıştırmak için magaza__cagir kullan.",
      };
    },
  });

  /* ---------------- cagir ---------------- */

  araclar.push({
    ad: "magaza__cagir",
    aciklama:
      `${kapsamNotu} API'lerinde herhangi bir operasyonu çalıştırır. ` +
      "Operasyon adını önce magaza__endpoint_ara ile bul. " +
      "Veri değiştiren işlemler (POST/PATCH/PUT/DELETE) onayla=true " +
      "verilmeden çalışmaz.",
    girdiSemasi: {
      type: "object",
      properties: {
        magaza: {
          type: "string",
          enum: magazaListesi,
          description: "Hangi mağaza.",
        },
        operasyon: {
          type: "string",
          description: "magaza__endpoint_ara sonucundaki 'operasyon' değeri.",
        },
        parametreler: {
          type: "object",
          description:
            "Yol ve sorgu parametreleri tek bir nesnede. Yol parametreleri " +
            "otomatik yerine konur, kalanlar sorgu dizesine eklenir.",
        },
        govde: {
          type: "object",
          description: "İstek gövdesi (POST/PATCH için).",
        },
        onayla: {
          type: "boolean",
          description:
            "Veri değiştiren işlemler için true olmalı. Kullanıcı işlemi " +
            "açıkça istemeden true verme.",
        },
      },
      required: ["magaza", "operasyon"],
    },
    // Bilerek `yazma` işaretlenmiyor: bu araç okumak için de tek kapı.
    // İşaretlersek salt-okunur modda araç listeden tamamen düşer ve
    // katalogdaki bütün uçlar okunamaz hale gelir. Yazma koruması operasyon
    // bazında aşağıda yapılıyor.
    async calistir(girdi) {
      const magaza = girdi.magaza as "appstore" | "play";
      const op = operasyonBul(magaza, girdi.operasyon);

      if (!op) {
        const yakin = ara(girdi.operasyon.replace(/[._-]/g, " "), {
          magaza,
          limit: 5,
        });
        throw new Error(
          `'${girdi.operasyon}' diye bir operasyon yok.` +
            (yakin.length
              ? `\nBunlar mı demek istedin?\n  ${yakin.map((y) => y.ad).join("\n  ")}`
              : "\nmagaza__endpoint_ara ile arayabilirsin."),
        );
      }

      const yazma = yazmaIslemiMi(op);

      if (yazma && saltOkunur()) {
        throw new Error(
          "Sunucu salt-okunur modda; veri değiştiren işlemler kapalı.",
        );
      }

      if (yazma && girdi.onayla !== true) {
        const sema = govdeSemasi(magaza, op);
        return {
          onay_gerekli: true,
          islem: `${op.yontem} ${op.yol}`,
          ozet: op.ozet,
          uyari:
            "Bu işlem veri değiştirir. Kullanıcıya ne yapılacağını anlat, " +
            "onayını al, sonra aynı çağrıyı onayla=true ile tekrarla.",
          beklenen_govde: sema ?? undefined,
        };
      }

      const { yol, sorgu } = yoluDoldur(op, girdi.parametreler || {});

      const istek = {
        yontem: op.yontem,
        yol,
        sorgu,
        govde: girdi.govde,
      };

      return magaza === "appstore"
        ? appleCagir(istek)
        : playCagir({ ...istek, api: op.api ?? "publisher" });
    },
  });

  /* ---------------- sema ---------------- */

  araclar.push({
    ad: "magaza__sema",
    aciklama:
      "Bir operasyonun istek gövdesinin nasıl olması gerektiğini gösterir. " +
      "POST/PATCH çağrılarından önce, gövdeyi doğru kurmak için kullan.",
    girdiSemasi: {
      type: "object",
      properties: {
        magaza: { type: "string", enum: magazaListesi },
        operasyon: { type: "string" },
      },
      required: ["magaza", "operasyon"],
    },
    async calistir(girdi) {
      const magaza = girdi.magaza as "appstore" | "play";
      const op = operasyonBul(magaza, girdi.operasyon);
      if (!op) throw new Error(`'${girdi.operasyon}' diye bir operasyon yok.`);

      return {
        operasyon: op.ad,
        yontem: op.yontem,
        yol: op.yol,
        ozet: op.ozet,
        parametreler: op.parametreler,
        govde_semasi: govdeSemasi(magaza, op) ?? "Bu operasyon gövde almıyor.",
      };
    },
  });

  return araclar;
}
