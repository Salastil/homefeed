// In-memory admin state for the mock backend. Mirrors GlobalSettings / Source / TrackedEvent
// from homefeed-data-schema.md. Real backend replaces this with SQLite-backed storage.

let settings = {
	mergeStrictness: 3,
	defaultPollIntervalMinutes: 15,
	holdBeforePublishMinutes: 30,
	tagDedupThreshold: 0.82,
	tagExpiryDays: 21,
	followUpMinHoursSinceLast: 6,
	followUpMinNewSources: 2,
	aiServiceHost: "http://10.0.0.14",
	aiServicePort: 11434,
	selectedModels: {
		embedding: "nomic-embed-text-v1.5",
		image: "clip-vit-b32",
		synthesis: "qwen2.5:7b-instruct-q4_K_M"
	},
	retention: {
		publishedArticleMaxAgeDays: 7,
		rawItemMaxAgeDays: 7,
		storageCapEnabled: true,
		storageCapValue: 500,
		storageCapUnit: "GB",
		storageUsedMB: 214
	},
	categoryPriority: [
		{ id: "cat-top", name: "Top stories", priorityRank: 1, isDefault: true },
		{ id: "cat-local", name: "Local", priorityRank: 2, isDefault: true },
		{ id: "cat-world", name: "World", priorityRank: 3, isDefault: true },
		{ id: "cat-business", name: "Business", priorityRank: 4, isDefault: true },
		{ id: "cat-tech", name: "Tech", priorityRank: 5, isDefault: true },
		{ id: "cat-culture", name: "Culture", priorityRank: 6, isDefault: true }
	]
};

let sources = [
	{
		id: "src-1",
		name: "Reuters World",
		type: "rss",
		category: ["World"],
		url: "https://reuters.com/world/rss",
		pollIntervalMinutes: 15,
		enabled: true,
		lastPolledAt: new Date(Date.now() - 6 * 60000).toISOString(),
		lastError: null
	},
	{
		id: "src-2",
		name: "Middle East Watch",
		type: "telegram",
		category: ["Iran war (event)"],
		url: "@meast_watch",
		pollIntervalMinutes: 5,
		enabled: true,
		lastPolledAt: new Date(Date.now() - 2 * 60000).toISOString(),
		lastError: null
	},
	{
		id: "src-3",
		name: "6ABC Philadelphia",
		type: "rss",
		category: ["Local: Philadelphia"],
		url: "https://6abc.com/feed",
		pollIntervalMinutes: 10,
		enabled: true,
		lastPolledAt: new Date(Date.now() - 4 * 60000).toISOString(),
		lastError: null
	},
	{
		id: "src-4",
		name: "PennDOT Alerts",
		type: "rss",
		category: ["Local: Philadelphia"],
		url: "https://penndot.pa.gov/alerts/feed",
		pollIntervalMinutes: 10,
		enabled: true,
		lastPolledAt: new Date(Date.now() - 40 * 60000).toISOString(),
		lastError: "502 Bad Gateway"
	}
];

let events = [
	{
		id: "evt-iran",
		name: "Iran war",
		description: "Ongoing conflict coverage, sourced primarily from Telegram channels for speed.",
		sourceIds: ["src-2"],
		cadence: "daily",
		cadenceTime: "18:00",
		active: true,
		retentionOverrideDays: null
	},
	{
		id: "evt-fed",
		name: "Fed rate decisions",
		description: "",
		sourceIds: ["src-1"],
		cadence: "continuous",
		cadenceTime: null,
		active: true,
		retentionOverrideDays: 7
	}
];

// Simulated Ollama-backed model catalog, per task
const models = {
	embedding: ["nomic-embed-text-v1.5", "all-MiniLM-L6-v2"],
	image: ["clip-vit-b32", "siglip-base"],
	synthesis: ["qwen2.5:7b-instruct-q4_K_M", "phi3.5:3.8b-mini-instruct-q4", "llama3.1:8b-instruct-q4"]
};

module.exports = {
	getSettings: () => settings,
	updateSettings: (patch) => {
		settings = { ...settings, ...patch, retention: { ...settings.retention, ...(patch.retention || {}) } };
		return settings;
	},
	getSources: () => sources,
	addSource: (source) => {
		const newSource = { id: `src-${Date.now()}`, lastPolledAt: null, lastError: null, enabled: true, ...source };
		sources = [...sources, newSource];
		return newSource;
	},
	updateSource: (id, patch) => {
		sources = sources.map((s) => (s.id === id ? { ...s, ...patch } : s));
		return sources.find((s) => s.id === id);
	},
	deleteSource: (id) => {
		sources = sources.filter((s) => s.id !== id);
	},
	getEvents: () => events,
	addEvent: (event) => {
		const newEvent = { id: `evt-${Date.now()}`, active: true, sourceIds: [], ...event };
		events = [...events, newEvent];
		return newEvent;
	},
	updateEvent: (id, patch) => {
		events = events.map((e) => (e.id === id ? { ...e, ...patch } : e));
		return events.find((e) => e.id === id);
	},
	deleteEvent: (id) => {
		events = events.filter((e) => e.id !== id);
	},
	getModels: () => models,
	createCategory: (name) => {
		const id = `cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
		const maxRank = Math.max(0, ...settings.categoryPriority.map((c) => c.priorityRank));
		const created = { id, name, priorityRank: maxRank + 1, isDefault: false };
		settings.categoryPriority = [...settings.categoryPriority, created];
		return created;
	},
	deleteCategory: (id) => {
		settings.categoryPriority = settings.categoryPriority.filter((c) => c.id !== id);
	}
};
