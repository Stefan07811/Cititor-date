# Cititor Date Fotbal

Aplicație web (PWA) pentru telefon: încarci mai multe capturi cu statistici de fotbal, iar aplicația extrage toate informațiile
și le adună într-un singur text (copiere, trimitere, .txt/.md sau PDF) pe care îl dai mai departe unui AI.

## Pornire
```
python3 -m http.server 8080
```
Deschide pe telefon `http://<IP-ul-calculatorului>:8080`, apoi „Adaugă pe ecranul principal". Pentru instalare ca aplicație
și funcționare offline a interfeței e nevoie de HTTPS (ex. GitHub Pages: Settings → Pages → branch).

## Metode de citire (⚙️ Setări)
- **Gemini** (gratuit): cheie de la aistudio.google.com/apikey, fără card.
- **Claude Vision** (recomandat, exact): ai nevoie de o cheie API Anthropic. Cheia rămâne doar în `localStorage`-ul telefonului.
- **OCR local** (Tesseract.js, ron+eng): gratuit, fără cheie, dar mai puțin precis la tabele și numere mici – verifică rezultatul.

Rezultatul este editabil înainte de export. „PDF" deschide dialogul de tipărire → „Salvează ca PDF".
