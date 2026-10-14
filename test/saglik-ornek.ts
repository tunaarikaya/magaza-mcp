/** Hesap sağlığı kural testleri için sahte veri — ağ yok. Varsayılanlar "temiz" bir uygulamadır. */
import type { Uygulama, Veri } from "../src/araclar/saglik/tip.js";

export const SIMDI = "2026-10-14T12:00:00Z";

export function ornekUygulama(id: string, ust: Partial<Uygulama> = {}): Uygulama {
  return {
    id,
    ad: `Uygulama ${id}`,
    bundleId: `com.ornek.${id}`,
    anaDil: "en-US",
    icerikHaklari: "DOES_NOT_USE_THIRD_PARTY_CONTENT",
    bilgiler: [
      {
        id: `ai-${id}`,
        durum: "READY_FOR_DISTRIBUTION",
        duzenlenebilir: false,
        kategori: "PRODUCTIVITY",
        yerel: [{ id: `ail-${id}`, dil: "en-US", ad: `Uygulama ${id}`, altBaslik: "Plan your day", gizlilikUrl: "https://ornek.com/gizlilik" }],
      },
    ],
    surumler: [
      { id: `v-${id}`, surum: "1.2", durum: "READY_FOR_DISTRIBUTION", magazaDurumu: "READY_FOR_SALE", olusturma: "2026-08-01T00:00:00Z", copyright: "© 2026 Ornek Ltd" },
    ],
    hedefSurumId: `v-${id}`,
    hedefSurumDuzenlenebilir: false,
    surumYerel: [
      {
        id: `vl-${id}`,
        dil: "en-US",
        aciklama: `A calm planner number ${id} that helps you organise tasks and notes.`,
        anahtarKelimeler: "planner,tasks,todo,notes",
        destekUrl: "https://ornek.com/destek",
      },
    ],
    ekranGoruntuleri: [{ dil: "en-US", checksum: `cs-${id}`, tur: "APP_IPHONE_67" }],
    incelemeDetayi: { id: `rd-${id}`, notlar: "Tap + to add a task. No login required.", demoGerekli: false, eposta: "dev@ornek.com" },
    gonderimler: [{ id: `rs-${id}`, durum: "COMPLETE", tarih: "2026-08-02T00:00:00Z" }],
    yorumlar: [],
    urunler: [],
    buildler: [{ id: `b-${id}`, surum: "12", yuklenme: "2026-08-01T00:00:00Z", sifreleme: false, durum: "VALID" }],
    bolgeDurumlari: {},
    yasBeyani: null,
    ...ust,
  };
}

export function ornekVeri(ust: Partial<Veri> = {}): Veri {
  return {
    simdi: SIMDI,
    derin: false,
    uygulamalar: [ornekUygulama("1")],
    kullanicilar: [{ id: "u1", roller: ["ACCOUNT_HOLDER", "ADMIN"], tumUygulamalar: true }],
    davetler: [],
    hatalar: {},
    ...ust,
  };
}
