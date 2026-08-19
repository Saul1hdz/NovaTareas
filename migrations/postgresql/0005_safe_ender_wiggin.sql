ALTER TABLE "tasks" ADD COLUMN "last_nudge_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tasks_last_nudge_idx" ON "tasks" USING btree ("archived","completed","last_nudge_at");