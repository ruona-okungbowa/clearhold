-- CreateTable
CREATE TABLE "Hire" (
    "id" TEXT NOT NULL,
    "hireRef" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "itemRef" TEXT NOT NULL,
    "feeGBP" DECIMAL(10,2) NOT NULL,
    "depositGBP" DECIMAL(10,2) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "dueBackAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Authorization" (
    "id" TEXT NOT NULL,
    "hireId" TEXT NOT NULL,
    "parentId" TEXT,
    "amountGBP" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "honourEndsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioLayout" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hire_hireRef_key" ON "Hire"("hireRef");

-- CreateIndex
CREATE UNIQUE INDEX "StudioLayout_name_key" ON "StudioLayout"("name");

-- AddForeignKey
ALTER TABLE "Authorization" ADD CONSTRAINT "Authorization_hireId_fkey" FOREIGN KEY ("hireId") REFERENCES "Hire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
