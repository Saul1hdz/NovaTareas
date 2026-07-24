import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  categories,
  taskComments,
  tasks,
  users,
} from './schema.js';

export function createPostgresRepositories(db) {
  return {
    users: {
      async findById(userId) {
        const [user] = await db.select().from(users)
          .where(eq(users.id, userId))
          .limit(1);
        return user || null;
      },

      async findByEmail(email) {
        const normalized = String(email || '').trim().toLowerCase();
        const [user] = await db.select().from(users)
          .where(sql`lower(${users.email}) = ${normalized}`)
          .limit(1);
        return user || null;
      },
    },

    tasks: {
      async findOwned(taskId, userId) {
        const [task] = await db.select().from(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
          .limit(1);
        return task || null;
      },

      async listOwned(userId, { archived = false } = {}) {
        return db.select({
          task: tasks,
          categoryName: categories.name,
        })
          .from(tasks)
          .leftJoin(categories, eq(tasks.categoryId, categories.id))
          .where(and(eq(tasks.userId, userId), eq(tasks.archived, archived)))
          .orderBy(asc(tasks.dueDate), desc(tasks.createdAt));
      },
    },

    comments: {
      async listOwned(taskId, userId) {
        return db.select({
          id: taskComments.id,
          body: taskComments.body,
          aiReply: taskComments.aiReply,
          createdAt: taskComments.createdAt,
        })
          .from(taskComments)
          .innerJoin(
            tasks,
            and(
              eq(taskComments.taskId, tasks.id),
              eq(tasks.userId, userId),
            ),
          )
          .where(eq(taskComments.taskId, taskId))
          .orderBy(asc(taskComments.createdAt));
      },
    },
  };
}
