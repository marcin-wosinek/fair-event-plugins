import { getSettings, setSettings } from '@wordpress/date';
import { isValidPhoneNumber } from '../questionnaire.js';
import {
	PHONE_PLACEHOLDER_BY_TIMEZONE,
	FALLBACK_PHONE_PLACEHOLDER,
	getPhonePlaceholderForTimezone,
	getSitePhonePlaceholder,
	resolvePhonePlaceholder,
} from '../phone-placeholder.js';

describe( 'getPhonePlaceholderForTimezone', () => {
	it.each( Object.entries( PHONE_PLACEHOLDER_BY_TIMEZONE ) )(
		'maps %s to its listed example',
		( timezoneString, example ) => {
			expect( getPhonePlaceholderForTimezone( timezoneString ) ).toBe(
				example
			);
		}
	);

	it( 'every shipped example passes isValidPhoneNumber', () => {
		const examples = [
			...new Set( Object.values( PHONE_PLACEHOLDER_BY_TIMEZONE ) ),
			FALLBACK_PHONE_PLACEHOLDER,
		];
		examples.forEach( ( example ) => {
			expect( isValidPhoneNumber( example ) ).toBe( true );
		} );
	} );

	it( 'falls back for an unmapped timezone', () => {
		expect( getPhonePlaceholderForTimezone( 'Pacific/Auckland' ) ).toBe(
			FALLBACK_PHONE_PLACEHOLDER
		);
	} );

	it( 'falls back for an empty or undefined timezone', () => {
		expect( getPhonePlaceholderForTimezone( '' ) ).toBe(
			FALLBACK_PHONE_PLACEHOLDER
		);
		expect( getPhonePlaceholderForTimezone( undefined ) ).toBe(
			FALLBACK_PHONE_PLACEHOLDER
		);
	} );

	it( 'falls back for a legacy raw UTC offset value', () => {
		expect( getPhonePlaceholderForTimezone( 'UTC+2' ) ).toBe(
			FALLBACK_PHONE_PLACEHOLDER
		);
	} );
} );

describe( 'resolvePhonePlaceholder', () => {
	it( 'prefers an explicit attribute value over the derived example', () => {
		expect(
			resolvePhonePlaceholder( '+1 555 0100', 'Europe/Madrid' )
		).toBe( '+1 555 0100' );
	} );

	it( 'falls through to the derived example for a whitespace-only value', () => {
		expect( resolvePhonePlaceholder( '   ', 'Europe/Madrid' ) ).toBe(
			'+34 612 34 56 78'
		);
	} );

	it( 'falls through to the derived example for an empty value', () => {
		expect( resolvePhonePlaceholder( '', 'Europe/Brussels' ) ).toBe(
			'+32 470 12 34 56'
		);
	} );
} );

describe( 'getSitePhonePlaceholder', () => {
	it( 'reads the timezone from @wordpress/date settings', () => {
		const settings = getSettings();

		setSettings( {
			...settings,
			timezone: {
				...settings.timezone,
				string: 'Europe/Madrid',
			},
		} );

		try {
			expect( getSitePhonePlaceholder() ).toBe( '+34 612 34 56 78' );
		} finally {
			setSettings( settings );
		}
	} );
} );
