-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "setBy" TEXT,
ADD COLUMN     "setGBP" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "ItemMark" (
    "id" TEXT NOT NULL,
    "itemRef" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "firstSeen" TEXT NOT NULL,
    "hireId" TEXT,
    "photoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemMark_itemRef_idx" ON "ItemMark"("itemRef");

-- AddForeignKey
ALTER TABLE "ItemMark" ADD CONSTRAINT "ItemMark_hireId_fkey" FOREIGN KEY ("hireId") REFERENCES "Hire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: the constant this table replaces
INSERT INTO "ItemMark" ("id", "itemRef", "description", "firstSeen")
VALUES ('KM-38-CUFF', 'BLZ-NAVY-40R', 'Faint mark on the left cuff', 'hire #38');
