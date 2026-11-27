import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { apiError } from '../common/exceptions/api-error';
import { UserRole } from '../common/enums/role.enum';
import { HorsesService } from './horses.service';
import { HorseHistoryService } from './horse-history.service';
import { HorseLifecycleService } from './horse-lifecycle.service';
import { CreateHorseDto } from './dto/create-horse.dto';
import { UpdateHorseDto } from './dto/update-horse.dto';
import { QueryHorseDto } from './dto/query-horse.dto';
import { ChangeHorseStatusDto } from './dto/change-status.dto';
import { DeleteHorseDto } from './dto/delete-horse.dto';
import { RestoreHorseDto } from './dto/restore-horse.dto';
import { QueryDeletedHorseDto } from './dto/query-deleted-horse.dto';
import {
  ApproveAdmissionDto,
  ReviewAdmissionHealthDto,
  CancelAdmissionDto,
  InspectAdmissionDto,
  QueryAdmissionDto,
  RejectAdmissionDto,
  ScheduleAdmissionDto,
  UpdateOwnerAdmissionSubmissionDto,
} from './dto/admission.dto';
import { AssignHorseTrainerDto, RespondHandoverDto } from './dto/handover.dto';

const ALL_STAFF_ROLES = [
  UserRole.CLUB_MANAGER,
  UserRole.HEAD_TRAINER,
  UserRole.VETERINARIAN,
  UserRole.GROOM,
];

@ApiTags('Horses')
@ApiBearerAuth('JWT-auth')
@Controller('horses')
export class HorsesController {
  constructor(
    private readonly horsesService: HorsesService,
    private readonly history: HorseHistoryService,
    private readonly lifecycle: HorseLifecycleService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách ngựa theo phân quyền vai trò (FR-1.03)' })
  async findAll(@Query() query: QueryHorseDto, @CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.findAll(query, user);
  }

  // Phải khai báo TRƯỚC ':id', nếu không Nest hiểu "deleted" là một id.
  @Get('deleted')
  @RequirePermission('deleteHorses')
  @Roles(UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Danh sách hồ sơ ngựa đã xóa (SC-1.05) - Chỉ Club Manager' })
  async findDeleted(@Query() query: QueryDeletedHorseDto) {
    return this.lifecycle.findDeleted(query);
  }

  // =========================================================================
  // ADM-02 (SPEC §5): 7 ROUTE TIẾP NHẬN & THẨM ĐỊNH (PHẢI TRƯỚC ':id')
  // =========================================================================

  @Get('admissions')
  @Roles(...ALL_STAFF_ROLES, UserRole.HORSE_OWNER)
  @ApiOperation({
    summary:
      'Danh sách hồ sơ tiếp nhận ngựa (Staff xem toàn CLB/được giao; Chủ ngựa chỉ xem đơn của mình)',
  })
  async listAdmissions(@Query() query: QueryAdmissionDto, @CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.listAdmissions(query, user);
  }

  @Get('admissions/:id/history')
  @Roles(...ALL_STAFF_ROLES, UserRole.HORSE_OWNER)
  @ApiOperation({
    summary: 'Lịch sử các bước của hồ sơ tiếp nhận (Staff hoặc chính Chủ ngựa của hồ sơ)',
  })
  async getAdmissionHistory(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.getAdmissionHistory(id, user);
  }

  @Patch('admissions/:id/submission')
  @Roles(UserRole.HORSE_OWNER)
  @ApiOperation({
    summary:
      'Chủ ngựa cập nhật ghi chú mong muốn / bổ sung ảnh giấy tờ pháp lý khi hồ sơ chưa xếp lịch',
  })
  async updateOwnerSubmission(
    @Param('id') id: string,
    @Body() dto: UpdateOwnerAdmissionSubmissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.updateOwnerSubmission(id, dto, user);
  }

  @Get('admissions/capacity')
  @Roles(UserRole.CLUB_MANAGER, UserRole.VETERINARIAN)
  admissionCapacity() {
    return this.horsesService.admissionCapacity();
  }

  @Get('admissions/placement')
  @Roles(UserRole.CLUB_MANAGER)
  admissionPlacement(
    @Query('stallId') stallId?: string,
    @Query('allocationId') allocationId?: string,
  ) {
    return this.horsesService.admissionPlacement(stallId, allocationId);
  }

  @Post('admissions/:id/health-review')
  @Roles(UserRole.VETERINARIAN)
  reviewHealth(
    @Param('id') id: string,
    @Body() dto: ReviewAdmissionHealthDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.inspectAdmission(
      id,
      {
        isHealthEligible: dto.isHealthEligible,
        healthCheckNotes: dto.healthCheckNotes,
        finalizeHealth: true,
      },
      user,
      dto.reason,
    );
  }

  @Post('admissions/:id/defer-capacity')
  @Roles(UserRole.CLUB_MANAGER)
  deferAdmissionForCapacity(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.deferAdmissionForCapacity(id, user);
  }

  @Post('admissions/:id/schedule')
  @Roles(UserRole.CLUB_MANAGER)
  @ApiOperation({
    summary: 'Xếp ngày hẹn tiếp nhận ngựa tại trung tâm (ADM-02) - Chỉ Club Manager',
  })
  async scheduleAdmission(
    @Param('id') id: string,
    @Body() dto: ScheduleAdmissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.scheduleAdmission(id, dto, user);
  }

  @Patch('admissions/:id/inspect')
  @Roles(UserRole.CLUB_MANAGER, UserRole.VETERINARIAN)
  @ApiOperation({
    summary: 'Cập nhật kết quả quét chip, giấy tờ hoặc khám y tế (ADM-02) - CM hoặc Vet',
  })
  async inspectAdmission(
    @Param('id') id: string,
    @Body() dto: InspectAdmissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.inspectAdmission(id, dto, user);
  }

  @Post('admissions/:id/approve')
  @Roles(UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Phê duyệt tiếp nhận ngựa vào CLB (ADM-02) - Chỉ Club Manager' })
  async approveAdmission(
    @Param('id') id: string,
    @Body() dto: ApproveAdmissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.approveAdmission(id, user, dto);
  }

  @Post('admissions/:id/reject')
  @Roles(UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Từ chối tiếp nhận ngựa vào CLB (ADM-02) - Chỉ Club Manager' })
  async rejectAdmission(
    @Param('id') id: string,
    @Body() dto: RejectAdmissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.rejectAdmission(id, dto, user);
  }

  @Post('admissions/:id/cancel')
  @Roles(UserRole.HORSE_OWNER, UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Hủy hồ sơ tiếp nhận ngựa (ADM-02) - Chủ ngựa hoặc Club Manager' })
  async cancelAdmission(
    @Param('id') id: string,
    @Body() dto: CancelAdmissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.cancelAdmission(id, dto, user);
  }

  // =========================================================================
  // HANDOVER & TRAINER ASSIGNMENT (BR-BARN-SOVEREIGNTY, SLA-HANDOVER-48H)
  // =========================================================================

  @Get('handover/pending')
  @Roles(UserRole.HEAD_TRAINER, UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu phân công đang chờ HLV phản hồi (SLA 48h)' })
  async getPendingHandovers(@CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.getPendingHandovers(user);
  }

  @Get('handover/my-waiting-horses')
  @Roles(UserRole.HEAD_TRAINER, UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Danh sách chiến mã đã tiếp nhận chờ lập giáo án (SLA Lũy tiến)' })
  async getMyWaitingHorses(@CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.getMyWaitingHorses(user);
  }

  @Post('handover/respond')
  @ApiOperation({ summary: 'HLV xác nhận tiếp nhận hoặc từ chối chiến mã qua Token (SLA 48h)' })
  async respondHandover(@Body() dto: RespondHandoverDto, @CurrentUser() user?: CurrentUserPayload) {
    return this.horsesService.respondHandover(dto, user);
  }

  // =========================================================================
  // CÁC ROUTE ĐỊNH DANH NGỰA DÙNG ':id'
  // =========================================================================

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết hồ sơ định danh ngựa (FR-1.04)' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.findOne(id, user);
  }

  @Get(':id/history')
  @ApiOperation({
    summary:
      'Lấy toàn bộ lịch sử vòng đời định danh, y tế, huấn luyện và chuyển nhượng của ngựa (Flow 1, FR-1.04)',
  })
  async getHistory(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.history.getHistory(id, user);
  }

  @Post()
  @RequirePermission('editHorses')
  @Roles(UserRole.HORSE_OWNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Chủ ngựa tự đăng ký ngựa của mình (FR-1.01)' })
  async create(@Body() dto: CreateHorseDto, @CurrentUser() user: CurrentUserPayload) {
    return this.horsesService.create(dto, user);
  }

  @Put(':id')
  @RequirePermission('editHorses')
  @Roles(UserRole.HORSE_OWNER)
  @ApiOperation({ summary: 'Chủ ngựa cập nhật thông tin ngựa của mình (FR-1.02)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHorseDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission('deleteHorses')
  @Roles(UserRole.CLUB_MANAGER)
  @ApiOperation({
    summary: 'Xóa mềm hồ sơ ngựa tạo nhầm (DL-1.10, chưa có dữ liệu phụ thuộc) - Chỉ Club Manager',
  })
  async remove(
    @Param('id') id: string,
    @Body() dto: DeleteHorseDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.lifecycle.remove(id, dto, user);
  }

  @Post(':id/restore')
  @RequirePermission('deleteHorses')
  @Roles(UserRole.CLUB_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Khôi phục hồ sơ đã xóa hoặc Hoàn tác xóa (DL-1.11) - Chỉ Club Manager',
  })
  async restore(
    @Param('id') id: string,
    @Body() dto: RestoreHorseDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.lifecycle.restore(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(UserRole.CLUB_MANAGER, UserRole.HEAD_TRAINER, UserRole.VETERINARIAN)
  @ApiOperation({ summary: 'Chuyển trạng thái ngựa (FR-1.05, FR-1.06, FR-1.08)' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeHorseStatusDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    // Q-2.C: CM chỉ dùng API này để Ngừng quản lý / Kích hoạt lại -> cần công tắc deleteHorses.
    if (user.role === UserRole.CLUB_MANAGER && user.permissions && !user.permissions.deleteHorses) {
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Not allowed');
    }
    return this.lifecycle.changeStatus(id, dto, user);
  }

  @Post(':id/assign-trainer')
  @Roles(UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Quản lý phân công HLV phụ trách chiến mã (cùng Barn, SLA 48h)' })
  async assignTrainer(
    @Param('id') id: string,
    @Body() dto: AssignHorseTrainerDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.horsesService.assignTrainer(id, dto, user);
  }
}
