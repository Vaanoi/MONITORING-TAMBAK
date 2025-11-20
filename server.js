const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");
require('dotenv').config(); // Load environment variables

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Firebase configuration from environment variables
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Important: handle newlines
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  console.log("Firebase Admin initialized successfully");
} catch (error) {
  console.error("Firebase initialization error:", error);
  process.exit(1);
}

const db = admin.database();

// POST dari ESP32
app.post("/api/sensor", (req, res) => {
  const { temperature, levelPercent, levelStatus, ntu, turbStatus } = req.body;

  console.log("Body diterima:", req.body);

  if (
    temperature === undefined ||
    levelPercent === undefined ||
    ntu === undefined
  ) {
    return res
      .status(400)
      .json({ message: "Data tidak lengkap / format salah" });
  }

  console.log("\n=== Data diterima dari ESP32 ===");
  console.log("Suhu:", temperature + " °C");
  console.log("Level Air:", levelPercent + "% | " + (levelStatus || "-"));
  console.log("Kekeruhan:", ntu + " NTU | " + (turbStatus || "-"));
  console.log("=================================\n");

  const data = {
    temperature,
    levelPercent,
    ntu,
    levelStatus: levelStatus || null,
    turbStatus: turbStatus || null,
    timestamp: Date.now(),
  };

  const dataTerbaruRef = db.ref("Tambak/DataTerbaru");
  const historyRef = db.ref("Tambak/History");

  Promise.all([dataTerbaruRef.set(data), historyRef.push(data)])
    .then(() => {
      console.log("Data berhasil dikirim ke Firebase!");
      res.json({ message: "Data sensor diterima dan disimpan ke Firebase!" });
    })
    .catch((error) => {
      console.error("Error mengirim data ke Firebase:", error);
      res.status(500).json({ message: "Gagal menyimpan data ke Firebase." });
    });
});

// GET data terbaru
app.get("/api/sensor/latest", async (req, res) => {
  try {
    const snapshot = await db.ref("Tambak/DataTerbaru").get();
    if (!snapshot.exists()) {
      return res.status(404).json({ message: "Belum ada data sensor" });
    }
    res.json(snapshot.val());
  } catch (error) {
    console.error("Error ambil data dari Firebase:", error);
    res.status(500).json({ message: "Gagal mengambil data dari Firebase" });
  }
});

// GET history
app.get("/api/sensor/history", async (req, res) => {
  try {
    const snapshot = await db
      .ref("Tambak/History")
      .limitToLast(20)
      .get();

    if (!snapshot.exists()) {
      return res.status(404).json({ message: "Belum ada riwayat data sensor" });
    }

    const raw = snapshot.val();
    const data = Object.keys(raw).map((key) => ({
      id: key,
      ...raw[key],
    }));

    res.json(data);
  } catch (error) {
    console.error("Error ambil history dari Firebase:", error);
    res.status(500).json({ message: "Gagal mengambil history dari Firebase" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend berjalan pada port ${PORT}`);
});