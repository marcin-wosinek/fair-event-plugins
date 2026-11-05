import './style.css';

import { createBlock } from '@wordpress/blocks';
import { InnerBlocks } from '@wordpress/block-editor';
import { isCategorySource } from '../shared/category-options.js';
import { CategoryChoiceQuestionEdit } from '../shared/ChoiceQuestionEdit.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-select-one', {
	transforms: {
		to: [
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
			{
				type: 'block',
				blocks: [ 'fair-form/fair-form-radio' ],
				// Radio questions have no category source (#1999).
				isMatch: ( attributes ) => ! isCategorySource( attributes ),
				transform: ( attributes, innerBlocks ) => {
					return createBlock(
						'fair-form/fair-form-radio',
						attributes,
						innerBlocks
					);
				},
			},
		],
	},
	edit: ( props ) => (
		<CategoryChoiceQuestionEdit
			{ ...props }
			className="fair-form-question-select-one"
		/>
	),
	save: () => {
		return <InnerBlocks.Content />;
	},
} );
