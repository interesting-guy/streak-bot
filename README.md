# StreakBot

A Telegram bot that tracks daily LinkedIn posting streaks for group members.

## Setup

1. **Get a bot token** from [@BotFather](https://t.me/BotFather) on Telegram.

2. **Disable privacy mode** so the bot can read all group messages:
   - Open @BotFather → `/mybots` → select your bot → **Bot Settings** → **Group Privacy** → **Turn off**

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Configure your token:**
   ```bash
   cp .env.example .env
   # Edit .env and replace your_token_here with your actual bot token
   ```

5. **Run the bot:**
   ```bash
   node bot.js
   # or for development with auto-restart:
   npx nodemon bot.js
   ```

## Commands

| Input | Description |
|---|---|
| `posted <linkedin_url>` | Log a LinkedIn post and update streak |
| `/streak` | Show your current streak and stats |
| `/leaderboard` | Top 10 streaks in the group |
| `/mystats` | Your full stats |

## Streak Rules

- Post once per day → streak continues
- Miss 1 day → grace period (streak still alive, warning shown)
- Miss 2+ days → streak resets to 0
- Posting twice in the same day → already-posted message

## Data

Streaks are stored locally in `streaks.json`. If the file is corrupted, the bot starts fresh automatically.
