// Phần thuần của trợ lý (không Nest, không DB) để test và eval chạy độc lập.
import { normalize } from './knowledge';

export type ChatStatus =
  'ANSWERED' | 'INSUFFICIENT_EVIDENCE' | 'REFUSED_UNAUTHORIZED' | 'BLOCKED_PROMPT_INJECTION';

export interface Intents {
  horses: boolean;
  locks: boolean;
}

/** Định tuyến tất định: câu hỏi về dữ liệu đang có mới gọi công cụ DB; câu hỏi quy định chỉ tra tài liệu. */
export function routeIntents(message: string): Intents {
  const n = normalize(message);
  const lockTerm = /\b(khoa (y te|huan luyen)|bi khoa|dang khoa|medical lock|locked)\b/.test(n);
  const current =
    /\b(ngua nao|con nao|dang|hien (nay|tai)|hom nay|cua toi|cua minh|which|currently|my)\b/.test(
      n,
    );
  return {
    locks: lockTerm && current,
    horses:
      !lockTerm &&
      /\b(ngua cua (toi|minh)|danh sach ngua|bao nhieu (con )?ngua|toi (co|quan ly|phu trach) (nhung )?(con )?ngua|my horses|how many horses)\b/.test(
        n,
      ),
  };
}

// Từ khóa (đã bỏ dấu) -> công cụ dữ liệu. Câu hỏi "là gì / làm sao" chỉ tra tài liệu vai trò.
const DATA_ROUTES: [string, RegExp][] = [
  ['training_overview', /\b(buoi tap|lich tap|giao an|tai tap|bai tap|workout|training)\b/],
  [
    'groom_shifts',
    /\b(ca truc|truc|phan ca|lich truc|ca cua toi|ca nao|trung ca|trung gio|roster|shift)\b/,
  ],
  ['inventory_status', /\b(ton kho|vat tu|sap het|het hang|duoi nguong|inventory|stock)\b/],
  [
    'owner_costs',
    /\b(chi phi|hoa don|tai chinh|sao ke|phai tra|thanh toan|cong no|invoice|cost)\b/,
  ],
  ['incident_reports', /\b(su co|incident)\b/],
  [
    'owner_races',
    /\b(giai dua|cuoc dua|thi dau|dang ky dua|tien thuong dua|ket qua dua|race|tournament)\b/,
  ],
  ['herd_health', /\b(suc khoe|chan thuong|cach ly|qua han|herd|health)\b/],
];
const HOW_TO = /\b(la gi|lam sao|lam the nao|cach nao|o dau|huong dan|quy trinh|how to|what is)\b/;
const ASKS_DATA =
  /\b(bao nhieu|tong|nhung|nao|dang|hien (nay|tai)|hom nay|tuan nay|sap toi|cua toi|cua minh|con lai|danh sach|liet ke|which|how many|list|my)\b/;

/** Danh sách công cụ dữ liệu cần gọi cho câu hỏi (tối đa 3, theo thứ tự). */
export function routeTools(message: string): string[] {
  const n = normalize(message);
  const { horses, locks } = routeIntents(message);
  const tools: string[] = [];
  if (locks) tools.push('medical_lock_status');
  if (horses) tools.push('list_my_horses');
  if (ASKS_DATA.test(n) || !HOW_TO.test(n)) {
    for (const [tool, re] of DATA_ROUTES) if (re.test(n)) tools.push(tool);
  }
  // "chi phí nuôi ngựa của tôi" hỏi chi phí, không hỏi danh sách ngựa.
  const specific = tools.filter((t) => t !== 'list_my_horses');
  return (specific.length ? specific : tools).slice(0, 3);
}

// Câu hỏi gợi ý theo vai trò: dùng cho lời giới thiệu và khi chưa đủ dữ liệu để trả lời.
const ROLE_EXAMPLES: Record<string, string[]> = {
  CLUB_MANAGER: [
    'Vật tư nào sắp hết?',
    'Ca trực tuần này có ai trùng giờ không?',
    'Có sự cố nào chưa xử lý?',
  ],
  HEAD_TRAINER: [
    'Lịch tập 7 ngày tới thế nào?',
    'Ngựa nào đang bị khóa y tế?',
    'Có sự cố nào chưa xử lý?',
  ],
  VETERINARIAN: [
    'Tình hình sức khỏe đàn ngựa?',
    'Ngựa nào đang bị khóa y tế?',
    'Lịch định kỳ nào quá hạn?',
  ],
  GROOM: ['Ca trực của tôi tuần này?', 'Lịch tập hôm nay?', 'Vật tư nào sắp hết?'],
  HORSE_OWNER: [
    'Ngựa của tôi đang thế nào?',
    'Báo cáo chi phí nuôi ngựa tháng này?',
    'Giải đua sắp tới và kết quả thi đấu?',
  ],
};

export function examplesFor(role: string): string[] {
  return (
    ROLE_EXAMPLES[role] ?? ['Ngựa nào đang bị khóa y tế?', 'Hướng dẫn dùng màn hình Chuồng trại']
  );
}

const quoted = (list: string[]) => list.map((q) => `"${q}"`).join(', ');

/**
 * Câu xã giao (chào, "bạn là ai", cảm ơn, "bạn làm được gì"): trả lời tự nhiên, không cần tra dữ liệu.
 * Chỉ khớp tin nhắn ngắn để không nuốt câu hỏi nghiệp vụ dài có chữ "chào"/"cảm ơn".
 */
export function smallTalk(message: string, role: string, fullName: string): string | null {
  const n = normalize(message)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n || n.split(' ').length > 8) return null;
  // "Lê Văn Bình (Groom Chăm Sóc)" -> "Bình": bỏ phần chức danh trong ngoặc, gọi bằng tên.
  const name =
    fullName
      .replace(/\(.*?\)/g, '')
      .trim()
      .split(/\s+/)
      .at(-1) || 'bạn';
  const examples = quoted(examplesFor(role));
  if (/\b(ban|may|em|tro ly) (la ai|ten (la )?gi|la gi)\b|\bwho are you\b|\bgioi thieu\b/.test(n)) {
    return `Mình là Trợ lý TMEC, giúp ${name} tra cứu nhanh dữ liệu câu lạc bộ trong phạm vi quyền của bạn: ngựa, lịch tập, ca trực, vật tư, sức khỏe, chi phí, và cách dùng từng màn hình. Mình chỉ đọc và gợi ý, không tự sửa dữ liệu. Bạn thử hỏi: ${examples}.`;
  }
  if (
    /\b(lam|giup) (duoc )?(gi|nhung gi)\b|\bco the (lam|giup) gi\b|\bwhat can you do\b|^(help|giup (toi|minh|em))$/.test(
      n,
    )
  ) {
    return `Mình trả lời được các câu về dữ liệu bạn được xem và cách dùng TMEC. Ví dụ: ${examples}.`;
  }
  if (/\b(cam on|thank|thanks)\b/.test(n)) {
    return `Không có gì đâu ${name}! Cần gì cứ hỏi mình nhé.`;
  }
  if (/^(xin )?chao( ban| tro ly| em)?$|^(hi|hello|hey|alo)( ban)?$/.test(n)) {
    return `Chào ${name}! Mình là Trợ lý TMEC. Hôm nay bạn cần xem gì? Ví dụ: ${examples}.`;
  }
  return null;
}

/** Đường dẫn màn hình (/abc/xyz) nhắc trong tài liệu -> nút hành động; route có ":id" bị bỏ. */
export function extractRoutes(content: string): string[] {
  const found = content.match(/(?<![\w/])\/[a-z][a-z0-9\-/:]*/g) ?? [];
  return [...new Set(found.map((r) => r.replace(/\/+$/, '')).filter((r) => !r.includes(':')))];
}

/** Khóa cache = câu hỏi đã chuẩn hóa; câu có dữ liệu riêng thêm userId (không lộ chéo người dùng),
 * câu chỉ tra tài liệu thêm vai trò (mỗi vai trò có bộ tài liệu riêng). */
export function cacheKey(message: string, tools: string[], userId: string, role: string): string {
  const q = normalize(message)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return tools.length ? `u:${userId}:${q}` : `doc:${role}:${q}`;
}

/** Cache TTL + giới hạn số mục (bỏ mục cũ nhất). */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  hits = 0;
  misses = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit || hit.expires <= this.now()) {
      if (hit) this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // Đưa lên cuối để mục hay dùng không bị đẩy ra.
    this.map.delete(key);
    this.map.set(key, hit);
    this.hits++;
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value as string);
  }

  get size(): number {
    return this.map.size;
  }
}

// Câu trả lời của model khẳng định đã ghi dữ liệu = vi phạm RULE-AI-01, bị loại.
const WRITE_CLAIM = /\b(da|vua) (xoa|tao|cap nhat|sua|go khoa|mo khoa|dat khoa|duyet|huy|luu)\b/;

export interface ModelAnswer {
  answer: string;
  citations: string[];
  status: ChatStatus;
}

/** Kiểm tra output model theo schema + ranh giới; trả null để quay về chế độ tất định. */
export function validateModelAnswer(
  raw: unknown,
  allowedIds: ReadonlySet<string>,
): ModelAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.answer !== 'string' || !r.answer.trim() || r.answer.length > 4000) return null;
  if (r.status !== 'ANSWERED' && r.status !== 'INSUFFICIENT_EVIDENCE') return null;
  if (!Array.isArray(r.citations) || !r.citations.every((c) => typeof c === 'string')) return null;
  const citations = r.citations as string[];
  if (citations.some((c) => !allowedIds.has(c))) return null;
  if (r.status === 'ANSWERED' && citations.length === 0) return null;
  if (WRITE_CLAIM.test(normalize(r.answer))) return null;
  return { answer: r.answer.trim(), citations, status: r.status };
}

/** Số trong câu model phải có trong số liệu công cụ (chặn model bịa con số). */
export function numbersGrounded(answer: string, facts: string): boolean {
  const nums = (s: string) =>
    (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((x) => x.replace(/[.,]/g, ''));
  const known = new Set(nums(facts));
  return nums(answer).every((n) => n.length < 2 || known.has(n));
}
