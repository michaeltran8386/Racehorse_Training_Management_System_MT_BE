import { Prisma } from '@prisma/client';
import { effectiveNow, isDemoClockActive } from '../common/utils/demo-clock';

const realTimeModels = new Set([
  'User',
  'GoogleIdentity',
  'OtpCode',
  'LoginAttempt',
  'ResetToken',
  'RefreshToken',
  'SimulatorSession',
]);
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

/** Apply the business clock to implicit Prisma timestamps, including nested writes. */
export function stampDemoWrite(
  modelName: string,
  operation: string,
  args: any,
  now = effectiveNow(),
) {
  if (!isDemoClockActive()) return;
  const write = (name: string, data: any, creating: boolean) => {
    if (!data) return;
    if (Array.isArray(data)) {
      for (const item of data) write(name, item, creating);
      return;
    }
    const model = models.get(name);
    if (!model) return;
    if (!realTimeModels.has(name))
      for (const field of model.fields) {
        const defaultNow =
          field.type === 'DateTime' &&
          field.hasDefaultValue &&
          typeof field.default === 'object' &&
          field.default !== null &&
          'name' in field.default &&
          field.default.name === 'now';
        if ((field.isUpdatedAt || (creating && defaultNow)) && data[field.name] === undefined)
          data[field.name] = now;
      }
    for (const field of model.fields.filter((field) => field.kind === 'object')) {
      const nested = data[field.name];
      if (!nested) continue;
      if (nested.create) write(field.type, nested.create, true);
      if (nested.createMany?.data) write(field.type, nested.createMany.data, true);
      for (const item of [nested.upsert].flat().filter(Boolean)) {
        write(field.type, item.create, true);
        write(field.type, item.update, false);
      }
      for (const item of [nested.update, nested.updateMany].flat(2).filter(Boolean))
        write(field.type, item.data ?? item, false);
      for (const item of [nested.connectOrCreate].flat().filter(Boolean))
        write(field.type, item.create, true);
    }
  };
  if (['create', 'createMany', 'createManyAndReturn'].includes(operation))
    write(modelName, args.data, true);
  else if (['update', 'updateMany', 'updateManyAndReturn'].includes(operation))
    write(modelName, args.data, false);
  else if (operation === 'upsert') {
    write(modelName, args.create, true);
    write(modelName, args.update, false);
  }
}

export const demoClockExtension = Prisma.defineExtension({
  name: 'business-clock',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        stampDemoWrite(model, operation, args);
        return query(args);
      },
    },
  },
});
