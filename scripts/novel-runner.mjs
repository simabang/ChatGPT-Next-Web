import fs from "fs/promises";
import path from "path";

const config = {
  outputDir: process.env.NOVEL_OUTPUT_DIR ?? "novel",
  targetWords: Number(process.env.NOVEL_TARGET_WORDS ?? 10000),
  minBatchWords: Number(process.env.NOVEL_MIN_BATCH_WORDS ?? 700),
  maxBatchWords: Number(process.env.NOVEL_MAX_BATCH_WORDS ?? 1200),
  maxChapters: Number(process.env.NOVEL_MAX_CHAPTERS ?? 12),
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.NOVEL_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  genre: process.env.NOVEL_GENRE ?? "科幻+穿越",
  title: process.env.NOVEL_TITLE ?? "回声纪元",
};

if (!config.apiKey) {
  throw new Error("Missing OPENAI_API_KEY");
}

const date = new Date().toISOString().slice(0, 10);
const chapterDir = path.join(config.outputDir, "chapters", date);
const reportDir = path.join(config.outputDir, "reports");
const bibleDir = path.join(config.outputDir, "bible");
const outlineDir = path.join(config.outputDir, "outlines");

await Promise.all([
  fs.mkdir(chapterDir, { recursive: true }),
  fs.mkdir(reportDir, { recursive: true }),
  fs.mkdir(bibleDir, { recursive: true }),
  fs.mkdir(outlineDir, { recursive: true }),
]);

async function readIfExists(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

const world = await readIfExists(path.join(bibleDir, "world.md"), "世界观：近未来科技与北宋末年历史交叠。\n");
const chars = await readIfExists(path.join(bibleDir, "characters.md"), "主角：林策，时序异常工程师。\n");
const timeline = await readIfExists(path.join(bibleDir, "timeline.md"), "当前阶段：穿越后72小时求生。\n");
const outline = await readIfExists(path.join(outlineDir, "master-outline.md"), "卷一目标：在乱世中生存并定位时间回声源。\n");

const existing = (await fs.readdir(chapterDir)).filter((f) => f.endsWith(".md")).sort();
let totalWords = 0;
let lastSummary = "";

for (const file of existing) {
  const content = await fs.readFile(path.join(chapterDir, file), "utf8");
  totalWords += countChineseWords(content);
  const summaryLine = content.split("\n").find((line) => line.startsWith("剧情摘要："));
  if (summaryLine) lastSummary = summaryLine.replace("剧情摘要：", "").trim();
}

while (totalWords < config.targetWords && existing.length < config.maxChapters) {
  const chapterNo = String(existing.length + 1).padStart(2, "0");
  const askWords = Math.min(
    config.maxBatchWords,
    Math.max(config.minBatchWords, config.targetWords - totalWords),
  );

  const prompt = `你是长篇小说连载作者。请创作《${config.title}》的下一章，题材${config.genre}。
要求：
1) 本章正文约${askWords}字，中文输出。
2) 与此前章节连续，避免重复剧情。
3) 每章必须推进一个外部冲突和一个人物关系变化。
4) 使用 Markdown，按以下格式输出：
# 第${chapterNo}章 <章节名>
剧情摘要：<一句话，不超过40字>

<正文>
`;

  const context = `已知设定：\n${world}\n\n角色：\n${chars}\n\n时间线：\n${timeline}\n\n大纲：\n${outline}\n\n上一章摘要：${lastSummary || "无"}`;

  const chapter = await generateChapter(config, prompt, context);
  const filename = `${chapterNo}.md`;
  await fs.writeFile(path.join(chapterDir, filename), chapter, "utf8");

  const words = countChineseWords(chapter);
  totalWords += words;
  existing.push(filename);

  const summaryLine = chapter.split("\n").find((line) => line.startsWith("剧情摘要："));
  if (summaryLine) lastSummary = summaryLine.replace("剧情摘要：", "").trim();

  console.log(`Generated ${filename}: ~${words}字, total=${totalWords}`);
}

const report = [
  `# ${date} 写作报告`,
  "",
  `- 作品：${config.title}`,
  `- 题材：${config.genre}`,
  `- 今日目标字数：${config.targetWords}`,
  `- 实际完成字数（估算）：${totalWords}`,
  `- 当日章节数：${existing.length}`,
  `- 最后剧情摘要：${lastSummary || "无"}`,
  "",
  "## 章节列表",
  ...existing.map((f) => `- ${f}`),
  "",
].join("\n");

await fs.writeFile(path.join(reportDir, `${date}.md`), report, "utf8");

function countChineseWords(text) {
  const matched = text.match(/[\u4e00-\u9fff]/g);
  return matched ? matched.length : Math.ceil(text.length / 2);
}

async function generateChapter(cfg, userPrompt, contextText) {
  const response = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.9,
      messages: [
        { role: "system", content: "你是稳定连载的中文长篇小说写作助手。" },
        { role: "user", content: `${contextText}\n\n${userPrompt}` },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "# 生成失败\n剧情摘要：生成失败\n";
}
