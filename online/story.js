// VUURWACHT: het script van de verhaalmodus (SPEC-3 §1–2). Alleen data, geen logica.
// Spelers op een telefoon lezen dit bij het vuur, dus: korte regels (max. 140 tekens), scènes van 3–8 regels.
// Placeholders: {A} {B} (eerste twee spelers), {ALLEN}, {X} (willekeurige speler per stap), {MVP} (beste van de
// laatste minigame), {VUUR} (huidige stand van het vuur). Tekst werkt ook met een derde speler ("jullie").
//
// Stemmen: Gloei is ijdel, dramatisch en brutaal (en stiekem dol op de spelers). De Vorst zegt altijd "u", roept
// nooit en houdt het kort. De verteller is droog en praat in de tegenwoordige tijd. {A} is de rekenaar ("wat levert
// het op?"), {B} de brutale ("vlammetje"); ze worden even vaak geplaagd en krijgen even veel regels.
// De win/meh/lose-regels van een minigame staan op het uitslagscherm naast de eigen regels van die minigame
// (score().lines), dus ze herhalen die niet maar voegen iets toe.
//
// Flags: elke keuze zet er één, en die doet er later toe:
//   belofte ja|nee         20:00  nee: +1 nu. ja: herinnering om 02:00, en nodig voor het einde "Legende"
//   bijl    grote|takken   21:00  bijl op moeilijkheid 3 of 1; daarna +1 (dikke blokken) of -1 (natte takjes)
//   kleed   deur|kachel    22:00  deur: de Mist blijft om 00:00 buiten (anders -1). kachel: +1 om 04:00
//   kist    hout|boek      23:00  hout: +2 meteen. boek: de kantlijn bij dageraad en +1, plus het einde "In het Wachtboek"
//   mist    dicht|gekeken  00:00  gekeken: makkelijkere echo, -1 erna, handafdrukken bij dageraad
//   aanbod  ja|nee         02:00  ja: +3 nu en een makkelijker duel, om 04:00 haalt de Vorst -3 op, einde "Een koude
//                                 handdruk" (gaat voor alles). nee: het zware duel
//   fles    nu|later       04:00  +1 nu, of +1 bij dageraad ("Het is later.")
// Lopende grappen: Henk (de spin in de houtmand), het oude kleed, die fles (voor later), het keurige handschrift
// van de Vorst in de rijp, en "vlammetje" (Gloei's geheim in "Legende").
// Vuur: burn 1 per hoofdstuk (proloog 0) en verlies (fire < 0) staat altijd ná de minigame van dat hoofdstuk. Zo is
// een retry vanaf 3 vuur altijd te halen, ook als de burn op "pittig" (x1.5) opnieuw meetelt.
// Extra velden naast SPEC-3 §2 (mag je negeren): chapter.tagline (regel op de titelkaart), ending.good (krijgt de
// Vuurwachters-badge).
// UMD: in de browser window.DV_STORY, in Node module.exports (ook bruikbaar als { DV_STORY }).
(function (root, factory) {
  const story = factory();
  if (typeof module === "object" && module.exports) module.exports = story;
  if (root) root.DV_STORY = story;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Regels: VT = verteller, GL = Gloei, VO = De Vorst, PA/PB = speler {A}/{B}.
  const say = (who) => (text) => ({ who, text });
  const VT = say("verteller"), GL = say("gloei"), VO = say("vorst"), PA = say("A"), PB = say("B");

  const when = (step, cond) => (cond ? Object.assign(step, { if: cond }) : step);
  const scene = (mood, lines, cond) => when({ type: "scene", mood, lines }, cond);
  const choice = (id, prompt, options, cond) => when({ type: "choice", id, prompt, options }, cond);
  const opt = (text, hint, set, delta) => Object.assign({ text, hint, set }, delta ? { fire: delta } : {});
  const mini = (id, difficulty, lines) => Object.assign({ type: "mini", id, difficulty }, lines);
  const fire = (delta, line, cond) => when({ type: "fire", delta, line }, cond);
  const is = (flag, eq) => ({ flag, eq });

  const chapters = [
    {
      id: "proloog", time: "20:00", title: "Het vuur spreekt", tagline: "Er zit iemand in de kachel.", burn: 0,
      steps: [
        scene("warm", [
          VT("De langste nacht van het jaar. Een huisje aan de rand van het dennenbos. Buiten vriest het dat het kraakt."),
          VT("Binnen: een ronde gietijzeren kachel, een oud kleed en {ALLEN}. En die fles, maar die is voor later."),
          VT("Het vuur ziet eruit alsof het er ook geen zin in heeft. Dan gaan achter het rooster twee kooltjes open. Als ogen."),
          GL("Zo. Zitten jullie lekker? Fijn voor jullie. Ik lig hier op drie natte takjes en een kassabon."),
          PA("Zei de kachel nou iets?"),
          GL("De kachel zegt niks, die is van ijzer. Ík zeg wat. Gloei is de naam. Aangenaam."),
          PB("Een pratend vlammetje. Dat kan er ook nog wel bij."),
          GL("Vlammetje?! Ik brand hier al sinds dit huisje een boom was. Een béétje respect graag, {B}."),
        ]),
        scene("cold", [
          GL("Luister. Vannacht komt de Vorst. Hij wil mij uitblazen, want dan houdt de nacht nooit meer op."),
          VT("Op het raam verschijnen ijsbloemen. Langzaam. Alsof iemand ze er met één vinger op tekent."),
          GL("Ik sta nu op {VUUR} van de tien. Ver beneden mijn stand. Op nul ben ik uit, en dan heeft hij gewonnen."),
          GL("Dus. Hou mij brandend tot de zon opkomt, en ik maak jullie Vuurwachters."),
          PA("Vuurwachters? Wat levert dat op?"),
          GL("Een eretitel. Heel oud, heel zeldzaam. Er hoort geen geld bij, {A}. Wel eeuwige roem."),
          GL("Nog één ding. De Vorst is beleefd, hij vraagt alles heel netjes. Maar wat hij ook biedt: niet opendoen."),
        ]),
        choice("belofte", "Gloei wil het beloofd hebben: wat de Vorst ook biedt, de deur blijft dicht.", [
          opt("Erewoord. De deur blijft dicht.", "Gloei onthoudt alles. Echt alles.", { belofte: "ja" }),
          opt("Eerst horen wat hij te bieden heeft.", "Gloei laait op van verontwaardiging.", { belofte: "nee" }),
        ]),
        fire(1, GL("Eerst horen?! Kijk wat je doet: ik vlam ervan op. Van pure verontwaardiging."), is("belofte", "nee")),
        scene("warm", [
          VT("Even is het stil in de kachel. Een kooltje knapt."),
          GL("Nou. Dat had ik niet verwacht. Meestal beloven mensen alleen dat ze ‘even kijken’."),
          GL("Goed. Genoeg gezwijmeld. Aan het werk, voor ik sentimenteel word."),
        ], is("belofte", "ja")),
        mini("blaasbalg", 1, {
          intro: "Pak de blaasbalg. Blaas op de maat, niet ertussendoor. En niet te hard: ik ben geen verjaardagskaarsje.",
          win: "Ahh. Zo. Zo hoort dat. Ik ben weer de ster van de avond. Dat was ik natuurlijk al, maar nu zie je het.",
          meh: "Het ritme van een kruiwagen op kinderkopjes. Maar goed: ik brand nog. Boffen jullie even.",
          lose: "Ik heb weleens een tochtje gevoeld dat meer deed. Uit een brievenbus. In juli.",
        }),
      ],
    },
    {
      id: "hout", time: "21:00", title: "Hout halen", tagline: "De houtmand is leeg. Buiten wacht iemand.", burn: 1,
      steps: [
        scene("cold", [
          VT("{X} grijpt in de houtmand. Er zit een spin in. Verder niks."),
          GL("Dat is Henk. Henk mag blijven. Maar wie heeft er vanavond al mijn hele voorraad opgestookt?"),
          PB("Jij."),
          GL("Ik heb ervan genóten. Dat is iets anders. Hup, naar buiten. En geen nat hout, dat is een belediging."),
          VT("Buiten is de nacht blauw en knerpt de sneeuw. Jullie adem blijft in de lucht hangen. Die vindt het ook te koud."),
          VO("Goedenavond."),
          VT("De stem komt van overal tegelijk. Kalm. Als een buurman die al een tijdje in jullie gang staat."),
          VO("U zoekt hout, hoor ik. Neemt u rustig de tijd. Ik heb de hele nacht."),
        ]),
        scene("cold", [
          VT("{X} houdt de zaklamp vast. Verder doet {X} helemaal niks."),
          VT("Zo gaat het al eeuwen bij hout halen: één hakt, één sjouwt en één houdt de zaklamp vast."),
          GL("Ik zie heus wie er alleen maar licht staat te geven. Licht geven is míjn werk."),
        ], { players: ">=3" }),
        choice("bijl", "Achter het schuurtje: een enorme oude bijl en een handbijl. Wat wordt het?", [
          opt("De grote bijl. Echte blokken.", "Zwaar werk. Maar dikke blokken branden langer.", { bijl: "grote" }),
          opt("De handbijl. Dunne takken.", "Een stuk makkelijker. Maar takjes uit de sneeuw zijn nat.", { bijl: "takken" }),
        ]),
        mini("bijl", { base: 1, ifFlag: { bijl: "grote" }, then: 3 }, {
          intro: "Ik kijk mee door het raampje. Hakken als het gloeit, recht in het hart van het blok. Niet in je voet.",
          win: "Wat een stapel! {MVP} hakt alsof de Vorst er persoonlijk in zit.",
          meh: "Een bescheiden stapeltje. Ik heb weleens dikkere tandenstokers gezien. Maar hout is hout.",
          lose: "Ergens in het donker klapt de Vorst. Zachtjes. Beleefd. Met handschoenen aan.",
        }),
        fire(1, GL("Dikke blokken, dat proef ik meteen. Daar kan ik een uur op teren. Twee, als ik me inhoud. Ik hou me niet in."), is("bijl", "grote")),
        fire(-1, GL("Zijn die takjes nat? Ze zijn nát. Wie gooit er nou nat hout op mij? Ik zak in van pure belediging."), is("bijl", "takken")),
      ],
    },
    {
      id: "vonken", time: "22:00", title: "Vonkenregen", tagline: "Iemand blaast door de schoorsteen.", burn: 1,
      steps: [
        scene("tense", [
          VT("Het vuur knappert weer. {X} legt de voeten op het oude kleed voor de kachel."),
          VT("Niemand weet hoe oud dat kleed is. Het kleed zelf ook niet. Het heeft de kleur van vroeger."),
          GL("Vertel eens iets sappigs. Ik hoor hier nooit wat. Alleen de schoorsteen, en die heeft het alleen over het weer."),
          VT("Dan zucht de schoorsteen. Iemand blaast er van bovenaf in. Heel beleefd. Heel hard."),
          GL("Dat was ik niet!"),
          VT("Een fontein van vonken spat de kamer in. Recht op het kleed af."),
        ]),
        mini("vonken", 2, {
          intro: "Vangen, voor ze landen! Elk schroeiplekje op dat kleed is een vlek op mijn blazoen. Mijn prachtige blazoen.",
          win: "Het kleed is gered. Het is nog precies even lelijk als eerst. Gefeliciteerd.",
          meh: "Een paar gaatjes erbij. Op dat kleed valt het niet op. Op dat kleed valt niks op.",
          lose: "Het kleed lijkt nu op een vergiet. Het was al lelijk, nu is het ook nog luchtig.",
        }),
        scene("warm", [
          VT("De laatste vonk dooft. Het ruikt naar geschroeide wol en een klein beetje naar schuldgevoel."),
          GL("Ik wil even gezegd hebben: dat was ik niet. Hooguit een béétje. Voor het effect."),
          PA("Voor het effect?"),
          GL("Het zag er prachtig uit, geef maar toe. Maar die windvlaag was van de Vorst. Hij zoekt kieren."),
          GL("En onder de deur zit een kier. Een flinke."),
          VT("Het kleed smeult nog wat na. Lelijk is het, maar ook groot en dik."),
        ]),
        choice("kleed", "Het oude kleed heeft het overleefd. Waar gaat het heen?", [
          opt("Oprollen en tegen de kier onder de deur.", "Lelijk, maar tochtdicht.", { kleed: "deur" }),
          opt("Uitkloppen en terug voor de kachel.", "Daar ligt het al jaren. Daar wordt het warm.", { kleed: "kachel" }),
        ]),
      ],
    },
    {
      id: "kist", time: "23:00", title: "De kist op zolder", tagline: "Het goeie spul ligt boven.", burn: 1,
      steps: [
        scene("tense", [
          VT("De houtmand is wéér leeg. Henk kijkt jullie verwijtend aan."),
          GL("Wacht eens. Wacht eens even. Op zolder staat een kist. Met het goeie spul."),
          PB("Het goeie spul?"),
          GL("Eikenhout. Kurkdroog. Twintig jaar gerijpt, als een goede wijn. Ik word al warm als ik eraan denk."),
          VT("De zoldertrap kraakt bij elke tree. Boven ruikt het naar stof, appels en heel lang geleden."),
          VT("Op het dakraam staat iets in de rijp. Keurig handschrift: ‘Fris, vindt u niet?’"),
          VT("Dwars door de zolder loopt de kachelpijp. Hij is warm, en hij praat."),
          GL("Hier ben ik, in de pijp! Links, achter de kerstspullen. Die kist met dat ringslot. Vier ringen, vier tekens."),
        ]),
        mini("slot", 2, {
          intro: "De code? Die weet ik natuurlijk. Hij ligt op het puntje van mijn vlam. Praat hardop, dan luister ik mee door de pijp.",
          win: "Open! Precies de code die ik in gedachten had. Ongeveer. Ik zat er dichtbij.",
          meh: "Open. Het duurde even, maar wie ben ik om te zeuren? Iemand die heel oud is, dat ben ik.",
          lose: "Uiteindelijk wrikt {X} de kist open met de pook. Het werkt. Het is barbaars. Het kostte tijd.",
        }),
        fire(-1, GL("Hallo-o? Ik ben hier beneden. Alleen. In het donker. Geen haast, hoor. Ik ga gewoon langzaam uit.")),
        scene("warm", [
          VT("In de kist ligt eikenhout, zo droog als een oude mop. Daaronder een schrift met een leren kaft."),
          VT("Op de kaft staat in schuine letters: ‘Wachtboek’. Binnenin: namen. Rijen en rijen namen, met jaartallen erbij."),
          GL("O. Dat. Laat dat maar liggen, dat is niks. Pak het hout. Het hóút!"),
          VT("Voor het eerst vanavond klinkt Gloei niet helemaal zeker van zijn zaak."),
          PA("Ik loop die trap niet twee keer. Eén ding mee, en dan naar beneden."),
        ]),
        choice("kist", "Eikenhout of het Wachtboek. Wat gaat er mee naar beneden?", [
          opt("Het eikenhout. Gloei heeft honger.", "Meteen warm. Gloei is dol op eik.", { kist: "hout" }),
          opt("Het Wachtboek. Daar zit een verhaal achter.", "Gloei wil het niet. Juist daarom.", { kist: "boek" }),
        ]),
        fire(2, GL("Eikenhout! Twintig jaar gerijpt! Ik voel me eeuwen jonger. Mmm. Niet kijken, dit is privé."), is("kist", "hout")),
        scene("warm", [
          VT("{X} klemt het Wachtboek onder de arm. Gloei zegt er niks van, en dat is nieuw."),
          VT("Het boek ruikt naar rook. Oude rook. De laatste naam erin is van twaalf winters geleden."),
          GL("Lees het maar. Bij daglicht. En wat er in de kantlijn staat, is laster. Allemaal laster."),
        ], is("kist", "boek")),
      ],
    },
    {
      id: "mist", time: "00:00", title: "Middernacht: de Mist", tagline: "Er klopt iemand. Met jullie stem.", burn: 1,
      steps: [
        scene("spooky", [
          VT("Middernacht. In de gang slaat de klok twaalf keer. Er hangt geen klok in de gang."),
          VT("Tegen het raam drukt mist. Dik, wit en doodstil. Buiten waait het, maar de mist beweegt niet."),
          GL("Dat is zijn Mist. Niet naar kijken, niet naar luisteren. En vooral niks terugzeggen."),
          VT("Er wordt geklopt. Drie keer, heel zacht. Dan klinkt van buiten de stem van {B}."),
          PB("{A}? Doe eens open. Ik sta hier al zo lang. Het is zo koud."),
          VT("Maar {B} zit gewoon hier, naast {A}, en heeft niks gezegd. Dan klinkt buiten de stem van {A}."),
          PA("{B}, kijk eens goed naast je. Zat die er de hele avond al zo stil bij?"),
          GL("Zo werkt de Mist. Eerst leent hij je stem, dan je twijfel. Kijk elkaar maar niet te lang aan."),
        ]),
        choice("mist", "Er wordt weer geklopt. Precies even zacht als net. Wat doen jullie?", [
          opt("Gordijnen dicht. Niet kijken.", "Veilig. Saai, maar veilig.", { mist: "dicht" }),
          opt("Heel even door het raam kijken.", "Wie kijkt, laat kou binnen. Maar weet daarna meer.", { mist: "gekeken" }),
        ]),
        scene("spooky", [
          VT("Door het raam zie je, midden in de mist, een huisje. Precies dit huisje, met een kachel en een oud kleed."),
          VT("Bij de kachel zitten {ALLEN}. Ze kijken op. Ze zwaaien."),
          VT("Jullie zwaaien niet terug. Zij blijven zwaaien."),
          GL("Gordijn DICHT. Zo. Nu weten jullie hoe hij werkt: alles wat hij laat zien, heeft hij van jullie geleend."),
        ], is("mist", "gekeken")),
        scene("spooky", [
          VT("{X} trekt de gordijnen dicht. Het kloppen houdt op. Op de een of andere manier is dat erger."),
          VT("Achter het gordijn neuriet iemand het liedje dat {X} de hele avond al neuriet."),
          GL("Niet op letten. Hij doet alleen na. Zelf iets verzinnen kan hij niet. Daar pakken we hem op."),
        ], is("mist", "dicht")),
        mini("echo", { base: 2, ifFlag: { mist: "gekeken" }, then: 1 }, {
          intro: "Zonder overleggen: denk allemaal hetzelfde woord. Echte vrienden kunnen dat. Mist niet.",
          win: "De Mist sist als water op een hete plaat. Niks vindt hij zo eng als mensen die hetzelfde denken.",
          meh: "Het duurde even, maar jullie zijn het echt. Denk ik. Ik ga ervan uit. Niet aankomen.",
          lose: "Langs elkaar heen gedacht. Even wist ik zelf niet meer wie er echt was. Ik vertrouw alleen Henk nog.",
        }),
        fire(-1, VT("Een laatste sliert mist vindt de kier onder de deur en kruipt naar de kachel. Gloei blaast als een boze kat."), { flag: "kleed", ne: "deur" }),
        scene("warm", [
          VT("Een laatste sliert mist zoekt de kier onder de deur. Daar ligt het oude kleed."),
          VT("Hij duwt. Het kleed duwt niet terug, het ligt er gewoon. Lelijk, dik en onverzettelijk."),
          GL("Ha! Ik heb dat kleed altijd gewaardeerd. Altijd. Zeg ik dat niet altijd?"),
        ], is("kleed", "deur")),
        fire(-1, VT("Het gordijn is dicht, maar de kou van dat ene kijkje hangt nog in de kamer. Gloei huivert."), is("mist", "gekeken")),
      ],
    },
    {
      id: "aanbod", time: "02:00", title: "Het aanbod van de Vorst", tagline: "Hij vraagt het heel beleefd.", burn: 1,
      steps: [
        scene("cold", [
          VT("Twee uur. De mist is weg. Het is stil. Zelfs de kachel tikt niet meer."),
          VT("Achter het raam staat een gestalte van rijp. Lang, keurig, de handen op de rug."),
          VO("Goedenacht. Ik kom niet binnen, dat zou onbeleefd zijn. Ik kom een voorstel doen."),
          VO("Op uw stoep liggen drie blokken berkenhout. Honderd winters gedroogd. U hoeft alleen open te doen."),
          GL("Niet doen. Vorsthout brandt fel en daarna koud. {A}, ik zie je rekenen. Hou op met rekenen."),
          VO("Denkt u er rustig over na. Ik heb de tijd. Eigenlijk heb ik alleen maar tijd."),
        ]),
        scene("cold", [
          GL("En jullie hebben het beloofd. Erewoord, zeiden jullie. Ik zeg het maar even."),
          VO("Een belofte. Wat aandoenlijk. Beloftes bevriezen zo makkelijk."),
          VT("Hij glimlacht. Je ziet het niet, maar je voelt het. Ergens in je nek."),
        ], is("belofte", "ja")),
        scene("cold", [
          GL("Jullie wilden eerst horen wat hij biedt. Nou, dit biedt hij. Kou, met een strikje erom."),
          VO("Ik waardeer mensen die eerst willen horen. Dat zijn mijn favoriete mensen."),
          VT("Het klinkt als een compliment. Het voelt als tocht."),
        ], is("belofte", "nee")),
        choice("aanbod", "Drie blokken Vorsthout voor de deur. Doen jullie open?", [
          opt("Opendoen. Drie blokken is drie blokken.", "Nu warm. De rekening komt later.", { aanbod: "ja" }),
          opt("Nee, dank u. De deur blijft dicht.", "Dan wordt het een duel. Op zijn manier.", { aanbod: "nee" }),
        ]),
        fire(3, VT("De deur zwaait open. Drie berijpte blokken schuiven vanzelf over de drempel. Het vuur laait hoog op."), is("aanbod", "ja")),
        scene("cold", [
          VO("Dank u. Zeer vriendelijk. Om vier uur kom ik iets terughalen. Niets bijzonders."),
          VT("De deur valt dicht. Het vuur is groot en fel. Maar de vlammen hebben nu blauwe puntjes."),
          GL("Ik zeg niks. Ik ben een vuur. Vuren mokken niet."),
          VT("Gloei mokt."),
          VO("Nu wij vrienden zijn: een spelletje? Ik zal u ontzien. Dat doe ik voor vrienden."),
        ], is("aanbod", "ja")),
        scene("tense", [
          GL("Nee, dank u! Hoor je dat, Vorst? Nee, dank u! Ik gloei ervan, zo trots ben ik."),
          VO("Jammer. Bewaart u die fles dan maar. Voor later. Als er nog een later komt."),
          VT("In de kachel kraakt een blok. Boven de kachel, in het donker, gaan twee bleke ogen open."),
          VO("Een spelletje, dan. Op de ouderwetse manier. Ik ben er erg goed in."),
        ], is("aanbod", "nee")),
        mini("snel", { base: 2, ifFlag: { aanbod: "ja" }, then: 1 }, {
          intro: "Ik laat dat blok knallen, en dán tikken. Kraakt het alleen maar? Dan is dat hem, om jullie te foppen.",
          win: "Wat een vingers! {MVP} tikt zo snel dat er een barst in zijn ijsbloemen springt. Hij zegt niks. Dat zegt genoeg.",
          meh: "‘Verdienstelijk,’ zegt de Vorst. Bij hem is dat geen compliment. Bij hem is dat een dreigement.",
          lose: "Hij bood er zelfs zijn excuses voor aan. Dat is nog het ergste. Juichen kan ik hebben, excuses niet.",
        }),
      ],
    },
    {
      id: "wolf", time: "04:00", title: "Het uur van de wolf", tagline: "Niemand mag in slaap vallen.", burn: 1,
      steps: [
        scene("warm", [
          VT("Vier uur. Het uur van de wolf. Het uur waarop zelfs de klok even wil gaan zitten."),
          VT("{X} gaapt zo hard dat Henk in de houtmand ervan schrikt."),
          GL("Niet in slaap vallen. Als jullie slapen, ga ik ook slapen. En ik word niet meer wakker."),
          GL("Vertel me iets. Verhalen zijn het beste brandhout. Beter dan eik. Zeg dat niet tegen de eik."),
          PB("Wat voor verhaal?"),
          GL("Iets van jullie. Ik heb de hele nacht over mezelf gepraat. Heerlijk was dat. Nu zijn jullie."),
          GL("Graag iets sappigs. Maar {B}: niks over vlammetjes. Dat ben ik nog niet vergeten."),
        ]),
        scene("tense", [
          VT("Het vuur staat nog maar op {VUUR} van de tien. Gloei praat zachter dan net."),
          GL("Ik voel me niet zo lekker. Een beetje doorschijnend. Is dat normaal? Dat is niet normaal."),
          GL("Snel, dat verhaal. Voor ik vergeet hoe branden ook alweer ging."),
        ], { fireLte: 3 }),
        fire(1, VT("Het kleed voor de kachel is warm van een hele nacht vuur. Jullie liggen erop als katten. Gloei spint mee."), is("kleed", "kachel")),
        choice("fles", "{X} kijkt naar die fles. Die was voor later. Is het al later?", [
          opt("Nu. Op Gloei!", "Gloei is dol op een toost. Zeker op zichzelf.", { fles: "nu" }),
          opt("Nog niet. Bij zonsopgang.", "Dan heb je iets om naar uit te kijken.", { fles: "later" }),
        ]),
        fire(1, VT("Die fles gaat open. Jullie proosten op Gloei. Gloei bloost tot in de schoorsteen."), is("fles", "nu")),
        mini("verhaal", 1, {
          intro: "Om de beurt een verhaal, de rest geeft vlammen. {A}, {B}: jezelf vlammen geven kan niet. Ik ken jullie.",
          win: "Die ga ik doorvertellen. Aan de schoorsteen. Die kan eindelijk eens over iets anders praten dan het weer.",
          meh: "Niet jullie beste werk. Maar ik ben een vuur, ik ben niet kieskeurig. Behalve met nat hout.",
          lose: "Ik ben ingedut. Bij een verhaal. Ik, een vuur. Dat is nog nooit iemand gelukt.",
        }),
        fire(-3, VO("Vier uur. Ik kom mijn deel halen. Drie blokken, als het u schikt. Het schikt u."), is("aanbod", "ja")),
        scene("warm", [
          VT("Het vuur brandt rustig. Niemand zegt iets, en dat is helemaal goed."),
          GL("Dit huisje heeft twaalf winters leeggestaan. Twaalf langste nachten zat ik hier, op één kooltje onder de as."),
          GL("Mijn oma was een bosbrand. Die heeft de halve Veluwe gezien. Ik ken alleen deze kachel. En Henk."),
          PB("Nou. Nu niet meer."),
          GL("Nee. Nu zitten jullie hier, met dat lelijke kleed en dat gegaap. Niet verder vertellen, maar het is gezellig."),
          VT("Buiten, heel ver weg, wordt de zwarte lucht één tint minder zwart."),
        ]),
      ],
    },
    {
      id: "dageraad", time: "06:00", title: "Dageraad", tagline: "Het is bijna later.", burn: 1,
      steps: [
        scene("dawn", [
          VT("Zes uur. De langste nacht van het jaar is bijna op. Jullie ook."),
          VT("Boven de dennen wordt de lucht grijs, dan roze, dan een kleur waar nog geen naam voor is."),
          PA("De zon? Nu al? Op de kortste dag van het jaar?"),
          GL("Ik heb een goed woordje gedaan. De zon en ik kennen elkaar nog van vroeger."),
          VO("Goedemorgen. Wat een akelig woord."),
          VO("Ik ga. Dank voor de gezellige avond. Dat zeg ik altijd. Ik meen het nooit."),
          VT("De ijsbloemen verdwijnen van het raam, één voor één, alsof iemand de tekening uitgumt."),
          GL("Is hij weg? Echt weg? HA! Ik wist het. Ik heb geen moment getwijfeld. Hooguit twee momenten."),
        ]),
        scene("dawn", [
          VT("Op het raam zitten nog handafdrukken. Aan de buitenkant. Precies zo groot als die van jullie."),
          VT("De eerste zonnestraal raakt ze. Ze smelten weg, druppel voor druppel, tot er niks meer over is."),
          GL("Zie je wel. Bij daglicht is niks meer eng. Nou ja. Behalve jullie kapsels."),
        ], is("mist", "gekeken")),
        scene("dawn", [
          VT("{X} slaat het Wachtboek open. Naast elke naam staat een aantekening, steeds in een ander handschrift."),
          VT("‘1953: Zegt dat hij nooit mokt. Mokt.’ ‘1988: Noem hem nooit vlammetje. Echt nooit.’"),
          GL("Laster. Allemaal laster. Schrijf jullie namen erbij en sla die bladzijde om."),
        ], is("kist", "boek")),
        fire(1, VT("Jullie schrijven je namen eronder, met erachter: ‘Is eigenlijk best lief.’ Het vuur knettert ineens een stuk harder."), is("kist", "boek")),
        fire(1, VT("{X} pakt die fles. Het is later. Jullie proosten op de zon, en op Gloei. Vooral op Gloei."), is("fles", "later")),
      ],
    },
  ];

  // Eerste match wint; de laatste is de vangnet-afloop.
  const endings = [
    {
      id: "koud", title: "Een koude handdruk", good: false, cond: { flag: "aanbod", eq: "ja" }, mood: "cold",
      lines: [
        VT("De zon komt op. Jullie hebben het gehaald: het vuur staat op {VUUR} van de tien."),
        VT("Maar het brandt anders dan gisteren. Die blauwe puntjes gaan er niet meer af."),
        GL("Ik zei nog: wat hij ook biedt, niet opendoen. Maar goed. Wie luistert er nou naar een vuur."),
        VT("Gloei mokt nog tot half acht. Daarna nog een klein beetje."),
        VT("Op de vensterbank ligt een kaartje van rijp, in keurig handschrift: ‘Dank voor de deur. Tot volgend jaar.’"),
        VO("Ik weet nu hoe hij opengaat."),
        GL("Volgend jaar doen we niet open. Afgesproken? Afgesproken. Mooi. Dan ga ik nu verder met mokken."),
      ],
    },
    {
      id: "legende", title: "Legende", good: true, cond: { fireGte: 8, flag: "belofte", eq: "ja" }, mood: "dawn",
      lines: [
        VT("De zon klimt over de dennen. In de kachel brandt een vuur van {VUUR} blokken. Het hele huisje gloeit mee."),
        GL("Jullie hebben je woord gehouden. De deur bleef dicht. Hierbij benoem ik jullie tot Vuurwachters. Voor altijd."),
        GL("Nee, {A}, er hoort nog steeds geen geld bij. Wel mijn geheim. Kom eens dichterbij. Nog dichterbij. Niet té."),
        GL("Mijn echte naam kreeg ik van het allereerste kind dat mij ooit aanstak. Heel lang geleden."),
        GL("Ze noemde me Vlammetje."),
        GL("Dus toen {B} dat gisteravond zei, was ik woedend. En een heel klein beetje ontroerd."),
        GL("Als je dit ooit doorvertelt, zijn je wenkbrauwen van mij."),
        VT("Buiten smelt de laatste rijp. Binnen is het warm. Dat blijft het nog heel lang."),
      ],
    },
    {
      id: "wachtboek", title: "In het Wachtboek", good: true, cond: { fireGte: 4, flag: "kist", eq: "boek" }, mood: "dawn",
      lines: [
        VT("De zon vindt jullie bij een vuur van {VUUR} blokken. Moe, warm en stiekem een beetje trots."),
        GL("Vuurwachters. Dat zijn jullie nu. Het staat zwart op wit, dus het is waar."),
        VT("In het Wachtboek staan jullie namen, onder die van honderden anderen. Het potlood is nog warm."),
        GL("Over honderd jaar leest iemand jullie namen en vraagt: wie waren dat? Dan zeg ik: die? Die waren best goed."),
        GL("Kom volgend jaar terug. Niet voor mij, hoor. Voor het boek."),
        VT("Gloei vindt jullie geweldig. Hij zou het nooit zeggen. Daar heb je een verteller voor."),
      ],
    },
    {
      id: "vuurwachters", title: "Vuurwachters", good: true, cond: { fireGte: 4 }, mood: "dawn",
      lines: [
        VT("Zes uur. De zon schuift over de dennen en legt een gouden streep over de vloer, tot aan de kachel."),
        VT("Daarin: een vuur van {VUUR} blokken. Op het raam staat nog één ijsbloem, en ook die geeft het op."),
        GL("Nou. Dat hebben jullie niet slecht gedaan. Voor beginners."),
        GL("Bij deze zijn jullie Vuurwachters. Draag die titel met trots. En met droge sokken."),
        PA("Krijgen we er nog iets bij?"),
        GL("Eeuwige roem, {A}. En ontbijt, als jullie het zelf maken."),
        GL("Ik heb ook nog een geheim. Maar dat vertel ik alleen aan legendes. Volgend jaar misschien."),
        VT("Het vuur knappert. Als je niet beter wist, zou je zeggen dat het lacht."),
      ],
    },
    {
      id: "nippertje", title: "Op het nippertje", good: false, cond: {}, mood: "dawn",
      lines: [
        VT("De zon komt op. Het vuur staat op {VUUR} van de tien. Het scheelde een haar. Een wenkbrauwhaar."),
        GL("Dat was krap. Ik zag mijn leven al voorbijflitsen. Het was erg lang en erg indrukwekkend."),
        VT("Jullie hebben het gered. Niet met stijl, wel met hart. En met heel veel geblaas."),
        GL("Vuurwachters zijn jullie nog niet. Vuurwachters in opleiding. Met kleine letters."),
        PB("Mogen we je dan tenminste vlammetje noemen?"),
        GL("Waag het eens, {B}. Dat mocht alleen... Laat maar. Dat gaat je niks aan."),
        VT("Buiten zingt een merel. Het eerste licht valt op Henk in de houtmand. Ook Henk heeft het gehaald."),
      ],
    },
  ];

  const fail = {
    title: "Het vuur is uit",
    lines: [
      VT("Het laatste kooltje knipoogt nog één keer. Dan wordt het donker in de kachel."),
      VO("Dank u. Dat was alles."),
      VT("IJsbloemen kruipen over het raam, over de kachel, over die fles voor later."),
      VO("Ik blijf nog even. Een paar maanden, hooguit. Doet u geen moeite."),
      GL("Psst. Nog niet helemaal. Er zit nog één vonkje in de as. Probeer het nog eens."),
    ],
  };

  const story = {
    id: "vuurwacht", title: "Vuurwacht", subtitle: "De langste nacht", startFire: 4, maxFire: 10,
    cast: { gloei: { name: "Gloei", color: "#ffc247" }, vorst: { name: "De Vorst", color: "#9fd3ff" }, verteller: { name: "" } },
    chapters, endings, fail,
  };
  // Zodat ook `const { DV_STORY } = require(...)` werkt; niet-enumerable, dus JSON/clone blijven schoon.
  Object.defineProperty(story, "DV_STORY", { value: story, enumerable: false });
  return story;
});
