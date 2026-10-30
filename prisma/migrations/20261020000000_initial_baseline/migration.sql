-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLUB_MANAGER', 'HEAD_TRAINER', 'VETERINARIAN', 'GROOM', 'HORSE_OWNER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_EMAIL', 'PENDING_APPROVAL', 'INVITED', 'ACTIVE', 'INACTIVE', 'REJECTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SIGNUP', 'RESET', 'INVITE');

-- CreateEnum
CREATE TYPE "PermissionRequestStatus" AS ENUM ('OPEN', 'GRANTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "HorseStatus" AS ENUM ('ACTIVE', 'IN_TRAINING', 'UNDER_OBSERVATION', 'INJURED', 'ISOLATED', 'RESTING', 'RETIRED');

-- CreateEnum
CREATE TYPE "NutritionPlanStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RetireReason" AS ENUM ('RETIRED', 'SOLD', 'DECEASED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "StallStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "HorseCatalogType" AS ENUM ('BREED', 'COLOR');

-- CreateEnum
CREATE TYPE "TrackSurface" AS ENUM ('TURF', 'DIRT', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'BLOCKED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BodySide" AS ENUM ('LEFT', 'RIGHT', 'BILATERAL');

-- CreateEnum
CREATE TYPE "SeverityLevel" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InjuryStatus" AS ENUM ('ACTIVE', 'HEALING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MedicalRecordStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PreventiveType" AS ENUM ('VACCINATION', 'DEWORMING', 'FARRIER_HOOF_CARE', 'DENTAL');

-- CreateEnum
CREATE TYPE "PreventiveStatus" AS ENUM ('PENDING', 'COMPLETED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "DailyTaskType" AS ENUM ('FEEDING', 'CLEANING', 'GROOMING', 'ICE_BOOT_REST', 'WALKING', 'MEDICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RestockStatus" AS ENUM ('PENDING', 'APPROVED', 'DELIVERED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('UPCOMING', 'OPEN_REGISTRATION', 'CLOSED_REGISTRATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'SCRATCHED_MEDICAL', 'CONFIRMED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('WORKOUT_RECOMMENDATION', 'INJURY_RISK_WARNING', 'RECOVERY_ADVICE');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('GENERATED', 'ACKNOWLEDGED', 'APPLIED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SupplyCategory" AS ENUM ('FEED_HAY', 'FEED_GRAIN', 'SUPPLEMENT_VITAMIN', 'SUPPLEMENT_MINERAL', 'SUPPLEMENT_ELECTROLYTE', 'SUPPLEMENT_GENERAL', 'MEDICINE', 'VACCINE', 'DEWORMER', 'TOOL_EQUIPMENT', 'CLEANING_SUPPLY');

-- CreateEnum
CREATE TYPE "SupplyUnit" AS ENUM ('KG', 'G', 'LITER', 'ML', 'PILL', 'PACKET', 'BOTTLE', 'VIAL', 'PIECE', 'SET');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ACCOUNT', 'HORSE', 'TRAINING', 'LOCK', 'MEDICAL', 'NUTRITION', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "passwordChangedAt" TIMESTAMP(3),
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_EMAIL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActive" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3),
    "requestCode" TEXT,
    "lockedAt" TIMESTAMP(3),
    "invitedBy" TEXT,
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "permissions" JSONB,
    "permissionsChangedAt" TIMESTAMP(3),
    "permissionsChangedBy" TEXT,
    "notify" JSONB,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resendAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "email" TEXT NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "windowStart" TIMESTAMP(3),

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "ResetToken" (
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResetToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "PermissionRequest" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PermissionRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "PermissionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "params" JSONB,
    "link" TEXT,
    "senderName" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "rotatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Horse" (
    "id" TEXT NOT NULL,
    "horseCode" TEXT,
    "name" TEXT NOT NULL,
    "microchip" TEXT,
    "rfid" TEXT,
    "microchipRfid" TEXT NOT NULL,
    "breed" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "gender" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "status" "HorseStatus" NOT NULL DEFAULT 'RESTING',
    "isMedicalLocked" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "retireReason" "RetireReason",
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Horse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StallZone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 1,
    "cols" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StallZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stall" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "zoneId" TEXT,
    "row" INTEGER,
    "col" INTEGER,
    "status" "StallStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorseCatalogItem" (
    "id" TEXT NOT NULL,
    "type" "HorseCatalogType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HorseCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StallAllocation" (
    "id" TEXT NOT NULL,
    "stallId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "assignedGroomUserId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StallAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "trainerUserId" TEXT NOT NULL,
    "planCode" TEXT,
    "phaseName" TEXT NOT NULL,
    "objective" TEXT,
    "notes" TEXT,
    "phases" JSONB,
    "targetSpeed" DOUBLE PRECISION,
    "targetDistance" INTEGER,
    "trackSurface" "TrackSurface" NOT NULL DEFAULT 'TURF',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "cancelReason" TEXT,
    "completionSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL,
    "trainingPlanId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "assignedStaffUserId" TEXT,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "phaseId" TEXT,
    "distanceMeters" INTEGER NOT NULL,
    "repetitions" INTEGER NOT NULL DEFAULT 1,
    "targetSpeedKmh" DOUBLE PRECISION,
    "targetDurationSeconds" INTEGER,
    "actualTimeSeconds" DOUBLE PRECISION,
    "heartRatePeak" INTEGER,
    "heartRateRecovery" INTEGER,
    "performanceScore" DOUBLE PRECISION,
    "trainerNotes" TEXT,
    "status" "WorkoutStatus" NOT NULL DEFAULT 'SCHEDULED',
    "workoutType" TEXT DEFAULT 'REGULAR',
    "intensity" TEXT DEFAULT 'MODERATE',
    "trackSurface" TEXT DEFAULT 'TURF',
    "jockeyName" TEXT,
    "gateNumber" INTEGER,
    "averageSpeedKmh" DOUBLE PRECISION,
    "topSpeedKmh" DOUBLE PRECISION,
    "recoveryTimeMinutes" DOUBLE PRECISION,
    "staminaScore" DOUBLE PRECISION,
    "injuryRiskLevel" TEXT DEFAULT 'LOW',
    "statusReason" TEXT,
    "medicalOverride" BOOLEAN NOT NULL DEFAULT false,
    "resultRecordedAt" TIMESTAMP(3),
    "resultRecordedById" TEXT,
    "resultUpdatedAt" TIMESTAMP(3),
    "resultUpdatedById" TEXT,
    "actualDistanceMeters" INTEGER,
    "actualSurface" TEXT,
    "trackCondition" TEXT,
    "completionLevel" TEXT,
    "resultNotes" TEXT,
    "abnormalSignTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "abnormalSigns" BOOLEAN NOT NULL DEFAULT false,
    "abnormalNotes" TEXT,
    "vetAcknowledgedAt" TIMESTAMP(3),
    "vetNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecord" (
    "id" TEXT NOT NULL,
    "recordNumber" TEXT,
    "horseId" TEXT NOT NULL,
    "veterinarianUserId" TEXT NOT NULL,
    "status" "MedicalRecordStatus" NOT NULL DEFAULT 'OPEN',
    "examinationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "examinationType" TEXT DEFAULT 'Routine Clinical',
    "discoverySource" TEXT,
    "severity" "SeverityLevel" DEFAULT 'MODERATE',
    "temperature" DOUBLE PRECISION,
    "restingHeartRate" INTEGER,
    "respiratoryRate" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "clinicalExamination" TEXT,
    "symptoms" TEXT NOT NULL,
    "clinicalDiagnosis" TEXT NOT NULL,
    "treatmentProtocol" TEXT NOT NULL,
    "prescriptionDetails" TEXT,
    "conclusion" TEXT,
    "treatmentResult" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "treatmentPhases" TEXT,
    "prescriptions" TEXT,
    "followUps" TEXT,
    "labTests" TEXT,
    "requiresFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InjuryLog" (
    "id" TEXT NOT NULL,
    "medicalRecordId" TEXT,
    "horseId" TEXT NOT NULL,
    "coordinateX" DOUBLE PRECISION NOT NULL,
    "coordinateY" DOUBLE PRECISION NOT NULL,
    "viewSide" TEXT NOT NULL DEFAULT 'LEFT',
    "layer" TEXT NOT NULL DEFAULT 'MUSCLE',
    "anatomicalZone" TEXT NOT NULL,
    "bodySide" "BodySide" NOT NULL DEFAULT 'LEFT',
    "injuryType" TEXT NOT NULL,
    "severity" "SeverityLevel" NOT NULL DEFAULT 'MODERATE',
    "stage" TEXT NOT NULL DEFAULT 'ACUTE',
    "status" "InjuryStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "discoveryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveryHistory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InjuryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalLock" (
    "id" TEXT NOT NULL,
    "lockCode" TEXT,
    "horseId" TEXT NOT NULL,
    "medicalRecordId" TEXT,
    "veterinarianUserId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedRestDays" INTEGER NOT NULL DEFAULT 7,
    "recheckDate" TIMESTAMP(3),
    "appliedMedicalStatus" "HorseStatus" NOT NULL DEFAULT 'INJURED',
    "lockReason" TEXT NOT NULL,
    "unlockConditions" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT true,
    "unlockedAt" TIMESTAMP(3),
    "unlockVetUserId" TEXT,
    "unlockReason" TEXT,
    "recheckNotes" TEXT,
    "extensionHistory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreventiveTypeCatalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PreventiveType" NOT NULL DEFAULT 'VACCINATION',
    "intervalDays" INTEGER NOT NULL,
    "advanceNoticeDays" INTEGER NOT NULL DEFAULT 7,
    "applyToNewHorses" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreventiveTypeCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreventiveSchedule" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "typeCatalogId" TEXT,
    "veterinarianUserId" TEXT,
    "scheduleType" "PreventiveType" NOT NULL DEFAULT 'VACCINATION',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "lastCompletedDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "productAdministered" TEXT,
    "batchNumber" TEXT,
    "performedByMode" TEXT NOT NULL DEFAULT 'SELF',
    "performedByName" TEXT,
    "notes" TEXT,
    "status" "PreventiveStatus" NOT NULL DEFAULT 'PENDING',
    "historyLogs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreventiveSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionPlan" (
    "id" TEXT NOT NULL,
    "planCode" TEXT,
    "horseId" TEXT NOT NULL,
    "status" "NutritionPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "dailyFeedWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetWeightRatioPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horseWeightSnapshot" DOUBLE PRECISION,
    "mealsJson" JSONB,
    "hayFeedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainFeedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supplementsJson" TEXT,
    "specialInstructions" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "vetNotes" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyGroomingLog" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "groomUserId" TEXT NOT NULL,
    "shiftDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftType" "ShiftType" NOT NULL DEFAULT 'MORNING',
    "feedCompleted" BOOLEAN NOT NULL DEFAULT false,
    "cleaningCompleted" BOOLEAN NOT NULL DEFAULT false,
    "groomingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "iceBootCompleted" BOOLEAN NOT NULL DEFAULT false,
    "healthObservations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyGroomingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "raceDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "trackType" "TrackSurface" NOT NULL DEFAULT 'TURF',
    "prizePool" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "registrationDeadline" TIMESTAMP(3) NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRegistration" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "registeredByTrainerId" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "registrationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentResult" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "finalRank" INTEGER NOT NULL,
    "finishTimeSeconds" DOUBLE PRECISION NOT NULL,
    "avgSpeedKmh" DOUBLE PRECISION NOT NULL,
    "prizeMoneyWon" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "officialNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialInvoice" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "boardingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "medicalFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "trainingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "prizeCredit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInsight" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "insightType" "InsightType" NOT NULL,
    "trainingLoadIndex" DOUBLE PRECISION NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "recommendationsJson" TEXT NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValuesJson" TEXT,
    "newValuesJson" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyCatalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "SupplyCategory" NOT NULL,
    "unit" "SupplyUnit" NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "withdrawalDays" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCatalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isOvernight" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRoster" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shiftId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "groomUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCareTask" (
    "id" TEXT NOT NULL,
    "taskCode" TEXT,
    "date" DATE NOT NULL,
    "horseId" TEXT NOT NULL,
    "stallZoneId" TEXT,
    "stallId" TEXT,
    "taskType" "DailyTaskType" NOT NULL DEFAULT 'FEEDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mealType" TEXT,
    "scheduledTime" TEXT,
    "shiftId" TEXT,
    "nutritionPlanId" TEXT,
    "isMedicalLocked" BOOLEAN NOT NULL DEFAULT false,
    "medicalLockNotes" TEXT,
    "itemsSnapshotJson" JSONB,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "assignedGroomUserId" TEXT,
    "undoUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCareTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" TEXT NOT NULL,
    "incidentNumber" TEXT,
    "horseId" TEXT NOT NULL,
    "stallZoneId" TEXT,
    "reportedById" TEXT NOT NULL,
    "severity" "SeverityLevel" NOT NULL DEFAULT 'MILD',
    "symptomsJson" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "vetNotes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "medicalRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minThreshold" DECIMAL(12,2) NOT NULL DEFAULT 10,
    "lastInventoryDate" TIMESTAMP(3),
    "lastAdjustedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT,
    "zoneId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(12,2) NOT NULL,
    "approvedQuantity" DECIMAL(12,2),
    "status" "RestockStatus" NOT NULL DEFAULT 'PENDING',
    "urgencyReason" TEXT,
    "rejectionReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_requestCode_key" ON "User"("requestCode");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OtpCode_email_purpose_key" ON "OtpCode"("email", "purpose");

-- CreateIndex
CREATE INDEX "ResetToken_email_idx" ON "ResetToken"("email");

-- CreateIndex
CREATE INDEX "PermissionRequest_status_idx" ON "PermissionRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Horse_horseCode_key" ON "Horse"("horseCode");

-- CreateIndex
CREATE UNIQUE INDEX "Horse_microchip_key" ON "Horse"("microchip");

-- CreateIndex
CREATE UNIQUE INDEX "Horse_rfid_key" ON "Horse"("rfid");

-- CreateIndex
CREATE UNIQUE INDEX "Horse_microchipRfid_key" ON "Horse"("microchipRfid");

-- CreateIndex
CREATE INDEX "Horse_horseCode_idx" ON "Horse"("horseCode");

-- CreateIndex
CREATE INDEX "Horse_microchip_idx" ON "Horse"("microchip");

-- CreateIndex
CREATE INDEX "Horse_rfid_idx" ON "Horse"("rfid");

-- CreateIndex
CREATE INDEX "Horse_microchipRfid_idx" ON "Horse"("microchipRfid");

-- CreateIndex
CREATE INDEX "Horse_ownerId_idx" ON "Horse"("ownerId");

-- CreateIndex
CREATE INDEX "Horse_status_idx" ON "Horse"("status");

-- CreateIndex
CREATE INDEX "Horse_isMedicalLocked_idx" ON "Horse"("isMedicalLocked");

-- CreateIndex
CREATE INDEX "Horse_deletedAt_idx" ON "Horse"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StallZone_code_key" ON "StallZone"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StallZone_name_key" ON "StallZone"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Stall_code_key" ON "Stall"("code");

-- CreateIndex
CREATE INDEX "Stall_zone_idx" ON "Stall"("zone");

-- CreateIndex
CREATE INDEX "Stall_code_idx" ON "Stall"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Stall_zoneId_row_col_key" ON "Stall"("zoneId", "row", "col");

-- CreateIndex
CREATE INDEX "HorseCatalogItem_type_isActive_idx" ON "HorseCatalogItem"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "HorseCatalogItem_type_code_key" ON "HorseCatalogItem"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "HorseCatalogItem_type_name_key" ON "HorseCatalogItem"("type", "name");

-- CreateIndex
CREATE INDEX "StallAllocation_stallId_isActive_idx" ON "StallAllocation"("stallId", "isActive");

-- CreateIndex
CREATE INDEX "StallAllocation_horseId_isActive_idx" ON "StallAllocation"("horseId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlan_planCode_key" ON "TrainingPlan"("planCode");

-- CreateIndex
CREATE INDEX "TrainingPlan_horseId_idx" ON "TrainingPlan"("horseId");

-- CreateIndex
CREATE INDEX "TrainingPlan_trainerUserId_idx" ON "TrainingPlan"("trainerUserId");

-- CreateIndex
CREATE INDEX "WorkoutSession_trainingPlanId_idx" ON "WorkoutSession"("trainingPlanId");

-- CreateIndex
CREATE INDEX "WorkoutSession_horseId_idx" ON "WorkoutSession"("horseId");

-- CreateIndex
CREATE INDEX "WorkoutSession_scheduledDate_idx" ON "WorkoutSession"("scheduledDate");

-- CreateIndex
CREATE INDEX "MedicalRecord_horseId_idx" ON "MedicalRecord"("horseId");

-- CreateIndex
CREATE INDEX "MedicalRecord_veterinarianUserId_idx" ON "MedicalRecord"("veterinarianUserId");

-- CreateIndex
CREATE INDEX "MedicalRecord_recordNumber_idx" ON "MedicalRecord"("recordNumber");

-- CreateIndex
CREATE INDEX "InjuryLog_horseId_idx" ON "InjuryLog"("horseId");

-- CreateIndex
CREATE INDEX "InjuryLog_medicalRecordId_idx" ON "InjuryLog"("medicalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalLock_lockCode_key" ON "MedicalLock"("lockCode");

-- CreateIndex
CREATE INDEX "MedicalLock_horseId_isLocked_idx" ON "MedicalLock"("horseId", "isLocked");

-- CreateIndex
CREATE INDEX "MedicalLock_medicalRecordId_idx" ON "MedicalLock"("medicalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "PreventiveTypeCatalog_code_key" ON "PreventiveTypeCatalog"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PreventiveTypeCatalog_name_key" ON "PreventiveTypeCatalog"("name");

-- CreateIndex
CREATE INDEX "PreventiveTypeCatalog_category_idx" ON "PreventiveTypeCatalog"("category");

-- CreateIndex
CREATE INDEX "PreventiveTypeCatalog_isActive_idx" ON "PreventiveTypeCatalog"("isActive");

-- CreateIndex
CREATE INDEX "PreventiveSchedule_horseId_idx" ON "PreventiveSchedule"("horseId");

-- CreateIndex
CREATE INDEX "PreventiveSchedule_typeCatalogId_idx" ON "PreventiveSchedule"("typeCatalogId");

-- CreateIndex
CREATE INDEX "PreventiveSchedule_dueDate_status_idx" ON "PreventiveSchedule"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionPlan_planCode_key" ON "NutritionPlan"("planCode");

-- CreateIndex
CREATE INDEX "NutritionPlan_horseId_idx" ON "NutritionPlan"("horseId");

-- CreateIndex
CREATE INDEX "NutritionPlan_status_idx" ON "NutritionPlan"("status");

-- CreateIndex
CREATE INDEX "NutritionPlan_createdById_idx" ON "NutritionPlan"("createdById");

-- CreateIndex
CREATE INDEX "NutritionPlan_approvedById_idx" ON "NutritionPlan"("approvedById");

-- CreateIndex
CREATE INDEX "DailyGroomingLog_horseId_idx" ON "DailyGroomingLog"("horseId");

-- CreateIndex
CREATE INDEX "DailyGroomingLog_groomUserId_idx" ON "DailyGroomingLog"("groomUserId");

-- CreateIndex
CREATE INDEX "DailyGroomingLog_shiftDate_idx" ON "DailyGroomingLog"("shiftDate");

-- CreateIndex
CREATE INDEX "Tournament_raceDate_idx" ON "Tournament"("raceDate");

-- CreateIndex
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");

-- CreateIndex
CREATE INDEX "TournamentRegistration_tournamentId_idx" ON "TournamentRegistration"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentRegistration_horseId_idx" ON "TournamentRegistration"("horseId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRegistration_tournamentId_horseId_key" ON "TournamentRegistration"("tournamentId", "horseId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentResult_registrationId_key" ON "TournamentResult"("registrationId");

-- CreateIndex
CREATE INDEX "FinancialInvoice_horseId_idx" ON "FinancialInvoice"("horseId");

-- CreateIndex
CREATE INDEX "FinancialInvoice_ownerId_idx" ON "FinancialInvoice"("ownerId");

-- CreateIndex
CREATE INDEX "FinancialInvoice_billingPeriod_idx" ON "FinancialInvoice"("billingPeriod");

-- CreateIndex
CREATE INDEX "AIInsight_horseId_idx" ON "AIInsight"("horseId");

-- CreateIndex
CREATE INDEX "AIInsight_insightType_idx" ON "AIInsight"("insightType");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityName_entityId_idx" ON "AuditLog"("entityName", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCatalog_code_key" ON "SupplyCatalog"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCatalog_name_key" ON "SupplyCatalog"("name");

-- CreateIndex
CREATE INDEX "SupplyCatalog_category_idx" ON "SupplyCatalog"("category");

-- CreateIndex
CREATE INDEX "SupplyCatalog_isActive_idx" ON "SupplyCatalog"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCatalog_code_key" ON "ShiftCatalog"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCatalog_name_key" ON "ShiftCatalog"("name");

-- CreateIndex
CREATE INDEX "ShiftCatalog_isActive_idx" ON "ShiftCatalog"("isActive");

-- CreateIndex
CREATE INDEX "ShiftCatalog_sortOrder_idx" ON "ShiftCatalog"("sortOrder");

-- CreateIndex
CREATE INDEX "ShiftRoster_date_zoneId_idx" ON "ShiftRoster"("date", "zoneId");

-- CreateIndex
CREATE INDEX "ShiftRoster_groomUserId_date_idx" ON "ShiftRoster"("groomUserId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRoster_date_shiftId_zoneId_groomUserId_key" ON "ShiftRoster"("date", "shiftId", "zoneId", "groomUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCareTask_taskCode_key" ON "DailyCareTask"("taskCode");

-- CreateIndex
CREATE INDEX "DailyCareTask_date_stallZoneId_idx" ON "DailyCareTask"("date", "stallZoneId");

-- CreateIndex
CREATE INDEX "DailyCareTask_assignedGroomUserId_date_idx" ON "DailyCareTask"("assignedGroomUserId", "date");

-- CreateIndex
CREATE INDEX "DailyCareTask_horseId_date_idx" ON "DailyCareTask"("horseId", "date");

-- CreateIndex
CREATE INDEX "DailyCareTask_isCompleted_idx" ON "DailyCareTask"("isCompleted");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCareTask_date_horseId_taskType_mealType_scheduledTime_key" ON "DailyCareTask"("date", "horseId", "taskType", "mealType", "scheduledTime");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentReport_incidentNumber_key" ON "IncidentReport"("incidentNumber");

-- CreateIndex
CREATE INDEX "IncidentReport_horseId_idx" ON "IncidentReport"("horseId");

-- CreateIndex
CREATE INDEX "IncidentReport_reportedById_idx" ON "IncidentReport"("reportedById");

-- CreateIndex
CREATE INDEX "IncidentReport_severity_status_idx" ON "IncidentReport"("severity", "status");

-- CreateIndex
CREATE INDEX "IncidentReport_createdAt_idx" ON "IncidentReport"("createdAt");

-- CreateIndex
CREATE INDEX "StockBalance_zoneId_idx" ON "StockBalance"("zoneId");

-- CreateIndex
CREATE INDEX "StockBalance_supplyId_idx" ON "StockBalance"("supplyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_zoneId_supplyId_key" ON "StockBalance"("zoneId", "supplyId");

-- CreateIndex
CREATE UNIQUE INDEX "RestockRequest_requestNumber_key" ON "RestockRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "RestockRequest_zoneId_idx" ON "RestockRequest"("zoneId");

-- CreateIndex
CREATE INDEX "RestockRequest_supplyId_idx" ON "RestockRequest"("supplyId");

-- CreateIndex
CREATE INDEX "RestockRequest_status_idx" ON "RestockRequest"("status");

-- CreateIndex
CREATE INDEX "RestockRequest_requestedById_idx" ON "RestockRequest"("requestedById");

-- AddForeignKey
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Horse" ADD CONSTRAINT "Horse_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Horse" ADD CONSTRAINT "Horse_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "StallZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StallAllocation" ADD CONSTRAINT "StallAllocation_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StallAllocation" ADD CONSTRAINT "StallAllocation_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StallAllocation" ADD CONSTRAINT "StallAllocation_assignedGroomUserId_fkey" FOREIGN KEY ("assignedGroomUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_trainerUserId_fkey" FOREIGN KEY ("trainerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_trainingPlanId_fkey" FOREIGN KEY ("trainingPlanId") REFERENCES "TrainingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_assignedStaffUserId_fkey" FOREIGN KEY ("assignedStaffUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_resultRecordedById_fkey" FOREIGN KEY ("resultRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_resultUpdatedById_fkey" FOREIGN KEY ("resultUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_veterinarianUserId_fkey" FOREIGN KEY ("veterinarianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InjuryLog" ADD CONSTRAINT "InjuryLog_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InjuryLog" ADD CONSTRAINT "InjuryLog_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalLock" ADD CONSTRAINT "MedicalLock_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalLock" ADD CONSTRAINT "MedicalLock_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalLock" ADD CONSTRAINT "MedicalLock_veterinarianUserId_fkey" FOREIGN KEY ("veterinarianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalLock" ADD CONSTRAINT "MedicalLock_unlockVetUserId_fkey" FOREIGN KEY ("unlockVetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreventiveSchedule" ADD CONSTRAINT "PreventiveSchedule_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreventiveSchedule" ADD CONSTRAINT "PreventiveSchedule_typeCatalogId_fkey" FOREIGN KEY ("typeCatalogId") REFERENCES "PreventiveTypeCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreventiveSchedule" ADD CONSTRAINT "PreventiveSchedule_veterinarianUserId_fkey" FOREIGN KEY ("veterinarianUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionPlan" ADD CONSTRAINT "NutritionPlan_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionPlan" ADD CONSTRAINT "NutritionPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionPlan" ADD CONSTRAINT "NutritionPlan_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyGroomingLog" ADD CONSTRAINT "DailyGroomingLog_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyGroomingLog" ADD CONSTRAINT "DailyGroomingLog_groomUserId_fkey" FOREIGN KEY ("groomUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_registeredByTrainerId_fkey" FOREIGN KEY ("registeredByTrainerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "TournamentRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialInvoice" ADD CONSTRAINT "FinancialInvoice_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialInvoice" ADD CONSTRAINT "FinancialInvoice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRoster" ADD CONSTRAINT "ShiftRoster_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ShiftCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRoster" ADD CONSTRAINT "ShiftRoster_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "StallZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRoster" ADD CONSTRAINT "ShiftRoster_groomUserId_fkey" FOREIGN KEY ("groomUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRoster" ADD CONSTRAINT "ShiftRoster_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareTask" ADD CONSTRAINT "DailyCareTask_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareTask" ADD CONSTRAINT "DailyCareTask_stallZoneId_fkey" FOREIGN KEY ("stallZoneId") REFERENCES "StallZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareTask" ADD CONSTRAINT "DailyCareTask_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareTask" ADD CONSTRAINT "DailyCareTask_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ShiftCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareTask" ADD CONSTRAINT "DailyCareTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareTask" ADD CONSTRAINT "DailyCareTask_assignedGroomUserId_fkey" FOREIGN KEY ("assignedGroomUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_stallZoneId_fkey" FOREIGN KEY ("stallZoneId") REFERENCES "StallZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "StallZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "SupplyCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_lastAdjustedById_fkey" FOREIGN KEY ("lastAdjustedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "StallZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "SupplyCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

