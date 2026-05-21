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
const DATA_DIR = process.env.DATA_DIR || __dirname;
const STREAKS_FILE = path.join(DATA_DIR, 'streaks.json');
const LINKEDIN_URL_REGEX = /https?:\/\/(www\.)?linkedin\.com\/\S+/i;
const VALID_POST_PATHS = /linkedin\.com\/(posts|feed\/update|pulse)\//i;

// ─── Data helpers ─────────────────────────────────────────────────────────────

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
  try {
    fs.writeFileSync(STREAKS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save streaks.json:', err.message);
  }
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

// ─── $YIN helpers ─────────────────────────────────────────────────────────────

function getLeaderboardRank(userId, data) {
  const sorted = Object.entries(data)
    .sort(([, a], [, b]) => b.streak - a.streak);
  const idx = sorted.findIndex(([id]) => id === userId);
  return {
    rank: idx === -1 ? sorted.length + 1 : idx + 1,
    total: sorted.length,
  };
}

function calculateYIN(streak, rank, isGrace) {
  if (isGrace) {
    return { amount: 50, streakMultiplier: 1, rankMultiplier: 1, reason: 'Grace period — base $YIN only' };
  }

  let streakMultiplier;
  if (streak >= 7)      streakMultiplier = 3;
  else if (streak >= 5) streakMultiplier = 2;
  else if (streak >= 3) streakMultiplier = 1.5;
  else                  streakMultiplier = 1;

  let rankMultiplier;
  if (rank === 1)       rankMultiplier = 2;
  else if (rank === 2)  rankMultiplier = 1.5;
  else if (rank === 3)  rankMultiplier = 1.25;
  else if (rank <= 10)  rankMultiplier = 1.1;
  else                  rankMultiplier = 1;

  const amount = Math.round(50 * streakMultiplier * rankMultiplier);
  return { amount, streakMultiplier, rankMultiplier, reason: `${streak}-day streak + Rank ${rank} bonus` };
}

function ensureYINFields(user) {
  if (user.yin === undefined) user.yin = 0;
  if (!user.yinHistory) user.yinHistory = [];
}

function getTodayYIN(user) {
  const t = today();
  return (user.yinHistory || [])
    .filter(h => h.date === t)
    .reduce((sum, h) => sum + h.amount, 0);
}

function getWeekYIN(user) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return (user.yinHistory || [])
    .filter(h => h.date >= cutoffStr)
    .reduce((sum, h) => sum + h.amount, 0);
}

// ─── Startup migration ────────────────────────────────────────────────────────

(function migrateData() {
  try {
    const data = loadData();
    let count = 0;
    for (const userId in data) {
      let changed = false;
      if (data[userId].yin === undefined)   { data[userId].yin = 0;         changed = true; }
      if (!data[userId].yinHistory)          { data[userId].yinHistory = []; changed = true; }
      if (changed) count++;
    }
    if (count > 0) {
      saveData(data);
      console.log(`Migrated ${count} users to add $YIN fields`);
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
})();

// ─── Handle "posted" messages ────────────────────────────────────────────────

bot.on('message', (msg) => {
  const text = msg.text || '';
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = getUsername(msg);
  const opts = { message_thread_id: msg.message_thread_id };

  if (!/posted/i.test(text)) return;

  const linkedinMatch = text.match(LINKEDIN_URL_REGEX);

  if (!linkedinMatch) {
    bot.sendMessage(chatId,
      `🔗 Please include your LinkedIn post URL ${username}!\nExample: posted https://linkedin.com/posts/...`,
      opts
    );
    return;
  }

  const url = linkedinMatch[0];

  if (!VALID_POST_PATHS.test(url)) {
    bot.sendMessage(chatId,
      `❌ That doesn't look like a LinkedIn post URL ${username}\nPlease share your LinkedIn post link!`,
      opts
    );
    return;
  }

  const data = loadData();
  const todayStr = today();

  // If user ID unknown but username matches a seeded entry, migrate it
  if (!data[userId] && msg.from.username) {
    const usernameKey = `@${msg.from.username.toLowerCase()}`;
    if (data[usernameKey]) {
      data[userId] = data[usernameKey];
      delete data[usernameKey];
      saveData(data);
      console.log(`Migrated @${msg.from.username} → user ID ${userId}`);
    }
  }

  if (!data[userId]) {
    // First post ever — BASE $YIN only
    const yinEarned = 50;
    data[userId] = {
      username: msg.from.username || msg.from.first_name || userId,
      streak: 1,
      longest: 1,
      lastPost: todayStr,
      totalPosts: 1,
      gracePeriodUsed: false,
      posts: [{ date: todayStr, link: url }],
      yin: yinEarned,
      yinHistory: [{
        date: todayStr,
        amount: yinEarned,
        reason: 'First post ever — base $YIN',
        balanceAfter: yinEarned,
      }],
    };
    saveData(data);
    bot.sendMessage(chatId,
      `🎯 Day 1 on the LinkedIn grind, ${username}!\nPost logged. The algorithm rewards consistency 👀\n💰 +${yinEarned} $YIN earned! Balance: ${yinEarned} $YIN`,
      opts
    );
    return;
  }

  const user = data[userId];
  ensureYINFields(user);

  // Already posted today
  if (user.lastPost === todayStr) {
    bot.sendMessage(chatId,
      `✅ LinkedIn post already logged today ${username}!\nStreak: ${user.streak} days 🔥 Go touch grass, you've done enough today.`,
      opts
    );
    return;
  }

  const daysSinceLast = daysBetween(user.lastPost, todayStr);

  // sacred fields updated below — posts array and totalPosts
  user.posts.push({ date: todayStr, link: url });
  user.totalPosts += 1;

  let reply;

  if (daysSinceLast === 1) {
    // Streak continues
    user.streak += 1;
    user.gracePeriodUsed = false;
    if (user.streak > user.longest) user.longest = user.streak;
    user.lastPost = todayStr;

    const { rank } = getLeaderboardRank(userId, data);
    const yin = calculateYIN(user.streak, rank, false);
    user.yin += yin.amount;
    user.yinHistory.push({ date: todayStr, amount: yin.amount, reason: yin.reason, balanceAfter: user.yin });
    saveData(data);

    reply =
      `🔥 ${username} is on a ${user.streak} day LinkedIn streak!\n` +
      `The algorithm is watching. Keep showing up! 💼\n` +
      `💰 +${yin.amount} $YIN earned! Balance: ${user.yin} $YIN\n` +
      `📊 Streak bonus: ${yin.streakMultiplier}x | Rank bonus: ${yin.rankMultiplier}x`;

  } else if (daysSinceLast === 2 && !user.gracePeriodUsed) {
    // Grace period — BASE $YIN only
    user.streak += 1;
    user.gracePeriodUsed = true;
    if (user.streak > user.longest) user.longest = user.streak;
    user.lastPost = todayStr;

    const yinEarned = 50;
    user.yin += yinEarned;
    user.yinHistory.push({ date: todayStr, amount: yinEarned, reason: 'Grace period — base $YIN only', balanceAfter: user.yin });
    saveData(data);

    reply =
      `⚠️ Saved by the grace period ${username}!\n` +
      `Streak alive: ${user.streak} days 🔥\n` +
      `Post on LinkedIn tomorrow — no excuses! 💼\n` +
      `💰 +${yinEarned} $YIN (base only — grace period)\n` +
      `Balance: ${user.yin} $YIN`;

  } else {
    // Streak reset — BASE $YIN only, but $YIN never resets
    const oldStreak = user.streak;
    user.streak = 1;
    user.gracePeriodUsed = false;
    user.lastPost = todayStr;

    const yinEarned = 50;
    user.yin += yinEarned;
    user.yinHistory.push({ date: todayStr, amount: yinEarned, reason: `Streak reset from ${oldStreak} — base $YIN`, balanceAfter: user.yin });
    saveData(data);

    reply =
      `💀 ${username} your ${oldStreak} day LinkedIn streak is gone.\n` +
      `The algorithm forgot you. Day 1 starts now.\n` +
      `Come back stronger! 💪\n` +
      `💰 +${yinEarned} $YIN for posting. Balance: ${user.yin} $YIN\n` +
      `(Your $YIN is safe — it never resets!)`;
  }

  bot.sendMessage(chatId, reply, opts);
});

// ─── /streak ─────────────────────────────────────────────────────────────────

bot.onText(/\/streak/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = getUsername(msg);
  const data = loadData();
  const user = data[userId];
  const opts = { message_thread_id: msg.message_thread_id };

  if (!user) {
    bot.sendMessage(chatId, `📭 No streak data yet ${username}!\nSend a LinkedIn post to start your streak.`, opts);
    return;
  }

  bot.sendMessage(chatId,
    `🔥 ${username}'s LinkedIn Streak\n─────────────────\n` +
    `📅 Current streak: ${user.streak} days\n` +
    `🏆 Longest ever: ${user.longest} days\n` +
    `📝 Total posts: ${user.totalPosts}\n` +
    `🗓 Last post: ${formatDate(user.lastPost)}\n` +
    `─────────────────`,
    opts
  );
});

// ─── /leaderboard ─────────────────────────────────────────────────────────────
// Note: /\/leaderboard/ does NOT match /yinleaderboard (no slash before "leaderboard" in that string)

bot.onText(/\/leaderboard/, (msg) => {
  const chatId = msg.chat.id;
  const data = loadData();
  const entries = Object.values(data);
  const opts = { message_thread_id: msg.message_thread_id };

  if (entries.length === 0) {
    bot.sendMessage(chatId, '📭 No streaks yet! Be the first to post.', opts);
    return;
  }

  const sorted = entries
    .slice()
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 10);

  const medals = ['🥇', '🥈', '🥉'];
  const flames = ['🔥', '💼', ''];

  const rows = sorted.map((u, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const suffix = flames[i] || '';
    const yinBal = u.yin !== undefined ? ` | ${u.yin} $YIN` : '';
    return `${medal} @${u.username} — ${u.streak} days ${suffix}${yinBal}`.trim();
  }).join('\n');

  bot.sendMessage(chatId,
    `🏆 LINKEDIN GRIND LEADERBOARD\n─────────────────\n${rows}\n─────────────────\nPost daily. Beat the algorithm. Climb the ranks!`,
    opts
  );
});

// ─── /mystats ─────────────────────────────────────────────────────────────────

bot.onText(/\/mystats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = getUsername(msg);
  const data = loadData();
  const user = data[userId];
  const opts = { message_thread_id: msg.message_thread_id };

  if (!user) {
    bot.sendMessage(chatId, `📭 No stats yet ${username}!\nSend a LinkedIn post to start tracking.`, opts);
    return;
  }

  const graceStatus = user.gracePeriodUsed ? 'used' : 'available';
  const { rank } = getLeaderboardRank(userId, data);
  const yin = calculateYIN(user.streak, rank, false);
  const yinBal = user.yin || 0;

  bot.sendMessage(chatId,
    `📊 YOUR LINKEDIN STATS ${username}\n─────────────────\n` +
    `🔥 Current streak: ${user.streak} days\n` +
    `🏆 Longest streak: ${user.longest} days\n` +
    `📅 Last post: ${formatDate(user.lastPost)}\n` +
    `📝 Total posts: ${user.totalPosts}\n` +
    `⚠️ Grace period: ${graceStatus}\n` +
    `─────────────────\n` +
    `💰 $YIN BALANCE: ${yinBal}\n` +
    `📈 Streak multiplier: ${yin.streakMultiplier}x\n` +
    `🏅 Rank multiplier: ${yin.rankMultiplier}x\n` +
    `💎 Earning rate: ${yin.amount} $YIN/post\n` +
    `─────────────────`,
    opts
  );
});

// ─── /balance and /yin ────────────────────────────────────────────────────────

bot.onText(/\/(balance|yin)(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = getUsername(msg);
  const data = loadData();
  const user = data[userId];
  const opts = { message_thread_id: msg.message_thread_id };

  if (!user) {
    bot.sendMessage(chatId, `📭 No data yet ${username}!\nSend a LinkedIn post to start earning $YIN.`, opts);
    return;
  }

  const yinBal = user.yin || 0;
  const todayEarned = getTodayYIN(user);
  const weekEarned = getWeekYIN(user);

  bot.sendMessage(chatId,
    `💰 $YIN BALANCE — ${username}\n─────────────────\n` +
    `Current balance: ${yinBal} $YIN\n` +
    `─────────────────\n` +
    `Today's earnings: +${todayEarned} $YIN\n` +
    `This week: +${weekEarned} $YIN\n` +
    `All time: ${yinBal} $YIN\n` +
    `─────────────────\n` +
    `Keep posting to earn more! 💼`,
    opts
  );
});

// ─── /yinleaderboard and /richlist ────────────────────────────────────────────

bot.onText(/\/(yinleaderboard|richlist)(@\w+)?/, (msg) => {
  const chatId = msg.chat.id;
  const data = loadData();
  const entries = Object.values(data);
  const opts = { message_thread_id: msg.message_thread_id };

  if (entries.length === 0) {
    bot.sendMessage(chatId, '📭 No $YIN earned yet! Be the first to post.', opts);
    return;
  }

  const sorted = entries
    .slice()
    .sort((a, b) => (b.yin || 0) - (a.yin || 0))
    .slice(0, 10);

  const rows = sorted.map((u, i) => {
    const crown = i === 0 ? ' 👑' : '';
    return `${i + 1}. @${u.username} — ${u.yin || 0} $YIN${crown}`;
  }).join('\n');

  bot.sendMessage(chatId,
    `💰 $YIN RICH LIST\n─────────────────\n${rows}\n─────────────────\nEarn $YIN by posting daily on LinkedIn!`,
    opts
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
