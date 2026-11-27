const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { Prisma } = require('@prisma/client');
const RealDate = Date;
const anchor = '2026-11-28T04:00:00.000Z';
global.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [anchor]));
  }
  static now() {
    return +new RealDate(anchor);
  }
};
const { seedFixtures } = require('../prisma/seed');
const models = Prisma.dmmf.datamodel.models;
const tables = new Map(models.map((m) => [m.name, new Map()]));
const uniqueIndexes = new Map();
const tx = {};
const valueKey = (value) => (value instanceof RealDate ? value.toISOString() : String(value));
const compoundKey = (fields, row) => fields.map((f) => valueKey(row[f])).join('|');
function matches(row, where = {}) {
  return Object.entries(where).every(([key, filter]) => {
    if (key === 'OR') return filter.some((f) => matches(row, f));
    if (key === 'AND')
      return (Array.isArray(filter) ? filter : [filter]).every((f) => matches(row, f));
    if (!(key in row) && filter && typeof filter === 'object') return matches(row, filter);
    const value = row[key];
    if (filter && typeof filter === 'object' && !(filter instanceof RealDate))
      return Object.entries(filter).every(([op, test]) => {
        if (op === 'in') return test.includes(value);
        if (op === 'notIn') return !test.includes(value);
        if (op === 'not') return value !== test;
        if (op === 'gte') return value >= test;
        if (op === 'lt') return value < test;
        throw new Error(`Unsupported mock filter ${op}`);
      });
    return valueKey(value) === valueKey(filter);
  });
}
for (const model of models) {
  const table = tables.get(model.name);
  const uniqueFields = [
    model.fields.filter((f) => f.isId).map((f) => f.name),
    ...model.fields.filter((f) => f.isUnique).map((f) => [f.name]),
    ...model.uniqueFields,
  ].filter((f) => f.length);
  const indexes = uniqueFields.map(() => new Map());
  uniqueIndexes.set(model.name, { uniqueFields, indexes });
  const primary = uniqueFields[0];
  const defaults = (data) => {
    const row = {};
    for (const field of model.fields.filter((f) => f.kind !== 'object')) {
      let value = data[field.name];
      if (value === undefined) {
        const def = field.default;
        value =
          def && typeof def === 'object' && 'name' in def
            ? def.name === 'uuid'
              ? randomUUID()
              : def.name === 'now'
                ? new Date()
                : def.name === 'autoincrement'
                  ? table.size + 1
                  : null
            : def !== undefined
              ? def
              : field.isUpdatedAt
                ? new Date()
                : field.isList
                  ? []
                  : null;
      }
      if (field.isRequired && value == null)
        throw new Error(`${model.name}.${field.name} required`);
      if (value != null && field.type === 'Decimal') value = new Prisma.Decimal(value);
      row[field.name] = value;
    }
    return row;
  };
  const add = (data, skip = false) => {
    const row = defaults(data);
    const keys = uniqueFields.map((fields) =>
      fields.some((f) => row[f] == null) ? null : compoundKey(fields, row),
    );
    for (let i = 0; i < keys.length; i++)
      if (keys[i] !== null && indexes[i].has(keys[i])) {
        if (skip) return false;
        throw new Error(`Duplicate ${model.name}(${uniqueFields[i]}): ${keys[i]}`);
      }
    const key = compoundKey(primary, row);
    table.set(key, row);
    keys.forEach((k, i) => {
      if (k !== null) indexes[i].set(k, key);
    });
    return row;
  };
  const find = (where = {}) => {
    for (let i = 0; i < uniqueFields.length; i++)
      if (uniqueFields[i].every((f) => where[f] != null && typeof where[f] !== 'object')) {
        const key = indexes[i].get(compoundKey(uniqueFields[i], where));
        const row = table.get(key);
        return row && matches(row, where) ? [row] : [];
      }
    return [...table.values()].filter((row) => matches(row, where));
  };
  const delegate = {
    async createMany({ data, skipDuplicates }) {
      return {
        count: (Array.isArray(data) ? data : [data]).filter((row) => add(row, skipDuplicates))
          .length,
      };
    },
    async create({ data }) {
      return add(data);
    },
    async findMany({ where, select, orderBy, take } = {}) {
      let rows = find(where);
      if (orderBy)
        for (const sort of (Array.isArray(orderBy) ? orderBy : [orderBy]).slice().reverse()) {
          const [field, dir] = Object.entries(sort)[0];
          rows.sort(
            (a, b) =>
              (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (dir === 'desc' ? -1 : 1),
          );
        }
      if (take) rows = rows.slice(0, take);
      return rows.map((row) =>
        select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row },
      );
    },
    async findUnique({ where }) {
      return find(where)[0] ?? null;
    },
    async findFirst(args = {}) {
      return (await delegate.findMany(args))[0] ?? null;
    },
    async count({ where } = {}) {
      return find(where).length;
    },
    async update({ where, data }) {
      const row = find(where)[0];
      assert.ok(row, `Missing ${model.name} update`);
      Object.assign(row, data);
      return row;
    },
    async updateMany({ where, data }) {
      const rows = find(where);
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    async upsert({ where, create, update }) {
      return find(where)[0] ? delegate.update({ where, data: update }) : add(create);
    },
    async deleteMany({ where } = {}) {
      const deleted = find(where),
        keys = new Set(deleted.map((row) => compoundKey(primary, row)));
      // Exercise Restrict and SetNull cleanup order using the actual Prisma relations.
      for (const child of models)
        for (const field of child.fields.filter(
          (f) => f.kind === 'object' && f.type === model.name && f.relationFromFields.length,
        )) {
          const targets = new Set(deleted.map((row) => compoundKey(field.relationToFields, row)));
          const children = tables.get(child.name);
          for (const [key, row] of children) {
            if (child.name === model.name && keys.has(key)) continue;
            if (
              !field.relationFromFields.every((f) => row[f] != null) ||
              !targets.has(compoundKey(field.relationFromFields, row))
            )
              continue;
            if (field.relationOnDelete === 'SetNull')
              field.relationFromFields.forEach((f) => (row[f] = null));
            else assert.ok(false, `Cleanup ${model.name} blocked by ${child.name}.${field.name}`);
          }
        }
      for (const row of deleted) {
        table.delete(compoundKey(primary, row));
        uniqueFields.forEach((fields, i) => indexes[i].delete(compoundKey(fields, row)));
      }
      return { count: deleted.length };
    },
  };
  tx[model.name[0].toLowerCase() + model.name.slice(1)] = delegate;
}
function checkRelations() {
  for (const model of models) {
    assert.ok(tables.get(model.name).size, `${model.name} is empty`);
    for (const field of model.fields.filter(
      (f) => f.kind === 'object' && f.relationFromFields.length,
    )) {
      const targets = new Set(
        [...tables.get(field.type).values()].map((row) => compoundKey(field.relationToFields, row)),
      );
      for (const row of tables.get(model.name).values()) {
        if (field.relationFromFields.some((f) => row[f] == null)) continue;
        assert.ok(
          targets.has(compoundKey(field.relationFromFields, row)),
          `${model.name}.${field.name} has dangling reference`,
        );
      }
    }
  }
}
const rows = (model) => [...tables.get(model).values()];
const counts = () => Object.fromEntries([...tables].map(([name, table]) => [name, table.size]));
async function main() {
  await seedFixtures(tx, 'test-only-password-hash');
  checkRelations();
  const initial = counts();
  await seedFixtures(tx, 'test-only-password-hash');
  assert.deepEqual(counts(), initial, 'Second run must not add duplicate fixtures');
  const invoices = rows('FinancialInvoice');
  assert.ok(invoices.length >= 200);
  assert.equal(new Set(invoices.map((i) => i.billingPeriod)).size, 11);
  assert.ok(invoices.every((i) => i.billingPeriod <= '2026-10'));
  for (const inv of invoices) {
    assert.equal(
      Number(inv.netAmount),
      Number(inv.boardingFee) +
        Number(inv.medicalFee) +
        Number(inv.trainingFee) -
        Number(inv.prizeCredit),
    );
    assert.ok(!inv.dueAt || inv.dueAt > inv.createdAt);
    if (inv.billingMethod === 'ACTUAL_USAGE' && inv.status !== 'CANCELLED') {
      const lines = rows('InvoiceLineItem').filter((l) => l.invoiceId === inv.id);
      assert.equal(
        lines.reduce((sum, l) => sum + Number(l.amount), 0),
        Number(inv.medicalFee),
      );
      assert.equal(
        rows('CareCostClaim').filter((c) => c.invoiceId === inv.id).length,
        lines.length,
      );
    }
  }
  assert.ok(rows('DailyCareTask').length > 20000);
  assert.ok(rows('WorkoutSession').length > 1500);
  assert.ok(rows('CareCostEntry').length > 5000);
  assert.equal(rows('Horse').length, 24);
  for (const [model, field, enumName] of [
    ['Horse', 'status', 'HorseStatus'],
    ['User', 'status', 'UserStatus'],
    ['TrainingPlan', 'status', 'PlanStatus'],
    ['WorkoutSession', 'status', 'WorkoutStatus'],
    ['HorseAdmissionRecord', 'status', 'AdmissionStatus'],
    ['HorseHandoverRequest', 'status', 'HandoverStatus'],
    ['HorseTransferRequest', 'status', 'HorseTransferStatus'],
    ['Complaint', 'status', 'ComplaintStatus'],
    ['FinancialInvoice', 'status', 'InvoiceStatus'],
    ['SupplyCatalog', 'category', 'SupplyCategory'],
    ['IncidentReport', 'status', 'IncidentStatus'],
  ]) {
    const values = require('@prisma/client')[enumName];
    for (const value of Object.values(values))
      assert.ok(
        rows(model).some((row) => row[field] === value),
        `${model} missing ${value}`,
      );
  }
  const horses = new Map(rows('Horse').map((h) => [h.id, h]));
  const plans = new Map(rows('TrainingPlan').map((p) => [p.id, p]));
  for (const w of rows('WorkoutSession')) {
    const plan = plans.get(w.trainingPlanId);
    assert.equal(plan.horseId, w.horseId);
    assert.ok(
      w.scheduledDate >= plan.startDate && w.scheduledDate <= new Date(+plan.endDate + 86400000),
      `Workout outside plan ${plan.planCode}`,
    );
    if (w.status === 'SCHEDULED') assert.ok(!horses.get(w.horseId).isMedicalLocked);
    if (w.resultRecordedAt)
      assert.ok(w.resultRecordedAt >= w.scheduledDate && w.resultRecordedAt <= new Date());
  }
  const rules = require('../src/training/training-rules');
  const groomDays = new Map();
  const trainerDays = new Map();
  for (const w of rows('WorkoutSession')) {
    if (['CANCELLED', 'BLOCKED', 'MISSED'].includes(w.status)) continue;
    const day = rules.clubDate(w.scheduledDate);
    const key = `${w.assignedStaffUserId}:${day}`;
    const group = groomDays.get(key) ?? [];
    group.push(w);
    groomDays.set(key, group);
    const trainerKey = `${plans.get(w.trainingPlanId).trainerUserId}:${day}`;
    const trainerGroup = trainerDays.get(trainerKey) ?? [];
    trainerGroup.push(w);
    trainerDays.set(trainerKey, trainerGroup);
    assert.equal(w.intensity, rules.effectiveIntensity(w.workoutType, w.intensity));
    assert.equal(w.trackSurface, rules.effectiveSurface(w.workoutType, w.trackSurface));
  }
  for (const group of groomDays.values()) {
    assert.ok(
      group.length <= rules.MAX_DAILY_WORKOUTS_PER_GROOM,
      `Groom daily capacity exceeded: ${group.length}`,
    );
    assert.ok(
      group.filter((w) => rules.isHeavy(w.workoutType, w.intensity)).length <=
        rules.MAX_DAILY_HEAVY_WORKOUTS_PER_GROOM,
    );
  }
  for (const group of [...groomDays.values(), ...trainerDays.values()]) {
    group.sort((a, b) => a.scheduledDate - b.scheduledDate);
    for (let i = 1; i < group.length; i++)
      assert.ok(
        +group[i].scheduledDate >=
          +group[i - 1].scheduledDate +
            (rules.workoutDurationMinutes(group[i - 1].workoutType) + rules.GROOM_BUFFER_MINUTES) *
              60000,
        'Overlapping workout assignments',
      );
  }
  for (const type of rules.WORKOUT_TYPES)
    assert.ok(
      rows('WorkoutSession').some((w) => w.workoutType === type),
      `Missing workout ${type}`,
    );
  assert.ok(
    rows('WorkoutSession').some((w) => w.abnormalSigns && w.vetAcknowledgedAt),
    'Missing abnormal-result follow-up',
  );
  for (const h of horses.values()) {
    assert.ok(
      rows('MedicalRecord').filter((r) => r.horseId === h.id && r.status === 'OPEN').length <= 1,
    );
    if (h.status === 'RETIRED')
      assert.equal(
        rows('StallAllocation').filter((a) => a.horseId === h.id && a.isActive).length,
        0,
      );
  }
  for (const t of rows('DailyCareTask'))
    if (t.isCompleted)
      assert.ok(t.completedAt && t.completedAt <= new Date(), `Future completion ${t.id}`);
  for (const model of ['OtpCode', 'ResetToken'])
    assert.ok(
      rows(model).every((row) => row.expiresAt < new Date()),
      `Predictable ${model} must be expired`,
    );
  assert.ok(rows('RefreshToken').every((row) => row.revoked || row.expiresAt < new Date()));
  const live = rows('FinancialInvoice').find((i) => i.status === 'SENT');
  live.paymentRef = 'USER-REPORTED-TRANSFER';
  await seedFixtures(tx, 'test-only-password-hash');
  assert.equal(live.paymentRef, 'USER-REPORTED-TRANSFER', 'Seed must preserve live payment edits');
  await seedFixtures(tx, 'test-only-password-hash', true);
  checkRelations();
  assert.deepEqual(counts(), initial, 'Reset must recreate the same dataset');
  console.log(
    'PASS: offline fixture generation, model relations, billing, timelines, reruns and reset.',
  );
  console.log(JSON.stringify(initial, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
