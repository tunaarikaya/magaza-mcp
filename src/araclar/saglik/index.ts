/**
 * Apple geliştirici hesabının "kapatılma / kaldırılma / uzun inceleme" riskini tarar.
 *
 * API Apple'ın iç işaretlerini göstermez; burada üretilen her şey risk
 * sinyalidir, hüküm değil. Çıktıdaki `goremediklerim` bunu kullanıcıya söyler.
 */
import { metin, onaySemasi } from "../appstore.js";
import type { Arac } from "../tip.js";
import { AGIRLIK, analizEt, bolumOf, puanla } from "./analiz.js";
import { hesapDuzelt } from "./duzelt.js";
import { hesapVerisiTopla } from "./topla.js";
import { BOLUMLER, KURALLAR, type Bolum, type Bulgu, type Ciddiyet } from "./tip.js";

const BOLUM_ADI: Record<Bolum, string> = {
  klon: "Klon / spam (4.3)",
  metadata: "Metadata & marka (2.3 / 5.2)",
  yorum_para: "Yorum & para (5.6 / 3.1)",
  inceleme_hesap: "İnceleme geçmişi & hesap",
};

const SEVIYE = (p: number) => (p >= 60 ? "🔴 YÜKSEK" : p >= 25 ? "🟡 ORTA" : "🟢 DÜŞÜK");

const GOREMEDIKLERIM = [
  "Apple'ın hesabına koyduğu iç işaretler (flag) — API bunları hiçbir yerde vermez.",
  "Resolution Center mesajları ve red gerekçeleri — API yalnızca 'reddedildi' durumunu verir, sebebini değil.",
  "Sözleşme, vergi ve banka durumu; Pending Termination bildirimleri (e-postana gelir).",
  "Gizlilik etiketi (privacy nutrition label), uygulama içi hesap silme, gizli özellikler, zorla puan isteme — uygulamanın içi görülemez.",
  "Bağlantılı hesaplar: aynı cihaz, kart, IP ya da freelancer üzerinden kapatılmış bir hesaba bağlanmak — açıklamasız kapatmaların en sık sebebi ve API'de görünmez.",
];

const TAVSIYE = [
  "Apple 'Pending Termination' bildirimi gönderirse genelde 14 gün (bazen 30) içinde App Review Board'a itiraz hakkın var; süreyi kaçırma.",
  "Bildirim aldıktan sonra yeni hesap açma — Apple bunu 'bağlantılı hesap' sayıp onu da kapatır.",
  "Hesabına erişimi olan freelancer'ları ve devraldığın (transfer) uygulamaları gözden geçir; kapatılmış bir hesapla bağın senin hesabını da yakar.",
];

const ETIKET: Record<Ciddiyet, string> = { kritik: "KRİTİK", yuksek: "YÜKSEK", orta: "ORTA", dusuk: "DÜŞÜK" };

const cubuk = (p: number) => "█".repeat(Math.round(p / 10)) + "░".repeat(10 - Math.round(p / 10));

function disaVer(b: Bulgu) {
  return {
    id: b.id,
    ciddiyet: b.ciddiyet,
    bolum: bolumOf(b),
    madde: KURALLAR[b.kural].madde,
    uygulama: b.uygulama,
    baslik: b.baslik,
    neden: b.neden,
    kanit: b.kanit,
    cozum: {
      otomatik: !!b.duzeltme && !b.duzeltme.engel,
      adimlar: b.adimlar,
      ...(b.duzeltme?.gerekenDeger ? { gereken_deger: b.duzeltme.gerekenDeger } : {}),
      ...(b.duzeltme?.engel ? { engel: b.duzeltme.engel } : {}),
    },
  };
}

function bolumleriAyikla(ham: unknown): Bolum[] {
  if (ham == null || ham === "") return BOLUMLER;
  const liste = (Array.isArray(ham) ? ham : String(ham).split(",")).map((s) => String(s).trim());
  const gecersiz = liste.filter((s) => !BOLUMLER.includes(s as Bolum));
  if (gecersiz.length) throw new Error(`Geçersiz bolum: ${gecersiz.join(", ")}. Geçerli: ${BOLUMLER.join(", ")}`);
  return liste as Bolum[];
}

export function saglikAraclari(): Arac[] {
  return [
    {
      ad: "appstore__hesap_sagligi",
      aciklama:
        "Apple geliştirici hesabını tarar ve hesabın kapatılma, uygulama kaldırılma ya da incelemenin " +
        "uzaması riskini 0-100 puanla ölçer: klon/spam (aynı ekran görüntüleri, benzer isimler), marka ve " +
        "metadata ihlalleri, şikâyet ve sahte yorum sinyalleri, iade oranı, red geçmişi, uzun bekleyen " +
        "inceleme, eksik beyanlar. Her bulgu Apple maddesi, neden tehlikeli olduğu ve çözüm adımlarıyla " +
        "gelir; 'otomatik' olanlar appstore__hesap_duzelt ile düzeltilebilir. Salt okunur. Kullanıcıya " +
        "önce rapor_metni'ni göster, sonra en kritik bulgulardan başlayarak açıkla.",
      girdiSemasi: {
        type: "object",
        properties: {
          uygulama: metin(
            "İsteğe bağlı: tek uygulamayı tara (Apple id, bundle id ya da ad). Verilmezse tüm hesap; " +
              "klon tespiti için tüm hesap gerekir.",
          ),
          bolum: {
            type: "array",
            items: { type: "string", enum: BOLUMLER },
            description: "İsteğe bağlı: yalnızca bu bölümler. Verilmezse hepsi.",
          },
          satici_no: metin(
            "İsteğe bağlı: Vendor number (App Store Connect → Ödemeler ve Finansal Raporlar). Verilirse " +
              "iade oranı ve 12 aylık indirme kontrolü de yapılır.",
          ),
          derin: {
            type: "boolean",
            description: "true: tüm diller ve uygulama başına 1000 yorum (yavaş). Varsayılan: ana dil + en-US, 200 yorum.",
          },
        },
      },
      calistir: async (girdi) => {
        const bolumler = bolumleriAyikla(girdi.bolum);
        const veri = await hesapVerisiTopla({
          uygulama: girdi.uygulama ? String(girdi.uygulama) : undefined,
          bolumler,
          derin: girdi.derin === true,
          saticiNo: girdi.satici_no ? String(girdi.satici_no) : undefined,
        });
        const { bulgular, hatalar } = analizEt(veri, bolumler);
        const puan = puanla(bulgular);

        const kategoriler = bolumler.map((b) => {
          const ait = bulgular.filter((x) => bolumOf(x) === b);
          const enCiddi = (["kritik", "yuksek", "orta", "dusuk"] as Ciddiyet[]).find((c) =>
            ait.some((x) => x.ciddiyet === c),
          );
          return { bolum: b, ad: BOLUM_ADI[b], puan: puanla(ait), bulgu_sayisi: ait.length, en_ciddi: enCiddi ?? null };
        });

        const rapor = [
          `HESAP RİSKİ: ${puan}/100  ${SEVIYE(puan)}`,
          "",
          ...kategoriler.map(
            (k) => `${k.ad.padEnd(30)} ${cubuk(k.puan)}  ${k.en_ciddi ? ETIKET[k.en_ciddi].toLocaleLowerCase("tr") : "temiz"} (${k.bulgu_sayisi})`,
          ),
          "",
          ...bulgular
            .slice(0, 15)
            .map((b, i) => `${i + 1}. [${ETIKET[b.ciddiyet]}] ${b.uygulama ? b.uygulama.ad + ": " : ""}${b.baslik}`),
          ...(bulgular.length > 15 ? [`… ve ${bulgular.length - 15} bulgu daha`] : []),
          ...(bulgular.length === 0 ? ["Taranan alanlarda risk sinyali bulunamadı."] : []),
        ].join("\n");

        return {
          puan,
          seviye: SEVIYE(puan),
          rapor_metni: rapor,
          kategoriler,
          bulgular: bulgular.map(disaVer),
          otomatik_duzeltilebilir: bulgular.filter((b) => b.duzeltme && !b.duzeltme.engel).map((b) => b.id),
          puanlama:
            `Her bulgu bağımsız risk sayılır (kritik %${AGIRLIK.kritik} · yüksek %${AGIRLIK.yuksek} · ` +
            `orta %${AGIRLIK.orta} · düşük %${AGIRLIK.dusuk}); puan = en az birinin gerçekleşme olasılığı.`,
          goremediklerim: GOREMEDIKLERIM,
          tavsiye: TAVSIYE,
          taranan: {
            uygulama: veri.uygulamalar.length,
            yorum: veri.uygulamalar.reduce((t, u) => t + u.yorumlar.length, 0),
            derin: veri.derin,
            ...(girdi.uygulama ? { not: "Tek uygulama tarandı; uygulamalar arası klon tespiti yapılmadı." } : {}),
          },
          ...(Object.keys({ ...veri.hatalar, ...hatalar }).length ? { hatalar: { ...veri.hatalar, ...hatalar } } : {}),
        };
      },
    },
    {
      ad: "appstore__hesap_duzelt",
      aciklama:
        "appstore__hesap_sagligi'nın bulduğu sorunları düzeltir. Bulgu id'lerini al; önce ne değişeceğini " +
        "(şimdi → yeni) gösterir, onayla=true ile uygular. Değer isteyen bulgularda (gizlilik URL'si, " +
        "copyright, demo hesap…) değeri `degerler`'e bulgu id'siyle ver. Düzenlenebilir sürüm yoksa yeni " +
        "sürüm açmaz, söyler. Satıştan kaldırma ve rol değiştirme yapmaz — onlar için rehber verir.",
      girdiSemasi: {
        type: "object",
        properties: {
          bulgular: { type: "array", items: { type: "string" }, description: "Düzeltilecek bulgu id'leri." },
          degerler: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Değer isteyen bulgular için { bulgu_id: değer }.",
          },
          onayla: onaySemasi,
        },
        required: ["bulgular"],
      },
      yazma: true,
      calistir: (girdi) => hesapDuzelt(girdi),
    },
  ];
}
