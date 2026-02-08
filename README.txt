UZMAN Puantaj PWA – Kurulum (Windows)

1) ZIP’i bir klasöre çıkarın (ör: C:\Users\pc\Desktop\uzman-puantaj)
   İçerik şu 5 dosya olacak:
     - index.html
     - manifest.json
     - sw.js
     - icon-192.png
     - icon-512.png

2) PWA için sunucu şart (file:// ile olmaz).
   En kolay yöntem: CMD (Komut İstemi) açın (PowerShell değil)

   cd C:\Users\pc\Desktop\uzman-puantaj
   npx http-server -p 8001

   Not: PowerShell "running scripts is disabled" diyorsa mutlaka CMD kullanın.

3) Tarayıcıdan açın:
   http://127.0.0.1:8001/

4) Sağ üst ••• menü > “Uygulamayı yükle / Ana ekrana ekle”

5) "EADDRINUSE" hatası: portu değiştirin (8002, 8003...)
