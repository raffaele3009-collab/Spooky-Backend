const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
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
  .then(() => console.log("Connesso a MongoDB ✅"))
  .catch((errore) => console.error("Errore connessione MongoDB:", errore));

// Definiamo la "forma" di un post (schema)
const postSchema = new mongoose.Schema({
  titolo: { type: String, required: true },
  data: { type: String, required: true },
  contenuto: { type: String, required: true }
}, { timestamps: true });

const Post = mongoose.model("Post", postSchema);

// Multer: riceve il file .docx in memoria (non lo salva su disco)
const upload = multer({ storage: multer.memoryStorage() });

// ENDPOINT 1: riceve un file .docx, lo converte in HTML e lo salva come nuovo post
app.post("/api/upload-post", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ errore: "Nessun file ricevuto" });
    }

    const titolo = req.body.titolo || "Senza titolo";

    // Mammoth converte il .docx in HTML, mantenendo paragrafi, titoli, grassetti ecc.
    const risultato = await mammoth.convertToHtml({ buffer: req.file.buffer });
    const contenutoHTML = risultato.value;
    const avvisi = risultato.messages;

    const nuovoPost = new Post({
      titolo: titolo,
      data: new Date().toISOString().split("T")[0],
      contenuto: contenutoHTML
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

// ENDPOINT 2: restituisce tutti i post salvati (usato dal blog con fetch)
app.get("/api/posts", async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }); // più recenti prima
    res.json(posts);
  } catch (errore) {
    res.status(500).json({ errore: "Errore nel recupero dei post" });
  }
});

// ENDPOINT 3 (utile per test): elimina un post per id
app.delete("/api/posts/:id", async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ messaggio: "Post eliminato" });
  } catch (errore) {
    res.status(500).json({ errore: "Errore nell'eliminazione del post" });
  }
});

app.get("/", (req, res) => {
  res.send("Backend blog Sognidor attivo ✅ (con MongoDB)");
});

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
