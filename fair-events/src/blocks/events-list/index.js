/**
 * WordPress dependencies
 */
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { Placeholder } from '@wordpress/components';
import { calendar } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

/**
 * Block metadata
 */
import metadata from './block.json';

/**
 * Block edit function
 */
function Edit() {
	const blockProps = useBlockProps();

	return (
		<div { ...blockProps }>
			<Placeholder
				icon={ calendar }
				label={ __( 'Events List', 'fair-events' ) }
				instructions={ __(
					'This block will display a filtered list of events. Block configuration coming soon.',
					'fair-events'
				) }
			/>
		</div>
	);
}

/**
 * Register block
 */
registerBlockType( metadata.name, {
	edit: Edit,
} );
