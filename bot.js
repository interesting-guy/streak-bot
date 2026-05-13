require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('Error: BOT_TOKEN is not set in .env file');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const STREAKS_FILE = path.join(__dirname, 'streaks.json');
const LINKEDIN_URL_REGEX = /https?:\/\/(www\.)?linkedin\.com\/\S+/i;
const VALID_POST_PATHS = /linkedin\.com\/(posts|feed\/update|pulse)\//i;

function loadData() {
  try {
    if (!fs.existsSync(STREAKS_FILE)) return {};
    const raw = fs.readFileSync(STREAKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    console.warn('streaks.json corrupted or unreadable, starting fresh.');
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(STREAKS_FILE, JSON.stringify(data, null, 2));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function getUsername(msg) {
  return msg.from.username
    ? `@${msg.from.username}`
    : msg.from.first_name || 'friend';
}

function formatDate(dateStr) {
  if (!dateStr) return 'never';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Handle "posted" messages ────────────────────────────────────────────────

bot.on('message', (msg) => {
  const text = msg.text || '';
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = getUsername(msg);

  // Detect "posted" anywhere in the message (case insensitive)
  if (!/posted/i.test(text)) return;

  const linkedinMatch = text.match(LINKEDIN_URL_REGEX);

  if (!linkedinMatch) {
    bot.sendMessage(chatId,
      `🔗 Please include your LinkedIn post URL ${username}!\nExample: posted https://linkedin.com/posts/...`,
      { message_thread_id: msg.message_thread_id }
    );
    return;
  }

  const url = linkedinMatch[0];

  if (!VALID_POST_PATHS.test(url)) {
    bot.sendMessage(chatId,
      `❌ That doesn't look like a LinkedIn post URL ${username}\nPlease share your LinkedIn post link!`,
      { message_thread_id: msg.message_thread_id }
    );
    return;
  }

  const data = loadData();
  const todayStr = today();

  if (!data[userId]) {
    // First post ever
    data[userId] = {
      username: msg.from.username || msg.from.first_name || userId,
      streak: 1,
      longest: 1,
      lastPost: todayStr,
      totalPosts: 1,
      gracePeriodUsed: false,
      posts: [{ date: todayStr, link: url }],
    };
    saveData(data);
    bot.sendMessage(chatId,
      `🎯 Day 1 on the LinkedIn grind, ${username}!\nPost logged. The algorithm rewards consistency 👀`,
      { message_thread_id: msg.message_thread_id }
    );
    return;
  }

  const user = data[userId];

  // Already posted today
  if (user.lastPost === todayStr) {
    bot.sendMessage(chatId,
      `✅ LinkedIn post already logged today ${username}!\nStreak: ${user.streak} days 🔥 Go touch grass, you've done enough today.`,
      { message_thread_id: msg.message_thread_id }
    );
    return;
  }

  const daysSinceLast = daysBetween(user.lastPost, todayStr);

  user.posts.push({ date: todayStr, link: url });
  user.totalPosts += 1;

  let reply;

  if (daysSinceLast === 1) {
    // Posted yesterday → streak continues
    user.streak += 1;
    user.gracePeriodUsed = false;
    if (user.streak > user.longest) user.longest = user.streak;
    user.lastPost = todayStr;
    saveData(data);
    reply = `🔥 ${username} is on a ${user.streak} day LinkedIn streak!\nThe algorithm is watching. Keep showing up! 💼`;

  } else if (daysSinceLast === 2 && !user.gracePeriodUsed) {
    // Missed one day → grace period
    user.streak += 1;
    user.gracePeriodUsed = true;
    if (user.streak > user.longest) user.longest = user.streak;
    user.lastPost = todayStr;
    saveData(data);
    reply = `⚠️ Saved by the grace period ${username}!\nStreak alive: ${user.streak} days 🔥\nPost on LinkedIn tomorrow — no excuses! 💼`;

  } else {
    // Missed 2+ days OR already used grace period → streak reset
    const oldStreak = user.streak;
    user.streak = 1;
    user.gracePeriodUsed = false;
    user.lastPost = todayStr;
    saveData(data);
    reply = `💀 ${username} your ${oldStreak} day LinkedIn streak is gone.\nThe algorithm forgot you. Day 1 starts now.\nCome back stronger! 💪`;
  }

  bot.sendMessage(chatId, reply, { message_thread_id: msg.message_thread_id });
});

// ─── /streak ─────────────────────────────────────────────────────────────────

bot.onText(/\/streak/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = getUsername(msg);
  const data = loadData();
  const user = data[userId];

  if (!user) {
    bot.sendMessage(chatId, `📭 No streak data yet ${username}!\nSend a LinkedIn post to start your streak.`,
      { message_thread_id: msg.message_thread_id }
    );
    return;
  }

  bot.sendMessage(chatId,
    `🔥 ${username}'s LinkedIn Streak\n─────────────────\n` +
    `📅 Current streak: ${user.streak} days\n` +
    `🏆 Longest ever: ${user.longest} days\n` +
    `📝 Total posts: ${user.totalPosts}\n` +
    `🗓 Last post: ${formatDate(user.lastPost)}\n` +
    `─────────────────`,
    { message_thread_id: msg.message_thread_id }
  );
});

// ─── /leaderboard ─────────────────────────────────────────────────────────────

bot.onText(/\/leaderboard/, (msg) => {
  const chatId = msg.chat.id;
  const data = loadData();
  const entries = Object.values(data);

  if (entries.length === 0) {
    bot.sendMessage(chatId, '📭 No streaks yet! Be the first to post.',
      { message_thread_id: msg.message_thread_id }
    );
    return;
  }

  const sorted = entries
    .slice()
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 10);

  const medals = ['🥇', '🥈', '🥉'];
  const flames = ['🔥', '💼', ''];

  const rows = sorted.map((u, i) => {
    const rank = i + 1;
    const medal = medals[i] || `${rank}.`;
    const suffix = flames[i] || '';
    return `${medal} @${u.username} — ${u.streak} days ${suffix}`.trim();
  }).join('\n');

  bot.sendMessage(chatId,
    `🏆 LINKEDIN GRIND LEADERBOARD\n─────────────────\n${rows}\n─────────────────\nPost daily. Beat the algorithm. Climb the ranks!`,
    { message_thread_id: msg.message_thread_id }
  );
});

// ─── /mystats ─────────────────────────────────────────────────────────────────

bot.onText(/\/mystats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = getUsername(msg);
  const data = loadData();
  const user = data[userId];

  if (!user) {
    bot.sendMessage(chatId, `📭 No stats yet ${username}!\nSend a LinkedIn post to start tracking.`,
      { message_thread_id: msg.message_thread_id }
    );
    return;
  }

  const graceStatus = user.gracePeriodUsed ? 'used' : 'available';

  bot.sendMessage(chatId,
    `📊 YOUR LINKEDIN STATS ${username}\n─────────────────\n` +
    `🔥 Current streak: ${user.streak} days\n` +
    `🏆 Longest streak: ${user.longest} days\n` +
    `📅 Last post: ${formatDate(user.lastPost)}\n` +
    `📝 Total posts: ${user.totalPosts}\n` +
    `⚠️ Grace period: ${graceStatus}\n` +
    `─────────────────`,
    { message_thread_id: msg.message_thread_id }
  );
});

// ─── Error handling ───────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

bot.on('error', (err) => {
  console.error('Bot error:', err.message);
});

console.log('StreakBot is running...');
