-- CreateTable
CREATE TABLE "household_member" (
    "id" SERIAL NOT NULL,
    "household_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT,
    "is_self" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "use_yn" CHAR(1) NOT NULL DEFAULT 'Y',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "household_member_household_id_idx" ON "household_member"("household_id");

-- AddForeignKey
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
