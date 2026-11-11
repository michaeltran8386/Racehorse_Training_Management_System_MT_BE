import { Body, Controller, Get, Param, ParseEnumPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserRole } from '../common/enums/role.enum';
import { SimulatorService } from './simulator.service';
import { SimulatorSessionsResponse } from './simulator.types';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { SimulatorSessionStatus } from '@prisma/client';
import { StartExamDto } from './dto/exam-packet.dto';
import { allowEarlyWorkoutStart } from '../training/training-rules';

@ApiTags('Simulator Realtime & Sessions')
@ApiBearerAuth('JWT-auth')
@Controller('simulator')
export class SimulatorController {
  constructor(private readonly simulatorService: SimulatorService) {}

  @Get('horses')
  @Public()
  @ApiOperation({ summary: 'Lấy toàn bộ danh sách ngựa công khai cho thiết bị mô phỏng' })
  getSimulatorHorses() {
    return this.simulatorService.getHorsesForSimulator();
  }

  @Get('stalls')
  @Public()
  @ApiOperation({ summary: 'Sơ đồ khu/ô chuồng thật (chỉ đọc) cho thiết bị mô phỏng' })
  getSimulatorStalls() {
    return this.simulatorService.getStallMapForSimulator();
  }

  @Get('staff')
  @Public()
  @ApiOperation({
    summary: 'Nhân sự đang làm việc (tên, vai trò, ca hôm nay, ngựa phụ trách) cho mô phỏng',
  })
  getSimulatorStaff() {
    return this.simulatorService.getStaffForSimulator();
  }

  @Get('config')
  @Roles(UserRole.HEAD_TRAINER)
  @ApiOperation({ summary: 'Cờ dev: có cho mô phỏng / ghi kết quả trước giờ tập không' })
  getConfig() {
    return { allowEarlyStart: allowEarlyWorkoutStart() };
  }

  @Post('workouts/:workoutId/start')
  @Roles(UserRole.HEAD_TRAINER)
  @ApiOperation({ summary: 'Cấp phiên mô phỏng cho một buổi tập hợp lệ' })
  startWorkout(@Param('workoutId') workoutId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.simulatorService.startWorkout(workoutId, actor);
  }

  @Post('tournaments/:tournamentId/start')
  @Roles(UserRole.HEAD_TRAINER, UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Cấp phiên mô phỏng cho giải đua chính thức' })
  startTournamentRace(
    @Param('tournamentId') tournamentId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.simulatorService.startTournamentRace(tournamentId, actor);
  }

  @Post('tournaments/:tournamentId/quick-result')
  @Roles(UserRole.HEAD_TRAINER, UserRole.CLUB_MANAGER)
  @ApiOperation({
    summary:
      'Đo nhanh kết quả giải đua từ mô hình huấn luyện thực tế và lưu nháp kết quả (1-click)',
  })
  quickSimulateTournamentRace(
    @Param('tournamentId') tournamentId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.simulatorService.quickSimulateTournamentRace(tournamentId, actor);
  }

  @Post('horses/:horseId/exams/start')
  @Roles(UserRole.VETERINARIAN)
  @ApiOperation({ summary: 'Cấp phiên mô phỏng khám cho bác sĩ thú y' })
  startExam(
    @Param('horseId') horseId: string,
    @Body() dto: StartExamDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.simulatorService.startExam(horseId, dto.medicalRecordId, actor);
  }

  @Get('horses/:horseId/exams/latest')
  @Roles(UserRole.VETERINARIAN, UserRole.CLUB_MANAGER)
  @ApiOperation({ summary: 'Lấy số đo khám mô phỏng gần nhất để bác sĩ duyệt' })
  getLatestExamResult(@Param('horseId') horseId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.simulatorService.getLatestExamResult(horseId, actor);
  }

  @Get('workouts/:workoutId/latest')
  @Roles(UserRole.HEAD_TRAINER)
  @ApiOperation({ summary: 'Lấy số đo mô phỏng gần nhất để trainer duyệt kết quả' })
  getLatestWorkoutResult(
    @Param('workoutId') workoutId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.simulatorService.getLatestWorkoutResult(workoutId, actor);
  }

  @Get('sessions/:sessionId/context')
  @Public()
  @ApiOperation({ summary: 'Lấy ngựa và cấu hình của phiên mô phỏng' })
  getContext(@Param('sessionId') sessionId: string, @CurrentUser() actor?: CurrentUserPayload) {
    return this.simulatorService.getContext(sessionId, actor);
  }

  @Get('sessions')
  @Roles(UserRole.CLUB_MANAGER, UserRole.HEAD_TRAINER, UserRole.VETERINARIAN)
  @ApiOperation({ summary: 'Truy vấn danh sách phiên mô phỏng đang chạy và lịch sử gần nhất' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Giới hạn số phiên gần nhất (1..100)',
  })
  @ApiQuery({ name: 'status', required: false, enum: SimulatorSessionStatus })
  async getSessions(
    @Query('limit') limit?: string,
    @Query('status', new ParseEnumPipe(SimulatorSessionStatus, { optional: true }))
    status?: SimulatorSessionStatus,
  ): Promise<SimulatorSessionsResponse> {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.simulatorService.listRecent(parsedLimit, status);
  }
}
