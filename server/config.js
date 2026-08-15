const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const adminUser = process.env.ADMIN_USER || (isProduction ? '' : 'admin');
const adminPass = process.env.ADMIN_PASS || (isProduction ? '' : 'lucky2026');

if (isProduction && (!adminUser || !adminPass)) {
  throw new Error('ADMIN_USER and ADMIN_PASS must be set in production.');
}

module.exports = {
  port: process.env.PORT || 3000,
  adminUser,
  adminPass,
  corsOptions: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  paths: {
    maps: path.join(__dirname, '../data/maps'),
    quizzes: path.join(__dirname, '../data/quizzes'),
    items: path.join(__dirname, '../data/items.json'),
    host: path.join(__dirname, '../host'),
    guest: path.join(__dirname, '../guest'),
    admin: path.join(__dirname, '../admin'),
    shared: path.join(__dirname, '../shared')
  }
};
