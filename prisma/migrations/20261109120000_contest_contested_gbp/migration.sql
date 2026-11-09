-- AlterTable: the total the renter contested, so a later approval can't climb back above it
ALTER TABLE "Contest" ADD COLUMN "contestedGBP" DECIMAL(10,2);

-- Existing contests: the newest final approval signed before the contest, not any lower one signed to resolve it.
UPDATE "Contest" c
SET "contestedGBP" = (
  SELECT ap."maxGBP"
  FROM "Approval" ap
  JOIN "Authorization" au ON au."id" = ap."authorizationId"
  WHERE au."hireId" = c."hireId" AND ap."finalCapture" AND ap."createdAt" <= c."createdAt"
  ORDER BY ap."createdAt" DESC
  LIMIT 1
);
