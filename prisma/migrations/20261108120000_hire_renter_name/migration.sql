-- AlterTable
ALTER TABLE "Hire" ADD COLUMN "renterName" TEXT;

-- Every hire so far is demo data and every customer on it is fictional, so existing rows get made-up names.
UPDATE "Hire" SET "renterName" =
  (ARRAY['Amara','Ben','Chloe','Daniel','Eilidh','Farah','George','Hannah','Imran','Jess','Kofi','Lucy'])[(1 + abs(hashtext("hireRef")::bigint) % 12)::int]
  || ' ' ||
  (ARRAY['Ashworth','Bello','Clarke','Dhillon','Evans','Fraser','Gill','Hughes','Iqbal','Jones','Khan','Lowe'])[(1 + abs(hashtext(reverse("hireRef"))::bigint) % 12)::int];
