-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "hireId" TEXT NOT NULL,
    "findingId" TEXT,
    "note" VARCHAR(500) NOT NULL,
    "photoId" TEXT,
    "status" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one contest per hire
CREATE UNIQUE INDEX "Contest_hireId_key" ON "Contest"("hireId");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_hireId_fkey" FOREIGN KEY ("hireId") REFERENCES "Hire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
