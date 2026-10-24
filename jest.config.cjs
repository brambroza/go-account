/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/?(*.)+(test|spec).ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/'],
  // นับ coverage ทุกไฟล์ใน domain/store/schemas แม้ไม่มี test import (ไม่อย่างนั้นตัวเลขสูงเกินจริง)
  collectCoverage: true,
  collectCoverageFrom: [
    'src/{domain,store,schemas}/**/*.{ts,tsx}',
    '!src/**/index.ts',
    '!src/store/seed.ts',
    '!src/**/__tests__/**',
  ],
  coverageReporters: ['text-summary', 'text'],
  coverageThreshold: {
    './src/domain/': { lines: 90, branches: 80 },
    './src/store/': { lines: 85 },
  },
};
