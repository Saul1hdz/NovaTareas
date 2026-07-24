const message = [
  'MIGRACIÓN BLOQUEADA POR SEGURIDAD.',
  '',
  'El flujo heredado contiene una migración que elimina usuarios, tareas y subtareas.',
  'No ejecutes los archivos de migrations/ manualmente.',
  'Se habilitará un nuevo flujo reproducible y no destructivo en el Bloque 2.',
];

console.error(message.join('\n'));
process.exitCode = 1;
