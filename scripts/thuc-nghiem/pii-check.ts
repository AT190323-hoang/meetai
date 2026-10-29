// Self-check of PII detection and masking (src/lib/pii.ts), no API calls.
// Usage: npx tsx --conditions=react-server scripts/thuc-nghiem/pii-check.ts
import { randomBytes } from "node:crypto";

import { decryptPii, labelPii, markersToLabels, maskPii } from "@/lib/pii";

// The key is read on each call, so a throwaway one is enough here
process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

// [text, labelled text expected]
const cases: [string, string][] = [
    ["Số của tôi là 0354 099 123 nhé.", "Số của tôi là [số điện thoại] nhé."],
    ["Gọi 0912-345-678 hoặc +84 912 345 678.", "Gọi [số điện thoại] hoặc [số điện thoại]."],
    ["Đọc lại cho tôi số điện thoại 0354099123.", "Đọc lại cho tôi số điện thoại [số điện thoại]."],
    ["Email tôi là hoang.le@example.com.", "Email tôi là [email]."],
    ["CCCD của tôi 001203012345.", "CCCD của tôi [số CCCD/CMND]."],
    ["Số CMND 123456789 cấp năm 2010.", "Số CMND [số CCCD/CMND] cấp năm 2010."],
    ["Thẻ 4111 1111 1111 1111 hết hạn 12/28.", "Thẻ [số thẻ] hết hạn 12/28."],
    ["Chuyển vào số tài khoản 1903 4567 8901 Techcombank.", "Chuyển vào số tài khoản [số tài khoản] Techcombank."],
    ["STK: 0123456789", "STK: [số tài khoản]"],
    // Seen in the 29/10 calls: fragments joined into one utterance, spoken email, read-back numbers
    ["Công dân của tôi là 0012 03012345, còn số tài khoản để đóng học phí là 1903 4567 8901.",
        "Công dân của tôi là [dãy số], còn số tài khoản để đóng học phí là [số tài khoản]."],
    ["Email của chị Lan là Lan chấm Nguyễn. a còng gmail chấm com.", "Email của chị Lan là [email]."],
    ["Rõ rồi. Mình đã nghe số bạn nói: 00345678901.", "Rõ rồi. Mình đã nghe số bạn nói: [dãy số]."],
    ["Số điện thoại 0987 654 321.", "Số điện thoại [số điện thoại]."],
    ["Dự án được duyệt 1.000.000.000 đồng.", "Dự án được duyệt 1.000.000.000 đồng."],
    // KB2 call on EC2 (29/10): numbers read digit by digit are transcribed as words
    ["Số điện thoại của tôi là không chín một hai ba bốn năm sáu bảy tám nhé.", "Số điện thoại của tôi là [số điện thoại] nhé."],
    ["Số căn cước của tôi là không không một hai không ba không một hai ba bốn năm, số tài khoản nhận học bổng là một chín không ba bốn năm sáu bảy, tám chín không một.",
        "Số căn cước của tôi là [số CCCD/CMND], số tài khoản nhận học bổng là [số tài khoản]."],
    ["Email của tôi là trang a cộng gmail chấm com.", "Email của tôi là [email]."],
    ["My account number is 1903. 4567 8901", "My account number is [số tài khoản]"],
    ["Năm năm trước tôi học ba năm ở Hà Nội và hai năm ở Huế.", "Năm năm trước tôi học ba năm ở Hà Nội và hai năm ở Huế."],
    // Must stay untouched
    ["Năm 1975 thống nhất đất nước, dân số khoảng 100 triệu người.", "Năm 1975 thống nhất đất nước, dân số khoảng 100 triệu người."],
    ["Giá là 2.500.000 đồng, mã đơn 123456.", "Giá là 2.500.000 đồng, mã đơn 123456."],
    ["Phương trình x^2 - 5x + 6 = 0 có hai nghiệm 2 và 3.", "Phương trình x^2 - 5x + 6 = 0 có hai nghiệm 2 và 3."],
    // Not a valid card (Luhn), but still a long number: masked with the generic label
    ["Số 4111 1111 1111 1112 không phải thẻ hợp lệ.", "Số [dãy số] không phải thẻ hợp lệ."],
];

let failed = 0;
for (const [text, expected] of cases) {
    const labelled = labelPii(text);
    const ok = labelled === expected;
    if (!ok) failed++;
    console.log(ok ? "PASS" : "FAIL", JSON.stringify(text), "→", JSON.stringify(labelled));
}

// Reversible masking: markers in the text, originals only in the encrypted blob
const original = "Gọi 0912-345-678, email a@b.vn.";
const { content, encrypted } = maskPii(original, "item1");
const values = decryptPii(encrypted!);
const roundTrip = content.includes("[[pii:item1:0:phone:12]]") && !content.includes("0912") && values[0] === "0912-345-678" && values[1] === "a@b.vn";
console.log(roundTrip ? "PASS" : "FAIL", "mask + decrypt round trip:", content, values);
const labels = markersToLabels(content) === "Gọi [số điện thoại], email [email].";
console.log(labels ? "PASS" : "FAIL", "markers to labels:", markersToLabels(content));
let tamperDetected = false;
try { decryptPii(encrypted!.slice(0, -4) + "AAAA"); } catch { tamperDetected = true; }
console.log(tamperDetected ? "PASS" : "FAIL", "tampered ciphertext rejected");
process.exit(failed === 0 && roundTrip && labels && tamperDetected ? 0 : 1);
