# Installatiehandleiding ATAG One app op Homey

Om de ATAG One app op je Homey te installeren heb je een aantal gegevens nodig.  
Volg onderstaande stappen om deze te verzamelen en de installatie succesvol af te ronden.

---

## 1. Apparaatnaam en e-mailadres achterhalen

1. Open de **ATAG One app** op je telefoon.
2. Ga via het **hamburgermenu (☰)** naar **Instellingen**.
3. Kies **Account**.
4. Ga naar **Apparaten**.
5. Noteer de **naam van je ATAG One thermostaat**.  
   Dit is de apparaatnaam die je later nodig hebt.
6. Ga terug en kies **Gebruikersinformatie**.
7. Noteer het **e-mailadres** dat onder *Email* staat.

---

## 2. IP-adres en MAC-adres achterhalen

Ga naar je **ATAG One thermostaat** en volg deze stappen:

1. Druk **2× op de grote middelste knop**.
2. Ga met de **rechterknop** naar **Instellingen** → druk op de **middelste knop**.
3. Ga met de **rechterknop** naar **Informatie** → druk op de **middelste knop**.
4. Ga met de **rechterknop** naar **Netwerk** → druk op de **middelste knop**.
5. Noteer:
   - Het **IP-adres**
   - Het **MAC-adres**

> Als je niets doet, gaat het scherm automatisch terug naar de beginstand.

---

## 3. Installatie van de ATAG One app in Homey

1. Open de Homey app op je telefoon  
   **of** ga in je browser naar: https://my.homey.app
2. Ga naar **Apparaten**.
3. Klik op **+ Nieuw apparaat**.
4. Zoek op **ATAG** en selecteer **ATAG One**.
5. Kies **ATAG One 2.0** en klik op **Installeren**.
6. Vul de gevraagde gegevens in:

   - **IP-adres**  
     Formaat: `xxx.xxx.xxx.xxx`  
     Voorbeeld: `192.168.1.10`

   - **MAC-adres**  
     Formaat: `xx:xx:xx:xx:xx:xx`  
     Voorbeeld: `ab:12:cd:34:ef:56`

   - **Apparaatnaam**  
     Exact zoals weergegeven in de ATAG One app.

   - **E-mailadres**  
     Zoals weergegeven in de ATAG One app.

7. Klik op **Verbinden**.

---

## ✔️ Klaar!

Je ATAG One 2.0 is nu toegevoegd aan Homey en klaar voor gebruik in flows en bediening via de app.

---

## 🔧 Tips bij problemen

- Zorg dat je **Homey en je telefoon in hetzelfde netwerk** zitten.
- Neem de **apparaatnaam exact over** (inclusief hoofdletters en spaties).
- Werkt het niet direct? Start Homey en de thermostaat opnieuw op.
