import { generateUuid } from '../uuid.js';

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe( 'generateUuid', () => {
	const originalRandomUUID = crypto.randomUUID;

	afterEach( () => {
		crypto.randomUUID = originalRandomUUID;
	} );

	it( 'uses crypto.randomUUID() when available', () => {
		crypto.randomUUID = jest.fn(
			() => '11111111-1111-4111-8111-111111111111'
		);
		expect( generateUuid() ).toBe( '11111111-1111-4111-8111-111111111111' );
		expect( crypto.randomUUID ).toHaveBeenCalled();
	} );

	it( 'falls back to crypto.getRandomValues() when randomUUID is unavailable', () => {
		crypto.randomUUID = undefined;
		const uuid = generateUuid();
		expect( uuid ).toMatch( UUID_V4_PATTERN );
	} );

	it( 'generates unique values on repeated calls', () => {
		crypto.randomUUID = undefined;
		const first = generateUuid();
		const second = generateUuid();
		expect( first ).not.toBe( second );
	} );
} );
