# Family Learning Assistant

Family learning assistant built on Cloudflare Workers + D1, featuring wrong question management, spaced repetition, AI speaking practice, and complete learning functionality.

> 本仓库为 demo 演示项目。所有数据均为虚构示例。
> *This is a demo project. All data are fictional examples.*

---

## Online Demo

**Deployment URL**: `https://learn.obsync.xyz/`

> 部署后替换为你的 Worker 地址 / Replace with your Worker URL after deployment.

---

## Features

| Feature | Description |
|---------|-------------|
| **Dual Engine Architecture** | Review Engine (review) + Learning Engine (introduction) |
| **Wrong Question Management** | Photo upload, 4-level spaced repetition, mastery marking |
| **Spaced Repetition** | Correct +3 days / Wrong +1 day / 3 consecutive correct = Mastered |
| **English Learning** | 6 major unit vocabulary, reading practice, TTS pronunciation |
| **Points System** | Points accumulation, badge rewards, learning incentives |
| **PWA** | Supports iPad/Android add to home screen |

---

## Architecture

```
┌──────────────┐     ┌─────────────────┐     ┌─────────────┐
│   iPad /     │────▶│ Cloudflare Edge │────▶│     D1     │
│   Android    │     │    Workers     │     │  SQLite    │
└──────────────┘     └────────┬────────┘     └─────────────┘
                              │
                     ┌────────▼────────┐
                     │   Web Speech   │
                     │   (TTS 发音)   │
                     └─────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| Cloudflare Workers | Edge computing API |
| Cloudflare D1 | SQLite distributed database |
| Cloudflare Pages | PWA static hosting |
| JavaScript (ES6+) | Primary development language |
| Web Speech API | TTS pronunciation (browser native) |
| PWA | Cross-platform application |

---

## Project Structure

```
learn-family-assistant/
├── src/
│   └── worker.js              # Cloudflare Worker main code (~1150 lines)
├── db-schema.sql             # D1 database schema (8 tables)
├── seed-bb.sql               # Elder child 79 required questions seed
├── seed-xb.sql               # Younger child 99 introductory questions seed
├── wrangler.toml             # Wrangler configuration
└── README.md
```

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/Jonathan987321123/learn-family-assistant.git
cd learn-family-assistant
```

### 2. Initialize D1 Database

```bash
# Create D1 database
npx wrangler d1 create learn-family-assistant

# Fill database_id in wrangler.toml

# Initialize table structure
npx wrangler d1 execute learn-family-assistant --local --file=db-schema.sql

# Import question banks
npx wrangler d1 execute learn-family-assistant --local --file=seed-bb.sql
npx wrangler d1 execute learn-family-assistant --local --file=seed-xb.sql
```

### 3. Configure environment variables

```bash
# Set KV namespace (video cache)
npx wrangler kv:namespace create VIDEOS
```

### 4. Deploy

```bash
npx wrangler deploy
```

---

## API Endpoints

### Get children list

```bash
curl https://your-worker.workers.dev/api/child/list
```

### Get today's tasks

```bash
curl https://your-worker.workers.dev/api/today?child_id=1&limit=10 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Submit answer

```bash
curl -X POST https://your-worker.workers.dev/api/answer \
  -H "Content-Type: application/json" \
  -d '{
    "child_id": 1,
    "item_id": 123,
    "item_type": "wrong_book",
    "answer": "56"
  }'
```

### Upload wrong question

```bash
curl -X POST https://your-worker.workers.dev/api/upload \
  -F "child_id=1" \
  -F "subject=数学" \
  -F "note=口算错误" \
  -F "correct_answer=56" \
  -F "image=@wrong.jpg"
```

### Get points

```bash
curl https://your-worker.workers.dev/api/points?child_id=1
```

### Get English units

```bash
curl https://your-worker.workers.dev/api/english/units
```

---

## Database Schema

| Table Name | Purpose |
|-----------|---------|
| `child` | Children information |
| `wrong_book` | Wrong questions (with image base64) |
| `review_item` | Required questions |
| `points` | Points system |
| `badge` | Badge system |
| `quiz_session` | Quiz sessions (legacy) |
| `quiz_item` | Quiz questions (legacy) |
| `wrong_photo` | Wrong question photos (legacy compatibility) |

---

## Spaced Repetition Algorithm

| State | next_review_date change |
|-------|------------------------|
| First learning | Tomorrow |
| Correct | +3 days |
| Wrong | +1 day |
| 3 consecutive correct | Mastered (mastered=1) |

---

## License

MIT
