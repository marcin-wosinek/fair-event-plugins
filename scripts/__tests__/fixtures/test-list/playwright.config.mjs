// Fixture for shard-assignment.test.mjs: proves --test-list selects whole
// files by exact path. Never run against WordPress.
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './',
	testMatch: ['**/*.spec.mjs'],
});
