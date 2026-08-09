-- 0009 — thêm announcements + announcement_deliveries cho DB đã tạo trước khi hai bảng này có mặt.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 chỉ chạy 1 lần trên volume
-- rỗng. Volume rỗng chạy 0001 (đã có hai bảng) rồi 0009 (no-op nhờ IF NOT EXISTS).
-- Chạy: psql "$DATABASE_URL" -f migrations/0009_announcements.sql

BEGIN;

-- announcements — bản gốc MỘT tin phát chung tới mọi nhóm đại lý (vd kho báo hết hàng).
-- Text soạn 1 lần và nằm ở đây; mọi nhóm phải đọc đúng cùng một câu.
--
-- HAI CHỮ KÝ mới phát được: thủ kho chốt (created_by) rồi người duyệt đích danh gật (approved_by).
-- status: 0 = chờ duyệt, 1 = đã duyệt, 2 = bị từ chối. Chỉ 1 mới có row nhận tới hạn gửi.
CREATE TABLE IF NOT EXISTS announcements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text        NOT NULL,       -- het_hang | ... (soát/thống kê)
  text                text        NOT NULL,       -- NGUYÊN VĂN gửi đi
  status              smallint    NOT NULL DEFAULT 0,
  created_by          text        NOT NULL,       -- senderId thủ kho chốt (audit)
  origin_channel      text        NOT NULL,       -- phòng báo ngược kết quả duyệt
  origin_conversation text        NOT NULL,
  approved_by         text,                       -- user_id người duyệt (audit)
  approved_at         timestamptz,
  reject_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_status_chk CHECK (status IN (0, 1, 2))
);

CREATE INDEX IF NOT EXISTS announcements_awaiting
  ON announcements (created_at)
  WHERE status = 0;

-- announcement_deliveries — 1 row mỗi nhóm nhận. Worker chết giữa đợt phát thì row chưa gửi vẫn
-- còn, poller tick sau gửi tiếp. next_attempt_at vừa là due-index vừa là ô CAS claim; NULL lúc
-- mới tạo = CHƯA ĐƯỢC DUYỆT, không tick nào nhặt.
CREATE TABLE IF NOT EXISTS announcement_deliveries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  uuid        NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  channel          text        NOT NULL,
  group_id         text        NOT NULL,
  customer_id      text        NOT NULL,          -- đại lý sở hữu nhóm (soát ai chưa nhận)
  status           smallint    NOT NULL DEFAULT 0, -- DeliveryStatus: 0 pending, 1 sent, 2 failed
  attempts         integer     NOT NULL DEFAULT 0,
  last_error       text,                          -- lý do lần hỏng gần nhất
  next_attempt_at  timestamptz,                   -- NULL = chưa duyệt HOẶC thôi thử
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_deliveries_status_chk CHECK (status IN (0, 1, 2))
);

-- Một nhóm nhận MỘT lần mỗi đợt phát. Chặn ở DB: insert lại (retry lượt tool) không nhân đôi tin.
CREATE UNIQUE INDEX IF NOT EXISTS announcement_deliveries_target_uniq
  ON announcement_deliveries (announcement_id, channel, group_id);

CREATE INDEX IF NOT EXISTS announcement_deliveries_due
  ON announcement_deliveries (next_attempt_at)
  WHERE status = 0;

CREATE INDEX IF NOT EXISTS announcement_deliveries_by_announcement
  ON announcement_deliveries (announcement_id);

COMMIT;
