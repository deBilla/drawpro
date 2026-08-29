-- CreateTable
CREATE TABLE "TelemetryReport" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "mcpVersion" TEXT NOT NULL,
    "calls" INTEGER NOT NULL,
    "writes" INTEGER NOT NULL,
    "tools" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelemetryReport_installId_idx" ON "TelemetryReport"("installId");

-- CreateIndex
CREATE INDEX "TelemetryReport_receivedAt_idx" ON "TelemetryReport"("receivedAt");
