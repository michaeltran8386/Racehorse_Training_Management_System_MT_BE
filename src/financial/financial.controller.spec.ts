import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { UserRole } from '../common/enums/role.enum';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

describe('FinancialController owner summary scope', () => {
  it.each([
    [UserRole.CLUB_MANAGER, undefined, undefined],
    [UserRole.CLUB_MANAGER, 'owner-2', 'owner-2'],
    [UserRole.HORSE_OWNER, undefined, 'current-user'],
    [UserRole.HORSE_OWNER, 'owner-2', 'current-user'],
  ])('scopes %s with owner query %s to %s', async (role, query, expected) => {
    const getOwnerSummary = jest.fn().mockResolvedValue({ invoices: [] });
    const controller = new FinancialController({ getOwnerSummary } as unknown as FinancialService);
    await controller.getOwnerSummary(
      {
        userId: 'current-user',
        fullName: 'User',
        email: 'user@test.com',
        role,
      },
      query,
    );
    expect(getOwnerSummary).toHaveBeenCalledWith(expected);
  });

  it('restricts summary access to manager and owner roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, FinancialController.prototype.getOwnerSummary)).toEqual([
      UserRole.CLUB_MANAGER,
      UserRole.HORSE_OWNER,
    ]);
  });
});
