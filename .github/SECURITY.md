# Güvenlik

`magaza-mcp` mağaza hesaplarınıza erişen bir araçtır. Bu yüzden güvenlik
tarafını baştan net tutuyoruz.

## Tasarım ilkeleri

### Anahtarlar Anahtar Zinciri'nde durur

Apple `.p8` özel anahtarı ve Google servis hesabı JSON'u macOS Anahtar
Zinciri'nde (Keychain) saklanır. Ayar dosyasına, ortam değişkenine veya repoya
**yazılmaz**. Ayar dosyasına yalnızca hangi mağazaların açık olduğu bilgisi
girer.

Anahtar Zinciri'ne erişilemeyen sistemlerde anahtarlar, izinleri `0600`'e
kilitlenmiş yerel bir dosyaya düşülür.

### Sunucu yerelde çalışır

Sunucu istemcinizin yanında, kendi makinenizde, stdio üzerinden çalışır.
Aradaki bir sunucuya, vekile veya bize ait bir servise bağlanmaz. Yaptığınız
istekler doğrudan Apple ve Google'ın resmî API uçlarına gider. Araya kimse
girmez.

### Telemetri yok

Kullanım verisi, hata raporu, sürüm bildirimi veya "anonim istatistik" adı
altında hiçbir şey toplanmaz ve hiçbir yere gönderilmez.

### Veri değiştiren işlemler onay ister

POST, PATCH, PUT ve DELETE çağrıları ilk seferde yürümez. Sunucu önce ne
yapılacağını, beklenen gövdeyi ve uyarısını döndürür; işlem ancak siz
onayladıktan sonra, `onayla=true` ile tekrar çağrıldığında gerçekleşir.

### Salt-okunur mod yazmayı kapatır

`--salt-okunur` bayrağı (ya da `SALT_OKUNUR=1` ortam değişkeni) yazma yapan
araçları — `appstore__yorum_yanitla`, `appstore__metin_guncelle` ve
`play__yorum_yanitla` — araç listesinden tamamen çıkarır. Model onları göremez,
dolayısıyla çağıramaz.

Tek istisna `magaza__cagir`'dır. O listede kalır, çünkü katalogdaki bütün
**okuma** uçlarına da bu araçtan gidiliyor; işaretlersek salt-okunur modda
hiçbir şey okunamaz hale gelirdi. Yazma koruması bu araçta operasyon bazında
uygulanır: veri değiştiren bir operasyon istendiğinde çağrı
"sunucu salt-okunur modda" hatasıyla reddedilir, gövde hiç gönderilmez.

Üretim hesabınıza yalnızca okuma erişimi vermek istiyorsanız doğru yol budur.

## Güvenlik açığı bildirimi

Bir güvenlik açığı bulduysanız **herkese açık issue açmayın.**

Bildirimi GitHub Security Advisory üzerinden, özel olarak gönderin:

- Deponun **Security** sekmesi → **Report a vulnerability**
- Doğrudan bağlantı:
  <https://github.com/tunaarikaya/magaza-mcp/security/advisories/new>

Bildiriminizde şunlar yardımcı olur:

- Açığın ne olduğu ve neye yol açtığı
- Tekrarlanması için gereken adımlar
- Etkilenen sürüm
- Varsa önerdiğiniz çözüm

**Bildirimde gerçek kimlik bilgisi paylaşmayın.** Key ID, Issuer ID, `.p8`
içeriği, servis hesabı JSON'u, erişim token'ı veya gerçek paket adı
göndermeyin. Gerekirse uydurma örneklerle anlatın.

Bildirimlere makul bir sürede dönüş yapmaya, doğrulanan açıkları düzeltip
düzeltmeyi bir sürümle yayınlamaya çalışırız. Düzeltme yayınlanana kadar
detayı açık etmemenizi rica ederiz.

## Desteklenen sürümler

Güvenlik düzeltmeleri en son yayınlanan sürüm üzerinden verilir. Eski
sürümlere geriye dönük yama çıkarılmaz.

## Anahtarınız sızdıysa

1. Apple tarafında: App Store Connect → Kullanıcılar ve Erişim →
   Entegrasyonlar bölümünden ilgili anahtarı iptal edin (revoke), yenisini
   üretin.
2. Google tarafında: Google Cloud Console → IAM & Admin → Service Accounts
   bölümünden anahtarı silin, yeni bir anahtar oluşturun.
3. Yerel kopyaları silin ve `magaza-mcp` kurulumunu yeni anahtarla tekrarlayın.
