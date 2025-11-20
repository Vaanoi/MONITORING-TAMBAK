const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// CORS configuration - DIPERBAIKI: Allow semua origin untuk testing
app.use(cors({
  origin: "*", // Untuk sementara allow semua origin
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(bodyParser.json());

// Firebase configuration
let serviceAccount;
let db;

try {
  console.log("Initializing Firebase...");
  
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("FIREBASE_PRIVATE_KEY is not defined");
  }

  const cleanedPrivateKey = privateKey
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n');

  serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: cleanedPrivateKey,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
  };

  console.log("Firebase project:", serviceAccount.project_id);

  // Initialize Firebase Admin
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  db = admin.database();
  console.log("Firebase Admin initialized successfully");

} catch (error) {
  console.error("Firebase initialization error:", error);
  process.exit(1);
}

// Health check endpoint - DIPERBAIKI
app.get("/", (req, res) => {
  res.json({ 
    message: "Backend Monitoring Tambak API", 
    status: "running",
    timestamp: new Date().toISOString(),
    endpoints: {
      latest: "/api/sensor/latest",
      history: "/api/sensor/history",
      post_data: "/api/sensor"
    }
  });
});

// POST dari ESP32 - TIDAK BERUBAH
app.post("/api/sensor", (req, res) => {
  try {
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
  } catch (error) {
    console.error("Error in POST /api/sensor:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET data terbaru - DIPERBAIKI: Tambah headers CORS
app.get("/api/sensor/latest", async (req, res) => {
  try {
    // Tambah headers CORS secara explicit
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    
    const snapshot = await db.ref("Tambak/DataTerbaru").get();
    if (!snapshot.exists()) {
      return res.status(404).json({ 
        message: "Belum ada data sensor",
        temperature: 0,
        levelPercent: 0,
        ntu: 0,
        levelStatus: "NO DATA",
        turbStatus: "NO DATA",
        timestamp: Date.now()
      });
    }
    
    const data = snapshot.val();
    console.log("Data terbaru dari Firebase:", data);
    
    // Pastikan data memiliki struktur yang konsisten
    const responseData = {
      temperature: data.temperature || 0,
      levelPercent: data.levelPercent || 0,
      ntu: data.ntu || 0,
      levelStatus: data.levelStatus || "Tidak Terdeteksi",
      turbStatus: data.turbStatus || "Tidak Terdeteksi",
      timestamp: data.timestamp || Date.now()
    };
    
    res.json(responseData);
  } catch (error) {
    console.error("Error ambil data dari Firebase:", error);
    res.status(500).json({ 
      message: "Gagal mengambil data dari Firebase",
      error: error.message 
    });
  }
});

// GET history - DIPERBAIKI: Tambah headers CORS
app.get("/api/sensor/history", async (req, res) => {
  try {
    // Tambah headers CORS secara explicit
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    
    const snapshot = await db
      .ref("Tambak/History")
      .limitToLast(20)
      .get();

    if (!snapshot.exists()) {
      return res.json([]);
    }

    const raw = snapshot.val();
    const data = Object.keys(raw).map((key) => ({
      id: key,
      ...raw[key],
    }));

    // Sort by timestamp dan pastikan data lengkap
    const sortedData = data
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .map(item => ({
        id: item.id,
        temperature: item.temperature || 0,
        levelPercent: item.levelPercent || 0,
        ntu: item.ntu || 0,
        levelStatus: item.levelStatus || "Tidak Terdeteksi",
        turbStatus: item.turbStatus || "Tidak Terdeteksi",
        timestamp: item.timestamp || Date.now()
      }));
    
    console.log(`Mengirim ${sortedData.length} data history`);
    res.json(sortedData);
  } catch (error) {
    console.error("Error ambil history dari Firebase:", error);
    res.status(500).json({ 
      message: "Gagal mengambil history dari Firebase",
      error: error.message 
    });
  }
});

// Test endpoint untuk debugging
app.get("/api/debug", (req, res) => {
  res.json({
    message: "Debug endpoint",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    firebaseProject: process.env.FIREBASE_PROJECT_ID
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`Backend berjalan pada port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`CORS: Enabled for all origins`);
  console.log(`=================================`);
});