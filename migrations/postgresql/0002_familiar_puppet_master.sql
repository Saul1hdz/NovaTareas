CREATE TYPE "public"."collaborator_role" AS ENUM('lector', 'comentarista', 'editor');--> statement-breakpoint
CREATE TYPE "public"."comment_kind" AS ENUM('comentario', 'idea');--> statement-breakpoint
CREATE TYPE "public"."task_visibility" AS ENUM('privada', 'colaborativa');--> statement-breakpoint
CREATE TABLE "task_collaborators" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_collaborators_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "collaborator_role" DEFAULT 'comentarista' NOT NULL,
	"invited_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_invites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"role" "collaborator_role" DEFAULT 'comentarista' NOT NULL,
	"created_by" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 0 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_invites_hash_hex" CHECK ("task_invites"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "task_invites_max_uses_nonnegative" CHECK ("task_invites"."max_uses" >= 0),
	CONSTRAINT "task_invites_uses_nonnegative" CHECK ("task_invites"."uses" >= 0)
);
--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "kind" "comment_kind" DEFAULT 'comentario' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "visibility" "task_visibility" DEFAULT 'privada' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_invites" ADD CONSTRAINT "task_invites_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_invites" ADD CONSTRAINT "task_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_collaborators_task_user_unique" ON "task_collaborators" USING btree ("task_id","user_id");--> statement-breakpoint
CREATE INDEX "task_collaborators_user_idx" ON "task_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_invites_hash_unique" ON "task_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "task_invites_task_idx" ON "task_invites" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_invites_expiry_idx" ON "task_invites" USING btree ("expires_at");