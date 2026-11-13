import { questionTextUpdates } from '../question-text.js';

const baseAttributes = {
	questionText: 'Which group?',
	questionKey: 'which_group',
};

describe( 'questionTextUpdates', () => {
	it( 'generates a key when there is none', () => {
		expect(
			questionTextUpdates(
				{ questionText: '', questionKey: '' },
				'Your T-shirt size?'
			)
		).toEqual( {
			questionText: 'Your T-shirt size?',
			questionKey: 'your_tshirt_size',
		} );
	} );

	it( 'keeps following the text while the key is the generated one', () => {
		expect(
			questionTextUpdates( baseAttributes, 'Which group do you join?' )
		).toEqual( {
			questionText: 'Which group do you join?',
			questionKey: 'which_group_do_you_join',
		} );
	} );

	it( 'keeps a customized key', () => {
		expect(
			questionTextUpdates(
				{ ...baseAttributes, questionKey: 'group' },
				'Which group do you join?'
			)
		).toEqual( { questionText: 'Which group do you join?' } );
	} );
} );
