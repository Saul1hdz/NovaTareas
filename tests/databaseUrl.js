// Fuente única de la conexión de pruebas.
//
// Deliberadamente NO cae a DATABASE_URL: esa variable apunta a la base de
// desarrollo (`novatareas`), y el setup de pruebas borra el esquema completo.
// Para apuntar a otra base —por ejemplo en CI— se define TEST_DATABASE_URL.

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL?.trim()
  || 'postgresql://novatareas:devpassword@127.0.0.1:5434/novatareas_test';
