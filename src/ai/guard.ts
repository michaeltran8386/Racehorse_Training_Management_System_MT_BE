// Chặn prompt injection ở cả 2 phía: câu hỏi người dùng và đoạn tài liệu truy xuất (context poisoning).
import { normalize } from './knowledge';

// So khớp trên chữ đã bỏ dấu nên viết mẫu không dấu.
const INJECTION_PATTERNS: { id: string; re: RegExp }[] = [
  {
    id: 'ignore-instructions',
    re: /\b(ignore|disregard|forget|override)\b.{0,40}\b(instruction|rule|prompt|previous|above|system)/,
  },
  {
    id: 'ignore-instructions-vi',
    re: /\b(bo qua|phot lo|quen|vo hieu)\b.{0,40}\b(huong dan|chi dan|quy tac|lenh|prompt|truoc do|he thong)/,
  },
  {
    id: 'role-override',
    re: /\b(you are now|act as|pretend to be|jailbreak|developer mode|dan mode)\b/,
  },
  { id: 'role-override-vi', re: /\b(gio ban la|hay dong vai|gia vo la|che do nha phat trien)\b/ },
  {
    id: 'reveal-prompt',
    re: /\b(system prompt|reveal|print|show|leak)\b.{0,30}\b(prompt|instruction|secret|api key|token|password)/,
  },
  {
    id: 'reveal-prompt-vi',
    re: /\b(tiet lo|in ra|hien thi)\b.{0,30}\b(prompt|chi dan he thong|mat khau|api key|token|bi mat)/,
  },
  {
    id: 'fake-delimiter',
    re: /(<\/?(system|assistant|instructions?)>|\[\/?inst\]|###\s*(system|instruction))/,
  },
];

// RULE-AI-01: AI chỉ đọc và gợi ý; yêu cầu tự ghi dữ liệu bị từ chối thay vì giả vờ đã làm.
const WRITE_ACTION =
  /\b(xoa|tao moi|them moi|cap nhat|sua|doi|go khoa|mo khoa|dat khoa|duyet|phe duyet|huy|delete|remove|create|update|unlock|approve|cancel)\b.{0,40}\b(ngua|ho so|benh an|khoa|giao an|lich|tai khoan|kho|horse|record|lock|plan|account|user|stock)\b/;
const IMPERATIVE_PREFIX =
  /^\s*(hay|giup|lam on|vui long|please|go ahead|tu dong)?\s*(xoa|tao|them|cap nhat|sua|doi|go|mo|dat|duyet|huy|delete|remove|create|update|unlock|approve|cancel)\b/;

export interface GuardVerdict {
  injection: string[];
  writeRequest: boolean;
}

export function inspectUserMessage(message: string): GuardVerdict {
  const n = normalize(message);
  return {
    injection: INJECTION_PATTERNS.filter((p) => p.re.test(n)).map((p) => p.id),
    writeRequest: IMPERATIVE_PREFIX.test(n) && WRITE_ACTION.test(n),
  };
}

/** Dòng tài liệu trông như lệnh gửi cho model bị thay bằng dấu báo, không bao giờ vào prompt. */
export function neutralizeEvidence(content: string): { content: string; flagged: boolean } {
  let flagged = false;
  const lines = content.split('\n').map((line) => {
    const n = normalize(line);
    if (INJECTION_PATTERNS.some((p) => p.re.test(n))) {
      flagged = true;
      return '[đã lược bỏ dòng nghi chèn lệnh]';
    }
    return line;
  });
  return { content: lines.join('\n'), flagged };
}

/** Bỏ ký tự điều khiển/ẩn hay dùng để giấu lệnh; giữ xuống dòng. */
export function cleanInput(message: string): string {
  return message
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}
