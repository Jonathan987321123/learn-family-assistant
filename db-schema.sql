-- ============================================================
-- 家庭学习助手 D1 数据库 Schema
-- 部署: learn.obsync.xyz
-- 复用 OBSYNC 账户（dongjunastrill）
-- ============================================================

-- 1. 孩子
CREATE TABLE IF NOT EXISTS child (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,              -- '一上' / '二下'
  avatar TEXT,                     -- emoji 头像
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. 间隔复习核心（spaced repetition）
CREATE TABLE IF NOT EXISTS review_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL,
  content_type TEXT NOT NULL,       -- '古诗' / '生字' / '口算' / '错题' / '课文' / '单词' / '句型'
  content_ref TEXT NOT NULL,        -- 关联 ID 或 "春晓" 文字
  prompt TEXT,                     -- 题干（可选）
  answer TEXT,                     -- 答案（可选）
  learned_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed_at TEXT,
  next_review_at TEXT NOT NULL DEFAULT (date('now', '+1 day')),
  review_count INTEGER DEFAULT 0,
  consecutive_correct INTEGER DEFAULT 0,
  mastered INTEGER DEFAULT 0,
  FOREIGN KEY (child_id) REFERENCES child(id)
);

CREATE INDEX IF NOT EXISTS idx_review_due ON review_item(child_id, next_review_at, mastered);

-- 3. 错题照片
CREATE TABLE IF NOT EXISTS wrong_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL,
  subject TEXT NOT NULL,            -- '语文' / '数学' / '英语'
  unit TEXT,                       -- '古诗' / '应用题' / '听写' / '单词'
  r2_url TEXT NOT NULL,
  note TEXT,                       -- 家长备注
  mastered INTEGER DEFAULT 0,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (child_id) REFERENCES child(id)
);

CREATE INDEX IF NOT EXISTS idx_photo_child ON wrong_photo(child_id, subject);

-- 4. 测验会话（口算闯关）
CREATE TABLE IF NOT EXISTS quiz_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  total INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  duration_ms INTEGER,
  FOREIGN KEY (child_id) REFERENCES child(id)
);

-- 5. 测验题目
CREATE TABLE IF NOT EXISTS quiz_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  user_answer TEXT,
  correct_answer TEXT NOT NULL,
  is_correct INTEGER,
  duration_ms INTEGER,
  FOREIGN KEY (session_id) REFERENCES quiz_session(id)
);

-- 6. 积分
CREATE TABLE IF NOT EXISTS points (
  child_id INTEGER PRIMARY KEY,
  total_points INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  last_active_date TEXT,
  FOREIGN KEY (child_id) REFERENCES child(id)
);

-- 7. 徽章
CREATE TABLE IF NOT EXISTS badge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL,
  badge_type TEXT NOT NULL,         -- '坚持7天' / '50题' / '全对' / '背诵王'
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(child_id, badge_type),
  FOREIGN KEY (child_id) REFERENCES child(id)
);

-- ============================================================
-- 初始化：插入 2 个孩子
-- ============================================================
INSERT INTO child (name, grade, avatar) VALUES ('大宝', '二下', '👦');
INSERT INTO child (name, grade, avatar) VALUES ('小宝', '一上', '👧');

INSERT INTO points (child_id, total_points) VALUES (1, 0);
INSERT INTO points (child_id, total_points) VALUES (2, 0);
