const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'lucky2026',
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
