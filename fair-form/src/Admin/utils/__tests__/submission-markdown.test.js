/**
 * @jest-environment jsdom
 *
 * Exact-output tests for the single-submission Markdown export (#2433).
 * Both live export paths (Submission Detail "Copy markdown" and the bulk
 * Questionnaire Responses Markdown export) depend on this module, and
 * external tools consume the text, so the output is pinned byte for byte.
 */
import {
	fileAnswerMarkdown,
	submissionToMarkdown,
} from '../submission-markdown.js';

const ADMIN_BASE = 'http://localhost/wp-admin/admin.php';

function answer( overrides ) {
	return {
		question_key: 'q',
		question_text: 'Question',
		question_type: 'short_text',
		answer_value: '',
		...overrides,
	};
}

function submission( overrides ) {
	return {
		id: 42,
		participant_id: 0,
		participant_name: '',
		participant_email: '',
		created_at: '2026-01-15 10:00:00',
		answers: [],
		...overrides,
	};
}

beforeEach( () => {
	window.history.pushState(
		{},
		'',
		'/wp-admin/admin.php?page=fair-form-submission-detail&submission_id=42'
	);
} );

describe( 'fileAnswerMarkdown', () => {
	it( 'embeds an image answer', () => {
		expect(
			fileAnswerMarkdown(
				answer( {
					question_text: 'Photo',
					file_url: 'https://example.test/a.jpg',
					is_image: true,
				} )
			)
		).toBe( '![Photo](https://example.test/a.jpg)' );
	} );

	it( 'links a non-image file answer', () => {
		expect(
			fileAnswerMarkdown(
				answer( {
					question_text: 'CV',
					file_url: 'https://example.test/cv.pdf',
					is_image: false,
				} )
			)
		).toBe( '[CV](https://example.test/cv.pdf)' );
	} );

	it( 'uses an empty alt text when the question text is missing', () => {
		expect(
			fileAnswerMarkdown( {
				file_url: 'https://example.test/cv.pdf',
			} )
		).toBe( '[](https://example.test/cv.pdf)' );
	} );

	it( 'returns null without a file URL or answer', () => {
		expect( fileAnswerMarkdown( answer( { answer_value: '17' } ) ) ).toBe(
			null
		);
		expect( fileAnswerMarkdown( undefined ) ).toBe( null );
		expect( fileAnswerMarkdown( null ) ).toBe( null );
	} );
} );

describe( 'submissionToMarkdown', () => {
	it( 'serializes a participant-linked submission with every answer type', () => {
		const markdown = submissionToMarkdown(
			submission( {
				participant_id: 7,
				participant_name: 'Jane Doe',
				participant_email: 'jane@example.com',
				answers: [
					answer( {
						question_text: 'Comment',
						answer_value: 'Great workshop',
					} ),
					answer( {
						question_text: 'Agree',
						question_type: 'checkbox',
						answer_value: '1',
					} ),
					answer( {
						question_text: 'Topics',
						question_type: 'multiselect',
						answer_value: '["Yoga","Dance"]',
					} ),
					answer( {
						question_text: 'Photo',
						question_type: 'file_upload',
						answer_value: '99',
						file_url: 'https://example.test/a.jpg',
						is_image: true,
					} ),
					answer( {
						question_text: 'CV',
						question_type: 'file_upload',
						answer_value: '100',
						file_url: 'https://example.test/cv.pdf',
						is_image: false,
					} ),
				],
			} )
		);

		expect( markdown ).toBe(
			[
				`## [Jane Doe](${ ADMIN_BASE }?page=fair-audience-participant-detail&participant_id=7)`,
				'',
				'_Submitted 2026-01-15 10:00:00_',
				'',
				'### Comment',
				'',
				'Great workshop',
				'',
				'### Agree',
				'',
				'Yes',
				'',
				'### Topics',
				'',
				'Yoga, Dance',
				'',
				'### Photo',
				'',
				'![Photo](https://example.test/a.jpg)',
				'',
				'### CV',
				'',
				'[CV](https://example.test/cv.pdf)',
				'',
			].join( '\n' )
		);
	} );

	it.each( [
		[ 'checked', '1', 'Yes' ],
		[ 'unchecked', '0', 'No' ],
		[ 'empty', '', 'No' ],
		[ 'missing', undefined, 'No' ],
		[ 'non-canonical truthy', 'yes', 'No' ],
		[ 'numeric one', 1, 'No' ],
	] )( 'maps a %s checkbox value to "%s"', ( _label, value, expected ) => {
		const markdown = submissionToMarkdown(
			submission( {
				participant_name: 'Jane',
				answers: [
					answer( {
						question_text: 'Agree',
						question_type: 'checkbox',
						answer_value: value,
					} ),
				],
			} )
		);

		expect( markdown ).toBe(
			[
				'## Jane',
				'',
				'_Submitted 2026-01-15 10:00:00_',
				'',
				'### Agree',
				'',
				expected,
				'',
			].join( '\n' )
		);
	} );

	it.each( [
		[ 'a JSON array', '["A","B","C"]', 'A, B, C' ],
		[ 'an empty JSON array', '[]', '' ],
		[ 'malformed JSON', '["A",', '["A",' ],
		[ 'a JSON non-array', '{"a":1}', '{"a":1}' ],
		[ 'a plain string', 'Just one', 'Just one' ],
		[ 'an empty value', '', '' ],
	] )(
		'serializes a multiselect stored as %s',
		( _label, value, expected ) => {
			const markdown = submissionToMarkdown(
				submission( {
					participant_name: 'Jane',
					answers: [
						answer( {
							question_text: 'Topics',
							question_type: 'multiselect',
							answer_value: value,
						} ),
					],
				} )
			);

			expect( markdown ).toBe(
				[
					'## Jane',
					'',
					'_Submitted 2026-01-15 10:00:00_',
					'',
					'### Topics',
					'',
					expected,
					'',
				].join( '\n' )
			);
		}
	);

	it( 'prefers an attachment URL over the stored value for any type', () => {
		const markdown = submissionToMarkdown(
			submission( {
				participant_name: 'Jane',
				answers: [
					answer( {
						question_text: 'Proof',
						question_type: 'checkbox',
						answer_value: '1',
						file_url: 'https://example.test/proof.png',
						is_image: true,
					} ),
				],
			} )
		);

		expect( markdown ).toContain(
			'![Proof](https://example.test/proof.png)'
		);
		expect( markdown ).not.toContain( 'Yes' );
	} );

	it( 'falls back to the email when the name is missing', () => {
		expect(
			submissionToMarkdown(
				submission( { participant_email: 'jane@example.com' } )
			)
		).toBe(
			[
				'## jane@example.com',
				'',
				'_Submitted 2026-01-15 10:00:00_',
				'',
			].join( '\n' )
		);
	} );

	it( 'falls back to the submission ID without respondent details, date or answers', () => {
		expect(
			submissionToMarkdown(
				submission( {
					created_at: '',
					answers: undefined,
				} )
			)
		).toBe( [ '## #42', '' ].join( '\n' ) );
	} );

	it( 'links the ID fallback heading when a participant ID is present', () => {
		expect(
			submissionToMarkdown(
				submission( { participant_id: 7, created_at: null } )
			)
		).toBe(
			[
				`## [#42](${ ADMIN_BASE }?page=fair-audience-participant-detail&participant_id=7)`,
				'',
			].join( '\n' )
		);
	} );

	it( 'prints an empty line for a missing text answer and keeps question order', () => {
		expect(
			submissionToMarkdown(
				submission( {
					participant_name: 'Jane',
					answers: [
						answer( {
							question_text: 'Second',
							answer_value: 'B',
						} ),
						answer( {
							question_text: 'First',
							answer_value: undefined,
						} ),
					],
				} )
			)
		).toBe(
			[
				'## Jane',
				'',
				'_Submitted 2026-01-15 10:00:00_',
				'',
				'### Second',
				'',
				'B',
				'',
				'### First',
				'',
				'',
				'',
			].join( '\n' )
		);
	} );
} );
