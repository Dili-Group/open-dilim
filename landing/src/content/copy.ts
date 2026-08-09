// Toàn bộ chữ của landing page. Sửa nội dung ở đây, không sửa trong component.
// Nguồn: landing/LANDING-PLAN.md

/**
 * Số liệu vận hành thật. design-system §1: "Số liệu chỉ khi cụ thể và có nguồn."
 * `6 agent` khớp đúng số root agent trong src/agents/registry.ts — kiểm chứng được.
 */
export const STATS = [
  { value: 200, suffix: "+", label: "đại lý đang chạy" },
  { value: 300, suffix: "+", label: "đơn xử lý mỗi ngày" },
  { value: 6, suffix: "", label: "agent chuyên trách" },
] as const;

/** Không đếm — hằng số thật, hiển thị nguyên văn. */
export const STAT_ALWAYS_ON = { value: "24/7", label: "agent luôn trực" } as const;

export const HERO = {
  eyebrow: "DiLiM · Hệ vận hành luôn mở",
  headlineLines: ["Đơn của bạn có người trực.", "Kể cả 2 giờ sáng."],
  sub: "DiLiM vận hành bằng đội agent AI chuyên trách — tra đơn, báo hết hàng, chốt sổ cuối ngày. Nhắn là có trả lời, không chờ giờ hành chính, không “để em hỏi lại”.",
  ctaPrimary: "Đăng ký làm đại lý",
  ctaSecondary: "Chat thử agent ngay",
  ctaNote: "Miễn phí. Không cần nhập gì trước khi chat.",
} as const;

/** TODO(link): thay bằng URL thật — form đăng ký và deep-link Zalo OA. */
export const LINKS = {
  register: "https://dangky.dilisupplement.com/",
  zaloChat: "https://dangky.dilisupplement.com/",
} as const;

/**
 * Sơ đồ định tuyến: đại lý nhắn → DiLiM (agent điều phối) → root agent chuyên trách.
 * Đúng luồng thật: message-ingest → router.ts → registry.resolve(agentType).
 * Không có toạ độ ở đây — component vẽ đường từ vị trí DOM thật của từng node.
 */
export const AGENT_ROUTING = {
  label: "Sơ đồ định tuyến",
  source: { icon: "message-circle", label: "Đại lý", note: "Nhắn trên các kênh liên lạc" },
  hub: { label: "DiLiM", note: "Agent điều phối" },
  targets: [
    { id: "dealer", icon: "shopping-bag", label: "Agent đại lý", note: "Nhóm chat hỗ trợ của bạn" },
    { id: "operations", icon: "settings-2", label: "Agent vận hành", note: "Nhóm Sales Admin" },
    { id: "warehouse", icon: "warehouse", label: "Agent kho", note: "Nhóm kho" },
    {
      id: "boss",
      icon: "chart-no-axes-column",
      label: "Agent lãnh đạo",
      note: "Nhóm giám đốc",
    },
    { id: "personal", icon: "user-round", label: "Trợ lý riêng", note: "Chat 1-1" },
  ],
  caption:
    "Một tin nhắn vào, điều hướng đúng nơi",
} as const;

/** §3 Problem — PAS. Ba cảnh có thật đại lý gặp, không phải nỗi đau bịa. */
export const PROBLEM = {
  heading: "Bán hàng thì dễ. Chờ câu trả lời mới mệt.",
  lead: "Bạn không sợ bán ế. Bạn sợ khách hỏi “đơn em tới đâu rồi” mà bạn không biết trả lời sao.",
  cards: [
    {
      icon: "clock",
      title: "22:14 — đơn nằm im ba ngày",
      body: "Khách nhắn hỏi lần thứ tư. Bạn nhắn vào nhóm. Nhóm im. Sáng mai mới có người đọc. Đến lúc biết lý do thì khách đã huỷ.",
    },
    {
      icon: "package-x",
      title: "Hết hàng mà không ai báo",
      body: "Bạn lên đơn, khách chuyển khoản xong. Ba ngày sau mới biết trong đơn có món hết hàng. Người xin lỗi khách là bạn, không phải kho.",
    },
    {
      icon: "receipt-text",
      title: "Cuối tháng không khớp sổ",
      body: "Đơn xuất bao nhiêu, hoàn về bao nhiêu, phải chuyển bao nhiêu tiền — mỗi thứ nằm một nơi. Bạn ngồi cộng tay lúc 11 giờ đêm, và vẫn không chắc đúng.",
    },
  ],
  close:
    "Không phải người hỗ trợ tệ. Là vì họ ngủ, họ nghỉ lễ, họ đang bận 200 đại lý khác. Bạn thì cần câu trả lời ngay lúc khách đang hỏi.",
} as const;

/**
 * §4 Solution — 6 root agent đang chạy thật (src/agents/roots/).
 * `icon` là tên icon Lucide; design-system §7 cấm emoji.
 */
export const AGENT_SECTION = {
  eyebrow: "Kiến trúc vận hành",
  heading: "Không phải một con bot. Là một đội.",
  lead: "Mỗi nhóm việc trong DiLiM có một agent riêng — prompt riêng, quyền riêng, trí nhớ riêng. Giống một công ty có phòng ban, chỉ khác là không phòng nào nghỉ trưa.",
  cards: [
    {
      icon: "shopping-bag",
      name: "Agent đại lý",
      where: "Nhóm Zalo của chính bạn",
      does: "Tra đơn, huỷ đơn, hỏi số tiền, xin video đóng gói, kiểm hết hàng, tra bậc chiết khấu.",
    },
    {
      icon: "settings-2",
      name: "Agent vận hành",
      where: "Nhóm Sales Admin",
      does: "Điều phối đơn, xử lý ca khó, đặt lịch việc chạy tự động theo giờ.",
    },
    {
      icon: "warehouse",
      name: "Agent kho",
      where: "Nhóm kho",
      does: "Đọc mã vận đơn hàng hoàn về, truy ngược đơn hoàn đó thuộc đại lý nào.",
    },
    {
      icon: "chart-no-axes-column",
      name: "Agent lãnh đạo",
      where: "Nhóm ban giám đốc",
      does: "Tổng hợp số liệu để ra quyết định, không phải để báo cáo cho đẹp.",
    },
    {
      icon: "user-round",
      name: "Trợ lý riêng",
      where: "Chat 1-1",
      does: "Việc cá nhân. Không đọc, không ghi bất cứ dữ liệu nào của nhóm.",
    },
    {
      icon: "compass",
      name: "Agent điều phối",
      where: "Chạy nền",
      does: "Đọc tin của bạn rồi giao đúng agent chuyên môn. Không chắc thì không đoán.",
    },
  ],
  notes: [
    {
      title: "Agent nhớ bạn",
      body: "Hệ thống chắt lọc điều đáng nhớ rồi lưu theo đúng nhóm của bạn. Lần sau không phải kể lại từ đầu, và nhóm này không đọc được gì của nhóm kia.",
    },
    {
      title: "Agent tự làm việc",
      body: "Tra dữ liệu thật trong hệ thống, mở quy trình xử lý, hẹn giờ chạy lại. Không phải chatbot đọc kịch bản có sẵn.",
    },
    {
      title: "Agent nhắn trước",
      body: "5 giờ chiều tự gửi báo cáo chốt ngày. Đơn kẹt tự báo. Bạn không phải nhớ đi hỏi.",
    },
  ],
} as const;

export const COMPANY = {
  name: "Công ty Cổ phần DiLi Supplement",
  taxId: "0317563019",
  licensedAt: "11/11/2022",
  address:
    "50 Đường số T21, Khu The Manhattan Glory, Dự án Khu dân cư, Phường Long Bình, Thành phố Thủ Đức, TP. Hồ Chí Minh, Việt Nam",
  representative: "Ông Lê Chí Linh",
  phone: "0902 396 230",
  email: "ketoan.dili@gmail.com",
  workingHours: "08h00 – 17h00, thứ Hai đến thứ Bảy",
  copyright: "© 2026 | DILI",
} as const;

/**
 * §5 FAQ. Câu hỏi viết đúng cách người ta gõ vào ô tìm kiếm ("DiLiM là gì",
 * "khác chatbot chỗ nào") — cùng nội dung này được đẩy lên schema FAQPage
 * trong `JsonLd` để Google hiển thị dạng rich result.
 * Câu trả lời phải khớp sự thật ở PROBLEM/AGENT_SECTION, không hứa thêm.
 */
export const FAQ = {
  eyebrow: "Câu hỏi thường gặp",
  heading: "Hỏi gì trước khi bắt đầu?",
  items: [
    {
      q: "DiLiM là gì?",
      a: "DiLiM là hệ vận hành chạy bằng đội agent AI cho đại lý của DiLi Supplement. Bạn nhắn trong nhóm như nhắn cho người hỗ trợ, agent tra dữ liệu thật trong hệ thống rồi trả lời ngay — tra đơn, kiểm hết hàng, chốt sổ cuối ngày, bất kể mấy giờ.",
    },
    {
      q: "Agent AI của DiLiM khác chatbot thường ở chỗ nào?",
      a: "Chatbot đọc kịch bản có sẵn. Agent DiLiM tra dữ liệu thật trong hệ thống đơn hàng, mở quy trình xử lý nhiều bước, hẹn giờ chạy lại và nhắn cho bạn trước khi bạn kịp hỏi. Không có câu trả lời thì nói không biết, không đoán.",
    },
    {
      q: "DiLiM có bao nhiêu agent và mỗi agent làm gì?",
      a: "6 agent chuyên trách: agent đại lý (nhóm chat hỗ trợ của bạn), agent vận hành (Sales Admin), agent kho, agent lãnh đạo, trợ lý riêng 1-1 và agent điều phối chạy nền. Mỗi agent có prompt riêng, quyền riêng và trí nhớ riêng.",
    },
    {
      q: "Dùng DiLiM ở đâu, có phải cài app không?",
      a: "Không cài gì. Agent nằm sẵn trong nhóm chat của bạn. Nhắn tin bình thường là dùng được.",
    },
    {
      q: "Dữ liệu nhóm tôi có bị nhóm khác đọc được không?",
      a: "Không. Trí nhớ lưu theo đúng nhóm, nhóm này không đọc được gì của nhóm kia. Trợ lý riêng trong chat 1-1 thì không đọc, không ghi bất cứ dữ liệu nào của nhóm.",
    },
    {
      q: "Chat thử có mất phí không?",
      a: "Miễn phí và không cần nhập gì trước khi chat. Bạn nhắn thử, thấy hợp thì đăng ký làm đại lý.",
    },
    {
      q: "Đăng ký làm đại lý DiLiM như thế nào?",
      a: "Điền form đăng ký đại lý trên trang này. Sau khi duyệt, nhóm chat hỗ trợ của bạn được tạo và agent đại lý vào nhóm cùng lúc — không có bước cài đặt riêng.",
    },
  ],
} as const;
