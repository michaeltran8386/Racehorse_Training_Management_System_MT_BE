import { stampDemoWrite } from './demo-clock-extension';
import { setDemoClock } from '../common/utils/demo-clock';

describe('Prisma business timestamps', () => {
  beforeEach(() => setDemoClock(new Date('2030-01-01T00:00:00Z')));
  afterEach(() => setDemoClock(null));
  it('timestamps new plans, preserves explicit history, and stamps nested writes', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const args: any = { data: { workoutSessions: { create: [{}] } } };
    stampDemoWrite('TrainingPlan', 'create', args, now);
    expect(args.data.createdAt).toEqual(now);
    expect(args.data.updatedAt).toEqual(now);
    expect(args.data.workoutSessions.create[0].createdAt).toEqual(now);
    const history = new Date('2020-01-01');
    const rows: any = { data: [{ createdAt: history }, {}] };
    stampDemoWrite('TrainingPlan', 'createMany', rows, now);
    expect(rows.data[0].createdAt).toBe(history);
    expect(rows.data[1].createdAt).toEqual(now);
    const upsert: any = { create: {}, update: {} };
    stampDemoWrite('TrainingPlan', 'upsert', upsert, now);
    expect(upsert.create.createdAt).toEqual(now);
    expect(upsert.update.createdAt).toBeUndefined();
    expect(upsert.update.updatedAt).toEqual(now);
    const nested: any = { data: { owner: { create: {} } } };
    stampDemoWrite('Horse', 'create', nested, now);
    expect(nested.data.owner.create.createdAt).toBeUndefined();
  });
  it('keeps security lifetimes and real-time writes untouched', () => {
    const auth: any = { data: {} };
    stampDemoWrite('User', 'create', auth);
    expect(auth.data).toEqual({});
    setDemoClock(null);
    const plan: any = { data: {} };
    stampDemoWrite('TrainingPlan', 'create', plan);
    expect(plan.data).toEqual({});
  });
});
