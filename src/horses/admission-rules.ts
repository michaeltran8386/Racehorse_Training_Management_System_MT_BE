import { effectiveNow } from '../common/utils/demo-clock';
import { HttpStatus } from '@nestjs/common';
import { AdmissionStatus } from '@prisma/client';
import { UserRole } from '../common/enums/role.enum';
import { apiError } from '../common/exceptions/api-error';

/**
 * ADM-01 (SPEC-EQUIFLOW-HORSE-ADMISSION-V2 §5): luật phòng vệ cho module tiếp nhận ngựa.
 * Các hàm thuần, không phụ thuộc Prisma/Nest DI để viết unit test (giống horse-rules.ts).
 */

/** Rule 3: các trạng thái hồ sơ "đang hoạt động" — mỗi ngựa tối đa MỘT (ACTIVE_ADMISSION_EXISTS). */
export const ACTIVE_ADMISSION_STATUSES: AdmissionStatus[] = [
  AdmissionStatus.PENDING_VERIFICATION,
  AdmissionStatus.APPOINTED,
  AdmissionStatus.INSPECTION_IN_PROGRESS,
];

export interface ApproveInput {
  status: AdmissionStatus;
  microchipVerified: boolean;
  legalVerified: boolean;
  isHealthEligible: boolean | null;
}

/**
 * Rule 1 — rào chắn Approve: hồ sơ phải đang INSPECTION_IN_PROGRESS và đủ 3 điều kiện
 * (vi mạch khớp + pháp lý + y tế đạt). Thiếu một → ADMISSION_CRITERIA_NOT_MET.
 */
export function assertAdmissionApprovable(input: ApproveInput): void {
  if (input.status !== AdmissionStatus.INSPECTION_IN_PROGRESS) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ADMISSION_NOT_IN_INSPECTION',
      'Hồ sơ tiếp nhận chưa ở trạng thái đang thẩm định.',
    );
  }
  if (!input.microchipVerified || !input.legalVerified || !input.isHealthEligible) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ADMISSION_CRITERIA_NOT_MET',
      'Không thể duyệt tiếp nhận khi chưa hoàn tất xác thực vi mạch, giấy tờ pháp lý và kiểm tra sức khỏe thú y.',
    );
  }
}

/** Rule 3 — single active admission per horse: chặn khi còn hồ sơ đang xử lý. */
export function assertNoActiveAdmission(activeCount: number): void {
  if (activeCount > 0) {
    throw apiError(
      HttpStatus.CONFLICT,
      'ACTIVE_ADMISSION_EXISTS',
      'Chiến mã đã có một hồ sơ tiếp nhận đang xử lý. Hãy hoàn tất hoặc hủy hồ sơ đó trước.',
    );
  }
}

/** Lý do từ chối là bắt buộc và đủ dài (10–500 ký tự, nhất quán REASON_REQUIRED). */
export function assertRejectionReason(reason?: string): void {
  if (!reason || reason.trim().length < 10 || reason.trim().length > 500) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'REJECTION_REASON_REQUIRED',
      'Lý do từ chối phải từ 10 đến 500 ký tự.',
    );
  }
}

/** Kiểm tra tính hợp lệ khi xếp / đổi lịch hẹn tiếp nhận. */
export function assertValidScheduleTransition(status: AdmissionStatus): void {
  if (
    status === AdmissionStatus.APPROVED ||
    status === AdmissionStatus.REJECTED ||
    status === AdmissionStatus.CANCELLED
  ) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ADMISSION_TERMINAL',
      'Hồ sơ tiếp nhận đã ở trạng thái kết thúc, không thể xếp lịch.',
    );
  }
  if (status === AdmissionStatus.INSPECTION_IN_PROGRESS) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_ADMISSION_STATUS',
      'Hồ sơ đang trong quá trình thẩm định, không thể đổi lịch hẹn.',
    );
  }
}

/** Kiểm tra tính hợp lệ khi cập nhật thẩm định (quét chip/khám y tế). */
export function assertValidInspectTransition(status: AdmissionStatus): void {
  if (
    status === AdmissionStatus.APPROVED ||
    status === AdmissionStatus.REJECTED ||
    status === AdmissionStatus.CANCELLED
  ) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ADMISSION_TERMINAL',
      'Hồ sơ tiếp nhận đã ở trạng thái kết thúc, không thể thay đổi thông tin thẩm định.',
    );
  }
  if (status === AdmissionStatus.PENDING_VERIFICATION) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ADMISSION_NOT_SCHEDULED',
      'Hồ sơ chưa được xếp lịch hẹn tiếp nhận tại CLB.',
    );
  }
}

export interface InspectFieldPayload {
  finalizeHealth?: boolean;
  scannedMicrochip?: string;
  legalVerified?: boolean;
  legalDocumentsNote?: string;
  documentsUrl?: string;
  isHealthEligible?: boolean;
  healthCheckNotes?: string;
  veterinarianUserId?: string;
}

/**
 * Phân quyền trường cập nhật thẩm định:
 * - CM chỉ cập nhật vi mạch & pháp lý (scannedMicrochip, legalVerified, legalDocumentsNote, documentsUrl).
 * - VET chỉ cập nhật sức khỏe (isHealthEligible, healthCheckNotes).
 * Chặn giả mạo trường trái thẩm quyền (FORBIDDEN_FIELD_SPOOFING).
 */
export function assertInspectFieldRoles(role: string, dto: InspectFieldPayload): void {
  if (role === UserRole.CLUB_MANAGER) {
    if (
      dto.finalizeHealth !== undefined ||
      dto.isHealthEligible !== undefined ||
      dto.healthCheckNotes !== undefined ||
      dto.veterinarianUserId !== undefined
    ) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN_FIELD_SPOOFING',
        'Quản lý CLB không được phép cập nhật thông tin y tế / bác sĩ thú y.',
      );
    }
    return;
  }

  if (role === UserRole.VETERINARIAN) {
    if (
      dto.scannedMicrochip !== undefined ||
      dto.legalVerified !== undefined ||
      dto.legalDocumentsNote !== undefined ||
      dto.documentsUrl !== undefined
    ) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN_FIELD_SPOOFING',
        'Bác sĩ thú y không được phép cập nhật thông tin vi mạch hoặc hồ sơ pháp lý.',
      );
    }
    return;
  }

  throw apiError(
    HttpStatus.FORBIDDEN,
    'ROLE_RESTRICTION',
    'Chỉ Quản lý CLB hoặc Bác sĩ thú y được phép thực hiện thẩm định tiếp nhận.',
  );
}

/**
 * Tính toán microchipVerified ở Server-Side:
 * Chuỗi vi mạch quét được phải KHÁC RỖNG và TRÙNG KHỚP 100% với vi mạch khai báo.
 */
export function computeMicrochipVerified(
  scanned?: string | null,
  declared?: string | null,
): boolean {
  const s = scanned?.trim();
  const d = declared?.trim();
  if (!s || !d) return false;
  return s === d;
}

export interface CancelTargetRecord {
  status: AdmissionStatus;
  ownerId: string;
  appointmentDate?: Date | null;
}

export interface CancelActor {
  role: string;
  userId: string;
}

/**
 * Kiểm tra tính hợp lệ khi hủy hồ sơ tiếp nhận:
 * - Không cho phép hủy hồ sơ terminal (APPROVED, REJECTED, CANCELLED).
 * - Chủ ngựa chỉ được hủy hồ sơ của chính mình khi chưa vào bước thẩm định (PENDING_VERIFICATION, APPOINTED).
 * - Club Manager chỉ được hủy lịch hẹn khi đã quá hạn từ 3 ngày trở lên (APPOINTED, appointmentDate <= now - 3 ngày).
 */
export function assertValidCancelTransition(
  record: CancelTargetRecord,
  user: CancelActor,
  now: Date = effectiveNow(),
): void {
  if (
    record.status === AdmissionStatus.APPROVED ||
    record.status === AdmissionStatus.REJECTED ||
    record.status === AdmissionStatus.CANCELLED
  ) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ADMISSION_TERMINAL',
      'Hồ sơ tiếp nhận đã ở trạng thái kết thúc, không thể hủy.',
    );
  }

  if (user.role === UserRole.HORSE_OWNER) {
    if (record.ownerId !== user.userId) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'NOT_ADMISSION_OWNER',
        'Chủ ngựa chỉ có thể hủy hồ sơ tiếp nhận của chính mình.',
      );
    }
    if (
      record.status !== AdmissionStatus.PENDING_VERIFICATION &&
      record.status !== AdmissionStatus.APPOINTED
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_CANCEL_IN_INSPECTION',
        'Hồ sơ đang trong quá trình thẩm định tại cổng tiếp nhận, chủ ngựa không thể tự hủy.',
      );
    }
    return;
  }

  if (user.role === UserRole.CLUB_MANAGER) {
    if (record.status !== AdmissionStatus.APPOINTED || !record.appointmentDate) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CANCELLATION_STATUS',
        'Quản lý CLB chỉ có thể hủy hồ sơ khi đã có lịch hẹn nhưng quá hạn tiếp nhận.',
      );
    }
    const diffMs = now.getTime() - new Date(record.appointmentDate).getTime();
    const daysOverdue = diffMs / (1000 * 60 * 60 * 24);
    if (daysOverdue < 3) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANCELLATION_NOT_OVERDUE',
        'Quản lý CLB chỉ được hủy hồ sơ khi lịch hẹn đã quá hạn từ 3 ngày trở lên.',
      );
    }
    return;
  }

  throw apiError(
    HttpStatus.FORBIDDEN,
    'ROLE_RESTRICTION',
    'Bạn không có quyền hủy hồ sơ tiếp nhận.',
  );
}

/** Kiểm tra tính hợp lệ khi từ chối tiếp nhận (không được từ chối hồ sơ terminal). */
export function assertValidRejectTransition(status: AdmissionStatus): void {
  if (
    status === AdmissionStatus.APPROVED ||
    status === AdmissionStatus.REJECTED ||
    status === AdmissionStatus.CANCELLED
  ) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ADMISSION_TERMINAL',
      'Hồ sơ tiếp nhận đã ở trạng thái kết thúc, không thể từ chối.',
    );
  }
}
