# 🔥 Dikke Vette App

Partytools voor op je telefoon, voor op de bank en in de kroeg. Het is een installeerbare web-app (PWA) die ook offline werkt.

| Tool | Wat doet het? |
|---|---|
| ☝️ **Vingerkiezer** | Iedereen legt een vinger op het scherm. Na een korte countdown wijst de app 1, 2 of 3 winnaars aan of deelt iedereen in 2 teams in. |
| 🎡 **Rad van Fortuin** | Vul namen of opties in en draai (tik of swipe), met tikgeluidjes en trillingen. ✨ laadt voorbeeldlijsten zoals *Wat eten we?* |
| 🃏 **Kaartspel** | Vier decks: *Meest waarschijnlijk*, *Ik heb nog nooit*, *Doe of Durf* en *Wat zou je liever…*. Tik of swipe voor de volgende kaart. |
| ⚔️ **Teams maken** | Spelers invoeren en verdelen over 2 tot 8 teams met willekeurige teamnamen. |
| 🎲 **Dobbelstenen** | 1 tot 6 stenen. Tik om te gooien, of zet schudden aan en schud je telefoon. |

Alles wat je invoert (namen, instellingen) wordt lokaal op je telefoon bewaard.

## Op je telefoon zetten

1. Zet GitHub Pages aan: **Settings → Pages → Deploy from a branch → `main` / root**.
2. Open `https://loek78.github.io/Dikke-vette-app/` op je telefoon.
3. **iPhone:** Deel-knop → *Zet op beginscherm*. **Android:** menu → *App installeren*.

## Lokaal draaien

Er is geen build-stap nodig, het is gewoon HTML, CSS en JavaScript:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Zelf vragen toevoegen

Pas `data.js` aan. Daar staan alle kaartdecks en de voorbeeldlijsten voor het rad. Verhoog daarna `VERSION` in `sw.js`, zodat telefoons de nieuwe versie ophalen.
