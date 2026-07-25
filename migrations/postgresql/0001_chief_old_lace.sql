CREATE TABLE "rate_limit_hits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rate_limit_hits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scope" varchar(60) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recovery_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_hash" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_tokens_hash_hex" CHECK ("recovery_tokens"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "telegram_sessions" (
	"chat_id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer,
	"step" varchar(40) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_sessions" ADD CONSTRAINT "telegram_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_hits_lookup_idx" ON "rate_limit_hits" USING btree ("scope","subject","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_tokens_hash_unique" ON "recovery_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "recovery_tokens_expiry_idx" ON "recovery_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "telegram_sessions_expiry_idx" ON "telegram_sessions" USING btree ("expires_at");