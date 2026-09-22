import {
	isEventsListPattern,
	classifyPatternContent,
	PATTERN_TYPE_QUERY_LOOP,
	PATTERN_TYPE_PER_EVENT,
	PATTERN_TYPE_UNAVAILABLE,
} from '../patternCompatibility.js';

describe( 'isEventsListPattern', () => {
	it( 'accepts the bundled list/grid patterns', () => {
		expect( isEventsListPattern( 'fair-events/event-list' ) ).toBe( true );
		expect( isEventsListPattern( 'fair-events/event-grid' ) ).toBe( true );
	} );

	it( 'rejects calendar-only patterns', () => {
		expect(
			isEventsListPattern( 'fair-events/calendar-event-simple' )
		).toBe( false );
	} );

	it( 'rejects schedule-only patterns', () => {
		expect(
			isEventsListPattern( 'fair-events/schedule-event-with-time' )
		).toBe( false );
	} );

	it( 'accepts an unrelated pattern name', () => {
		expect( isEventsListPattern( 'core/some-pattern' ) ).toBe( true );
	} );
} );

describe( 'classifyPatternContent', () => {
	it( 'classifies wp:query content as query-loop', () => {
		expect(
			classifyPatternContent(
				'<!-- wp:query {"query":{}} --><div></div><!-- /wp:query -->'
			)
		).toBe( PATTERN_TYPE_QUERY_LOOP );
	} );

	it( 'classifies wp:post-template content as query-loop', () => {
		expect(
			classifyPatternContent(
				'<!-- wp:post-template --><!-- /wp:post-template -->'
			)
		).toBe( PATTERN_TYPE_QUERY_LOOP );
	} );

	it( 'classifies plain block content as per-event', () => {
		expect(
			classifyPatternContent(
				'<!-- wp:html -->{{title}}<!-- /wp:html -->'
			)
		).toBe( PATTERN_TYPE_PER_EVENT );
	} );

	it( 'classifies empty content as unavailable', () => {
		expect( classifyPatternContent( '' ) ).toBe( PATTERN_TYPE_UNAVAILABLE );
		expect( classifyPatternContent( undefined ) ).toBe(
			PATTERN_TYPE_UNAVAILABLE
		);
	} );
} );
