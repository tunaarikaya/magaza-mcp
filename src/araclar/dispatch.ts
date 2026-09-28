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

/**
 * Bir yol parçasını güvenle kodlar.
 *
 * Yer tutucuya gelen değer kullanıcıdan/modelden geliyor; içinde `..` varsa
 * URL sınıfı yolu normalleştirirken isteği bambaşka bir uca yönlendiriyor:
 * `uygulama_id="../../v1/users"` ile `/v1/apps/{id}/builds` çağrısı
 * `/v1/users` oluyordu. `encodeURIComponent` eğik çizgiyi kodladığı için tek
 * başına yetmiyor — nokta karakterlerini kodlamaz. Bu yüzden `.` ve `..`
 * parçalarını ve boş parçaları doğrudan reddediyoruz.
 */
function yolParcasi(opAdi: string, ad: string, parca: string): string {
  if (parca === "" || parca === "." || parca === "..") {
    throw new Error(
      `'${opAdi}' çağrısında '${ad}' parametresi geçersiz bir yol parçası ` +
        `içeriyor (${parca === "" ? "boş" : parca}). Yol parametreleri kaynak ` +
        `kimliği olmalı; '.', '..' veya boş parça kabul edilmiyor.`,
    );
  }
  return encodeURIComponent(parca);
}

/** Yoldaki {yer tutucu}ları doldurur, kullanılanları sorgudan düşer. */
function yoluDoldur(
  op: Operasyon,
  parametreler: Record<string, any>,
): { yol: string; sorgu: Record<string, any> } {
  const sorgu: Record<string, any> = { ...parametreler };
  const eksikler: string[] = [];

  const yol = op.yol.replace(/\{(\+?)([^}]+)\}/g, (esles, arti, ad) => {
    const ham = sorgu[ad];
    // Boş dize de eksik sayılır: "/v1/apps//builds" gibi bozuk bir adres
    // üretip Apple'dan anlamsız bir 404 almaktansa burada durmak iyi.
    if (!(ad in sorgu) || ham === undefined || ham === null || ham === "") {
      eksikler.push(ad);
      return esles;
    }
    const deger = String(ham);
    delete sorgu[ad];

    // {+name} biçimindeki "reserved expansion" parametreleri kaynak yolunun
    // tamamını taşır (örn. "apps/com.ornek.uygulama/anomalies"); eğik
    // çizgileri kodlarsak adres bozulur. Ters eğik çizgi de URL sınıfında
    // ayırıcı sayıldığı için aynı muameleyi görür.
    return arti
      ? deger
          .split(/[/\\]/)
          .map((parca) => yolParcasi(op.ad, ad, parca))
          .join("/")
      : yolParcasi(op.ad, ad, deger);
  });

  if (eksikler.length) {
    const yolAdlari = [...op.yol.matchAll(/\{\+?([^}]+)\}/g)].map((m) => m[1]);
    throw new Error(
      `'${op.ad}' için zorunlu yol parametresi eksik: ${eksikler.join(", ")}\n` +
        `Yol: ${op.yol}\n` +
        `Yol parametreleri: ${yolAdlari.join(", ")}\n` +
        `Tüm parametreler: ${op.parametreler.map((p) => p.ad).join(", ")}`,
    );
  }

  return { yol, sorgu };
}

/**
 * Kalan parametreleri sorgu dizesine çevirir.
 *
 * İki mağazanın dizi/nesne beklentisi farklı, HTTP istemcileri ise elindeki
 * değeri `String()`'e verip geçiyor. Bu yüzden sorgu dizesini burada,
 * operasyonun hangi mağazaya ait olduğunu bilerek kuruyoruz:
 *
 *  - Apple (JSON:API): `fields[apps]=name,bundleId` — diziler virgülle
 *    birleşir. Parametre adları zaten `filter[bundleId]` gibi köşeli
 *    parantezli; model iç içe nesne verirse ({filter:{bundleId:"..."}})
 *    onu da aynı biçime düzleştiriyoruz, yoksa "[object Object]" gidiyordu.
 *  - Google: tekrarlanabilir parametreler `?productIds=a&productIds=b`
 *    biçiminde YİNELENİR. Virgülle birleştirmek `inappproducts.batchGet`,
 *    `orders.batchget`, `monetization.subscriptions.batchGet` ve
 *    `monetization.onetimeproducts.batchGet` çağrılarını tek (ve yanlış)
 *    kimlikle gönderiyordu.
 */
function sorguDizesi(
  magaza: "appstore" | "play",
  sorgu: Record<string, any>,
): string {
  const alanlar = new URLSearchParams();

  const ekle = (ad: string, deger: unknown): void => {
    if (deger === undefined || deger === null) return;

    if (Array.isArray(deger)) {
      if (magaza === "play") {
        for (const tek of deger) ekle(ad, tek);
      } else {
        alanlar.append(ad, deger.map((x) => String(x)).join(","));
      }
      return;
    }

    if (typeof deger === "object") {
      if (magaza === "appstore") {
        for (const [alt, altDeger] of Object.entries(deger)) {
          // filter -> filter[bundleId]; zaten parantezliyse dokunma.
          ekle(ad.includes("[") ? `${ad}.${alt}` : `${ad}[${alt}]`, altDeger);
        }
      } else {
        alanlar.append(ad, JSON.stringify(deger));
      }
      return;
    }

    alanlar.append(ad, String(deger));
  };

  for (const [ad, deger] of Object.entries(sorgu)) ekle(ad, deger);

  return alanlar.toString();
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

/**
 * İkinci emniyet: ekin adı kadar operasyonun kendi açıklaması da okuma
 * demeli. Google ileride `:batchGet` gibi görünen ama yazan bir uç eklerse
 * tek başına ek adına güvenmek onay kapısını sessizce deler; açıklama
 * "Reads / Queries / Searches / Gets / Lists" ile başlamıyorsa yazma sayıp
 * onay isteriz. Bugünkü 19 ucun 19'u bu kalıba uyuyor.
 */
const OKUMA_OZETI = /^(read|quer|search|look ?up|get|list|fetch|retriev)/i;

function yazmaIslemiMi(op: Operasyon): boolean {
  if (!YAZMA_YONTEMLERI.has(op.yontem)) return false;
  if (
    op.yontem === "POST" &&
    OKUYAN_POST_EKLERI.some((ek) => op.yol.endsWith(ek)) &&
    OKUMA_OZETI.test(op.ozet.trim())
  ) {
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
          eskimis: s.eskimis || undefined,
          parametreler: s.parametreler.map(
            (p) =>
              `${p.ad}${p.gerekli ? "*" : ""} (${p.konum}${p.cok ? ", dizi" : ""})`,
          ),
          govde_var: !!s.govdeRef,
        })),
        not:
          "* işaretli parametreler zorunlu; '(query, dizi)' olanlara liste ver. " +
          "eskimis=true olan uçları ancak yerine geçen yoksa kullan. " +
          "Çalıştırmak için magaza__cagir kullan.",
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
        // Onay ekranında ham şablon (`PATCH /v1/apps/{id}`) göstermek
        // kullanıcıya neyi onayladığını söylemiyor: hangi uygulama, hangi
        // kimlik, hangi değerler? Yolu burada çözüp gövdeyi de gösteriyoruz.
        let islem = `${op.yontem} ${op.yol}`;
        let cozulemedi: string | undefined;
        try {
          const onizleme = yoluDoldur(op, girdi.parametreler || {});
          const dize = sorguDizesi(magaza, onizleme.sorgu);
          islem = `${op.yontem} ${onizleme.yol}${dize ? `?${dize}` : ""}`;
        } catch (hata) {
          cozulemedi = (hata as Error).message;
        }

        return {
          onay_gerekli: true,
          islem,
          ozet: op.ozet,
          eskimis: op.eskimis || undefined,
          gonderilecek_govde: girdi.govde,
          parametre_hatasi: cozulemedi,
          uyari:
            "Bu işlem veri değiştirir. Yukarıdaki adresi ve gövdeyi olduğu " +
            "gibi kullanıcıya göster, onayını al, sonra aynı çağrıyı " +
            "onayla=true ile tekrarla.",
          beklenen_govde: girdi.govde === undefined
            ? (govdeSemasi(magaza, op) ?? undefined)
            : undefined,
        };
      }

      const { yol, sorgu } = yoluDoldur(op, girdi.parametreler || {});

      // Sorgu dizesi yolun içine gömülüyor; istemcilerin `Record` arayüzü
      // Google'ın yinelenen parametrelerini ifade edemiyor (bkz. sorguDizesi).
      const dize = sorguDizesi(magaza, sorgu);
      const istek = {
        yontem: op.yontem,
        yol: dize ? `${yol}?${dize}` : yol,
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
        eskimis: op.eskimis || undefined,
        parametreler: op.parametreler,
        govde_semasi: govdeSemasi(magaza, op) ?? "Bu operasyon gövde almıyor.",
      };
    },
  });

  return araclar;
}
