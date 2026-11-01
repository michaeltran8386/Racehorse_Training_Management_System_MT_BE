// RAG thuần TypeScript: cắt tài liệu Markdown theo tiêu đề và tìm bằng BM25 (D-AI-03, không cần vector DB).
import { createHash } from 'crypto';

export interface EvidenceUnit {
  evidenceId: string;
  documentId: string;
  headingPath: string[];
  content: string;
  startLine: number;
  endLine: number;
  sourceHash: string;
  ruleIds: string[];
}

export interface RetrievedEvidence extends EvidenceUnit {
  score: number;
  rank: number;
}

const MAX_CHUNK_CHARS = 1600;

/** Bỏ dấu tiếng Việt + chữ thường để "khóa" khớp "khoa", "Khoá". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

// Từ quá phổ biến làm nhiễu điểm BM25.
const STOP = new Set(
  'la cua va cho co khong the nao gi duoc nhung mot cac trong khi thi de voi tu nay do o ra vao toi minh ban the the is the a an of to and or in on for'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Cắt theo H1–H4; đoạn dài quá MAX_CHUNK_CHARS chia tiếp theo đoạn văn. */
export function chunkMarkdown(documentId: string, text: string): EvidenceUnit[] {
  const lines = text.split(/\r?\n/);
  const sourceHash = createHash('sha256').update(text).digest('hex').slice(0, 12);
  const units: EvidenceUnit[] = [];
  const path: string[] = [];
  let buf: string[] = [];
  let start = 1;

  const flush = (end: number) => {
    const body = buf.join('\n').trim();
    buf = [];
    if (!body) return;
    const parts: string[] = [];
    let cur = '';
    for (const para of body.split(/\n\s*\n/)) {
      if (cur && cur.length + para.length > MAX_CHUNK_CHARS) {
        parts.push(cur);
        cur = '';
      }
      cur = cur ? `${cur}\n\n${para}` : para;
    }
    if (cur) parts.push(cur);
    parts.forEach((content) =>
      units.push({
        evidenceId: `${documentId}#${units.length + 1}`,
        documentId,
        headingPath: [...path],
        content: content.slice(0, MAX_CHUNK_CHARS * 2),
        startLine: start,
        endLine: end,
        sourceHash,
        ruleIds: [...new Set(content.match(/RULE-[A-Z]+-\d+/g) ?? [])],
      }),
    );
  };

  lines.forEach((line, idx) => {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      flush(idx);
      path.length = m[1].length - 1;
      path[m[1].length - 1] = m[2].trim();
      start = idx + 1;
    } else {
      buf.push(line);
    }
  });
  flush(lines.length);
  return units;
}

/** Okapi BM25 (k1=1.2, b=0.75); tiêu đề được cộng vào nội dung để câu hỏi theo tên màn hình/luật vẫn trúng. */
export class Bm25Index {
  private readonly docs: { unit: EvidenceUnit; tf: Map<string, number>; len: number }[] = [];
  private readonly df = new Map<string, number>();
  private avgLen = 0;

  constructor(units: readonly EvidenceUnit[]) {
    for (const unit of units) {
      const tokens = tokenize(
        `${unit.headingPath.join(' ')} ${unit.headingPath.join(' ')} ${unit.content}`,
      );
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ unit, tf, len: tokens.length });
    }
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, k = 4): RetrievedEvidence[] {
    const q = [...new Set(tokenize(query))];
    if (q.length === 0) return [];
    const n = this.docs.length;
    const scored = this.docs
      .map(({ unit, tf, len }) => {
        let score = 0;
        for (const t of q) {
          const f = tf.get(t);
          if (!f) continue;
          const df = this.df.get(t) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * len) / this.avgLen));
        }
        return { unit, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return scored.map((x, i) => ({ ...x.unit, score: Number(x.score.toFixed(3)), rank: i + 1 }));
  }
}

/** Markdown -> một dòng chữ để hiển thị đoạn trích: bỏ dòng kẻ bảng, ô bảng nối bằng " · ", bỏ ký hiệu đậm/code. */
export function toPlainText(md: string): string {
  return md
    .split('\n')
    .filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l))
    .map((l) =>
      l
        .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
        .replace(/\s*\|\s*/g, ' · ')
        .replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, '')
        .replace(/\*\*|__|`/g, ''),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
