// Run this once to restore known user streaks: node seed.js
// Entries are keyed by @username. The bot auto-migrates them to real
// Telegram user IDs the next time each person sends a message.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const STREAKS_FILE = path.join(DATA_DIR, 'streaks.json');

// Yesterday so each user can post today to continue their streak
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const lastPost = yesterday.toISOString().slice(0, 10);

const KNOWN_USERS = [
  { username: 'Daniel_Simplicity', streak: 8 },
  { username: 'simple_toxa',       streak: 7 },
  { username: 'MarianneOnTG',      streak: 6 },
  { username: 'Alex_Simplicity',   streak: 4 },
  { username: 'GalileoWil',        streak: 4 },
  { username: 'Truunik',           streak: 3 },
  { username: 'aBitCrafty',        streak: 3 },
  { username: 'Jumperz11',         streak: 2 },
  { username: 'camskimood',        streak: 1 },
  { username: 'Tusharlog',         streak: 1 },
];

let data = {};
try {
  if (fs.existsSync(STREAKS_FILE)) {
    data = JSON.parse(fs.readFileSync(STREAKS_FILE, 'utf8'));
    console.log(`Loaded existing streaks.json (${Object.keys(data).length} entries)`);
  }
} catch {
  console.warn('No existing streaks.json — starting fresh.');
}

let seeded = 0;
let skipped = 0;

for (const u of KNOWN_USERS) {
  const key = `@${u.username.toLowerCase()}`;

  // Skip if already present under any key (real ID or username key)
  const alreadyExists = Object.values(data).some(
    v => v.username && v.username.toLowerCase() === u.username.toLowerCase()
  );
  if (alreadyExists) {
    console.log(`  skip  @${u.username} — already in data`);
    skipped++;
    continue;
  }

  data[key] = {
    username: u.username,
    streak: u.streak,
    longest: u.streak,
    lastPost,
    totalPosts: u.streak,
    gracePeriodUsed: false,
    posts: [],
    yin: 0,
    yinHistory: [],
  };
  console.log(`  seeded @${u.username} — streak: ${u.streak}, lastPost: ${lastPost}`);
  seeded++;
}

fs.writeFileSync(STREAKS_FILE, JSON.stringify(data, null, 2));
console.log(`\nDone. Seeded: ${seeded}, Skipped: ${skipped}. File: ${STREAKS_FILE}`);
