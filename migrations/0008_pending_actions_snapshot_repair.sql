-- 0008 — vá `pending_actions.state_snapshot` bị double-encode (bug bind jsonb của store.ts).
--
-- `${chuỗi}::jsonb` khiến Bun JSON-encode chuỗi đã-là-JSON thêm lần nữa → cột lưu một jsonb
-- *string scalar* thay vì object. Hai hình dạng hỏng có trong bảng:
--
--   'string' : row còn treo         → '"{\"origin\":...,\"state\":...}"'
--   'array'  : row đã trả lời       → '["{\"origin\":...}", "{\"answer\":...}"]'
--              (`state_snapshot || patch` nối hai scalar thành mảng, không merge)
--
-- Hậu quả: `state_snapshot -> 'origin'` ra NULL (openForOrigin mù), và row 'array' không parse
-- được nữa → resolve() trả undefined → KHÔNG báo kết quả về nhóm đã hỏi.
--
-- Code đã sửa (::text::jsonb) nên row mới ghi đúng; migration này chỉ nắn row cũ về object.
--
-- Chạy: psql "$DATABASE_URL" -f migrations/0008_pending_actions_snapshot_repair.sql

BEGIN;

-- 'string' → parse một lần: `#>> '{}'` lấy nội dung text của scalar rồi ép lại thành jsonb.
UPDATE pending_actions
SET state_snapshot = (state_snapshot #>> '{}')::jsonb
WHERE jsonb_typeof(state_snapshot) = 'string';

-- 'array' → parse từng phần tử rồi merge lại thành đúng object mà `||` lẽ ra phải cho.
UPDATE pending_actions p
SET state_snapshot = m.merged
FROM (
  SELECT approval_id,
         (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            FROM jsonb_array_elements(a.state_snapshot) AS elem,
                 LATERAL jsonb_each((elem #>> '{}')::jsonb) AS e)
           AS merged
    FROM pending_actions a
   WHERE jsonb_typeof(a.state_snapshot) = 'array'
) m
WHERE p.approval_id = m.approval_id;

COMMIT;
