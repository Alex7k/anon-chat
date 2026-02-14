-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");
