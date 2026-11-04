// Se ejecuta antes de importar cada archivo de pruebas: la configuración de env.ts se lee de aquí
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/ourhouse_test';
process.env.JWT_SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
process.env.APP_URL = 'http://app.test';
