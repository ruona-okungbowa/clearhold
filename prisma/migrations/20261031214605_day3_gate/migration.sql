-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "hireId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "serverAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "hireId" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clauseId" TEXT,
    "severity" TEXT,
    "box" JSONB,
    "pickupPhotoId" TEXT,
    "returnPhotoId" TEXT,
    "knownMarkId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "proposedGBP" DECIMAL(10,2),
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "maxGBP" DECIMAL(10,2) NOT NULL,
    "finalCapture" BOOLEAN NOT NULL,
    "approver" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "amountGBP" DECIMAL(10,2) NOT NULL,
    "finalCapture" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "hireRef" TEXT,
    "summary" TEXT NOT NULL,
    "status" INTEGER,
    "paypalDebugId" TEXT,
    "idempotencyKey" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "tokens" INTEGER,
    "latencyMs" INTEGER,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Photo_hireId_stage_angle_key" ON "Photo"("hireId", "stage", "angle");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_approvalId_key" ON "Capture"("approvalId");

-- CreateIndex
CREATE INDEX "AuditEvent_hireRef_idx" ON "AuditEvent"("hireRef");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_hireId_fkey" FOREIGN KEY ("hireId") REFERENCES "Hire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_hireId_fkey" FOREIGN KEY ("hireId") REFERENCES "Hire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
