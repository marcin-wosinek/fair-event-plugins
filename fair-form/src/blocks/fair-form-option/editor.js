import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-option', {
	edit: ( { attributes, setAttributes } ) => {
		const { value } = attributes;

		const blockProps = useBlockProps( {
			className: 'fair-form-option',
		} );

		return (
			<div { ...blockProps }>
				<input
					type="text"
					value={ value }
					onChange={ ( e ) =>
						setAttributes( { value: e.target.value } )
					}
					placeholder={ __( 'Enter option text...', 'fair-form' ) }
					className="fair-form-option-input"
				/>
			</div>
		);
	},
	save: () => {
		return null;
	},
} );
