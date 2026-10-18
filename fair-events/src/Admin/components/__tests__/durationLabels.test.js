import { resetLocaleData, setLocaleData } from '@wordpress/i18n';
import { DurationOptions } from 'fair-events-shared';
import {
	formatDurationLabel,
	getDurationLabelConfig,
} from '../durationLabels.js';
import { loadFairEventsLocaleData } from './helpers/localeData.js';

const timedValues = [ 30, 60, 90, 120, 150, 180, 240, 360, 480 ];
const dayValues = [ 1, 2, 3, 4, 5, 6, 7 ];

const labels = ( values, unit ) =>
	new DurationOptions( { values, unit, ...getDurationLabelConfig() } )
		.getDurationOptions()
		.map( ( option ) => option.label );

afterEach( () => {
	resetLocaleData();
} );

describe( 'durationLabels in English', () => {
	it( 'keeps the existing picker labels', () => {
		expect( labels( timedValues, 'minutes' ) ).toEqual( [
			'Other',
			'30 minutes',
			'1 hour',
			'1 hour 30 minutes',
			'2 hours',
			'2 hours 30 minutes',
			'3 hours',
			'4 hours',
			'6 hours',
			'8 hours',
		] );
		expect( labels( dayValues, 'days' ) ).toEqual( [
			'Other',
			'1 day',
			'2 days',
			'3 days',
			'4 days',
			'5 days',
			'6 days',
			'7 days',
		] );
	} );

	it( 'uses singular forms for one minute and hours as a fraction', () => {
		expect( formatDurationLabel( 61, 'minutes' ) ).toBe(
			'1 hour 1 minute'
		);
		expect( formatDurationLabel( 1.5, 'hours' ) ).toBe(
			'1 hour 30 minutes'
		);
	} );
} );

describe( 'durationLabels in Spanish', () => {
	beforeEach( () => {
		setLocaleData( loadFairEventsLocaleData( 'es_ES' ), 'fair-events' );
	} );

	it( 'translates every timed and all-day option', () => {
		expect( labels( timedValues, 'minutes' ) ).toEqual( [
			'Otra',
			'30 minutos',
			'1 hora',
			'1 hora 30 minutos',
			'2 horas',
			'2 horas 30 minutos',
			'3 horas',
			'4 horas',
			'6 horas',
			'8 horas',
		] );
		expect( labels( dayValues, 'days' ) ).toEqual( [
			'Otra',
			'1 día',
			'2 días',
			'3 días',
			'4 días',
			'5 días',
			'6 días',
			'7 días',
		] );
	} );

	it( 'combines singular and plural parts', () => {
		expect( formatDurationLabel( 61, 'minutes' ) ).toBe(
			'1 hora 1 minuto'
		);
		expect( formatDurationLabel( 121, 'minutes' ) ).toBe(
			'2 horas 1 minuto'
		);
	} );
} );

describe( 'durationLabels in Polish', () => {
	beforeEach( () => {
		setLocaleData( loadFairEventsLocaleData( 'pl_PL' ), 'fair-events' );
	} );

	it( 'uses all three plural forms', () => {
		expect( formatDurationLabel( 60, 'minutes' ) ).toBe( '1 godzina' );
		expect( formatDurationLabel( 180, 'minutes' ) ).toBe( '3 godziny' );
		expect( formatDurationLabel( 360, 'minutes' ) ).toBe( '6 godzin' );
		expect( formatDurationLabel( 150, 'minutes' ) ).toBe(
			'2 godziny 30 minut'
		);
		expect( formatDurationLabel( 5, 'days' ) ).toBe( '5 dni' );
		expect( getDurationLabelConfig().otherLabel ).toBe( 'Inny' );
	} );
} );
