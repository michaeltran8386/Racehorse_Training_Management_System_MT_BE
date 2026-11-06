import { plainToInstance } from 'class-transformer';
import { UpdateInvoiceDto } from './update-invoice.dto';

describe('Partial invoice edits', () => {
  it('does not reset omitted fees or status when editing a single field', () => {
    const dto = plainToInstance(UpdateInvoiceDto, { medicalFee: 100 });
    expect(dto.medicalFee).toBe(100);
    expect(dto.boardingFee).toBeUndefined();
    expect(dto.trainingFee).toBeUndefined();
    expect(dto.prizeCredit).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });
});
