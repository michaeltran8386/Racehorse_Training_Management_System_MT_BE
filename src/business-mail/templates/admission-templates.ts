import { effectiveNow } from '../../common/utils/demo-clock';
import { BusinessMailContent, linkBase, renderMail } from './html';

/**
 * Templates nhóm TIẾP NHẬN NGỰA & XÁC THỰC CHÍNH CHỦ VÀO CLB (ADM-03, SPEC §6).
 * Gửi tự động cho chủ ngựa qua BusinessMailService sau khi giao dịch DB hoàn tất.
 */

export interface AdmissionMailLike {
  id: string;
  admissionCode: string;
  declaredMicrochip?: string | null;
  scannedMicrochip?: string | null;
  appointmentDate?: Date | string | null;
  appointmentEndDate?: Date | string | null;
  appointmentNotes?: string | null;
  rejectionReason?: string | null;
  admittedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface HorseMailLike {
  id: string;
  name: string;
  horseCode?: string | null;
  microchip?: string | null;
}

export interface OwnerMailLike {
  id: string;
  fullName: string;
  email?: string;
}

const fmtDateTime = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      })
    : '—';

/**
 * Email 0: Đã nhận đăng ký (ADMISSION_REQUEST_RECEIVED)
 * Gửi ngay sau khi chủ nộp đơn tạo hồ sơ PENDING_ADMISSION.
 */
export function admissionRequestReceived(
  admission: AdmissionMailLike,
  horse: HorseMailLike,
  owner: OwnerMailLike,
): BusinessMailContent {
  const subject = `[EquiFlow] Đã tiếp nhận yêu cầu đăng ký chiến mã ${horse.name}`;
  return renderMail(subject, [
    { label: 'Chủ sở hữu', value: owner.fullName },
    { label: 'Tên chiến mã', value: horse.name },
    { label: 'Mã hồ sơ tiếp nhận', value: admission.admissionCode },
    { label: 'Số vi mạch khai báo', value: admission.declaredMicrochip || horse.microchip || '—' },
    { label: 'Thời gian đăng ký', value: fmtDateTime(admission.createdAt || effectiveNow()) },
    {
      label: 'Thông báo',
      value:
        'Hệ thống đã tiếp nhận yêu cầu đăng ký của bạn. Bộ phận Quản lý CLB sẽ sớm liên hệ và xếp lịch hẹn thẩm định thực tế.',
    },
    { label: 'Theo dõi hồ sơ', value: `${linkBase()}/horses` },
  ]);
}

/**
 * Email 1: Lịch hẹn thẩm định tại CLB (ADMISSION_APPOINTMENT_SCHEDULED)
 * Quản lý CLB xếp ngày giờ hẹn mang ngựa đến trạm tiếp nhận Cổng A.
 */
export function admissionAppointmentScheduled(
  admission: AdmissionMailLike,
  horse: HorseMailLike,
  owner: OwnerMailLike,
): BusinessMailContent {
  const subject = `[EquiFlow] Lịch hẹn thẩm định tiếp nhận ngựa: ${horse.name}`;
  return renderMail(subject, [
    { label: 'Chủ sở hữu', value: owner.fullName },
    { label: 'Tên chiến mã', value: horse.name },
    { label: 'Mã hồ sơ tiếp nhận', value: admission.admissionCode },
    { label: 'Bắt đầu (giờ CLB)', value: fmtDateTime(admission.appointmentDate) },
    { label: 'Kết thúc (giờ CLB)', value: fmtDateTime(admission.appointmentEndDate) },
    { label: 'Địa điểm tiếp đón', value: 'Trạm kiểm định Cổng A — CLB Đua Ngựa EquiFlow' },
    {
      label: 'Hướng dẫn chuẩn bị',
      value:
        'Mang theo ngựa cùng các giấy tờ gốc gồm: Giấy chứng nhận phả hệ, Giấy tờ chứng minh quyền sở hữu hợp pháp, Sổ theo dõi tiêm phòng vắc-xin gốc.',
    },
    {
      label: 'Ghi chú đón tiếp',
      value: admission.appointmentNotes || 'Đến trước giờ hẹn 15 phút để làm thủ tục tiếp nhận.',
    },
    { label: 'Tra cứu thông tin', value: `${linkBase()}/horses` },
  ]);
}

export function admissionCapacityDeferred(
  admission: AdmissionMailLike,
  horse: HorseMailLike,
  owner: OwnerMailLike,
): BusinessMailContent {
  return renderMail(`[EquiFlow] Hoãn thẩm định hồ sơ ${admission.admissionCode} do hết chuồng`, [
    { label: 'Chủ ngựa', value: owner.fullName },
    { label: 'Ngựa', value: horse.name },
    { label: 'Hồ sơ', value: admission.admissionCode },
    { label: 'Lịch hẹn cũ', value: fmtDateTime(admission.appointmentDate) },
    {
      label: 'Thông báo',
      value:
        'CLB hiện đã hết chuồng trống nên chưa thể tiến hành thẩm định tiếp nhận. Hồ sơ của bạn được giữ lại, không bị từ chối. Quản lý sẽ liên hệ để thống nhất lịch hẹn mới khi có chuồng phù hợp.',
    },
    { label: 'Theo dõi hồ sơ', value: `${linkBase()}/horses` },
  ]);
}

/**
 * Email 2: Tiếp nhận thành công vào CLB (HORSE_ADMISSION_CONFIRMED)
 * Quản lý bấm duyệt sau khi thẩm định đủ 3 điều kiện (chip, pháp lý, y tế).
 */
export function admissionApproved(
  admission: AdmissionMailLike,
  horse: HorseMailLike,
  owner: OwnerMailLike,
  vetName?: string | null,
): BusinessMailContent {
  const subject = `[EquiFlow] Chúc mừng: Chiến mã ${horse.name} đã chính thức gia nhập CLB`;
  return renderMail(subject, [
    { label: 'Chủ sở hữu', value: owner.fullName },
    { label: 'Tên chiến mã', value: horse.name },
    { label: 'Mã số tiếp nhận', value: admission.admissionCode },
    {
      label: 'Số Vi mạch (Microchip) xác thực',
      value: admission.scannedMicrochip || admission.declaredMicrochip || horse.microchip || '—',
    },
    { label: 'Bác sĩ thú y thẩm định', value: vetName || 'Bác sĩ thú y CLB EquiFlow' },
    { label: 'Tình trạng thể lực', value: 'Đạt chuẩn sức khỏe và an toàn sinh học' },
    {
      label: 'Trạng thái hiện tại',
      value:
        'Ngựa đã được đưa vào trung tâm với trạng thái Nghỉ ngơi (RESTING). Bộ phận Quản lý đang tiến hành phân bổ ô chuồng (Stall) và nhân viên chăm sóc (Groom).',
    },
    { label: 'Thời điểm tiếp nhận', value: fmtDateTime(admission.admittedAt || effectiveNow()) },
    { label: 'Xem hồ sơ ngựa', value: `${linkBase()}/horses` },
  ]);
}

/**
 * Email 3: Từ chối tiếp nhận (HORSE_ADMISSION_REJECTED)
 * Quản lý từ chối tiếp nhận kèm lý do bắt buộc.
 */
export function admissionRejected(
  admission: AdmissionMailLike,
  horse: HorseMailLike,
  owner: OwnerMailLike,
): BusinessMailContent {
  const subject = `[EquiFlow] Thông báo kết quả thẩm định tiếp nhận ngựa: ${horse.name}`;
  return renderMail(subject, [
    { label: 'Chủ sở hữu', value: owner.fullName },
    { label: 'Tên chiến mã', value: horse.name },
    { label: 'Mã hồ sơ', value: admission.admissionCode },
    { label: 'Kết quả thẩm định', value: 'Chưa đủ điều kiện gia nhập CLB tại thời điểm này' },
    {
      label: 'Lý do từ chối',
      value: admission.rejectionReason || 'Hồ sơ chưa đạt tiêu chuẩn quy định của CLB.',
    },
    {
      label: 'Hướng dẫn khắc phục',
      value:
        'Chủ ngựa có thể bổ sung giấy tờ hoặc điều trị dứt điểm triệu chứng và nộp lại đơn đăng ký tiếp nhận sau.',
    },
    { label: 'Xem chi tiết', value: `${linkBase()}/horses` },
  ]);
}
