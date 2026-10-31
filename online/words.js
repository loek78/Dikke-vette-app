// Woordparen voor Infiltrant. Elk paar = twee VERSCHILLENDE maar VERWANTE begrippen, zodat één hint bij allebei past.
// Burgers krijgen het ene woord, de infiltrant (modus "woord") het andere. Voeg gerust paren toe — `npm test` checkt de regels:
// max 18 tekens, hoofdletter, geen dubbele paren, geen woord in meer dan 2 paren.
// UMD: in de browser window.DV_WORDCATS / window.DV_WORDPAIRS, in Node module.exports.
(function (root, factory) {
  const m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.DV_WORDCATS = m.DV_WORDCATS; root.DV_WORDPAIRS = m.DV_WORDPAIRS; }
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DV_WORDCATS = {
    eten: "🍕 Eten & drinken",
    dieren: "🐾 Dieren",
    plekken: "📍 Plekken",
    beroepen: "👷 Beroepen",
    sport: "⚽ Sport & spel",
    huis: "🛋️ In huis",
    kleding: "👕 Kleding & spullen",
    vervoer: "🚲 Vervoer",
    feest: "🎉 Feest & vrije tijd",
    natuur: "🌦️ Natuur & weer",
    fantasie: "🎬 Film, muziek & fantasie",
    nl: "🇳🇱 Typisch Nederlands",
  };

  // Compacte bron: categorie → [a, b] paren
  const RAW = {
    eten: [
      ["Koffie", "Thee"], ["Pizza", "Lasagne"], ["Spaghetti", "Macaroni"], ["Hamburger", "Hotdog"],
      ["Pannenkoek", "Wafel"], ["Appel", "Peer"], ["Sinaasappel", "Mandarijn"], ["Aardbei", "Framboos"],
      ["Bier", "Wijn"], ["Cola", "IJsthee"], ["Chips", "Popcorn"], ["Milkshake", "Smoothie"],
      ["Cake", "Brownie"], ["Kaas", "Boter"], ["Yoghurt", "Kwark"], ["Ketchup", "Mayonaise"],
      ["Citroen", "Limoen"], ["Komkommer", "Courgette"], ["Tomaat", "Paprika"], ["Ui", "Knoflook"],
      ["Rijst", "Couscous"], ["Taco", "Burrito"], ["Pinda", "Cashewnoot"], ["Honing", "Jam"],
      ["Cornflakes", "Muesli"], ["Croissant", "Chocoladebroodje"], ["Spareribs", "Kippenvleugels"],
      ["Mango", "Ananas"], ["Tosti", "Panini"], ["Sushi", "Loempia"], ["Druif", "Kers"],
    ],
    dieren: [
      ["Leeuw", "Tijger"], ["Hond", "Wolf"], ["Kat", "Konijn"], ["Hamster", "Cavia"],
      ["Paard", "Ezel"], ["Schaap", "Geit"], ["Koe", "Varken"], ["Kip", "Kalkoen"],
      ["Eend", "Zwaan"], ["Uil", "Vleermuis"], ["Arend", "Valk"], ["Dolfijn", "Walvis"],
      ["Haai", "Krokodil"], ["Olifant", "Neushoorn"], ["Giraf", "Zebra"], ["Chimpansee", "Gorilla"],
      ["Slang", "Hagedis"], ["Kikker", "Salamander"], ["Spin", "Schorpioen"], ["Bij", "Wesp"],
      ["Vlinder", "Libelle"], ["Muis", "Rat"], ["Egel", "Eekhoorn"], ["Hert", "Eland"],
      ["Pinguïn", "IJsbeer"], ["Papegaai", "Toekan"], ["Struisvogel", "Flamingo"], ["Kameel", "Lama"],
      ["Koala", "Panda"], ["Zeehond", "Walrus"], ["Schildpad", "Slak"], ["Mier", "Lieveheersbeestje"],
    ],
    plekken: [
      ["Strand", "Zwembad"], ["Bioscoop", "Theater"], ["Bibliotheek", "Boekhandel"], ["Supermarkt", "Drogisterij"],
      ["Restaurant", "Snackbar"], ["Café", "Discotheek"], ["School", "Universiteit"], ["Kerk", "Klooster"],
      ["Vliegveld", "Treinstation"], ["Dierentuin", "Safaripark"], ["Pretpark", "Kermis"], ["Museum", "Galerie"],
      ["Hotel", "Camping"], ["Sportschool", "Sporthal"], ["Kapsalon", "Nagelstudio"], ["Bakkerij", "Slagerij"],
      ["Gevangenis", "Politiebureau"], ["Stadion", "Festivalterrein"], ["Kasteel", "Paleis"], ["Iglo", "Boomhut"],
      ["Sauna", "Bubbelbad"], ["Tankstation", "Garage"], ["Kinderboerderij", "Manege"], ["Speeltuin", "Schoolplein"],
      ["Ziekenhuis", "Dierenkliniek"], ["Rommelmarkt", "Kringloopwinkel"],
    ],
    beroepen: [
      ["Politieagent", "Brandweerman"], ["Dokter", "Verpleegkundige"], ["Chirurg", "Tandarts"], ["Huisarts", "Dierenarts"],
      ["Kok", "Bakker"], ["Piloot", "Stewardess"], ["Astronaut", "Duiker"], ["Juf", "Oppas"],
      ["Kapper", "Visagist"], ["Advocaat", "Rechter"], ["Timmerman", "Loodgieter"], ["Elektricien", "Monteur"],
      ["Boer", "Tuinman"], ["Journalist", "Nieuwslezer"], ["Fotograaf", "Cameraman"], ["Schilder", "Beeldhouwer"],
      ["Postbode", "Pakketbezorger"], ["Buschauffeur", "Taxichauffeur"], ["Ober", "Barman"], ["Detective", "Spion"],
      ["Beveiliger", "Uitsmijter"], ["Visser", "Kapitein"], ["Slager", "Groenteboer"], ["Architect", "Bouwvakker"],
      ["Wetenschapper", "Uitvinder"], ["Trainer", "Scheidsrechter"],
    ],
    sport: [
      ["Voetbal", "Hockey"], ["Tennis", "Badminton"], ["Basketbal", "Volleybal"], ["Schaatsen", "Skeeleren"],
      ["Skiën", "Snowboarden"], ["Zwemmen", "Waterpolo"], ["Wielrennen", "Mountainbiken"], ["Hardlopen", "Wandelen"],
      ["Judo", "Karate"], ["Boksen", "Worstelen"], ["Golf", "Hockey"], ["Darts", "Biljart"],
      ["Bowlen", "Curling"], ["Schaken", "Dammen"], ["Monopoly", "Ganzenbord"], ["Poker", "Blackjack"],
      ["Jenga", "Mikado"], ["Verstoppertje", "Tikkertje"], ["Surfen", "Zeilen"], ["Roeien", "Kanoën"],
      ["Turnen", "Ballet"], ["Yoga", "Pilates"], ["Handbal", "Korfbal"], ["Rugby", "American football"],
      ["Boogschieten", "Darts"], ["Paintball", "Lasergamen"], ["Sudoku", "Kruiswoordpuzzel"], ["Padel", "Squash"],
    ],
    huis: [
      ["Kussen", "Deken"], ["Stoel", "Kruk"], ["Bank", "Fauteuil"], ["Bed", "Hangmat"],
      ["Lamp", "Kaars"], ["Vork", "Lepel"], ["Mes", "Schaar"], ["Koekenpan", "Wok"],
      ["Koelkast", "Vriezer"], ["Wasmachine", "Vaatwasser"], ["Douche", "Bad"], ["Tandenborstel", "Haarborstel"],
      ["Föhn", "Stijltang"], ["Tafel", "Bureau"], ["Kledingkast", "Boekenkast"], ["Magnetron", "Oven"],
      ["Waterkoker", "Broodrooster"], ["Stofzuiger", "Bezem"], ["Dweil", "Spons"], ["Laptop", "Tablet"],
      ["Televisie", "Beamer"], ["Wekker", "Horloge"], ["Vuilnisbak", "Wasmand"], ["Handdoek", "Badjas"],
      ["Spiegel", "Schilderij"],
    ],
    kleding: [
      ["Sok", "Handschoen"], ["Muts", "Pet"], ["Stropdas", "Vlinderdas"], ["Laarzen", "Sneakers"],
      ["Slippers", "Sandalen"], ["Zonnebril", "Skibril"], ["Rugzak", "Koffer"], ["Spijkerbroek", "Joggingbroek"],
      ["Ring", "Oorbel"], ["Ketting", "Armband"], ["Paraplu", "Parasol"], ["Jurk", "Rok"],
      ["Trui", "Sjaal"], ["T-shirt", "Overhemd"], ["Bikini", "Badpak"], ["Handtas", "Portemonnee"],
      ["Kroon", "Tiara"], ["Lippenstift", "Nagellak"], ["Parfum", "Deodorant"], ["Pyjama", "Pantoffels"],
    ],
    vervoer: [
      ["Fiets", "Step"], ["Scooter", "Motor"], ["Bus", "Tram"], ["Trein", "Metro"],
      ["Vliegtuig", "Helikopter"], ["Speedboot", "Jetski"], ["Roeiboot", "Zeilboot"], ["Cruiseschip", "Veerboot"],
      ["Raket", "Satelliet"], ["Luchtballon", "Zeppelin"], ["Taxi", "Limousine"], ["Vrachtwagen", "Bestelbus"],
      ["Tractor", "Graafmachine"], ["Brandweerauto", "Ambulance"], ["Skateboard", "Rolschaatsen"], ["Tandem", "Bakfiets"],
      ["Camper", "Caravan"], ["Bolderkar", "Kruiwagen"], ["Kabelbaan", "Skilift"], ["Koets", "Slee"],
      ["Parachute", "Paraglider"], ["Skelter", "Botsauto"], ["Politieauto", "Taxi"],
    ],
    feest: [
      ["Bruiloft", "Verjaardag"], ["Vrijgezellenfeest", "Babyshower"], ["Halloween", "Carnaval"], ["Barbecue", "Picknick"],
      ["Karaoke", "Playbackshow"], ["Ballon", "Slinger"], ["Vuurwerk", "Sterretje"], ["Festival", "Concert"],
      ["Escaperoom", "Spookhuis"], ["Goochelaar", "Clown"], ["Diploma", "Rijbewijs"], ["Schoolreisje", "Werkweek"],
      ["Stoelendans", "Zakdoekje leggen"], ["Koekhappen", "Zaklopen"], ["Confetti", "Glitter"], ["Taart", "Cupcake"],
      ["Pyjamafeest", "Filmavond"], ["Pubquiz", "Bingo"], ["Loterij", "Kraslot"], ["Tuinieren", "Klussen"],
      ["Breien", "Haken"], ["Schilderen", "Tekenen"], ["Lego", "Playmobil"], ["Pop", "Knuffel"],
    ],
    natuur: [
      ["Regen", "Hagel"], ["Sneeuw", "IJzel"], ["Onweer", "Storm"], ["Tornado", "Orkaan"],
      ["Regenboog", "Noorderlicht"], ["Zon", "Maan"], ["Ster", "Planeet"], ["Komeet", "Meteoriet"],
      ["Berg", "Vulkaan"], ["Heuvel", "Duin"], ["Rivier", "Kanaal"], ["Meer", "Vijver"],
      ["Waterval", "Fontein"], ["Bos", "Jungle"], ["Woestijn", "Strand"], ["Grot", "Tunnel"],
      ["Boom", "Struik"], ["Roos", "Tulp"], ["Zonnebloem", "Madelief"], ["Eikel", "Kastanje"],
      ["Dennenboom", "Palmboom"], ["Gletsjer", "IJsberg"], ["Lente", "Herfst"], ["Wolk", "Mist"],
      ["Schelp", "Zeester"],
    ],
    fantasie: [
      ["Vampier", "Weerwolf"], ["Zombie", "Spook"], ["Mummie", "Skelet"], ["Heks", "Tovenaar"],
      ["Prinses", "Koningin"], ["Koning", "Keizer"], ["Ridder", "Samurai"], ["Piraat", "Viking"],
      ["Robot", "Alien"], ["Draak", "Dinosaurus"], ["Eenhoorn", "Pegasus"], ["Fee", "Engel"],
      ["Elf", "Kabouter"], ["Reus", "Trol"], ["Cowboy", "Sheriff"], ["Ninja", "Superheld"],
      ["Gitaar", "Viool"], ["Piano", "Orgel"], ["Trompet", "Saxofoon"], ["Blokfluit", "Mondharmonica"],
      ["Zanger", "Rapper"], ["Band", "Koor"], ["Musical", "Opera"], ["Tekenfilm", "Stripboek"],
      ["Horrorfilm", "Thriller"], ["Popster", "Filmster"], ["Podcast", "Radio"], ["Tandenfee", "Paashaas"],
    ],
    nl: [
      ["Stroopwafel", "Speculaas"], ["Poffertjes", "Pannenkoek"], ["Sinterklaas", "Kerstman"], ["Chocoladeletter", "Marsepein"],
      ["Oliebol", "Appelflap"], ["Kroket", "Frikandel"], ["Bitterbal", "Kaasstengel"], ["Haring", "Paling"],
      ["Hagelslag", "Pindakaas"], ["Stamppot", "Erwtensoep"], ["Drop", "Pepermunt"], ["Klompen", "Laarzen"],
      ["Windmolen", "Vuurtoren"], ["Grachtenpand", "Woonboot"], ["Koningsdag", "Bevrijdingsdag"], ["Elfstedentocht", "Vierdaagse"],
      ["Kaasschaaf", "Dunschiller"], ["Gouda", "Edammer"], ["Vla", "Pudding"], ["Beschuit", "Ontbijtkoek"],
      ["Rookworst", "Knakworst"], ["Pakjesavond", "Kerstavond"], ["Tompouce", "Bossche bol"], ["Appeltaart", "Vlaai"],
      ["Dijk", "Duin"], ["Mosselen", "Oesters"], ["Draaiorgel", "Accordeon"],
    ],
  };

  const DV_WORDPAIRS = [];
  for (const c of Object.keys(RAW)) for (const [a, b] of RAW[c]) DV_WORDPAIRS.push({ c, a, b });

  return { DV_WORDCATS, DV_WORDPAIRS };
});
