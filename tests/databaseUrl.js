// Fuente única de la conexión de pruebas.
//
// Deliberadamente NO cae a DATABASE_URL: esa variable apunta a la base de
// desarrollo (`novatareas`), y el setup de pruebas borra y recrea el esquema
// completo. Para apuntar a otra base —por ejemplo en CI— se define
// TEST_DATABASE_URL.
//
// El valor por defecto es el PostgreSQL de compose.dev.yml, para que `npm test`
// funcione recién clonado el repositorio sin exportar nada.

const FALLBACK = 'postgresql://novatareas:devpassword@127.0.0.1:5434/novatareas_test';

const configurada = process.env.TEST_DATABASE_URL?.trim() || FALLBACK;

// El sufijo `_test` es obligatorio y se comprueba aquí en lugar de confiar en
// que quien exporta la variable se acuerde. Sin esta guarda, un
// TEST_DATABASE_URL apuntando por error a la base de desarrollo o a producción
// haría que la suite la borrara entera al arrancar. El propio comentario del
// workflow de CI ya daba la regla por supuesta; ahora se aplica.
const nombreBase = new URL(configurada).pathname.slice(1);
if (!nombreBase.endsWith('_test')) {
  throw new Error(
    `TEST_DATABASE_URL apunta a la base "${nombreBase}", que no termina en _test. ` +
    'La suite borra el esquema completo al arrancar: se niega a hacerlo sobre una ' +
    'base que no esté marcada como de pruebas.'
  );
}

export const TEST_DATABASE_URL = configurada;
