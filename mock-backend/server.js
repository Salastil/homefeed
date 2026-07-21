// Mock backend — implements the public API surface from homefeed-data-schema.md
// so the frontend can be built and tested before the real backend exists.
// GET /api/feed?category=&geo=&eventId=&tag=&before=&limit=
// GET /api/article/:id
// GET /api/events
// GET /api/tags
// GET /api/categories

const express = require("express");
const cors = require("cors");
const { articles, tags, events } = require("./data");
const admin = require("./admin-data");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get("/api/feed", (req, res) => {
  const { category, geo, eventId, tag, before, limit } = req.query;
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

  if (before) {
    const cursor = new Date(before).getTime();
    results = results.filter((a) => new Date(a.publishedAt).getTime() < cursor);
  }

  const pageSize = Math.min(Number(limit) || 15, 50);
  res.json(results.slice(0, pageSize));
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

app.get("/api/categories", (req, res) => {
  const { categoryPriority } = admin.getSettings();
  res.json([...categoryPriority].sort((a, b) => a.priorityRank - b.priorityRank));
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

app.post("/api/admin/categories", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name required" });
  res.status(201).json(admin.createCategory(name.trim()));
});

app.delete("/api/admin/categories/:id", (req, res) => {
  admin.deleteCategory(req.params.id);
  res.status(204).end();
});

app.get("/api/admin/logs", (req, res) => {
  // The mock backend doesn't run a scheduler/pipeline, so there's nothing to log —
  // returns an empty list rather than 404ing, so the Logs tab renders its empty state
  // instead of erroring when pointed at the mock backend.
  res.json([]);
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
