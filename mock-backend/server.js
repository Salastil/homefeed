// Mock backend — implements the public API surface from homefeed-data-schema.md
// so the frontend can be built and tested before the real backend exists.
// GET /api/feed?category=&geo=&eventId=&tag=
// GET /api/article/:id
// GET /api/events
// GET /api/tags

const express = require("express");
const cors = require("cors");
const { articles, tags, events } = require("./data");
const admin = require("./admin-data");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get("/api/feed", (req, res) => {
  const { category, geo, eventId, tag } = req.query;
  let results = articles;

  if (category) {
    results = results.filter((a) => a.category.some((c) => c.toLowerCase() === String(category).toLowerCase()));
  }
  if (geo) {
    results = results.filter((a) => a.geo === geo);
  }
  if (eventId) {
    results = results.filter((a) => a.eventId === eventId);
  }
  if (tag) {
    results = results.filter((a) => a.tags.includes(tag));
  }

  results = [...results].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  res.json(results);
});

app.get("/api/article/:id", (req, res) => {
  const article = articles.find((a) => a.id === req.params.id);
  if (!article) return res.status(404).json({ error: "not found" });
  res.json(article);
});

app.get("/api/tags", (req, res) => {
  res.json(tags.filter((t) => t.status === "active"));
});

app.get("/api/events", (req, res) => {
  res.json(events);
});

// --- Admin API ---
// No auth in the mock — the real backend enforces session auth on all /api/admin/* routes.

app.get("/api/admin/settings", (req, res) => {
  res.json(admin.getSettings());
});

app.patch("/api/admin/settings", (req, res) => {
  res.json(admin.updateSettings(req.body));
});

app.get("/api/admin/sources", (req, res) => {
  res.json(admin.getSources());
});

app.post("/api/admin/sources", (req, res) => {
  res.status(201).json(admin.addSource(req.body));
});

app.patch("/api/admin/sources/:id", (req, res) => {
  const updated = admin.updateSource(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/admin/sources/:id", (req, res) => {
  admin.deleteSource(req.params.id);
  res.status(204).end();
});

app.get("/api/admin/events", (req, res) => {
  res.json(admin.getEvents());
});

app.post("/api/admin/events", (req, res) => {
  res.status(201).json(admin.addEvent(req.body));
});

app.patch("/api/admin/events/:id", (req, res) => {
  const updated = admin.updateEvent(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/admin/events/:id", (req, res) => {
  admin.deleteEvent(req.params.id);
  res.status(204).end();
});

app.get("/api/admin/models", (req, res) => {
  res.json(admin.getModels());
});

app.get("/api/admin/ai-status", (req, res) => {
  // Simulates pinging the configured Ollama host
  const { aiServiceHost, aiServicePort } = admin.getSettings();
  res.json({
    connected: true,
    host: aiServiceHost,
    port: aiServicePort,
    ramGB: 48,
    gpu: "none reported"
  });
});

app.listen(PORT, () => {
  console.log(`Mock backend running at http://localhost:${PORT}`);
});
