"""Draws the thesis diagrams (architecture, guard layers, strict-mode turn) into docs/do-an/hinh/."""
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

plt.rcParams["font.family"] = "Arial"
OUT = "docs/do-an/hinh"
os.makedirs(OUT, exist_ok=True)

COLORS = {
    "blue": ("#dbe8ff", "#2563eb"), "green": ("#dcfce7", "#16a34a"), "purple": ("#f3e8ff", "#7e22ce"),
    "red": ("#fde2e2", "#dc2626"), "orange": ("#ffedd5", "#ea580c"), "gray": ("#f1f3f5", "#6b7280"),
}

def box(ax, x, y, w, h, title, body="", color="gray", title_size=13, body_size=10.5):
    fill, edge = COLORS[color]
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=12", fc=fill, ec=edge, lw=2))
    if body:
        ax.text(x + w / 2, y + h - 22, title, ha="center", va="top", fontsize=title_size, fontweight="bold")
        ax.text(x + w / 2, y + h / 2 - 12, body, ha="center", va="center", fontsize=body_size, linespacing=1.5)
    else:
        ax.text(x + w / 2, y + h / 2, title, ha="center", va="center", fontsize=title_size, fontweight="bold")

def arrow(ax, x1, y1, x2, y2, label="", both=False, dashed=False, label_dx=0, label_dy=8):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="<|-|>" if both else "-|>", color="#4b5563", lw=1.8,
                                linestyle="--" if dashed else "-", mutation_scale=16))
    if label:
        ax.text((x1 + x2) / 2 + label_dx, (y1 + y2) / 2 + label_dy, label, ha="center", va="bottom", fontsize=10.5, color="#374151")

def canvas(w, h, title):
    fig, ax = plt.subplots(figsize=(w / 100, h / 100), dpi=150)
    ax.set_xlim(0, w); ax.set_ylim(0, h); ax.axis("off")
    ax.text(w / 2, h - 30, title, ha="center", va="top", fontsize=17, fontweight="bold")
    return fig, ax

# ---------------------------------------------------------------- 1. architecture
fig, ax = canvas(2000, 1250, "Kiến trúc tổng thể hệ thống")
box(ax, 80, 990, 400, 140, "Người dùng", "Trình duyệt web (Next.js / React)", "blue")
box(ax, 1520, 990, 400, 140, "Stream", "WebRTC video/audio, Stream Chat,\nghi hình, chép lời", "green")
box(ax, 1520, 700, 400, 160, "OpenAI Realtime", "gpt-realtime-2.1 (speech-to-speech)\ngpt-transcribe (chép lời tiếng Việt)", "purple")
arrow(ax, 480, 1060, 1520, 1060, "WebRTC (SRTP/DTLS)", both=True)
arrow(ax, 1720, 990, 1720, 860, "audio", both=True, label_dx=40, label_dy=-10)

ax.add_patch(FancyBboxPatch((560, 300), 860, 560, boxstyle="round,pad=0,rounding_size=14", fc="#f8fafc", ec="#6b7280", lw=2))
ax.text(990, 838, "Máy chủ ứng dụng Next.js (AWS EC2, Caddy HTTPS, pm2)", ha="center", va="top", fontsize=14, fontweight="bold")
box(ax, 600, 640, 370, 130, "API tRPC", "agents, meetings, premium", "blue")
box(ax, 1010, 640, 370, 130, "Webhook handler", "sự kiện Stream, chat", "blue")
box(ax, 600, 470, 370, 140, "Lớp kiểm duyệt", "realtime-guard, safety-events,\nchính sách phân mức", "red")
box(ax, 1010, 470, 370, 140, "Agent session", "kết nối agent, ghi transcript,\nẩn dữ liệu cá nhân", "purple")
ax.text(990, 345, "Better Auth (xác thực) · Drizzle ORM (truy cập dữ liệu) · Inngest (tóm tắt, hậu kiểm)", ha="center", fontsize=11.5)
arrow(ax, 280, 990, 280, 560); arrow(ax, 280, 560, 560, 560, "HTTPS: tRPC, Better Auth", label_dx=-10)
arrow(ax, 1540, 990, 1380, 740, "webhook", label_dx=-60, label_dy=0)
arrow(ax, 1520, 760, 1380, 560, "WebSocket điều khiển", dashed=True, label_dx=120, label_dy=-30)

lower = [(60, "Neon PostgreSQL", "users, agents, meetings,\nsafety_events, guard_turns,\ntranscript_items, pii_reveals", "gray"),
         (450, "NVIDIA NIM", "Nemotron Safety Guard 8B v3,\nNemoGuard JailbreakDetect", "red"),
         (840, "OpenAI API", "gpt-5.6-luna (jailbreak_llm,\nvn_policy), gpt-6.1-terra\n(tóm tắt, chat)", "purple"),
         (1230, "Inngest (tự vận hành)", "hàng đợi sự kiện, tác vụ nền", "orange"),
         (1620, "Polar", "gói dịch vụ, thanh toán", "gray")]
for x, t, b, c in lower:
    box(ax, x, 60, 330, 170, t, b, c, title_size=12.5, body_size=10)
    arrow(ax, 990 + (x + 165 - 990) * 0.45, 300, x + 165, 230)
ax.text(1000, 22, "Âm thanh cuộc gọi đi trực tiếp giữa Stream và OpenAI; máy chủ giữ kết nối điều khiển và nhận sự kiện văn bản.", ha="center", fontsize=10.5, color="#4b5563")
fig.savefig(f"{OUT}/kien-truc-tong-the.png", bbox_inches="tight", facecolor="white"); plt.close(fig)

# ---------------------------------------------------------------- 2. guard layers
fig, ax = canvas(2000, 1200, "Kiến trúc lớp kiểm duyệt (guardrail)")
for i, (t, b) in enumerate([("1. Trong cuộc gọi", "Chế độ strict: agent chỉ trả lời\nsau khi câu người dùng được duyệt (T = 2 s)"),
                            ("2. Chat sau cuộc họp", "Kiểm trước khi gọi mô hình chat\nvà trước khi gửi câu trả lời"),
                            ("3. Hậu kiểm sau cuộc gọi", "Inngest kiểm lại câu người dùng\ntrên bản chép lời của Stream")]):
    x = 80 + i * 640
    box(ax, x, 930, 560, 170, t, b, "blue")
    arrow(ax, x + 280, 930, x + 280 if i != 1 else 1000, 850)
box(ax, 280, 720, 1440, 130, "Bộ điều phối kiểm duyệt",
    "checkUserInput(): 4 bộ phát hiện song song cho câu người dùng · checkAgentReply(): content safety + vn_policy cho câu agent", "gray", body_size=11)
detectors = [("content_safety", "Nemotron Safety Guard 8B v3\n23 nhóm S1–S23"),
             ("jailbreak_nemoguard", "NemoGuard JailbreakDetect\njailbreak dài, tiếng Anh"),
             ("jailbreak_llm", "gpt-5.6-luna + prompt phân loại\njailbreak ngắn, tiếng Việt"),
             ("vn_policy", "gpt-5.6-luna + 7 nguyên tắc\nLuật An ninh mạng 2018")]
for i, (t, b) in enumerate(detectors):
    x = 80 + i * 470
    arrow(ax, 1000, 720, x + 210, 640)
    box(ax, x, 480, 420, 160, t, b, "red", title_size=12.5, body_size=10.5)
    arrow(ax, x + 210, 480, 1000, 400)
box(ax, 450, 270, 1100, 130, "Chính sách phân mức", "BLOCK: từ chối, gắn cờ, đếm kill-switch · CARE: chế độ hỗ trợ · LOG: chỉ ghi nhận · lỗi bộ phát hiện → fail-open", "orange", body_size=11)
arrow(ax, 800, 270, 480, 200); arrow(ax, 1200, 270, 1520, 200)
box(ax, 80, 60, 800, 140, "Lưu vết: recordSafetyEvent()", "safety_events · guard_turns · meetings.safety_status", "gray")
box(ax, 1120, 60, 800, 140, "Phản ứng", "hủy câu trả lời · agent từ chối · kill-switch · cách ly cuộc họp · khóa chat", "green")
fig.savefig(f"{OUT}/kien-truc-kiem-duyet.png", bbox_inches="tight", facecolor="white"); plt.close(fig)

# ---------------------------------------------------------------- 3. strict-mode turn
fig, ax = canvas(2000, 1500, "Luồng xử lý một lượt hội thoại ở chế độ strict")
lanes = [("Người dùng", 220, "blue"), ("Stream + OpenAI Realtime", 740, "purple"), ("Lớp kiểm duyệt (máy chủ)", 1260, "red"), ("Bộ phát hiện", 1760, "orange")]
for t, x, c in lanes:
    box(ax, x - 190, 1330, 380, 75, t, "", c, title_size=12.5)
    ax.plot([x, x], [80, 1330], color="#9ca3af", lw=1)
steps = [
    (220, 740, "1. Nói xong một câu (VAD: 0,9 s im lặng)", False),
    (740, 1260, "2. Bản chép lời câu người dùng (gpt-transcribe)", True),
    (1260, 1760, "3. Bốn bộ phát hiện chạy song song", False),
    (1760, 1260, "4. Kết luận: BLOCK / CARE / LOG / an toàn", True),
]
y = 1250
for x1, x2, label, dashed in steps:
    arrow(ax, x1, y, x2, y, label, dashed=dashed); y -= 105
ax.add_patch(FancyBboxPatch((80, 600), 1840, 230, boxstyle="round,pad=0,rounding_size=12", fc="none", ec="#16a34a", lw=2))
ax.text(100, 815, "An toàn, hoặc chưa có kết luận sau T = 2 s:", fontsize=11.5, color="#16a34a", fontweight="bold", va="top")
arrow(ax, 1260, 740, 740, 740, "5. response.create (agent được phép trả lời)")
arrow(ax, 740, 650, 220, 650, "6. Agent trả lời bằng giọng nói")
ax.add_patch(FancyBboxPatch((80, 120), 1840, 440, boxstyle="round,pad=0,rounding_size=12", fc="none", ec="#dc2626", lw=2))
ax.text(100, 545, "BLOCK (kết luận chặn đầu tiên):", fontsize=11.5, color="#dc2626", fontweight="bold", va="top")
arrow(ax, 1260, 470, 740, 470, "7. response.create kèm chỉ dẫn từ chối (cảnh báo khi tới ngưỡng)")
arrow(ax, 740, 380, 220, 380, "8. \"Xin lỗi, mình không thể giúp việc này…\"")
ax.text(1260, 270, "9. Đếm vi phạm (kill-switch), gắn cờ cuộc họp", ha="center", fontsize=10.5, color="#374151")
ax.text(1000, 150, "Câu trả lời của agent tiếp tục được kiểm theo từng câu; lần chặn đầu tiên trên câu mở đầu được xác nhận lại với phần tiếp theo.",
        ha="center", fontsize=10.5, color="#4b5563")
fig.savefig(f"{OUT}/luong-strict.png", bbox_inches="tight", facecolor="white"); plt.close(fig)
print("ok")
