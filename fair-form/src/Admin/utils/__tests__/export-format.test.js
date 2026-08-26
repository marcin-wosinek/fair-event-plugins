/**
 * Unit tests for the bulk Questionnaire Responses export (#1448): a
 * file_upload answer must show its usable file URL/link instead of the
 * bare attachment ID, and the Markdown format must embed image answers
 * the same way the single-response export already does.
 */
import { buildBulkExportText } from '../export-format.js';

const photoColumn = {
	id: 'question_photo',
	label: 'Photo',
	getAnswer: ( { item } ) =>
		item.answers.find( ( a ) => a.question_key === 'photo' ),
	getValue: ( { item } ) => {
		const answer = item.answers.find( ( a ) => a.question_key === 'photo' );
		return answer?.file_url || answer?.answer_value || '';
	},
};

const textColumn = {
	id: 'question_text',
	label: 'Comment',
	getAnswer: ( { item } ) =>
		item.answers.find( ( a ) => a.question_key === 'text' ),
	getValue: ( { item } ) => {
		const answer = item.answers.find( ( a ) => a.question_key === 'text' );
		return answer?.answer_value || '';
	},
};

const IMAGE_RESPONSE = {
	id: 1,
	participant_id: 5,
	participant_name: 'Jane Doe',
	answers: [
		{
			question_key: 'photo',
			question_text: 'Photo',
			question_type: 'file_upload',
			answer_value: '42',
			file_url: 'https://example.com/wp-content/uploads/photo.jpg',
			is_image: true,
		},
		{
			question_key: 'text',
			question_text: 'Comment',
			question_type: 'short_text',
			answer_value: 'Looking forward to it',
		},
	],
};

const FILE_RESPONSE = {
	id: 2,
	participant_id: 6,
	participant_name: 'John Smith',
	answers: [
		{
			question_key: 'photo',
			question_text: 'Photo',
			question_type: 'file_upload',
			answer_value: '43',
			file_url: 'https://example.com/wp-content/uploads/doc.pdf',
			is_image: false,
		},
	],
};

describe( 'buildBulkExportText — markdown', () => {
	it( 'embeds an image file answer as a Markdown image, not a bare ID', () => {
		const result = buildBulkExportText( {
			responses: [ IMAGE_RESPONSE ],
			columns: [ photoColumn, textColumn ],
			format: 'markdown',
		} );

		expect( result ).toContain(
			'![Photo](https://example.com/wp-content/uploads/photo.jpg)'
		);
		expect( result ).not.toContain( '**Photo:** 42' );
	} );

	it( 'renders a non-image file answer as a Markdown link, not a bare ID', () => {
		const result = buildBulkExportText( {
			responses: [ FILE_RESPONSE ],
			columns: [ photoColumn ],
			format: 'markdown',
		} );

		expect( result ).toContain(
			'[Photo](https://example.com/wp-content/uploads/doc.pdf)'
		);
		expect( result ).not.toContain( '**Photo:** 43' );
	} );

	it( 'leaves a normal text answer unaffected', () => {
		const result = buildBulkExportText( {
			responses: [ IMAGE_RESPONSE ],
			columns: [ textColumn ],
			format: 'markdown',
		} );

		expect( result ).toContain( '**Comment:** Looking forward to it' );
	} );
} );

describe( 'buildBulkExportText — csv / oneline', () => {
	it( 'uses the file URL instead of the bare attachment ID in CSV', () => {
		const result = buildBulkExportText( {
			responses: [ IMAGE_RESPONSE ],
			columns: [ photoColumn ],
			format: 'csv',
		} );

		expect( result ).toContain(
			'https://example.com/wp-content/uploads/photo.jpg'
		);
		expect( result ).not.toContain( '\n42' );
	} );

	it( 'uses the file URL instead of the bare attachment ID in one-line-per-person', () => {
		const result = buildBulkExportText( {
			responses: [ IMAGE_RESPONSE ],
			columns: [ photoColumn ],
			format: 'oneline',
		} );

		expect( result ).toBe(
			'https://example.com/wp-content/uploads/photo.jpg'
		);
	} );
} );
