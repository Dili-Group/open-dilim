# 9. Nguyên tắc thiết kế (chốt)

1. **ACK ≠ answer.** Ingress trả 202 ngay, câu trả lời đến sau qua broadcast.
2. **Correlation-id xuyên suốt.** `msgId` + `conversationId` đi từ ingress → egress để map response ↔ request.
3. **Idempotency bắt buộc.** Broker retry → msg tới 2 lần → dedupe theo `msgId`.
4. **Factory cho ingest & broadcast.** Thêm channel = thêm 1 adapter + 1 dòng register, core 0 đổi.
5. **Interface ẩn implementation.** Broker/Store/LLM đều sau interface → thay được không sửa core.
6. **Danh tính do backend inject — act-as bind từ `identity`, không từ LLM.** Agent gọi hệ vận hành thay user → act-as handle (`user_id` nhân viên / `customer_id` đại lý) lấy từ `identity` resolve server-side ([bước 6 AUTH](./05b-dinh-danh-va-vai.md)), KHÔNG nằm trong tool schema, KHÔNG từ tham số LLM sinh. Message người dùng = untrusted → tool nhận danh tính qua closure sẽ bị prompt-injection chiếm quyền (confused-deputy): đại lý A rút data đại lý B. Tool chỉ nhận tham số nghiệp vụ.
7. **Write không tự thực thi.** Tạo `pending_action` → confirm mới execute.
8. **Sub-agent context riêng.** Chạy song song, trả kết quả gọn về orchestrator.
9. **LLM đa provider sau interface.** Agent loop gọi `LLMProvider` chung, không bind Anthropic/Gemini. Đổi provider = đổi config; thêm provider = 1 file trong `llm/providers/` + 1 dòng register.
10. **`agentType` route, không cấp quyền.** Client gửi `agentType` chỉ chọn root agent; quyền luôn theo `identity` backend inject. Whitelist enum + map identity→allowed-type + agent tự gate tool.
11. **Quyền theo `senderId`, không theo phòng.** `conversationId`=phòng, `senderId`=người gửi từng message. Group không có "quyền group" — mỗi câu quyền theo người gửi câu đó.
12. **Group chỉ chạy khi mention.** `isGroup` + mention @agent mới trigger loop; câu khác nuốt vào history làm ngữ cảnh. Nhiều message/phòng → serialize theo `conversationId`.
13. **Memory 2 tầng, informs≠authorizes.** Ngắn hạn = session buffer/phòng; dài hạn = pgvector theo `user_id`. Memory chỉ giữ fact bền (không lưu fact động → DB-first), gợi ý chứ không cấp quyền — WRITE thật phải re-verify DB + approval.
14. **Cron = ingress theo thời gian.** Scheduler tự sinh Envelope `source=cron` → tái dùng nguyên pipeline (không path mới). Fire-once (leader-lock + idempotent `msgId`); không bypass quyền (`agentType` whitelist + `identity` auth); output có `target` rõ. Approval-timeout sweep = 1 cron job.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
