// Dummy data matching MergedArticle / Tag / TrackedEvent shapes from homefeed-data-schema.md
// Images are placeholder URLs (picsum.photos) fetched by the browser at runtime, not by this server.

const img = (seed, w = 900, h = 540) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const articles = [
  {
    id: "art-1",
    title: "Coalition talks resume as ministers signal a shift on trade rules",
    body:
      "Negotiators returned to the table this week after a two-month pause in talks over cross-border trade rules. Reuters reported the earlier pause followed a dispute over proposed tariff timelines, while the Associated Press notes that both delegations have since dropped their public objections to the original framework.\n\nThe Guardian's coverage adds that a signing event is tentatively planned for next week, pending final sign-off from both finance ministries. The Washington Post, citing a senior trade official, describes the remaining disagreements as procedural rather than substantive.",
    heroImage: { url: img("trade-talks"), sourceItemId: "ci-101", selectionReason: "Widest shot showing both delegations at the table" },
    video: { url: "", provider: "Reuters", sourceItemId: "ci-101" },
    category: ["World"],
    geo: null,
    eventId: null,
    sourceCount: 4,
    sources: [
      { itemId: "ci-101", sourceName: "Reuters", link: "https://example.com/reuters/1", publishedAt: hoursAgo(6) },
      { itemId: "ci-102", sourceName: "Associated Press", link: "https://example.com/ap/1", publishedAt: hoursAgo(5.5) },
      { itemId: "ci-103", sourceName: "The Guardian", link: "https://example.com/guardian/1", publishedAt: hoursAgo(5.2) },
      { itemId: "ci-104", sourceName: "Washington Post", link: "https://example.com/wapo/1", publishedAt: hoursAgo(4.5) }
    ],
    publishedAt: hoursAgo(6),
    updatedAt: hoursAgo(3.8),
    mergeConfidence: 0.91,
    tags: ["tag-trade-talks", "tag-trump"],
    threadId: "thread-trade-2026",
    previousArticleId: null,
    nextArticleId: "art-2"
  },
  {
    id: "art-2",
    title: "Trade deal signed after final overnight session",
    body:
      "Ministers signed the finalized trade agreement early this morning after a session that ran past 2am, according to Reuters and Bloomberg. The deal narrows tariff exemptions but preserves the core framework both sides agreed to in principle last week.\n\nBloomberg reports markets responded positively in early trading, with export-heavy sectors seeing the largest gains.",
    heroImage: { url: img("trade-signed"), sourceItemId: "ci-140", selectionReason: "Signing ceremony, clearest depiction of the event" },
    video: null,
    category: ["World"],
    geo: null,
    eventId: null,
    sourceCount: 2,
    sources: [
      { itemId: "ci-140", sourceName: "Reuters", link: "https://example.com/reuters/2", publishedAt: hoursAgo(1.5) },
      { itemId: "ci-141", sourceName: "Bloomberg", link: "https://example.com/bloomberg/1", publishedAt: hoursAgo(1.2) }
    ],
    publishedAt: hoursAgo(1.1),
    updatedAt: hoursAgo(1.1),
    mergeConfidence: 0.88,
    tags: ["tag-trade-talks"],
    threadId: "thread-trade-2026",
    previousArticleId: "art-1",
    nextArticleId: null
  },
  {
    id: "art-3",
    title: "Housing bill signed into law after months of negotiation",
    body: "The measure passed with bipartisan support after several rounds of amendments. Washington Post reports the bill includes new funding for first-time buyer assistance programs.",
    heroImage: { url: img("housing-bill"), sourceItemId: "ci-201", selectionReason: "Single source, original image retained" },
    video: null,
    category: ["Business"],
    geo: null,
    eventId: null,
    sourceCount: 1,
    sources: [{ itemId: "ci-201", sourceName: "Washington Post", link: "https://example.com/wapo/2", publishedAt: hoursAgo(9) }],
    publishedAt: hoursAgo(9),
    updatedAt: hoursAgo(9),
    mergeConfidence: 1.0,
    tags: [],
    threadId: "thread-housing",
    previousArticleId: null,
    nextArticleId: null
  },
  {
    id: "art-4",
    title: "Retail earnings beat expectations across the board",
    body: "Major retailers posted stronger than forecast quarterly results, with Fortune noting consumer spending held up despite earlier concerns about a slowdown.",
    heroImage: { url: img("retail-earnings"), sourceItemId: "ci-210", selectionReason: "Single source" },
    video: null,
    category: ["Business"],
    geo: null,
    eventId: null,
    sourceCount: 1,
    sources: [{ itemId: "ci-210", sourceName: "Fortune", link: "https://example.com/fortune/1", publishedAt: hoursAgo(12) }],
    publishedAt: hoursAgo(12),
    updatedAt: hoursAgo(12),
    mergeConfidence: 1.0,
    tags: [],
    threadId: "thread-retail",
    previousArticleId: null,
    nextArticleId: null
  },
  {
    id: "art-5",
    title: "Open-source model matches proprietary benchmark on reasoning tasks",
    body: "Ars Technica reports the newly released open-weight model scored within a few points of leading closed models on a widely cited reasoning benchmark, while running on consumer-grade hardware.",
    heroImage: { url: img("oss-model"), sourceItemId: "ci-301", selectionReason: "Single source" },
    video: null,
    category: ["Tech"],
    geo: null,
    eventId: null,
    sourceCount: 1,
    sources: [{ itemId: "ci-301", sourceName: "Ars Technica", link: "https://example.com/ars/1", publishedAt: hoursAgo(7.5) }],
    publishedAt: hoursAgo(7.5),
    updatedAt: hoursAgo(7.5),
    mergeConfidence: 1.0,
    tags: ["tag-ai-models"],
    threadId: "thread-oss-model",
    previousArticleId: null,
    nextArticleId: null
  },
  {
    id: "art-6",
    title: "Browser vendor rolls out default tracker blocking",
    body: "The Verge reports the change applies to all users by default starting with this release, with an opt-out available in privacy settings.",
    heroImage: { url: img("browser-privacy"), sourceItemId: "ci-310", selectionReason: "Single source" },
    video: null,
    category: ["Tech"],
    geo: null,
    eventId: null,
    sourceCount: 1,
    sources: [{ itemId: "ci-310", sourceName: "The Verge", link: "https://example.com/verge/1", publishedAt: hoursAgo(11) }],
    publishedAt: hoursAgo(11),
    updatedAt: hoursAgo(11),
    mergeConfidence: 1.0,
    tags: [],
    threadId: "thread-browser",
    previousArticleId: null,
    nextArticleId: null
  },
  {
    id: "local-1",
    title: "City council approves new transit corridor along Broad Street",
    body: "6ABC and the Inquirer both reported the council vote passed 12-3, with construction expected to begin next spring. The Inquirer's coverage adds that the project timeline could shift depending on federal funding approval.",
    heroImage: { url: img("transit-corridor"), sourceItemId: "ci-401", selectionReason: "Clearest depiction of the proposed route" },
    video: null,
    category: ["Local"],
    geo: "philadelphia",
    eventId: null,
    sourceCount: 2,
    sources: [
      { itemId: "ci-401", sourceName: "6ABC", link: "https://example.com/6abc/1", publishedAt: hoursAgo(10) },
      { itemId: "ci-402", sourceName: "The Inquirer", link: "https://example.com/inquirer/1", publishedAt: hoursAgo(9.3) }
    ],
    publishedAt: hoursAgo(10),
    updatedAt: hoursAgo(9.3),
    mergeConfidence: 0.82,
    tags: [],
    threadId: "thread-transit",
    previousArticleId: null,
    nextArticleId: null
  },
  {
    id: "local-2",
    title: "School district announces revised calendar for fall term",
    body: "WHYY reports the district moved the first day back by one week to accommodate facility upgrades over the summer.",
    heroImage: { url: img("school-calendar"), sourceItemId: "ci-410", selectionReason: "Single source" },
    video: null,
    category: ["Local"],
    geo: "philadelphia",
    eventId: null,
    sourceCount: 1,
    sources: [{ itemId: "ci-410", sourceName: "WHYY", link: "https://example.com/whyy/1", publishedAt: hoursAgo(13) }],
    publishedAt: hoursAgo(13),
    updatedAt: hoursAgo(13),
    mergeConfidence: 1.0,
    tags: [],
    threadId: "thread-school",
    previousArticleId: null,
    nextArticleId: null
  },
  {
    id: "local-3",
    title: "Fireworks show draws record crowd to Penn's Landing",
    body: "6ABC's coverage includes video from the riverfront as the annual show drew what organizers called its largest crowd yet.",
    heroImage: { url: img("fireworks"), sourceItemId: "ci-420", selectionReason: "Single source" },
    video: { url: "", provider: "6ABC", sourceItemId: "ci-420" },
    category: ["Local"],
    geo: "philadelphia",
    eventId: null,
    sourceCount: 1,
    sources: [{ itemId: "ci-420", sourceName: "6ABC", link: "https://example.com/6abc/2", publishedAt: hoursAgo(19) }],
    publishedAt: hoursAgo(19),
    updatedAt: hoursAgo(19),
    mergeConfidence: 1.0,
    tags: [],
    threadId: "thread-fireworks",
    previousArticleId: null,
    nextArticleId: null
  },
  {
    id: "local-4",
    title: "Road work begins on I-76 overnight lane closures",
    body: "PennDOT's feed indicates closures will run nightly between 9pm and 5am through the end of the month.",
    heroImage: { url: img("road-work"), sourceItemId: "ci-430", selectionReason: "Single source" },
    video: null,
    category: ["Local"],
    geo: "philadelphia",
    eventId: null,
    sourceCount: 1,
    sources: [{ itemId: "ci-430", sourceName: "PennDOT feed", link: "https://example.com/penndot/1", publishedAt: hoursAgo(15) }],
    publishedAt: hoursAgo(15),
    updatedAt: hoursAgo(15),
    mergeConfidence: 1.0,
    tags: [],
    threadId: "thread-road",
    previousArticleId: null,
    nextArticleId: null
  }
];

const tags = [
  { id: "tag-trade-talks", label: "US-EU Trade Talks 2026", slug: "us-eu-trade-talks-2026", articleCount: 2, status: "active" },
  { id: "tag-trump", label: "President Trump", slug: "president-trump", articleCount: 1, status: "active" },
  { id: "tag-ai-models", label: "Open-source AI models", slug: "open-source-ai-models", articleCount: 1, status: "active" }
];

const events = [
  { id: "evt-iran", name: "Iran war", active: true, cadence: "daily" },
  { id: "evt-fed", name: "Fed rate decisions", active: true, cadence: "continuous" }
];

module.exports = { articles, tags, events };
