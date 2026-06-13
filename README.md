# Family Learning Assistant

> 本仓库为 demo 演示项目。所有数据均为虚构示例。

基于 Cloudflare Workers + D1 构建的家庭学习助手，支持错题管理、间隔复习、AI 口语等完整学习功能。

## 在线 Demo

**部署地址**：`https://learn.obsync.xyz/`

> 部署后替换为你的 Worker 地址

## 功能特性

| 功能 | 说明 |
|------|------|
| 双引擎架构 | Review Engine（复习）+ Learning Engine（入门）|
| 错题管理 | 拍照录入、4级间隔复习、掌握标记 |
| 间隔复习 | 答对+3天 / 错+1天 / 连3次对=掌握 |
| 英语学习 | 6大单元词汇、跟读练习、TTS发音 |
| 积分系统 | 积分累计、徽章奖励、学习激励 |
| PWA | 支持 iPad/Android 添加到主屏幕 |

## 架构图

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

## 技术栈

| 技术 | 用途 |
|------|------|
| Cloudflare Workers | 边缘计算 API |
| Cloudflare D1 | SQLite 分布式数据库 |
| Cloudflare Pages | PWA 静态托管 |
| JavaScript (ES6+) | 主开发语言 |
| Web Speech API | TTS 发音（浏览器原生）|
| PWA | 跨平台应用 |

## 项目结构

```
learn-family-assistant/
├── src/
│   └── worker.js              # Cloudflare Worker 主代码 (~1150 lines)
├── db-schema.sql             # D1 数据库 schema (8 tables)
├── seed-bb.sql               # 大宝 79 条必背题 seed
├── seed-xb.sql               # 小宝 99 条入门题 seed
├── wrangler.toml             # Wrangler 配置
└── README.md
```

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/Jonathan987321123/learn-family-assistant.git
cd learn-family-assistant
```

### 2. 初始化 D1 数据库

```bash
# 创建 D1 数据库
npx wrangler d1 create learn-family-assistant

# 将 database_id 填入 wrangler.toml

# 初始化表结构
npx wrangler d1 execute learn-family-assistant --local --file=db-schema.sql

# 导入题库
npx wrangler d1 execute learn-family-assistant --local --file=seed-bb.sql
npx wrangler d1 execute learn-family-assistant --local --file=seed-xb.sql
```

### 3. 配置环境变量

```bash
# 设置 KV 命名空间（视频缓存）
npx wrangler kv:namespace create VIDEOS
```

### 4. 部署

```bash
npx wrangler deploy
```

## API 接口

### 获取孩子列表
```bash
curl https://your-worker.workers.dev/api/child/list
```

### 获取今日任务
```bash
curl https://your-worker.workers.dev/api/today?child_id=1&limit=10 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 提交答案
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

### 上传错题
```bash
curl -X POST https://your-worker.workers.dev/api/upload \
  -F "child_id=1" \
  -F "subject=数学" \
  -F "note=口算错误" \
  -F "correct_answer=56" \
  -F "image=@wrong.jpg"
```

### 获取积分
```bash
curl https://your-worker.workers.dev/api/points?child_id=1
```

### 获取英语单元
```bash
curl https://your-worker.workers.dev/api/english/units
```

## 数据库表结构

| 表名 | 用途 |
|------|------|
| `child` | 孩子信息 |
| `wrong_book` | 错题库（含图片 base64）|
| `review_item` | 必背题库 |
| `points` | 积分系统 |
| `badge` | 徽章系统 |
| `quiz_session` | 测验会话（保留）|
| `quiz_item` | 测验题目（保留）|
| `wrong_photo` | 错题照片（兼容旧数据）|

## 间隔复习算法

| 状态 | next_review_date 变化 |
|------|----------------------|
| 第一次学 | 明天 |
| 答对 | +3 天 |
| 答错 | +1 天 |
| 连 3 次对 | 掌握 (mastered=1) |

## License

MIT