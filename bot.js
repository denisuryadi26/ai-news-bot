require('dotenv').config();
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

// ─── Daftar platform AI yang dipantau ───
const AI_PLATFORMS = [
  'ChatGPT',
  'OpenAI',
  'Claude',
  'Anthropic',
  'Gemini',
  'Google AI',
  'DeepSeek',
  'Meta AI',
  'Llama',
  'Grok',
  'xAI',
  'Mistral',
  'Perplexity',
  'Copilot',
  'Microsoft AI',
  'Sora',
  'Runway',
  'Midjourney',
  'Stable Diffusion',
];

// ─── Ambil berita dari NewsAPI ───
async function fetchAINews() {
  const query = AI_PLATFORMS.join(' OR ');

  // Ambil berita dari awal kemarin (WIB) — NewsAPI free plan delay ~24 jam
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const fromDate = new Date(
    yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
  ).toISOString();
  const toDate = new Date(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
  ).toISOString();
  console.log(`📅 Mengambil berita dari: ${fromDate} s/d ${toDate}`);

  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: query,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: 100,
      from: fromDate,
      to: toDate,
      apiKey: process.env.NEWSAPI_KEY,
    },
  });

  console.log(
    `📡 NewsAPI status: ${response.data.status}, totalResults: ${response.data.totalResults}`,
  );

  // Filter hanya dari website/blog (bukan video, dll)
  return response.data.articles.filter(
    (a) =>
      a.url && !a.url.includes('youtube.com') && !a.url.includes('tiktok.com'),
  );
}

// ─── Nilai viralitas pakai Claude ───
async function checkIfViral(article) {
  const prompt = `
Kamu adalah analis berita AI. Nilai apakah berita berikut VIRAL atau tidak.

Kriteria VIRAL (harus memenuhi SALAH SATU):
1. Berita ini berpotensi dibaca/di-share lebih dari 100.000 orang dalam 24 jam, atau sudah mendapatkan perhatian besar di media sosial
2. Berita ini bisa mempengaruhi perilaku masyarakat global secara signifikan, atau dampaknya luar biasa besar

Berita:
Judul: ${article.title}
Sumber: ${article.source.name}
Deskripsi: ${article.description}
URL: ${article.url}

Jawab HANYA dalam format JSON ini, tanpa teks lain:
{
  "is_viral": true/false,
  "reason": "alasan singkat dalam 1-2 kalimat",
  "impact_score": 1-10,
  "platform_mentioned": "nama platform AI yang disebut"
}
`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = message.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { is_viral: false };
  }
}

// ─── Kirim alert ke Telegram ───
async function sendTelegram(article, analysis) {
  const publishedAt = new Date(article.publishedAt).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const stars = '⭐'.repeat(Math.min(analysis.impact_score, 10));
  const message = `
🚨 *VIRAL AI NEWS ALERT* 🚨

🤖 *Platform:* ${analysis.platform_mentioned || 'AI'}
📰 *Judul:* ${article.title}
📌 *Sumber:* ${article.source.name}
🕐 *Publish:* ${publishedAt}
💥 *Impact Score:* ${analysis.impact_score}/10 ${stars}
📊 *Kenapa viral:* ${analysis.reason}

🔗 [Baca selengkapnya](${article.url})
`;

  await axios.post(
    `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: process.env.TELEGRAM_GROUP_ID,
      message_thread_id: parseInt(process.env.TELEGRAM_THREAD_ID),
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    },
  );

  console.log(`✅ Alert terkirim: ${article.title}`);
}

// ─── Fungsi utama ───
async function runBot() {
  const startTime = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
  });
  console.log(`\n🔍 [${startTime}] Mulai cek berita AI...`);

  // 1. Kirim header scan pagi
  await axios
    .post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_GROUP_ID,
        message_thread_id: parseInt(process.env.TELEGRAM_THREAD_ID),
        text: `📡 *AI News Scan Started*\n🕐 ${startTime}`,
        parse_mode: 'Markdown',
      },
    )
    .catch((e) => console.error('Header send failed:', e.message));

  try {
    const articles = await fetchAINews();
    console.log(`📰 Ditemukan ${articles.length} berita, sedang dianalisis...`);
    if (articles.length > 0) {
      console.log('📋 Sample judul berita:');
      articles
        .slice(0, 5)
        .forEach((a, i) => console.log(`   ${i + 1}. ${a.title}`));
    }

    let alertCount = 0;

    for (const article of articles) {
      if (!article.title || !article.description) continue;

      const analysis = await checkIfViral(article);

      if (analysis.is_viral) {
        await sendTelegram(article, analysis);
        alertCount++;
        // Jeda 1 detik supaya tidak spam
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // 3. Summary selesai scan
    const summary =
      alertCount === 0
        ? `ℹ️ *Tidak ada berita viral AI hari ini.*\n\nBot sudah menganalisis ${articles.length} berita dari hari ini, tidak ada yang memenuhi kriteria viral.`
        : `✅ *Scan Selesai!*\n\n🎯 Total ${alertCount} alert berita viral terkirim.`;

    await axios
      .post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: process.env.TELEGRAM_GROUP_ID,
          message_thread_id: parseInt(process.env.TELEGRAM_THREAD_ID),
          text: summary,
          parse_mode: 'Markdown',
        },
      )
      .catch((e) => console.error('Summary send failed:', e.message));

    if (alertCount === 0) {
      console.log('ℹ️  Tidak ada berita viral ditemukan hari ini.');
    } else {
      console.log(`\n🎯 Total ${alertCount} alert terkirim ke Telegram!`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ─── Jadwal: setiap jam 08.00 WIB (UTC+7 = 01:00 UTC) ───
cron.schedule(
  '0 1 * * *',
  () => {
    runBot();
  },
  {
    timezone: 'UTC',
  },
);

console.log('🤖 AI News Bot aktif! Akan cek berita setiap 08.00 WIB.');
console.log('💡 Untuk test sekarang, jalankan: node bot.js --test\n');

// Kalau dijalankan dengan flag --test, langsung run sekali
if (process.argv.includes('--test')) {
  runBot();
}
