# 🔥 Dikke Vette App

Partytools voor op je telefoon, voor op de bank en in de kroeg. Het is een installeerbare web-app (PWA) die ook offline werkt.
Nieuw: **Infiltrant**, een bluffspel dat je online speelt, iedereen op z'n eigen telefoon.

| Tool | Wat doet het? |
|---|---|
| 🕵️ **Infiltrant** *(online)* | 3 tot 12 spelers, ieder op z'n eigen telefoon. Iedereen krijgt hetzelfde geheime woord, behalve de infiltrant. Wie liegt er? |
| ☝️ **Vingerkiezer** | Iedereen legt een vinger op het scherm. Na een korte countdown wijst de app 1, 2 of 3 winnaars aan of deelt iedereen in 2 teams in. |
| 🎡 **Rad van Fortuin** | Vul namen of opties in en draai (tik of swipe), met tikgeluidjes en trillingen. ✨ laadt voorbeeldlijsten zoals *Wat eten we?* |
| 🃏 **Kaartspel** | Vier decks: *Meest waarschijnlijk*, *Ik heb nog nooit*, *Doe of Durf* en *Wat zou je liever…*. Tik of swipe voor de volgende kaart. |
| ⚔️ **Teams maken** | Spelers invoeren en verdelen over 2 tot 8 teams met willekeurige teamnamen. |
| 🎲 **Dobbelstenen** | 1 tot 6 stenen. Tik om te gooien, of zet schudden aan en schud je telefoon. |

Alles wat je invoert (namen, instellingen) wordt lokaal op je telefoon bewaard.

## 🕵️ Infiltrant

### Zo speel je

1. **Kamer maken.** Eén iemand tikt op *Infiltrant* → *Kamer maken* en wordt de host. De anderen scannen de QR-code,
   tikken op de gedeelde link of typen de kamercode van 4 letters bij *Meedoen*.
2. **Geheim woord.** Iedereen houdt z'n kaart ingedrukt om het woord te zien en tikt op *Gezien ✓*. De burgers hebben
   allemaal hetzelfde woord. De infiltrant heeft een nét ander woord en weet zelf van niks (*Ander woord*), of heeft
   geen woord, weet dat hij de infiltrant is en ziet alleen de categorie (*Geen woord*).
3. **Hints.** Om de beurt geeft iedereen één hint: typen, of hardop zeggen en op *Hardop gezegd ✓* tikken.
   Te duidelijk? Dan weet de infiltrant het ook. Te vaag? Dan lijk jij verdacht.
4. **Stemmen.** Iedereen stemt wie de infiltrant is. Bij gelijkspel wordt er opnieuw gestemd tussen de koplopers;
   is het dan nóg gelijk, dan gaat er niemand uit.
5. **Wie wint?** De burgers winnen als alle infiltranten eruit liggen. De infiltranten winnen zodra ze even groot zijn
   als de groep burgers, of als een ontmaskerde infiltrant in *Geen woord* het woord van de burgers raadt.

Punten: winnende burgers +2, winnende infiltranten +4 (de goede rader +1 extra), en +1 voor elke stem op een infiltrant.
De host kiest in de lobby de spelregels: modus, 1 of 2 infiltranten (2 vanaf 5 spelers), 1–3 hint-rondes per stemming,
een timer per beurt en de woordcategorieën. Wie later binnenkomt kijkt mee en speelt het volgende potje mee.
Met *Nog een potje* begint meteen een nieuw spel; *Naar de lobby* gaat eerst terug naar de spelregels.

### Hoe werkt het online?

- Er is geen eigen server. De telefoons praten met elkaar via openbare **MQTT-servers** over een beveiligde WebSocket
  (broker.emqx.io, broker.hivemq.com, test.mosquitto.org, in die volgorde). Elke kamer heeft eigen kanalen `dva/v1/<CODE>/…`.
- De **telefoon van de host is de spelleider**: die draait de spelregels (`online/engine.js`), bewaart het hele spel
  (ook de geheime woorden) en stuurt iedereen alleen het openbare spel plus z'n eigen geheime woord, op een kanaal met
  een geheime sleutel per speler. Andere telefoons sturen hun acties naar de host.
- Elke actie heeft een volgnummer en wordt herhaald tot de host hem bevestigt: niets raakt kwijt en niets telt dubbel,
  ook niet na een slechte verbinding.
- **Tegen een stootje bestand.** Een telefoon die herlaadt of uit de slaapstand komt, zit meteen weer op z'n plek met
  hetzelfde woord. Valt het netwerk weg, dan staat er *Verbinden…* en gaat alles vanzelf verder zodra het terug is.
  Herlaadt de host, dan gaat het spel verder waar het was (de host bewaart het spel 12 uur). Is de host weg, dan
  zien de anderen *Host is even weg…*.
- Openbare servers betekent: wie de kamercode kent kan het openbare spel (namen, hints, stemmen) meelezen. De geheime
  woorden gaan alleen naar de telefoon die ze moet zien. Zet dus niks persoonlijks in je naam of hints.
- `online/verbinding.html` test vanaf een echte telefoon welke servers bereikbaar zijn.
  Met `?broker=wss://…` in de URL gebruikt de app alleen die server (handig voor een eigen server of lokaal testen).

| Bestand | Wat zit erin |
|---|---|
| `online/words.js` | ruim 300 woordparen in 12 categorieën |
| `online/engine.js` | de spelregels (`DVInfiltrant`): puur, zonder netwerk, goed testbaar |
| `online/net.js` | de verbinding (`DVNet`): MQTT, kamercodes, opnieuw verbinden |
| `online/ui.js`, `online/online.css` | alle schermen, host-loop en sessie per telefoon |
| `online/preview.js` | ontwerp-preview van elk scherm zonder netwerk: `?preview=lobby`, `reveal`, `vote`, `elim-tie`, `over-burgers`, … |

## Op je telefoon zetten

1. Open `https://loek78.github.io/Dikke-vette-app/` op je telefoon.
2. **iPhone:** Deel-knop → *Zet op beginscherm*. **Android:** menu → *App installeren*.

Publiceren: op `main` wordt gewerkt; `npm run release` zet `main` op de branch `release` en start de workflow
`.github/workflows/pages.yml`, die `release` op GitHub Pages zet.

## Lokaal draaien en testen

Er is geen build-stap nodig, het is gewoon HTML, CSS en JavaScript. De npm-pakketten zijn alleen voor de tests.

```bash
npm install     # aedes, mqtt en ws: een lokale MQTT-server voor de tests
npm run dev     # app op http://localhost:8000 + lokale MQTT-server op ws://localhost:8883
```

Open `http://localhost:8000/?broker=ws://localhost:8883` in een paar browservensters. Gebruik aparte profielen of
incognitovensters: tabbladen in hetzelfde venster delen hun opslag en zijn dus samen één telefoon. Telefoons in
hetzelfde wifi-netwerk kunnen meedoen via `http://<ip-van-je-computer>:8000/?broker=ws://<ip-van-je-computer>:8883`.

```bash
npm test        # unit-tests: spelregels, woordenlijst, verbinding, minigames (hetzelfde als: node --test test/)
npm run e2e     # Playwright: 6 "telefoons" spelen echte potjes tegen een lokale MQTT-server
```

`npm run e2e` speelt via de echte schermen: kamer maken, meedoen met code en deellink, beide modi tot de uitslag,
gelijkspel en herstemming, herladen tijdens het spel (speler én host), 5 seconden offline, dubbel tikken, eruit zetten
en de kamer sluiten. Daarna een snelle controle van de andere tools en de service worker. Elke console-fout laat de
test falen. Screenshots van elke fase komen in `test-results/e2e/` (of zet `E2E_SHOTS=<map>`).
Eén deel draaien kan ook: `npm run e2e -- infiltrant` of `npm run e2e -- smoke`.
Playwright met Chromium moet geïnstalleerd zijn (`require("playwright")` moet werken).

## Zelf vragen of woorden toevoegen

- Kaartdecks en voorbeeldlijsten voor het rad staan in `data.js`.
- Woordparen voor Infiltrant staan in `online/words.js`. `npm test` controleert de regels: twee verschillende maar
  verwante woorden, maximaal 18 tekens, en geen dubbele paren.

Verhoog daarna `VERSION` in `sw.js`, zodat telefoons de nieuwe versie ophalen.
