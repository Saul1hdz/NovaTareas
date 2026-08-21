CREATE TABLE "job_runs" (
	"job" varchar(60) PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok" boolean NOT NULL,
	"last_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "job_runs_job_length" CHECK (char_length(btrim("job_runs"."job")) BETWEEN 1 AND 60)
);
