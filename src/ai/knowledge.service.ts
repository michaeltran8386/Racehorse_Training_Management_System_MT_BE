import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Bm25Index, chunkMarkdown, EvidenceUnit, RetrievedEvidence } from './knowledge';
import { neutralizeEvidence } from './guard';

// Tài liệu hướng dẫn theo vai trò (src/ai/docs, copy sang dist qua nest-cli assets).
// Mỗi vai trò chỉ tra cứu được tài liệu chung + tài liệu của mình; cũng là MCP resources.
export const ROLE_DOCS: { id: string; title: string; roles: string[] | 'ALL' }[] = [
  { id: 'common', title: 'Hướng dẫn chung TMEC', roles: 'ALL' },
  { id: 'club-manager', title: 'Hướng dẫn Quản lý CLB', roles: ['CLUB_MANAGER'] },
  { id: 'head-trainer', title: 'Hướng dẫn HLV Trưởng', roles: ['HEAD_TRAINER'] },
  { id: 'veterinarian', title: 'Hướng dẫn Bác sĩ thú y', roles: ['VETERINARIAN'] },
  { id: 'groom', title: 'Hướng dẫn Groom', roles: ['GROOM'] },
  { id: 'horse-owner', title: 'Hướng dẫn Chủ ngựa', roles: ['HORSE_OWNER'] },
];

export const docsFor = (role: string) =>
  ROLE_DOCS.filter((d) => d.roles === 'ALL' || d.roles.includes(role));

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly texts = new Map<string, string>();
  private readonly units = new Map<string, EvidenceUnit[]>();
  private readonly indexes = new Map<string, Bm25Index>();
  indexVersion = 'empty';

  private loadDocs() {
    if (this.texts.size) return;
    const dir = process.env.AI_CORPUS_DIR || join(__dirname, 'docs');
    for (const doc of ROLE_DOCS) {
      try {
        const text = readFileSync(join(dir, `${doc.id}.md`), 'utf8');
        this.texts.set(doc.id, text);
        // Tài liệu cũng là dữ liệu không tin cậy: lọc dòng chèn lệnh ngay lúc lập chỉ mục.
        this.units.set(
          doc.id,
          chunkMarkdown(doc.id, text).map((u) => {
            const { content, flagged } = neutralizeEvidence(u.content);
            if (flagged) this.logger.warn(`Neutralized injection-like line in ${u.evidenceId}`);
            return { ...u, content };
          }),
        );
      } catch (err) {
        this.logger.warn(`Role doc skipped: ${doc.id} (${(err as Error).message})`);
      }
    }
    const all = [...this.units.values()].flat();
    this.indexVersion = createHash('sha256')
      .update(all.map((u) => u.sourceHash + u.evidenceId).join('|'))
      .digest('hex')
      .slice(0, 10);
    this.logger.log(`AI role docs indexed: ${all.length} units, version ${this.indexVersion}`);
  }

  private index(role: string): Bm25Index {
    this.loadDocs();
    let idx = this.indexes.get(role);
    if (!idx) {
      idx = new Bm25Index(docsFor(role).flatMap((d) => this.units.get(d.id) ?? []));
      this.indexes.set(role, idx);
    }
    return idx;
  }

  search(query: string, role: string, k = 4): RetrievedEvidence[] {
    return this.index(role).search(query, k);
  }

  /** MCP resources/list: chỉ tài liệu vai trò được xem. */
  listDocs(role: string) {
    this.loadDocs();
    return docsFor(role)
      .filter((d) => this.texts.has(d.id))
      .map((d) => ({
        uri: `tmec://docs/${d.id}`,
        name: d.id,
        title: d.title,
        mimeType: 'text/markdown',
      }));
  }

  /** MCP resources/read; null nếu không tồn tại hoặc ngoài phạm vi vai trò. */
  readDoc(uri: string, role: string): string | null {
    this.loadDocs();
    const id = uri.replace(/^tmec:\/\/docs\//, '');
    return docsFor(role).some((d) => d.id === id) ? (this.texts.get(id) ?? null) : null;
  }

  get size(): number {
    this.loadDocs();
    return [...this.units.values()].reduce((n, u) => n + u.length, 0);
  }
}
