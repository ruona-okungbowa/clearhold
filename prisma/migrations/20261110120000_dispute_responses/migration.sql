-- AlterTable: when staff accepted a PayPal dispute and PayPal refunded the renter
ALTER TABLE "Hire" ADD COLUMN "refundedViaDisputeAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DisputeCase" (
    "id" TEXT NOT NULL,
    "hireRef" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "amountGBP" DECIMAL(10,2),
    "outcome" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeResponse" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "hireRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" VARCHAR(2000) NOT NULL,
    "photoIds" TEXT[],
    "amountGBP" DECIMAL(10,2),
    "requestId" TEXT NOT NULL,
    "paypalDebugId" TEXT,
    "status" TEXT NOT NULL,

    CONSTRAINT "DisputeResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisputeCase_hireRef_idx" ON "DisputeCase"("hireRef");
CREATE UNIQUE INDEX "DisputeResponse_requestId_key" ON "DisputeResponse"("requestId");
CREATE INDEX "DisputeResponse_hireRef_idx" ON "DisputeResponse"("hireRef");
CREATE UNIQUE INDEX "DisputeResponse_disputeId_stage_key" ON "DisputeResponse"("disputeId", "stage");
