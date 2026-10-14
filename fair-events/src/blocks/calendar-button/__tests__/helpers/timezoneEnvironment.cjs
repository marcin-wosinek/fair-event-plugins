/**
 * jsdom test environment that runs a test file in a fixed timezone.
 *
 * Assigning `process.env.TZ` inside a test file only changes Jest's sandboxed
 * copy of the environment, so the timezone has to be set here, on the real
 * process. Select the zone with a `@timezone` docblock pragma next to
 * `@jest-environment`; the previous value is restored on teardown so other
 * test files in the same worker keep the host timezone.
 */

const { TestEnvironment } = require( 'jest-environment-jsdom' );

class TimezoneEnvironment extends TestEnvironment {
	constructor( config, context ) {
		super( config, context );
		this.timezone = context.docblockPragmas.timezone;
		this.originalTimezone = process.env.TZ;
	}

	async setup() {
		await super.setup();
		if ( this.timezone ) {
			process.env.TZ = this.timezone;
		}
	}

	async teardown() {
		if ( this.originalTimezone === undefined ) {
			delete process.env.TZ;
		} else {
			process.env.TZ = this.originalTimezone;
		}
		await super.teardown();
	}
}

module.exports = TimezoneEnvironment;
