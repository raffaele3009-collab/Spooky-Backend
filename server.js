const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// File dove salviamo i post (semplice, poi si potrà passare a un database)
const POSTS_FILE = path.join(__dirname, "posts.json");

// Se il file non esiste ancora, lo creiamo vuoto
if (!fs.existsSync(POSTS_FILE)) {
  fs.writeFileSync(POSTS_FILE, "[]", "utf-8");
}

// Multer: riceve il file .docx in memoria (non lo salva su disco)
const upload = multer({ storage: multer.memoryStorage() });

// Funzione di supporto: legge i post salvati
function leggiPost() {
  const data = fs.readFileSync(POSTS_FILE, "utf-8");
  return JSON.parse(data);
}

// Funzione di supporto: salva i post
function salvaPost(posts) {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), "utf-8");
}

// ENDPOINT 1: riceve un file .docx, lo converte in HTML e lo salva come nuovo post
app.post("/api/upload-post", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ errore: "Nessun file ricevuto" });
    }

    const titolo = req.body.titolo || "Senza titolo";

    // Mammoth converte il .docx in HTML, mantenendo paragrafi, titoli, grassetti ecc.
    const risultato = await mammoth.convertToHtml({ buffer: req.file.buffer });
    const contenutoHTML = risultato.value; // HTML pulito del documento
    const avvisi = risultato.messages; // eventuali avvisi (es. stili non riconosciuti)

    const posts = leggiPost();

    const nuovoPost = {
      id: Date.now(), // id semplice basato sul timestamp
      titolo: titolo,
      data: new Date().toISOString().split("T")[0], // es. 2026-08-04
      contenuto: contenutoHTML
    };

    posts.unshift(nuovoPost); // lo mette in cima alla lista (più recente prima)
    salvaPost(posts);

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

// ENDPOINT 2: restituisce tutti i post salvati (usato dal blog con fetch)
app.get("/api/posts", (req, res) => {
  const posts = leggiPost();
  res.json(posts);
});

// ENDPOINT 3 (utile per test): elimina un post per id
app.delete("/api/posts/:id", (req, res) => {
  const id = parseInt(req.params.id);
  let posts = leggiPost();
  posts = posts.filter((p) => p.id !== id);
  salvaPost(posts);
  res.json({ messaggio: "Post eliminato" });
});

app.get("/", (req, res) => {
  res.send("Backend blog Sognidor attivo ✅");
});

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
