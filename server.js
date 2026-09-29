const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// La connection string arriva da una variabile d'ambiente su Render,
// MAI scritta direttamente nel codice (per sicurezza).
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("Connesso a MongoDB ✅");
    // I post pubblicati prima dell'introduzione della programmazione non hanno
    // il campo "pubblicazione": glielo assegniamo pari alla data di creazione,
    // così restano visibili subito e non "scompaiono" dal sito.
    try {
      await Post.updateMany(
        { pubblicazione: { $exists: false } },
        [{ $set: { pubblicazione: "$createdAt" } }]
      );
    } catch (errore) {
      console.error("Errore nella migrazione del campo pubblicazione:", errore);
    }
  })
  .catch((errore) => console.error("Errore connessione MongoDB:", errore));

// Categorie ammesse per un post. "diario" resta il valore di default,
// cosi i post pubblicati prima di questa modifica continuano a comparire
// nella sezione "Diario per Dormiglioni" senza bisogno di toccarli.
const CATEGORIE_AMMESSE = ["diario", "storie"];

// Definiamo la "forma" di un post (schema)
const postSchema = new mongoose.Schema({
  titolo: { type: String, required: true },
  data: { type: String, required: true },
  contenuto: { type: String, required: true },
  categoria: { type: String, default: "diario" },
  paroleChiave: { type: [String], default: [] },
  // Momento (data + ora) in cui il post diventa visibile sul sito.
  // Di default è "adesso", ma può essere impostato nel futuro per
  // programmare l'uscita in anticipo.
  pubblicazione: { type: Date, default: Date.now }
}, { timestamps: true });

const Post = mongoose.model("Post", postSchema);

// Trasforma "Horror, Paura , Poesie" in ["horror", "paura", "poesie"]
function analizzaParoleChiave(testo) {
  if (!testo) return [];
  return testo.split(",").map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
}

// Trasforma il testo semplice estratto da un PDF in paragrafi HTML,
// mantenendo almeno la struttura a capoversi (i PDF non hanno grassetti/
// titoli riconoscibili come un .docx, quindi qui va bene il solo testo).
function testoInParagrafi(testo) {
  return testo
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p.replace(/\n/g, " ")}</p>`)
    .join("");
}

// Pagine del sito modificabili dall'editor (oggi solo "chi-siamo")
const paginaSchema = new mongoose.Schema({
  chiave: { type: String, required: true, unique: true },
  contenuto: { type: String, required: true }
}, { timestamps: true });

const Pagina = mongoose.model("Pagina", paginaSchema);

// Multer: riceve il file (.docx o .pdf) in memoria (non lo salva su disco)
const upload = multer({ storage: multer.memoryStorage() });

// ENDPOINT 1: riceve un file .docx o .pdf, lo converte in HTML e lo salva come nuovo post
app.post("/api/upload-post", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ errore: "Nessun file ricevuto" });
    }

    const nomeFile = (req.file.originalname || "").toLowerCase();
    const eDocx = nomeFile.endsWith(".docx");
    const ePdf = nomeFile.endsWith(".pdf");

    if (!eDocx && !ePdf) {
      return res.status(400).json({ errore: "Formato non supportato: carica un file .docx o .pdf" });
    }

    const titolo = req.body.titolo || "Senza titolo";
    const categoria = CATEGORIE_AMMESSE.includes(req.body.categoria) ? req.body.categoria : "diario";
    const paroleChiave = analizzaParoleChiave(req.body.paroleChiave);

    // Se viene passata una data/ora di pubblicazione valida, il post esce
    // (diventa visibile pubblicamente) solo a partire da quel momento.
    // Altrimenti è pubblicato immediatamente.
    let pubblicazione = new Date();
    if (req.body.pubblicazione) {
      const dataRichiesta = new Date(req.body.pubblicazione);
      if (!isNaN(dataRichiesta.getTime())) pubblicazione = dataRichiesta;
    }

    let contenutoHTML;
    let avvisi = [];

    if (eDocx) {
      // Mammoth converte il .docx in HTML, mantenendo paragrafi, titoli, grassetti ecc.
      const risultato = await mammoth.convertToHtml({ buffer: req.file.buffer });
      contenutoHTML = risultato.value;
      avvisi = risultato.messages;
    } else {
      // pdf-parse estrae il solo testo (i PDF non hanno una struttura come il .docx)
      const risultatoPdf = await pdfParse(req.file.buffer);
      contenutoHTML = testoInParagrafi(risultatoPdf.text);
    }

    const nuovoPost = new Post({
      titolo: titolo,
      data: new Date().toISOString().split("T")[0],
      contenuto: contenutoHTML,
      categoria: categoria,
      paroleChiave: paroleChiave,
      pubblicazione: pubblicazione
    });

    await nuovoPost.save(); // <-- salvato su MongoDB, sopravvive ai riavvii

    res.json({
      messaggio: "Post caricato e convertito con successo",
      post: nuovoPost,
      avvisiConversione: avvisi
    });
  } catch (errore) {
    console.error("Errore durante la conversione:", errore);
    res.status(500).json({ errore: "Errore durante la conversione del file" });
  }
});

// ENDPOINT 2: restituisce i post salvati (usato dal blog con fetch).
// Di default nasconde i post ancora programmati per il futuro; l'editor
// (uso interno, privato) passa ?tutti=1 per vederli tutti, compresi quelli
// non ancora usciti.
app.get("/api/posts", async (req, res) => {
  try {
    const vediTutti = req.query.tutti === "1";
    const filtro = vediTutti ? {} : { pubblicazione: { $lte: new Date() } };
    const posts = await Post.find(filtro).sort({ pubblicazione: -1 }); // più recenti prima
    res.json(posts);
  } catch (errore) {
    res.status(500).json({ errore: "Errore nel recupero dei post" });
  }
});

// ENDPOINT 3: aggiorna titolo, testo, categoria e/o parole chiave di un post già pubblicato
app.put("/api/posts/:id", async (req, res) => {
  try {
    const aggiornamenti = {};
    if (req.body.titolo !== undefined) aggiornamenti.titolo = req.body.titolo;
    if (req.body.contenuto !== undefined) aggiornamenti.contenuto = req.body.contenuto;
    if (CATEGORIE_AMMESSE.includes(req.body.categoria)) aggiornamenti.categoria = req.body.categoria;
    if (req.body.paroleChiave !== undefined) aggiornamenti.paroleChiave = analizzaParoleChiave(req.body.paroleChiave);
    if (req.body.pubblicazione) {
      const dataRichiesta = new Date(req.body.pubblicazione);
      if (!isNaN(dataRichiesta.getTime())) aggiornamenti.pubblicazione = dataRichiesta;
    }

    const postAggiornato = await Post.findByIdAndUpdate(req.params.id, aggiornamenti, { new: true });
    if (!postAggiornato) {
      return res.status(404).json({ errore: "Post non trovato" });
    }
    res.json(postAggiornato);
  } catch (errore) {
    console.error("Errore durante l'aggiornamento:", errore);
    res.status(500).json({ errore: "Errore durante l'aggiornamento del post" });
  }
});

// ENDPOINT 4 (utile per test): elimina un post per id
app.delete("/api/posts/:id", async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ messaggio: "Post eliminato" });
  } catch (errore) {
    res.status(500).json({ errore: "Errore nell'eliminazione del post" });
  }
});

// ENDPOINT 5: legge il contenuto di una pagina del sito (oggi solo "chi-siamo")
app.get("/api/pagina/:chiave", async (req, res) => {
  try {
    const pagina = await Pagina.findOne({ chiave: req.params.chiave });
    if (!pagina) {
      return res.status(404).json({ errore: "Pagina non trovata" });
    }
    res.json(pagina);
  } catch (errore) {
    res.status(500).json({ errore: "Errore nel recupero della pagina" });
  }
});

// ENDPOINT 6: salva/aggiorna il contenuto di una pagina del sito
app.put("/api/pagina/:chiave", async (req, res) => {
  try {
    if (req.body.contenuto === undefined) {
      return res.status(400).json({ errore: "Contenuto mancante" });
    }
    const pagina = await Pagina.findOneAndUpdate(
      { chiave: req.params.chiave },
      { contenuto: req.body.contenuto },
      { new: true, upsert: true }
    );
    res.json(pagina);
  } catch (errore) {
    console.error("Errore durante il salvataggio della pagina:", errore);
    res.status(500).json({ errore: "Errore nel salvataggio della pagina" });
  }
});

app.get("/", (req, res) => {
  res.send("Backend blog Spooky attivo ✅ (con MongoDB)");
});

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
