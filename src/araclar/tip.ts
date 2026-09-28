/** Tüm araçların ortak biçimi. */
export type Arac = {
  ad: string;
  aciklama: string;
  /** JSON Schema — MCP istemcisine olduğu gibi verilir. */
  girdiSemasi: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Veriyi değiştiren araçlar işaretlenir; onay kapısına takılırlar. */
  yazma?: boolean;
  calistir: (girdi: Record<string, any>) => Promise<unknown>;
};

/** Hangi mağazaların açık olduğu — kurulumda seçilir, ortamdan okunur. */
export function acikMagazalar(): { appstore: boolean; play: boolean } {
  const ham = (process.env.MAGAZALAR || "appstore,play").toLowerCase();
  return {
    appstore: ham.includes("appstore"),
    play: ham.includes("play"),
  };
}

/** Yazma işlemleri kapalı mı? (`--salt-okunur` veya SALT_OKUNUR=1) */
export function saltOkunur(): boolean {
  return (
    process.argv.includes("--salt-okunur") ||
    process.env.SALT_OKUNUR === "1"
  );
}
