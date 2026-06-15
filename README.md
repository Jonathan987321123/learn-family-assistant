# Family Learning Assistant
# 家庭学习助手

> 本仓库为 demo 演示项目。所有数据均为虚构示例。
> This is a demo project. All data are fictional examples.

---

## 🌐 Online Demo | 在线演示

**Deployment URL / 部署地址**: `https://learn.obsync.xyz/`

> 部署后替换为你的 Worker 地址
> Replace with your Worker URL after deployment.

---

## ✨ Features | 功能特性

| Feature / 功能 | Description / 说明 |
|----------------|--------------------|
| **Dual Engine Architecture** | Review Engine (review) + Learning Engine (introduction) / 双引擎架构：复习引擎 + 学习引擎 |
| **Wrong Question Management** | Photo upload, 4-level spaced repetition, mastery marking / 错题管理：拍照录入、4级间隔复习、掌握标记 |
| **Spaced Repetition** | Correct +3 days / Wrong +1 day / 3 consecutive correct = Mastered / 间隔复习：答对+3天 / 错+1天 / 连3次对=掌握 |
| **English Learning** | 6 major unit vocabulary, reading practice, TTS pronunciation / 英语学习：6大单元词汇、跟读练习、TTS发音 |
| **Points System** | Points accumulation, badge rewards, learning incentives / 积分系统：积分累计、徽章奖励、学习激励 |
| **PWA** | Supports iPad/Android add to home screen / 支持 iPad/Android 添加到主屏幕 |

---

## 🏗️ Architecture | 架构图

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

## 🛠️ Tech Stack | 技术栈

| Technology / 技术 | Purpose / 用途 |
|-------------------|----------------|
| Cloudflare Workers | Edge computing API / 边缘计算 API |
| Cloudflare D1 | SQLite distributed database / SQLite 分布式数据库 |
| Cloudflare Pages | PWA static hosting / PWA 静态托管 |
| JavaScript (ES6+) | Primary development language / 主开发语言 |
| Web Speech API | TTS pronunciation (browser native) / TTS 发音（浏览器原生）|
| PWA | Cross-platform application / 跨平台应用 |

---

## 📁 Project Structure | 项目结构

```
learn-family-assistant/
├── src/
│   └── worker.js              # Cloudflare Worker 主代码 (~1150 行) / Main code (~1150 lines)
├── db-schema.sql             # D1 数据库 schema (8 张表) / Database schema (8 tables)
├── seed-bb.sql               # 大宝 79 条必背题 / Elder child 79 required questions
├── seed-xb.sql               # 小宝 99 条入门题 / Younger child 99 introductory questions
├── wrangler.toml             # Wrangler 配置 / Wrangler configuration
└── README.md
```

---

## 🚀 Quick Start | 快速开始

### 1. Clone the repository / 克隆仓库

```bash
git clone https://github.com/Jonathan987321123/learn-family-assistant.git
cd learn-family-assistant
```

### 2. Initialize D1 Database / 初始化 D1 数据库

```bash
# 创建 D1 数据库 / Create D1 database
npx wrangler d1 create learn-family-assistant

# 将 database_id 填入 wrangler.toml / Fill database_id in wrangler.toml

# 初始化表结构 / Initialize table structure
npx wrangler d1 execute learn-family-assistant --local --file=db-schema.sql

# 导入题库 / Import question banks
npx wrangler d1 execute learn-family-assistant --local --file=seed-bb.sql
npx wrangler d1 execute learn-family-assistant --local --file=seed-xb.sql
```

### 3. Configure environment variables / 配置环境变量

```bash
# 设置 KV 命名空间（视频缓存）/ Set KV namespace (video cache)
npx wrangler kv:namespace create VIDEOS
```

### 4. Deploy / 部署

```bash
npx wrangler deploy
```

---

## 📡 API Endpoints | API 接口

### Get children list / 获取孩子列表

```bash
curl https://your-worker.workers.dev/api/child/list
```

### Get today's tasks / 获取今日任务

```bash
curl https://your-worker.workers.dev/api/today?child_id=1&limit=10 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Submit answer / 提交答案

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

### Upload wrong question / 上传错题

```bash
curl -X POST https://your-worker.workers.dev/api/upload \
  -F "child_id=1" \
  -F "subject=数学" \
  -F "note=口算错误" \
  -F "correct_answer=56" \
  -F "image=@wrong.jpg"
```

### Get points / 获取积分

```bash
curl https://your-worker.workers.dev/api/points?child_id=1
```

### Get English units / 获取英语单元

```bash
curl https://your-worker.workers.dev/api/english/units
```

---

## 🗄️ Database Schema | 数据库表结构

| Table Name / 表名 | Purpose / 用途 |
|-------------------|---------------|
| `child` | Children information / 孩子信息 |
| `wrong_book` | Wrong questions (with image base64) / 错题库（含图片 base64）|
| `review_item` | Required questions / 必背题库 |
| `points` | Points system / 积分系统 |
| `badge` | Badge system / 徽章系统 |
| `quiz_session` | Quiz sessions (legacy) / 测验会话（保留）|
| `quiz_item` | Quiz questions (legacy) / 测验题目（保留）|
| `wrong_photo` | Wrong question photos (legacy compatibility) / 错题照片（兼容旧数据）|

---

## 🔄 Spaced Repetition Algorithm | 间隔复习算法

| State / 状态 | next_review_date change / next_review_date 变化 |
|--------------|--------------------------------------------------|
| First learning / 第一次学 | Tomorrow / 明天 |
| Correct / 答对 | +3 days / +3 天 |
| Wrong / 答错 | +1 day / +1 天 |
| 3 consecutive correct / 连 3 次对 | Mastered (mastered=1) / 掌握 (mastered=1) |

---

## 📄 License | 开源协议

MIT
