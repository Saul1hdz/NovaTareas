CREATE TYPE "public"."recommendation_source" AS ENUM('zai', 'ollama', 'history', 'rules');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('baja', 'media', 'alta', 'urgente');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pendiente', 'en progreso', 'completada');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('estudiante', 'empleado', 'comun');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_length" CHECK (char_length(btrim("categories"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "categories_color_hex" CHECK ("categories"."color" IS NULL OR "categories"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "security_questions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"q1_index" integer NOT NULL,
	"q1_answer" text NOT NULL,
	"q2_index" integer NOT NULL,
	"q2_answer" text NOT NULL,
	"recovery_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	CONSTRAINT "security_questions_q1_range" CHECK ("security_questions"."q1_index" BETWEEN 0 AND 9),
	CONSTRAINT "security_questions_q2_range" CHECK ("security_questions"."q2_index" BETWEEN 0 AND 9),
	CONSTRAINT "security_questions_distinct" CHECK ("security_questions"."q1_index" <> "security_questions"."q2_index"),
	CONSTRAINT "security_questions_attempts_nonnegative" CHECK ("security_questions"."recovery_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subtasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subtasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subtasks_text_length" CHECK (char_length(btrim("subtasks"."text")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"body" text NOT NULL,
	"ai_reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_comments_body_length" CHECK (char_length(btrim("task_comments"."body")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "task_embeddings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_embeddings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"vector" jsonb NOT NULL,
	"model" varchar(120) NOT NULL,
	"dimension" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_embeddings_dimension_positive" CHECK ("task_embeddings"."dimension" > 0),
	CONSTRAINT "task_embeddings_vector_array" CHECK (jsonb_typeof("task_embeddings"."vector") = 'array'),
	CONSTRAINT "task_embeddings_dimension_matches" CHECK (jsonb_array_length("task_embeddings"."vector") = "task_embeddings"."dimension")
);
--> statement-breakpoint
CREATE TABLE "task_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"field" varchar(80) NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_recommendations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_recommendations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer,
	"user_id" integer NOT NULL,
	"source" "recommendation_source" NOT NULL,
	"model" varchar(120),
	"prompt_version" varchar(80),
	"input_snapshot" jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_recommendations_text_length" CHECK (char_length(btrim("task_recommendations"."recommendation")) BETWEEN 1 AND 12000)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"category_id" integer,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" "task_priority" DEFAULT 'media' NOT NULL,
	"status" "task_status" DEFAULT 'pendiente' NOT NULL,
	"label" varchar(80) DEFAULT '' NOT NULL,
	"due_date" date,
	"reminder_at" timestamp with time zone,
	"completed" boolean DEFAULT false NOT NULL,
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"overdue_notified" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"observations" text,
	"what_worked" text,
	"what_failed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title_length" CHECK (char_length(btrim("tasks"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "tasks_description_length" CHECK (char_length("tasks"."description") <= 2000),
	CONSTRAINT "tasks_label_length" CHECK (char_length("tasks"."label") <= 80),
	CONSTRAINT "tasks_completed_matches_status" CHECK ("tasks"."completed" = ("tasks"."status" = 'completada')),
	CONSTRAINT "tasks_completed_at_contract" CHECK (("tasks"."completed" AND "tasks"."completed_at" IS NOT NULL) OR (NOT "tasks"."completed" AND "tasks"."completed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telegram_link_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_codes_hash_hex" CHECK ("telegram_link_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" varchar(120) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"telefono" varchar(30) NOT NULL,
	"user_type" "user_type" DEFAULT 'comun' NOT NULL,
	"avatar_url" text,
	"telegram_chat_id" varchar(64),
	"theme" "theme" DEFAULT 'dark' NOT NULL,
	"google_access_token" text,
	"google_refresh_token" text,
	"google_token_expiry" timestamp with time zone,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_length" CHECK (char_length(btrim("users"."username")) BETWEEN 1 AND 120),
	CONSTRAINT "users_full_name_length" CHECK (char_length(btrim("users"."full_name")) BETWEEN 1 AND 120),
	CONSTRAINT "users_google_access_token_encrypted" CHECK ("users"."google_access_token" IS NULL OR "users"."google_access_token" LIKE 'enc:v1:%'),
	CONSTRAINT "users_google_refresh_token_encrypted" CHECK ("users"."google_refresh_token" IS NULL OR "users"."google_refresh_token" LIKE 'enc:v1:%')
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_questions" ADD CONSTRAINT "security_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_embeddings" ADD CONSTRAINT "task_embeddings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_embeddings" ADD CONSTRAINT "task_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recommendations" ADD CONSTRAINT "task_recommendations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recommendations" ADD CONSTRAINT "task_recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_lower_unique" ON "categories" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "categories_user_id_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_questions_user_unique" ON "security_questions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subtasks_task_id_idx" ON "subtasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_created_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_comments_user_id_idx" ON "task_comments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_embeddings_task_unique" ON "task_embeddings" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_embeddings_user_id_idx" ON "task_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_history_task_changed_idx" ON "task_history" USING btree ("task_id","changed_at");--> statement-breakpoint
CREATE INDEX "task_history_user_id_idx" ON "task_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_recommendations_task_created_idx" ON "task_recommendations" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_recommendations_user_created_idx" ON "task_recommendations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_user_archived_idx" ON "tasks" USING btree ("user_id","archived");--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_user_priority_idx" ON "tasks" USING btree ("user_id","priority");--> statement-breakpoint
CREATE INDEX "tasks_user_due_date_idx" ON "tasks" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_reminder_at_idx" ON "tasks" USING btree ("reminder_at","reminder_sent");--> statement-breakpoint
CREATE INDEX "tasks_category_id_idx" ON "tasks" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_codes_hash_unique" ON "telegram_link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_user_id_idx" ON "telegram_link_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_expiry_idx" ON "telegram_link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_chat_id_unique" ON "users" USING btree ("telegram_chat_id") WHERE "users"."telegram_chat_id" IS NOT NULL;