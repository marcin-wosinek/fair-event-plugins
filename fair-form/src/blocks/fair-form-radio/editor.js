import './style.css';

import { createBlock } from '@wordpress/blocks';
import { InnerBlocks } from '@wordpress/block-editor';
import { ChoiceQuestionEdit } from '../shared/ChoiceQuestionEdit.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-radio', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [ 'fair-form/fair-form-select-one' ],
				transform: ( attributes, innerBlocks ) => {
					return createBlock(
						'fair-form/fair-form-select-one',
						{ ...attributes, displayAs: 'select' },
						innerBlocks
					);
				},
			},
			{
				type: 'block',
				blocks: [ 'fair-form/fair-form-multiselect' ],
				transform: ( attributes, innerBlocks ) => {
					return createBlock(
						'fair-form/fair-form-multiselect',
						attributes,
						innerBlocks
					);
				},
			},
		],
	},
	edit: ( props ) => (
		<ChoiceQuestionEdit { ...props } className="fair-form-question-radio" />
	),
	save: () => {
		return <InnerBlocks.Content />;
	},
} );
