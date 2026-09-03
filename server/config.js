const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const staffAccessCode = process.env.STAFF_ACCESS_CODE || '1009';
const staffSessionSecret =
  process.env.STAFF_SESSION_SECRET ||
  process.env.SESSION_SECRET ||
  `lucky-horse-staff-${staffAccessCode}-${process.env.COMPUTERNAME || 'local'}`;
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');

if (isProduction) {
  if (!process.env.STAFF_ACCESS_CODE) {
    throw new Error('STAFF_ACCESS_CODE must be set in production.');
  }
  if (
    !process.env.STAFF_SESSION_SECRET ||
    staffSessionSecret.length < 32 ||
    staffSessionSecret.startsWith('replace-')
  ) {
    throw new Error('STAFF_SESSION_SECRET must contain at least 32 characters in production.');
  }
  try {
    const publicUrl = new URL(publicBaseUrl);
    const forbiddenHost =
      publicUrl.hostname === 'localhost' ||
      publicUrl.hostname === '127.0.0.1' ||
      publicUrl.hostname === '0.0.0.0' ||
      publicUrl.hostname === '[::1]' ||
      publicUrl.hostname.endsWith('.local');
    if (publicUrl.protocol !== 'https:' || forbiddenHost) {
      throw new Error('not a public HTTPS URL');
    }
  } catch {
    throw new Error('PUBLIC_BASE_URL must be a public HTTPS URL in production.');
  }
}

module.exports = {
  port: process.env.PORT || 3000,
  publicBaseUrl,
  staffAccessCode,
  staffSessionSecret,
  corsOptions: {
    origin: publicBaseUrl || '*',
    methods: ['GET', 'POST']
  },
  paths: {
    maps: path.join(__dirname, '../data/maps'),
    quizzes: path.join(__dirname, '../data/quizzes'),
    items: path.join(__dirname, '../data/items.json'),
    home: path.join(__dirname, '../home'),
    docs: path.join(__dirname, '../docs'),
    host: path.join(__dirname, '../host'),
    hostAssets: path.join(__dirname, '../host/assets'),
    guest: path.join(__dirname, '../guest'),
    control: path.join(__dirname, '../control'),
    admin: path.join(__dirname, '../admin'),
    shared: path.join(__dirname, '../shared')
  }
};
