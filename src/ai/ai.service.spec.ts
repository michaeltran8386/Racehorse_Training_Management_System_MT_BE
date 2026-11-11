import { AiService } from './ai.service';
import { AiToolsService } from './ai.tools';
import { routeTools } from './assistant-core';
import { KnowledgeService } from './knowledge.service';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

const OWNER_USER: CurrentUserPayload = {
  userId: 'owner-1',
  email: 'owner@gmail.com',
  role: 'HORSE_OWNER',
  fullName: 'Test Owner',
};

const GROOM_USER: CurrentUserPayload = {
  userId: 'groom-1',
  email: 'groom@gmail.com',
  role: 'GROOM',
  fullName: 'Test Groom',
};

function createMocks() {
  const horses = {
    findAll: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'h-1',
          name: 'Hồng Kỳ',
          breed: 'Thoroughbred',
          healthStatus: 'FIT',
          trainingPhase: 'SPEED',
          isMedicalLocked: false,
          ownerId: 'owner-1',
        },
      ],
      total: 1,
    }),
  };
  const workouts = { findAllWorkouts: jest.fn().mockResolvedValue([]) };
  const rosters = {
    findAll: jest.fn().mockResolvedValue([]),
    getMyShifts: jest.fn().mockResolvedValue([]),
  };
  const inventory = {
    findAllStock: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const statementBreakdown = {
    summary: {
      billingPeriod: '2026-11',
      totalBoarding: 15_000_000,
      totalMedical: 2_000_000,
      totalTraining: 5_000_000,
      totalExpense: 22_000_000,
      totalRaceNet: 8_000_000,
      finalBalanceDue: 14_000_000,
      isSurplus: false,
      surplusAmount: 0,
      invoiceCount: 1,
    },
    drilldown: {
      invoices: [
        {
          id: 'inv-1',
          billingPeriod: '2026-11',
          horseName: 'Hồng Kỳ',
          boardingFee: 15_000_000,
          boardingDays: 30,
          medicalFee: 2_000_000,
          trainingFee: 5_000_000,
          prizeCredit: 8_000_000,
          netAmount: 14_000_000,
          status: 'UNPAID',
          dueAt: '2026-11-30T00:00:00.000Z',
        },
      ],
      raceSettlements: [],
    },
  };
  const financial = {
    getOwnerSummary: jest.fn().mockResolvedValue({
      totals: {
        totalDue: 14_000_000,
        paidCount: 0,
        unpaidCount: 1,
        invoiceCount: 1,
      },
      invoices: [
        {
          id: 'inv-1',
          billingPeriod: '2026-11',
          horseName: 'Hồng Kỳ',
          totalAmount: 22_000_000,
          prizeCredit: 8_000_000,
          netAmount: 14_000_000,
          status: 'UNPAID',
        },
      ],
    }),
    getOwnerStatementBreakdown: jest.fn().mockResolvedValue(statementBreakdown),
  };
  const incidents = { findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const health = {
    getHealthBoard: jest.fn().mockResolvedValue({
      summary: { total: 1, lockedCount: 0, fitCount: 1, injuredCount: 0 },
      items: [],
    }),
  };
  const prisma = {
    tournamentEntry: { findMany: jest.fn().mockResolvedValue([]) },
    ownerAiMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return {
    horses,
    workouts,
    rosters,
    inventory,
    financial,
    incidents,
    health,
    prisma,
    statementBreakdown,
  };
}

function createService() {
  const knowledge = new KnowledgeService();
  const mocks = createMocks();
  const tools = new AiToolsService(
    knowledge,
    mocks.horses as never,
    mocks.workouts as never,
    mocks.rosters as never,
    mocks.inventory as never,
    mocks.financial as never,
    mocks.incidents as never,
    mocks.health as never,
    mocks.prisma as never,
  );
  const service = new AiService(knowledge, tools, mocks.prisma as never, mocks.financial as never);
  return { knowledge, tools, service, mocks };
}

describe('AiService & Retrieval Quality', () => {
  const origEnv = { ...process.env };
  const origFetch = global.fetch;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  describe('BM25 retrieval precision', () => {
    it('does not falsely match unrelated recipe query "Công thức nấu phở bò" with score >= 3', () => {
      const knowledge = new KnowledgeService();
      const hits = knowledge.search('Công thức nấu phở bò', 'GROOM', 4);
      const strong = hits.filter((h) => h.score >= 3);
      expect(strong).toHaveLength(0);
    });

    it('continues to match genuine TMEC owner doc queries strongly', () => {
      const knowledge = new KnowledgeService();
      const hits = knowledge.search('Làm sao để xuất PDF hóa đơn?', 'HORSE_OWNER', 4);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].score).toBeGreaterThanOrEqual(3);
      expect(hits[0].documentId).toContain('horse-owner');
    });
  });

  describe('External query tool routing isolation', () => {
    it('does not route external questions to internal TMEC DB tools even with overlapping words', () => {
      expect(routeTools('Thời tiết Hà Nội hôm nay như thế nào?')).toEqual([]);
      expect(routeTools('Chi phí du lịch Đà Lạt 3 ngày khoảng bao nhiêu?')).toEqual([]);
      expect(
        routeTools(
          'Luật đua ngựa thuần chủng quốc tế quy định về trọng lượng nài ngựa như thế nào?',
        ),
      ).toEqual([]);
      expect(routeTools('Giá Bitcoin hôm nay là bao nhiêu?')).toEqual([]);
    });

    it('still routes genuine TMEC owner questions to expected DB tools', () => {
      expect(routeTools('Tổng kết chi phí tháng này của tôi?')).toContain('owner_costs');
      expect(routeTools('Ngựa của tôi sắp tới chạy giải đua nào?')).toContain('owner_races');
    });
  });

  describe('Role-scope enforcement & external conversational behavior', () => {
    it('refuses role-restricted inventory query for HORSE_OWNER with INSUFFICIENT_EVIDENCE and empty sources', async () => {
      const { service } = createService();
      const res = await service.chat('Tồn kho vật tư hiện tại bao nhiêu?', OWNER_USER);
      expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(res.sources).toHaveLength(0);
      expect(res.summary.toLowerCase()).toMatch(/quyền|nhân viên|quản lý/);
    });

    it('gives distinct natural offline guidance instead of one identical rigid boilerplate', async () => {
      const { service } = createService();
      const phores = await service.chat('Công thức nấu phở bò', GROOM_USER);
      const weatherRes = await service.chat('Thời tiết Hà Nội hôm nay như thế nào?', OWNER_USER);
      const lawRes = await service.chat(
        'Luật đua ngựa thuần chủng quốc tế quy định về trọng lượng nài ngựa như thế nào?',
        OWNER_USER,
      );

      expect(phores.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(phores.sources).toHaveLength(0);
      expect(weatherRes.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(lawRes.status).toBe('INSUFFICIENT_EVIDENCE');
      // External replies should NOT repeat the identical stiff "Câu này mình chưa trả lời được..." template
      expect(weatherRes.summary).not.toEqual(phores.summary);
      expect(weatherRes.summary).not.toContain(
        'Câu này mình chưa trả lời được vì không có trong hướng dẫn',
      );
    });

    it('calls Gemini in flexible conversational mode for external questions and falls back cleanly on 404 model', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.GEMINI_MODEL = 'gemini-2.0-flash';

      const fetchMock = jest
        .fn()
        // First call to deprecated gemini-2.0-flash returns 404
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({ error: { code: 404, message: 'no longer available' } }),
        })
        // Automatic fallback call succeeds with natural prose (plain text, not rigid JSON card)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Trong đua ngựa thuần chủng quốc tế, trọng lượng nài ngựa thường được tính theo hệ thống handicap hoặc scale weight dao động khoảng 52–60 kg tùy hạng đua và độ tuổi ngựa. Đây là thông tin tham khảo chung ngoài dữ liệu nội bộ của TMEC.',
                    },
                  ],
                },
              },
            ],
          }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const { service, mocks } = createService();
      const res = await service.chat(
        'Luật đua ngựa thuần chủng quốc tế quy định về trọng lượng nài ngựa như thế nào?',
        OWNER_USER,
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain('gemini-2.0-flash:generateContent');
      expect(fetchMock.mock.calls[1][0]).toContain('gemini-flash-lite-latest:generateContent');
      expect(res.aiGenerated).toBe(true);
      expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(res.sources).toHaveLength(0);
      expect(res.actions).toHaveLength(0);
      expect(res.data).toHaveLength(0);
      expect(res.cardPayload).toBeNull();
      expect(res.summary).toContain('handicap');
      expect(mocks.prisma.ownerAiMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sender: 'ASSISTANT',
            cardType: null,
          }),
        }),
      );
    });

    it('attaches BILLING_CARD matching backend summary/drilldown contract for owner cost query', async () => {
      const { service, mocks } = createService();
      const res = await service.chat('Tổng kết chi phí tháng này của tôi?', OWNER_USER);

      expect(res.status).toBe('ANSWERED');
      expect(mocks.financial.getOwnerStatementBreakdown).toHaveBeenCalledWith('owner-1');
      expect(res.cardPayload).toEqual({
        type: 'BILLING_CARD',
        data: mocks.statementBreakdown,
      });
      expect(res.actions.some((a) => a.route === '/financial-reports')).toBe(true);
    });
  });
});
